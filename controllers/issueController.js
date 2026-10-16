const mongoose = require('mongoose');
const { Issue, ISSUE_STATUSES, ISSUE_PRIORITIES, ISSUE_CATEGORIES } = require('../models/Issue');
const { dispatchIssueEvent } = require('../services/notifications/notificationService');

// Enforced State Machine Transition Matrix
const ALLOWED_TRANSITIONS = {
  submitted: {
    under_review: ['admin'],
    cancelled: ['admin', 'resident_submitter']
  },
  under_review: {
    awaiting_information: ['admin'],
    provider_contact_pending: ['admin'],
    scheduled: ['admin'],
    in_progress: ['admin'],
    cancelled: ['admin', 'resident_submitter']
  },
  awaiting_information: {
    under_review: ['admin', 'resident_submitter'],
    cancelled: ['admin', 'resident_submitter']
  },
  provider_contact_pending: {
    scheduled: ['admin'],
    in_progress: ['admin'],
    cancelled: ['admin']
  },
  scheduled: {
    in_progress: ['admin'],
    scheduled: ['admin'], // reschedule
    cancelled: ['admin']
  },
  in_progress: {
    completion_submitted: ['admin'],
    awaiting_information: ['admin']
  },
  completion_submitted: {
    verified_closed: ['admin'], // STRICT: Only admin may verify completion
    verification_rejected: ['admin'] // STRICT: Only admin may reject verification
  },
  verification_rejected: {
    in_progress: ['admin'],
    provider_contact_pending: ['admin']
  },
  verified_closed: {
    reopened: ['admin', 'resident_submitter']
  },
  reopened: {
    under_review: ['admin'],
    in_progress: ['admin'],
    scheduled: ['admin']
  },
  cancelled: {} // Terminal state
};

const ADMIN_UPDATEABLE_FIELDS = [
  'title',
  'description',
  'category',
  'location',
  'priority',
  'externalProviderDetails',
  'costs',
  'completionDetails'
];
const RESIDENT_UPDATEABLE_FIELDS = ['title', 'description', 'category', 'location'];

/**
 * Validate and sanitize costs object.
 * Enforces non-negative finite numbers with reasonable bounds and no unknown fields.
 */
function validateCosts(costs) {
  if (!costs || typeof costs !== 'object' || Array.isArray(costs)) {
    return { valid: false, message: 'Costs must be a valid object.' };
  }

  const allowedKeys = ['materialCost', 'laborCost', 'otherCost', 'totalCost', 'currency'];
  const unknown = Object.keys(costs).filter((k) => !allowedKeys.includes(k));
  if (unknown.length > 0) {
    return { valid: false, message: `Invalid field(s) in costs: ${unknown.join(', ')}` };
  }

  const numFields = ['materialCost', 'laborCost', 'otherCost', 'totalCost'];
  const maxBound = 30000000; // 30,000,000 reasonable upper bound

  for (const field of numFields) {
    if (costs[field] !== undefined) {
      const val = costs[field];
      if (typeof val !== 'number' || !Number.isFinite(val) || isNaN(val)) {
        return { valid: false, message: `${field} must be a valid finite number.` };
      }
      if (val < 0) {
        return { valid: false, message: `${field} cannot be negative.` };
      }
      if (val > maxBound) {
        return { valid: false, message: `${field} exceeds maximum reasonable bound of ${maxBound.toLocaleString()}.` };
      }
    }
  }

  let currency = 'INR';
  if (costs.currency !== undefined) {
    if (typeof costs.currency !== 'string' || !costs.currency.trim() || costs.currency.trim().length > 10) {
      return { valid: false, message: 'Currency must be a string up to 10 characters.' };
    }
    currency = costs.currency.trim().toUpperCase();
  }

  const hasItemized = costs.materialCost !== undefined || costs.laborCost !== undefined || costs.otherCost !== undefined;
  const materialCost = typeof costs.materialCost === 'number' ? costs.materialCost : 0;
  const laborCost = typeof costs.laborCost === 'number' ? costs.laborCost : 0;
  const otherCost = typeof costs.otherCost === 'number' ? costs.otherCost : 0;

  // STRICT: If itemized costs are provided, server ALWAYS calculates totalCost as their sum.
  // If only totalCost is provided, use that validated totalCost.
  const totalCost = hasItemized
    ? materialCost + laborCost + otherCost
    : (typeof costs.totalCost === 'number' ? costs.totalCost : 0);

  if (totalCost > maxBound) {
    return { valid: false, message: `totalCost exceeds maximum reasonable bound of ${maxBound.toLocaleString()}.` };
  }

  return {
    valid: true,
    data: {
      materialCost,
      laborCost,
      otherCost,
      totalCost,
      currency
    }
  };
}

/**
 * Validate and sanitize completion details object and evidence items.
 */
function validateCompletionDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return { valid: false, message: 'Completion details must be a valid object.' };
  }

  const allowedKeys = ['workSummary', 'completedAt', 'completedBy', 'evidence'];
  const unknown = Object.keys(details).filter((k) => !allowedKeys.includes(k));
  if (unknown.length > 0) {
    return { valid: false, message: `Invalid field(s) in completion details: ${unknown.join(', ')}` };
  }

  const sanitized = {};

  if (details.workSummary !== undefined) {
    if (typeof details.workSummary !== 'string') {
      return { valid: false, message: 'Work summary must be a string.' };
    }
    if (details.workSummary.trim().length > 2000) {
      return { valid: false, message: 'Work summary cannot exceed 2000 characters.' };
    }
    sanitized.workSummary = details.workSummary.trim();
  }

  if (details.completedAt !== undefined) {
    const parsedDate = Date.parse(details.completedAt);
    if (isNaN(parsedDate)) {
      return { valid: false, message: 'Completed at must be a valid date.' };
    }
    if (parsedDate > Date.now() + 60000) {
      return { valid: false, message: 'Completed at date cannot be in the future.' };
    }
    sanitized.completedAt = new Date(parsedDate);
  } else {
    sanitized.completedAt = new Date();
  }

  if (details.completedBy !== undefined) {
    if (typeof details.completedBy !== 'string' || details.completedBy.trim().length > 100) {
      return { valid: false, message: 'Completed by must be a string up to 100 characters.' };
    }
    sanitized.completedBy = details.completedBy.trim();
  }

  if (details.evidence !== undefined) {
    if (!Array.isArray(details.evidence)) {
      return { valid: false, message: 'Evidence must be an array of evidence items.' };
    }
    const sanitizedEvidence = [];
    for (const item of details.evidence) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { valid: false, message: 'Each evidence item must be an object.' };
      }
      const allowedItemKeys = ['caption', 'referenceUrl', 'isInternal'];
      const unknownItemKeys = Object.keys(item).filter((k) => !allowedItemKeys.includes(k));
      if (unknownItemKeys.length > 0) {
        return { valid: false, message: `Invalid field(s) in evidence item: ${unknownItemKeys.join(', ')}` };
      }

      const caption = item.caption ? String(item.caption).trim().slice(0, 200) : '';
      let referenceUrl = '';
      if (item.referenceUrl !== undefined && item.referenceUrl !== null) {
        if (typeof item.referenceUrl !== 'string') {
          return { valid: false, message: 'Evidence referenceUrl must be a string.' };
        }
        referenceUrl = item.referenceUrl.trim();
        if (referenceUrl.length > 500) {
          return { valid: false, message: 'Evidence referenceUrl cannot exceed 500 characters.' };
        }
        if (/^javascript:/i.test(referenceUrl)) {
          return { valid: false, message: 'Evidence referenceUrl contains an invalid or unsafe protocol.' };
        }
      }
      const isInternal = Boolean(item.isInternal);

      sanitizedEvidence.push({
        caption,
        referenceUrl,
        isInternal,
        uploadedAt: new Date()
      });
    }
    sanitized.evidence = sanitizedEvidence;
  }

  return { valid: true, data: sanitized };
}

/**
 * Create a new issue in the society.
 */
async function createIssue(req, res, next) {
  try {
    const { title, description, category, location, priority } = req.body;

    // Strict input validation
    if (!title || typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 120) {
      return res.status(400).json({
        success: false,
        message: 'Title is required and must be between 5 and 120 characters.'
      });
    }

    if (!description || typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Description is required and must be between 10 and 2000 characters.'
      });
    }

    if (!category || !ISSUE_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Category must be one of: ${ISSUE_CATEGORIES.join(', ')}`
      });
    }

    if (!location || typeof location !== 'object' || !['unit', 'common_area'].includes(location.type)) {
      return res.status(400).json({
        success: false,
        message: 'Location type must be either unit or common_area.'
      });
    }

    if (location.type === 'unit') {
      if (!location.blockOrWing || !location.blockOrWing.trim() || !location.flatOrUnit || !location.flatOrUnit.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Block/wing and flat/unit number are required for unit issues.'
        });
      }
    } else if (location.type === 'common_area') {
      if (!location.areaDescription || location.areaDescription.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Area description is required for common area issues.'
        });
      }
    }

    let assignedPriority = 'normal';
    if (priority && ISSUE_PRIORITIES.includes(priority)) {
      assignedPriority = priority;
    }

    // Server-enforced values (never trust client for audit or status)
    const issue = new Issue({
      society: req.society._id,
      submittingResident: req.user._id,
      title: title.trim(),
      description: description.trim(),
      category,
      location: {
        type: location.type,
        blockOrWing: location.blockOrWing ? location.blockOrWing.trim() : '',
        flatOrUnit: location.flatOrUnit ? location.flatOrUnit.trim() : '',
        areaDescription: location.areaDescription ? location.areaDescription.trim() : ''
      },
      priority: assignedPriority,
      status: 'submitted',
      history: [
        {
          action: 'created',
          toStatus: 'submitted',
          changedBy: req.user._id,
          note: 'Issue submitted',
          changedAt: new Date()
        }
      ]
    });

    await issue.save();

    // Safely dispatch issue creation notification (best-effort, non-blocking)
    const creationEvent = issue.history[0];
    if (creationEvent) {
      await dispatchIssueEvent({
        issue,
        event: creationEvent,
        actor: { _id: req.user._id, role: req.membership.role },
        societyId: req.society._id
      });
    }

    res.status(201).json({
      success: true,
      message: 'Issue submitted successfully',
      issue: issue.toClientJSON(req.membership.role, req.user._id)
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List issues in society with privacy filtering.
 */
async function listIssues(req, res, next) {
  try {
    const { status, priority, category, myIssuesOnly } = req.query;
    const isResident = req.membership.role === 'resident';

    const filter = { society: req.society._id };

    if (isResident) {
      if (myIssuesOnly === 'true') {
        filter.submittingResident = req.user._id;
      } else {
        // Residents only see their own issues and common-area issues
        filter.$or = [
          { submittingResident: req.user._id },
          { 'location.type': 'common_area' }
        ];
      }
    } else {
      // Admins see all society issues, or can filter by myIssuesOnly
      if (myIssuesOnly === 'true') {
        filter.submittingResident = req.user._id;
      }
    }

    if (status && ISSUE_STATUSES.includes(status)) {
      filter.status = status;
    }

    if (priority && ISSUE_PRIORITIES.includes(priority)) {
      filter.priority = priority;
    }

    if (category && ISSUE_CATEGORIES.includes(category)) {
      filter.category = category;
    }

    const issues = await Issue.find(filter)
      .populate('submittingResident', 'name email phone')
      .sort({ createdAt: -1 });

    const sanitizedIssues = issues.map((doc) =>
      doc.toClientJSON(req.membership.role, req.user._id)
    );

    res.status(200).json({
      success: true,
      count: sanitizedIssues.length,
      issues: sanitizedIssues
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get issue details with access control and privacy redaction.
 */
async function getIssue(req, res, next) {
  try {
    const { issueId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(issueId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid issue ID format.'
      });
    }

    const issue = await Issue.findOne({
      _id: issueId,
      society: req.society._id
    })
      .populate('submittingResident', 'name email phone')
      .populate('history.changedBy', 'name email');

    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found in this society.'
      });
    }

    const isResident = req.membership.role === 'resident';
    const isSubmitter = issue.submittingResident && issue.submittingResident._id
      ? issue.submittingResident._id.equals(req.user._id)
      : false;
    const isCommonArea = issue.location && issue.location.type === 'common_area';

    // Privacy check: Residents cannot view another resident's private unit issue
    // Uniformly return 404 to avoid private issue ID enumeration
    if (isResident && !isSubmitter && !isCommonArea) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found in this society.'
      });
    }

    res.status(200).json({
      success: true,
      issue: issue.toClientJSON(req.membership.role, req.user._id)
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Transition issue status via state machine.
 */
async function updateStatus(req, res, next) {
  try {
    const { issueId } = req.params;
    const { toStatus, note, scheduledDate, cancellationReason, costs, completionDetails, resolutionSummary } = req.body;

    if (!mongoose.Types.ObjectId.isValid(issueId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid issue ID format.'
      });
    }

    if (!toStatus || !ISSUE_STATUSES.includes(toStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid or missing toStatus. Must be one of: ${ISSUE_STATUSES.join(', ')}`
      });
    }

    const issue = await Issue.findOne({
      _id: issueId,
      society: req.society._id
    });

    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found in this society.'
      });
    }

    // Terminal state check
    if (issue.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot transition an issue that has been cancelled.'
      });
    }

    // State machine check
    const currentTransitions = ALLOWED_TRANSITIONS[issue.status] || {};
    const allowedRoles = currentTransitions[toStatus];

    if (!allowedRoles) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from "${issue.status}" to "${toStatus}".`
      });
    }

    const isSubmitter = issue.submittingResident
      ? (issue.submittingResident._id ? issue.submittingResident._id.equals(req.user._id) : issue.submittingResident.equals(req.user._id))
      : false;
    const isAdmin = req.membership.role === 'admin';

    let isAuthorized = false;
    if (isAdmin && allowedRoles.includes('admin')) {
      isAuthorized = true;
    }
    if (isSubmitter && allowedRoles.includes('resident_submitter')) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      if (toStatus === 'verified_closed' || toStatus === 'verification_rejected') {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Only an authorized society administrator may verify or reject completion.'
        });
      }
      return res.status(403).json({
        success: false,
        message: 'Access denied: You are not authorized to perform this status transition.'
      });
    }

    // Required transition data validation
    if (toStatus === 'scheduled') {
      if (!scheduledDate || isNaN(Date.parse(scheduledDate))) {
        return res.status(400).json({
          success: false,
          message: 'A valid scheduledDate is required when transitioning to scheduled.'
        });
      }
      issue.scheduledDate = new Date(scheduledDate);
    }

    if (toStatus === 'cancelled') {
      const reason = (cancellationReason || note || '').trim();
      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'A cancellation reason or note is required when cancelling an issue.'
        });
      }
      issue.cancellationReason = reason;
    }

    if (toStatus === 'completion_submitted') {
      if (costs !== undefined) {
        const costRes = validateCosts(costs);
        if (!costRes.valid) {
          return res.status(400).json({
            success: false,
            message: costRes.message
          });
        }
        issue.costs = costRes.data;
      }

      if (completionDetails !== undefined) {
        const compRes = validateCompletionDetails(completionDetails);
        if (!compRes.valid) {
          return res.status(400).json({
            success: false,
            message: compRes.message
          });
        }
        issue.completionDetails = compRes.data;
      }
    }

    if (toStatus === 'verification_rejected') {
      if (!note || note.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'A note explaining why verification was rejected is required.'
        });
      }
      issue.verificationDetails = {
        verifiedBy: req.user._id,
        verifiedAt: new Date(),
        decision: 'verification_rejected',
        notes: note.trim()
      };
    }

    if (toStatus === 'verified_closed') {
      const summaryText = resolutionSummary !== undefined ? String(resolutionSummary).trim() : (note ? note.trim() : '');
      if (summaryText) {
        issue.resolutionSummary = summaryText;
      }
      issue.verificationDetails = {
        verifiedBy: req.user._id,
        verifiedAt: new Date(),
        decision: 'verified_closed',
        notes: note ? note.trim() : summaryText
      };
    }

    if (toStatus === 'awaiting_information') {
      if (!note || note.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'A note specifying the requested information is required.'
        });
      }
    }

    if (toStatus === 'reopened') {
      if (!note || note.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'A note explaining why the issue is being reopened is required.'
        });
      }
    }

    // Append server-generated history event
    issue.history.push({
      action: 'status_change',
      fromStatus: issue.status,
      toStatus: toStatus,
      changedBy: req.user._id,
      note: note ? note.trim() : (cancellationReason ? cancellationReason.trim() : ''),
      changedAt: new Date()
    });

    issue.status = toStatus;
    await issue.save();

    // Safely dispatch status change notification (best-effort, non-blocking)
    const statusEvent = issue.history[issue.history.length - 1];
    if (statusEvent) {
      await dispatchIssueEvent({
        issue,
        event: statusEvent,
        actor: { _id: req.user._id, role: req.membership.role },
        societyId: req.society._id
      });
    }

    res.status(200).json({
      success: true,
      message: `Status updated to ${toStatus}`,
      issue: issue.toClientJSON(req.membership.role, req.user._id)
    });
  } catch (error) {
    if (error.name === 'VersionError') {
      return res.status(409).json({
        success: false,
        message: 'Conflict: This issue was modified by another request. Please reload and try again.'
      });
    }
    next(error);
  }
}

/**
 * Update issue fields without altering status or history.
 */
async function updateIssue(req, res, next) {
  try {
    const { issueId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(issueId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid issue ID format.'
      });
    }

    const issue = await Issue.findOne({
      _id: issueId,
      society: req.society._id
    });

    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found in this society.'
      });
    }

    const isSubmitter = issue.submittingResident
      ? (issue.submittingResident._id ? issue.submittingResident._id.equals(req.user._id) : issue.submittingResident.equals(req.user._id))
      : false;
    const isAdmin = req.membership.role === 'admin';

    if (!isAdmin && !isSubmitter) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You do not have permission to update this issue.'
      });
    }

    // Terminal and closed states cannot be updated via normal update
    if (issue.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update an issue that has been cancelled.'
      });
    }

    if (issue.status === 'verified_closed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update an issue that has been verified and closed. Reopen the issue to make changes.'
      });
    }

    // Residents can only edit core fields in submitted or awaiting_information
    if (!isAdmin) {
      if (!['submitted', 'awaiting_information'].includes(issue.status)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot update issue details after review or work has commenced.'
        });
      }
    }

    const incomingFields = Object.keys(req.body);
    if (incomingFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields provided for update.'
      });
    }

    // Reject attempt to modify read-only or prohibited properties
    const prohibitedFields = [
      '_id',
      'status',
      'history',
      'society',
      'submittingResident',
      'createdAt',
      'updatedAt',
      'verificationDetails',
      'resolutionSummary'
    ];
    for (const key of incomingFields) {
      if (prohibitedFields.includes(key)) {
        return res.status(400).json({
          success: false,
          message: `Field "${key}" cannot be updated directly.`
        });
      }
    }

    // Enforce role-based updateable allowlist
    const allowedFields = isAdmin ? ADMIN_UPDATEABLE_FIELDS : RESIDENT_UPDATEABLE_FIELDS;
    const invalidFields = incomingFields.filter((key) => !allowedFields.includes(key));
    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid or unauthorized field(s) for update: ${invalidFields.join(', ')}`
      });
    }

    const {
      title,
      description,
      category,
      location,
      priority,
      externalProviderDetails,
      costs,
      completionDetails
    } = req.body;

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 120) {
        return res.status(400).json({
          success: false,
          message: 'Title must be between 5 and 120 characters.'
        });
      }
      issue.title = title.trim();
    }

    if (description !== undefined) {
      if (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 2000) {
        return res.status(400).json({
          success: false,
          message: 'Description must be between 10 and 2000 characters.'
        });
      }
      issue.description = description.trim();
    }

    if (category !== undefined) {
      if (!ISSUE_CATEGORIES.includes(category)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid category.'
        });
      }
      issue.category = category;
    }

    if (location !== undefined) {
      if (!location || typeof location !== 'object' || Array.isArray(location)) {
        return res.status(400).json({
          success: false,
          message: 'Location must be a valid object.'
        });
      }

      if (location.type !== undefined) {
        if (!['unit', 'common_area'].includes(location.type)) {
          return res.status(400).json({
            success: false,
            message: 'Location type must be either unit or common_area.'
          });
        }
        if (location.type !== issue.location.type) {
          return res.status(400).json({
            success: false,
            message: 'Cannot change location type of an existing issue.'
          });
        }
      }

      if (issue.location.type === 'unit') {
        if (
          !location.blockOrWing ||
          typeof location.blockOrWing !== 'string' ||
          !location.blockOrWing.trim() ||
          !location.flatOrUnit ||
          typeof location.flatOrUnit !== 'string' ||
          !location.flatOrUnit.trim()
        ) {
          return res.status(400).json({
            success: false,
            message: 'Block/wing and flat/unit number are required for unit issues.'
          });
        }
        issue.location.blockOrWing = location.blockOrWing.trim();
        issue.location.flatOrUnit = location.flatOrUnit.trim();
        issue.location.areaDescription = '';
      } else if (issue.location.type === 'common_area') {
        if (
          !location.areaDescription ||
          typeof location.areaDescription !== 'string' ||
          location.areaDescription.trim().length < 2
        ) {
          return res.status(400).json({
            success: false,
            message: 'Area description is required for common area issues.'
          });
        }
        issue.location.areaDescription = location.areaDescription.trim();
        issue.location.blockOrWing = '';
        issue.location.flatOrUnit = '';
      }
    }

    // Admin-only updates
    if (isAdmin) {
      if (priority !== undefined) {
        if (!ISSUE_PRIORITIES.includes(priority)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid priority.'
          });
        }
        issue.priority = priority;
      }

      if (externalProviderDetails !== undefined) {
        if (typeof externalProviderDetails !== 'object' || externalProviderDetails === null || Array.isArray(externalProviderDetails)) {
          return res.status(400).json({
            success: false,
            message: 'External provider details must be a valid object.'
          });
        }
        issue.externalProviderDetails = {
          companyOrName: externalProviderDetails.companyOrName ? String(externalProviderDetails.companyOrName).trim() : '',
          contactPhone: externalProviderDetails.contactPhone ? String(externalProviderDetails.contactPhone).trim() : '',
          trade: externalProviderDetails.trade ? String(externalProviderDetails.trade).trim() : ''
        };
      }

      if (costs !== undefined) {
        const costRes = validateCosts(costs);
        if (!costRes.valid) {
          return res.status(400).json({
            success: false,
            message: costRes.message
          });
        }
        issue.costs = costRes.data;
      }

      if (completionDetails !== undefined) {
        const compRes = validateCompletionDetails(completionDetails);
        if (!compRes.valid) {
          return res.status(400).json({
            success: false,
            message: compRes.message
          });
        }
        issue.completionDetails = compRes.data;
      }
    }

    // Append server-generated audit event
    issue.history.push({
      action: 'details_updated',
      changedBy: req.user._id,
      note: 'Issue details updated',
      changedAt: new Date()
    });

    await issue.save();

    // Safely dispatch details updated notification (best-effort, non-blocking)
    const updateEvent = issue.history[issue.history.length - 1];
    if (updateEvent) {
      await dispatchIssueEvent({
        issue,
        event: updateEvent,
        actor: { _id: req.user._id, role: req.membership.role },
        societyId: req.society._id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Issue updated successfully',
      issue: issue.toClientJSON(req.membership.role, req.user._id)
    });
  } catch (error) {
    if (error.name === 'VersionError') {
      return res.status(409).json({
        success: false,
        message: 'Conflict: This issue was modified by another request. Please reload and try again.'
      });
    }
    next(error);
  }
}

/**
 * Add a timeline note or comment.
 */
async function addNote(req, res, next) {
  try {
    const { issueId } = req.params;
    const { note, isInternal } = req.body;

    if (!mongoose.Types.ObjectId.isValid(issueId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid issue ID format.'
      });
    }

    if (!note || typeof note !== 'string' || note.trim().length < 2 || note.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Note must be between 2 and 1000 characters.'
      });
    }

    const issue = await Issue.findOne({
      _id: issueId,
      society: req.society._id
    });

    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found in this society.'
      });
    }

    const isSubmitter = issue.submittingResident
      ? (issue.submittingResident._id ? issue.submittingResident._id.equals(req.user._id) : issue.submittingResident.equals(req.user._id))
      : false;
    const isAdmin = req.membership.role === 'admin';
    const isCommonArea = issue.location && issue.location.type === 'common_area';

    if (!isAdmin && !isSubmitter && !isCommonArea) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You do not have permission to comment on this issue.'
      });
    }

    // Only admin can mark notes as internal
    const internalFlag = isAdmin ? Boolean(isInternal) : false;

    issue.history.push({
      action: 'note_added',
      changedBy: req.user._id,
      note: note.trim(),
      isInternal: internalFlag,
      changedAt: new Date()
    });

    await issue.save();

    // Safely dispatch note added notification (best-effort, non-blocking)
    const noteEvent = issue.history[issue.history.length - 1];
    if (noteEvent) {
      await dispatchIssueEvent({
        issue,
        event: noteEvent,
        actor: { _id: req.user._id, role: req.membership.role },
        societyId: req.society._id
      });
    }

    res.status(201).json({
      success: true,
      message: 'Note added successfully',
      issue: issue.toClientJSON(req.membership.role, req.user._id)
    });
  } catch (error) {
    if (error.name === 'VersionError') {
      return res.status(409).json({
        success: false,
        message: 'Conflict: This issue was modified by another request. Please reload and try again.'
      });
    }
    next(error);
  }
}

/**
 * Record repair progress on an issue (Admin-only).
 */
async function recordProgress(req, res, next) {
  try {
    const { issueId } = req.params;
    const { note, progressPercentage, isInternal } = req.body;

    if (!mongoose.Types.ObjectId.isValid(issueId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid issue ID format.'
      });
    }

    if (!note || typeof note !== 'string' || note.trim().length < 2 || note.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Progress note must be between 2 and 1000 characters.'
      });
    }

    if (progressPercentage !== undefined) {
      if (typeof progressPercentage !== 'number' || !Number.isFinite(progressPercentage) || progressPercentage < 0 || progressPercentage > 100) {
        return res.status(400).json({
          success: false,
          message: 'Progress percentage must be a finite number between 0 and 100.'
        });
      }
    }

    const issue = await Issue.findOne({
      _id: issueId,
      society: req.society._id
    });

    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found in this society.'
      });
    }

    // Progress updates are permitted on active repair statuses
    const allowedProgressStatuses = ['scheduled', 'in_progress', 'under_review', 'reopened', 'verification_rejected'];
    if (!allowedProgressStatuses.includes(issue.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot record progress on an issue with status "${issue.status}".`
      });
    }

    const formattedNote = progressPercentage !== undefined
      ? `[${progressPercentage}%] ${note.trim()}`
      : note.trim();

    issue.history.push({
      action: 'progress_recorded',
      changedBy: req.user._id,
      note: formattedNote,
      isInternal: Boolean(isInternal),
      changedAt: new Date()
    });

    await issue.save();

    // Safely dispatch progress recorded notification (best-effort, non-blocking)
    const progressEvent = issue.history[issue.history.length - 1];
    if (progressEvent) {
      await dispatchIssueEvent({
        issue,
        event: progressEvent,
        actor: { _id: req.user._id, role: req.membership.role },
        societyId: req.society._id
      });
    }

    res.status(201).json({
      success: true,
      message: 'Progress recorded successfully',
      issue: issue.toClientJSON(req.membership.role, req.user._id)
    });
  } catch (error) {
    if (error.name === 'VersionError') {
      return res.status(409).json({
        success: false,
        message: 'Conflict: This issue was modified by another request. Please reload and try again.'
      });
    }
    next(error);
  }
}

module.exports = {
  createIssue,
  listIssues,
  getIssue,
  updateStatus,
  updateIssue,
  addNote,
  recordProgress
};
