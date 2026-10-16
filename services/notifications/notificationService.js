const mongoose = require('mongoose');
const { Notification } = require('../../models/Notification');
const SocietyMembership = require('../../models/SocietyMembership');
const User = require('../../models/User');
const { getEmailAdapter } = require('./emailAdapter');

/**
 * Architectural Note on Delivery Guarantees and Email Retry Window:
 *
 * Standalone MongoDB deployments (without a replica set) do not support multi-collection
 * transactions or retryable writes. Therefore, an atomic two-phase transactional outbox
 * across 'issues' and 'notifications' cannot be implemented without requiring a replica set.
 *
 * We implement a best-effort delivery architecture:
 * 1. The issue mutation is committed to MongoDB first as the single source of truth.
 * 2. Notification processing executes post-save in an isolated, non-blocking execution block.
 * 3. In-app notifications are persisted before any email dispatch is attempted.
 * 4. Duplicate processing for in-app notifications is strictly suppressed via database-enforced
 *    unique idempotency keys tied to the immutable subdocument event ID (issue.history[]._id).
 * 5. Email Pending/Retry Limitation:
 *    When email delivery is enabled, the notification document is first persisted with
 *    emailStatus: 'pending'. If a crash or network partition occurs between upstream SMTP
 *    acceptance and persisting emailStatus: 'sent', a subsequent retry mechanism could re-send
 *    the email, potentially resulting in a duplicate email delivery. Exactly-once email delivery
 *    cannot be guaranteed across network boundaries without idempotent upstream email providers
 *    (e.g., SMTP gateways supporting client-supplied deduplication tokens) or distributed 2PC.
 * 6. Submitter Recipient Verification:
 *    Residents receive notifications about an issue only if they maintain an 'active' membership
 *    in the same society as the issue. Inactive, pending, or non-members are strictly excluded.
 */

/**
 * Render privacy-safe, allowlisted notification content.
 * Never serializes raw issue objects, costs, provider contact cards, or internal notes to residents.
 */
function renderNotificationContent({ action, issue, event, recipientRole }) {
  const safeTitle = (issue.title || 'Issue').substring(0, 80);
  const toStatus = event.toStatus || issue.status;

  // Determine specific notification type
  let type = 'status_changed';
  let title = `Issue Status Changed: ${safeTitle}`;
  let message = `Issue "${safeTitle}" status changed to ${toStatus}.`;

  if (action === 'created') {
    type = 'issue_created';
    title = `New Issue Reported: ${safeTitle}`;
    const locationStr = issue.location && issue.location.type === 'unit'
      ? `Unit ${issue.location.flatOrUnit || issue.location.flatNumber || ''}`.trim()
      : 'Common Area';
    message = `A new ${issue.category} issue "${safeTitle}" (${issue.priority} priority) was submitted in ${locationStr}.`;
  } else if (action === 'status_change') {
    switch (toStatus) {
      case 'scheduled':
        type = 'repair_scheduled';
        title = `Repair Scheduled: ${safeTitle}`;
        const dateStr = issue.scheduledDate
          ? new Date(issue.scheduledDate).toLocaleDateString()
          : 'scheduled date';
        message = `A repair for issue "${safeTitle}" has been scheduled for ${dateStr}.`;
        break;
      case 'completion_submitted':
        type = 'completion_submitted';
        title = `Repair Completed: ${safeTitle}`;
        // CRITICAL PRIVACY RULE: Never include costs or provider details in resident messages
        message = `Repair work for issue "${safeTitle}" has been completed and submitted for committee verification.`;
        break;
      case 'verified_closed':
        type = 'verified_closed';
        title = `Issue Verified & Closed: ${safeTitle}`;
        message = `Issue "${safeTitle}" has been verified and marked as closed.`;
        break;
      case 'verification_rejected':
        type = 'verification_rejected';
        title = `Repair Verification Rejected: ${safeTitle}`;
        message = `The repair for issue "${safeTitle}" was not approved during verification and has been returned for rework.`;
        break;
      case 'reopened':
        type = 'reopened';
        title = `Issue Reopened: ${safeTitle}`;
        message = `Issue "${safeTitle}" has been reopened for further attention.`;
        break;
      case 'cancelled':
        type = 'cancelled';
        title = `Issue Cancelled: ${safeTitle}`;
        message = `Issue "${safeTitle}" has been cancelled.`;
        break;
      default:
        type = 'status_changed';
        title = `Issue Status Updated: ${safeTitle}`;
        message = `Issue "${safeTitle}" is now marked as ${toStatus}.`;
        break;
    }
  } else if (action === 'progress_recorded') {
    type = 'progress_recorded';
    title = `Repair Progress: ${safeTitle}`;
    const noteText = event.note ? event.note.substring(0, 250) : '';
    message = noteText ? `Progress update on "${safeTitle}": ${noteText}` : `Progress was recorded on issue "${safeTitle}".`;
  } else if (action === 'note_added') {
    type = 'note_added';
    if (event.isInternal) {
      title = `Internal Staff Note: ${safeTitle}`;
      const noteText = event.note ? event.note.substring(0, 250) : '';
      message = `Internal committee note on "${safeTitle}": ${noteText}`;
    } else {
      title = `New Note: ${safeTitle}`;
      const noteText = event.note ? event.note.substring(0, 250) : '';
      message = `A note was added to issue "${safeTitle}": ${noteText}`;
    }
  } else if (action === 'details_updated') {
    type = 'details_updated';
    title = `Issue Details Updated: ${safeTitle}`;
    message = `Details for issue "${safeTitle}" have been updated.`;
  }

  return { type, title, message };
}

/**
 * Determine explicit recipients based on event action, actor role, and issue ownership.
 * Strictly suppresses self-notifications and cross-society routing.
 */
async function resolveRecipients({ issue, event, actor, societyId }) {
  const actorIdStr = actor._id ? actor._id.toString() : '';
  const recipients = [];

  // Helper to fetch active society admins
  async function getActiveSocietyAdmins() {
    const adminMemberships = await SocietyMembership.find({
      society: societyId,
      role: 'admin',
      status: 'active'
    })
      .populate('user', 'name email')
      .lean();

    return adminMemberships
      .filter((m) => m.user && m.user._id)
      .map((m) => ({
        _id: m.user._id,
        email: m.user.email,
        name: m.user.name,
        role: 'admin'
      }))
      .filter((admin) => admin._id.toString() !== actorIdStr); // Self-suppression
  }

  // Helper to fetch issue submitter with active membership in the issue's society
  async function getSubmitter() {
    const rawSubmitter = issue.submittingResident || issue.reportedBy;
    const submitterId = rawSubmitter && rawSubmitter._id ? rawSubmitter._id : rawSubmitter;
    if (!submitterId) return null;
    if (submitterId.toString() === actorIdStr) return null; // Self-suppression

    // Strictly verify that the submitter has an active membership in this society
    const activeMembership = await SocietyMembership.findOne({
      user: submitterId,
      society: societyId,
      status: 'active'
    }).lean();

    if (!activeMembership) {
      return null; // Submitter is inactive, pending, or not a member of this society
    }

    const user = await User.findById(submitterId).select('name email').lean();
    if (!user) return null;

    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      role: activeMembership.role || 'resident'
    };
  }

  const { action, isInternal } = event;

  if (isInternal) {
    // STRICT RULE: Internal notes and internal progress are visible ONLY to society admins
    const admins = await getActiveSocietyAdmins();
    return admins;
  }

  if (action === 'created') {
    // New issue reported: Notify active society admins
    const admins = await getActiveSocietyAdmins();
    return admins;
  }

  if (action === 'status_change') {
    const toStatus = event.toStatus || issue.status;
    const isResidentActor = actor.role === 'resident';

    if (toStatus === 'reopened' || toStatus === 'cancelled' || (event.fromStatus === 'awaiting_information' && toStatus === 'under_review')) {
      if (isResidentActor) {
        // Resident reopened, cancelled, or replied: Notify society admins
        return await getActiveSocietyAdmins();
      } else {
        // Admin took the action: Notify submitter
        const submitter = await getSubmitter();
        return submitter ? [submitter] : [];
      }
    }

    // Standard lifecycle status changes by admin: Notify submitter
    const submitter = await getSubmitter();
    return submitter ? [submitter] : [];
  }

  if (action === 'progress_recorded') {
    // Public progress recorded: Notify submitter
    const submitter = await getSubmitter();
    return submitter ? [submitter] : [];
  }

  if (action === 'note_added') {
    if (actor.role === 'admin') {
      // Public note by admin: Notify submitter
      const submitter = await getSubmitter();
      return submitter ? [submitter] : [];
    } else {
      // Note by resident: Notify society admins
      return await getActiveSocietyAdmins();
    }
  }

  if (action === 'details_updated') {
    if (actor.role === 'resident') {
      return await getActiveSocietyAdmins();
    } else {
      const submitter = await getSubmitter();
      return submitter ? [submitter] : [];
    }
  }

  return recipients;
}

/**
 * Dispatch an issue lifecycle event to eligible recipients.
 * Enforces best-effort delivery, deduplication, resident privacy, and independent persistence.
 *
 * @param {Object} params
 * @param {Object} params.issue Persisted Mongoose issue document
 * @param {Object} params.event Persisted history subdocument ({ _id, action, toStatus, note, isInternal, ... })
 * @param {Object} params.actor { _id, role }
 * @param {ObjectId|string} params.societyId Society context ID
 * @returns {Promise<{ dispatched: number, duplicates: number, inAppSaved: number, emailsSent: number }>}
 */
async function dispatchIssueEvent({ issue, event, actor, societyId }) {
  const result = {
    dispatched: 0,
    duplicates: 0,
    inAppSaved: 0,
    emailsSent: 0
  };

  try {
    if (!issue || !event || !event._id || !societyId) {
      return result;
    }

    const recipients = await resolveRecipients({ issue, event, actor, societyId });
    if (!recipients || recipients.length === 0) {
      return result;
    }

    const isEmailEnabled = process.env.EMAIL_ENABLED === 'true';
    const emailAdapter = getEmailAdapter();

    for (const recipient of recipients) {
      result.dispatched += 1;

      // Stable compound idempotency key bound to the persisted history subdocument _id
      const idempotencyKey = `${issue._id}:${event._id}:${recipient._id}:${event.action}`;

      const content = renderNotificationContent({
        action: event.action,
        issue,
        event,
        recipientRole: recipient.role
      });

      let notificationDoc = null;
      try {
        notificationDoc = new Notification({
          recipient: recipient._id,
          society: societyId,
          issue: issue._id,
          type: content.type,
          title: content.title,
          message: content.message,
          idempotencyKey,
          emailStatus: isEmailEnabled ? 'pending' : 'disabled'
        });

        await notificationDoc.save();
        result.inAppSaved += 1;
      } catch (saveError) {
        if (saveError.code === 11000) {
          // Idempotency: Duplicate key indicates this notification was already processed.
          // Treat as safe no-op to prevent duplicate in-app alerts and duplicate emails.
          result.duplicates += 1;
          continue;
        } else {
          // Log persistence error without disrupting other recipients or the caller
          console.error(`[NotificationService] In-app save failed for recipient ${recipient._id}:`, saveError.message);
          continue;
        }
      }

      // Email dispatch executes strictly AFTER in-app persistence succeeds
      if (isEmailEnabled && notificationDoc) {
        if (!recipient.email) {
          notificationDoc.emailStatus = 'not_applicable';
          await notificationDoc.save().catch(() => {});
          continue;
        }

        try {
          const emailRes = await emailAdapter.sendEmail({
            to: recipient.email,
            subject: content.title,
            text: content.message
          });

          if (emailRes && emailRes.success) {
            notificationDoc.emailStatus = 'sent';
            notificationDoc.emailSentAt = new Date();
            result.emailsSent += 1;
          } else {
            notificationDoc.emailStatus = 'failed';
            notificationDoc.emailError = ((emailRes && emailRes.error) || 'Email dispatch failed').substring(0, 200);
          }
          await notificationDoc.save().catch(() => {});
        } catch (emailErr) {
          // Email failure NEVER rolls back the in-app notification or the issue
          notificationDoc.emailStatus = 'failed';
          notificationDoc.emailError = (emailErr.message || 'SMTP delivery exception').substring(0, 200);
          await notificationDoc.save().catch(() => {});
        }
      }
    }
  } catch (topLevelError) {
    // Best-effort guarantee: notification service failures never bubble up to abort issue transactions
    console.error('[NotificationService] Top-level dispatch error:', topLevelError.message);
  }

  return result;
}

module.exports = {
  dispatchIssueEvent,
  resolveRecipients,
  renderNotificationContent
};
