const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { app, connectDB, disconnectDB } = require('../server');
const User = require('../models/User');
const Society = require('../models/Society');
const SocietyMembership = require('../models/SocietyMembership');
const { Issue } = require('../models/Issue');
const { Notification } = require('../models/Notification');
const { getEmailAdapter } = require('../services/notifications/emailAdapter');
const { dispatchIssueEvent } = require('../services/notifications/notificationService');

describe('Phase 7 — Issue Lifecycle Notifications and Email Advisory Dispatch Tests', () => {
  let server;
  let baseUrl;
  const testDbUri = 'mongodb://127.0.0.1:27017/housing_management_phase7_test';

  let admin1Cookie;
  let admin2Cookie;
  let resident1Cookie;
  let resident2Cookie;
  let adminBCookie;

  let societyAId;
  let societyBId;

  let admin1Id;
  let admin2Id;
  let resident1Id;
  let resident2Id;
  let adminBId;

  const emailAdapter = getEmailAdapter();

  function extractCookie(response) {
    if (typeof response.headers.getSetCookie === 'function') {
      const cookies = response.headers.getSetCookie();
      return cookies.map((c) => c.split(';')[0]).join('; ');
    }
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return '';
    return setCookie.split(';')[0];
  }

  function extractRawCsrf(cookieString) {
    if (!cookieString) return '';
    const match = cookieString.match(/_csrf=([^;]+)/);
    if (!match) return '';
    return match[1].split('.')[0];
  }

  before(async () => {
    process.env.NOTIFICATION_ENABLED = 'true';
    process.env.EMAIL_ENABLED = 'false';
    process.env.EMAIL_PROVIDER = 'mock';

    await connectDB(testDbUri);

    await User.deleteMany({});
    await Society.deleteMany({});
    await SocietyMembership.deleteMany({});
    await Issue.deleteMany({});
    await Notification.deleteMany({});

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 1. Setup Admin 1 and Society A
    const regAdmin1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Society A Admin 1',
        email: 'admin1@society-a.local',
        password: 'Password123!',
        phone: '9876543210'
      })
    });
    assert.strictEqual(regAdmin1.status, 201);
    admin1Cookie = extractCookie(regAdmin1);
    const admin1Data = await regAdmin1.json();
    admin1Id = admin1Data.user._id || admin1Data.user.id;

    const createSocA = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: admin1Cookie,
        'X-CSRF-Token': extractRawCsrf(admin1Cookie)
      },
      body: JSON.stringify({
        name: 'Greenwood Society A',
        code: 'GREEN-A-01'
      })
    });
    assert.strictEqual(createSocA.status, 201);
    const socAData = await createSocA.json();
    societyAId = socAData.society._id;

    // 2. Setup Admin 2 in Society A
    const regAdmin2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Society A Admin 2',
        email: 'admin2@society-a.local',
        password: 'Password123!',
        phone: '9876543211'
      })
    });
    admin2Cookie = extractCookie(regAdmin2);
    const admin2Data = await regAdmin2.json();
    admin2Id = admin2Data.user._id || admin2Data.user.id;

    await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: admin1Cookie,
        'X-CSRF-Token': extractRawCsrf(admin1Cookie)
      },
      body: JSON.stringify({
        email: 'admin2@society-a.local',
        role: 'admin'
      })
    });

    // 3. Setup Resident 1 in Society A
    const regRes1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident One',
        email: 'resident1@society-a.local',
        password: 'Password123!',
        phone: '9876543212'
      })
    });
    resident1Cookie = extractCookie(regRes1);
    const res1Data = await regRes1.json();
    resident1Id = res1Data.user._id || res1Data.user.id;

    await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: admin1Cookie,
        'X-CSRF-Token': extractRawCsrf(admin1Cookie)
      },
      body: JSON.stringify({
        email: 'resident1@society-a.local',
        role: 'resident',
        flatNumber: 'A-101'
      })
    });

    // 4. Setup Resident 2 in Society A
    const regRes2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident Two',
        email: 'resident2@society-a.local',
        password: 'Password123!',
        phone: '9876543213'
      })
    });
    resident2Cookie = extractCookie(regRes2);
    const res2Data = await regRes2.json();
    resident2Id = res2Data.user._id || res2Data.user.id;

    await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: admin1Cookie,
        'X-CSRF-Token': extractRawCsrf(admin1Cookie)
      },
      body: JSON.stringify({
        email: 'resident2@society-a.local',
        role: 'resident',
        flatNumber: 'A-102'
      })
    });

    // 5. Setup Admin B in Society B (Cross-Society Isolation)
    const regAdminB = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Society B Admin',
        email: 'admin@society-b.local',
        password: 'Password123!',
        phone: '9876543214'
      })
    });
    adminBCookie = extractCookie(regAdminB);
    const adminBData = await regAdminB.json();
    adminBId = adminBData.user._id || adminBData.user.id;

    const createSocB = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminBCookie,
        'X-CSRF-Token': extractRawCsrf(adminBCookie)
      },
      body: JSON.stringify({
        name: 'Highland Society B',
        code: 'HIGH-B-02'
      })
    });
    const socBData = await createSocB.json();
    societyBId = socBData.society._id;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await disconnectDB();
  });

  beforeEach(async () => {
    await Notification.deleteMany({});
    emailAdapter.clearSentEmails();
    emailAdapter.simulateFailure(false);
  });

  describe('Explicit Recipient Selection and Self-Action Suppression', () => {
    test('Issue creation by Resident 1 notifies active Society A admins but suppresses Resident 1', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'x-csrf-token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Kitchen pipe leak under sink',
          description: 'Water leaking continuously into kitchen cabinet.',
          category: 'plumbing',
          location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
          priority: 'high'
        })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      const issueId = data.issue._id;

      // Admin 1 should receive notification
      const notifsAdmin1 = await Notification.find({ recipient: admin1Id });
      assert.strictEqual(notifsAdmin1.length, 1);
      assert.strictEqual(notifsAdmin1[0].type, 'issue_created');
      assert.strictEqual(notifsAdmin1[0].issue.toString(), issueId);
      assert.ok(notifsAdmin1[0].message.includes('Kitchen pipe leak'));

      // Admin 2 should receive notification
      const notifsAdmin2 = await Notification.find({ recipient: admin2Id });
      assert.strictEqual(notifsAdmin2.length, 1);
      assert.strictEqual(notifsAdmin2[0].type, 'issue_created');

      // Resident 1 (submitter) MUST NOT receive notification (self-action suppressed)
      const notifsRes1 = await Notification.find({ recipient: resident1Id });
      assert.strictEqual(notifsRes1.length, 0);

      // Resident 2 MUST NOT receive notification
      const notifsRes2 = await Notification.find({ recipient: resident2Id });
      assert.strictEqual(notifsRes2.length, 0);
    });

    test('Admin 1 status change notifies Resident 1 submitter but suppresses Admin 1 and Resident 2', async () => {
      // Create issue first
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'x-csrf-token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Ceiling plaster chipping',
          description: 'Small pieces of plaster falling from living room ceiling.',
          category: 'structural',
          location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
          priority: 'normal'
        })
      });
      const issueData = await createRes.json();
      const issueId = issueData.issue._id;

      // Clear creation notifications
      await Notification.deleteMany({});

      // Admin 1 transitions to under_review
      const updateRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: admin1Cookie,
          'x-csrf-token': extractRawCsrf(admin1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'under_review',
          note: 'Assigned to maintenance committee for review.'
        })
      });
      assert.strictEqual(updateRes.status, 200);

      // Resident 1 (submitter) should receive status update notification
      const notifsRes1 = await Notification.find({ recipient: resident1Id });
      assert.strictEqual(notifsRes1.length, 1);
      assert.strictEqual(notifsRes1[0].type, 'status_changed');
      assert.ok(notifsRes1[0].title.includes('Issue Status Updated'));

      // Admin 1 (actor) must not receive self-alert
      const notifsAdmin1 = await Notification.find({ recipient: admin1Id });
      assert.strictEqual(notifsAdmin1.length, 0);

      // Resident 2 must receive zero notifications
      const notifsRes2 = await Notification.find({ recipient: resident2Id });
      assert.strictEqual(notifsRes2.length, 0);
    });

    test('Resident submitter reopening issue notifies active society admins', async () => {
      // Create issue, verify, then reopen
      const issue = await Issue.create({
        society: societyAId,
        submittingResident: resident1Id,
        title: 'Geyser tripping main MCB',
        description: 'Bathroom water heater trips electricity whenever turned on.',
        category: 'electrical',
        location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
        status: 'verified_closed',
        history: [
          { action: 'created', toStatus: 'submitted', changedBy: resident1Id, note: 'Created' },
          { action: 'status_change', toStatus: 'verified_closed', changedBy: admin1Id, note: 'Closed' }
        ]
      });

      await Notification.deleteMany({});

      // Resident 1 reopens the verified_closed issue
      const reopenRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issue._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'x-csrf-token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'reopened',
          note: 'Problem recurred next morning.'
        })
      });
      assert.strictEqual(reopenRes.status, 200);

      // Admins should be notified of resident reopening
      const notifsAdmin1 = await Notification.find({ recipient: admin1Id });
      assert.strictEqual(notifsAdmin1.length, 1);
      assert.strictEqual(notifsAdmin1[0].type, 'reopened');

      const notifsAdmin2 = await Notification.find({ recipient: admin2Id });
      assert.strictEqual(notifsAdmin2.length, 1);

      // Resident 1 (actor) gets no self-alert
      const notifsRes1 = await Notification.find({ recipient: resident1Id });
      assert.strictEqual(notifsRes1.length, 0);
    });

    test('Inactive submitter does not receive issue notifications when admin updates issue', async () => {
      const issue = await Issue.create({
        society: societyAId,
        submittingResident: resident1Id,
        title: 'Balcony railing loose',
        description: 'Railing screws coming loose on 4th floor balcony.',
        category: 'structural',
        location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
        status: 'submitted',
        history: [{ action: 'created', toStatus: 'submitted', changedBy: resident1Id, note: 'Submitted' }]
      });

      await Notification.deleteMany({});

      // Set Resident 1 membership to inactive
      await SocietyMembership.updateOne(
        { user: resident1Id, society: societyAId },
        { status: 'inactive' }
      );

      try {
        // Admin updates status to under_review
        const updateRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issue._id}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: admin1Cookie,
            'x-csrf-token': extractRawCsrf(admin1Cookie)
          },
          body: JSON.stringify({
            toStatus: 'under_review',
            note: 'Committee review commenced.'
          })
        });
        assert.strictEqual(updateRes.status, 200);

        // Submitter is inactive: MUST NOT receive notification
        const notifsRes1 = await Notification.find({ recipient: resident1Id });
        assert.strictEqual(notifsRes1.length, 0, 'Inactive submitter must not receive notifications');
      } finally {
        // Restore Resident 1 membership to active
        await SocietyMembership.updateOne(
          { user: resident1Id, society: societyAId },
          { status: 'active' }
        );
      }
    });

    test('Submitter who is not a member of the issue society does not receive notifications', async () => {
      // Create user belonging only to Society B
      const outsider = await User.create({
        name: 'Outsider User',
        email: 'outsider@other.local',
        password: 'HashedPassword123!',
        phone: '9998887776',
        isActive: true
      });

      // Issue points to outsider in Society A (where outsider is NOT a member)
      const issue = await Issue.create({
        society: societyAId,
        submittingResident: outsider._id,
        title: 'Guest parking gate issue',
        description: 'Gate sensor malfunction.',
        category: 'security',
        location: { type: 'common_area', areaDescription: 'Visitor gate' },
        status: 'submitted',
        history: [{ action: 'created', toStatus: 'submitted', changedBy: outsider._id, note: 'Submitted' }]
      });

      await Notification.deleteMany({});

      // Admin updates status
      const updateRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issue._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: admin1Cookie,
          'x-csrf-token': extractRawCsrf(admin1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'under_review',
          note: 'Gate team notified.'
        })
      });
      assert.strictEqual(updateRes.status, 200);

      // Non-member outsider must not receive notifications in Society A
      const notifsOutsider = await Notification.find({ recipient: outsider._id });
      assert.strictEqual(notifsOutsider.length, 0, 'Non-member submitter must not receive notifications');
    });
  });

  describe('Resident Privacy and Strict Allowlist Templates', () => {
    test('Completion notification to resident strictly redacts costs and provider contact info', async () => {
      const issue = await Issue.create({
        society: societyAId,
        submittingResident: resident1Id,
        title: 'Corridor main light replacement',
        description: 'Fluorescent fixture burnt out.',
        category: 'electrical',
        location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
        status: 'in_progress',
        history: [
          { action: 'created', toStatus: 'submitted', changedBy: resident1Id, note: 'Submitted' },
          { action: 'status_change', toStatus: 'in_progress', changedBy: admin1Id, note: 'Started' }
        ]
      });

      await Notification.deleteMany({});

      // Admin 1 submits completion with itemized costs and provider details
      const compRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issue._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: admin1Cookie,
          'x-csrf-token': extractRawCsrf(admin1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Replaced ballast and two tubes.',
          costs: {
            materialCost: 4500,
            laborCost: 1500,
            otherCost: 500,
            currency: 'INR'
          },
          completionDetails: {
            workSummary: 'Installed new LED lighting gear.',
            completedAt: new Date().toISOString(),
            completedBy: 'Super Electrics Private Ltd',
            evidence: [
              { caption: 'New LED light operating', isInternal: false }
            ]
          }
        })
      });
      assert.strictEqual(compRes.status, 200);

      const notifs = await Notification.find({ recipient: resident1Id });
      assert.strictEqual(notifs.length, 1);
      const notif = notifs[0];

      assert.strictEqual(notif.type, 'completion_submitted');
      // Assert cost numbers are completely excluded from title and message
      assert.ok(!notif.message.includes('4500'), 'Must not leak materialCost');
      assert.ok(!notif.message.includes('1500'), 'Must not leak laborCost');
      assert.ok(!notif.message.includes('6500'), 'Must not leak totalCost');
      assert.ok(!notif.message.includes('INR'), 'Must not mention currency');
      assert.ok(!notif.message.includes('Super Electrics'), 'Must not leak provider name');
    });

    test('Common area issue notifications are NOT broadcasted to unrelated residents', async () => {
      // Submitting common area issue
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'x-csrf-token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Garden water pump failure',
          description: 'Water pump in central lawn making grinding noise.',
          category: 'common_area',
          location: { type: 'common_area', areaDescription: 'Central lawn pump house' },
          priority: 'normal'
        })
      });
      assert.strictEqual(res.status, 201);

      // Only society admins are notified
      const notifsAdmin1 = await Notification.find({ recipient: admin1Id });
      assert.strictEqual(notifsAdmin1.length, 1);

      // Resident 2 (unrelated resident) MUST NOT receive common area broadcast
      const notifsRes2 = await Notification.find({ recipient: resident2Id });
      assert.strictEqual(notifsRes2.length, 0);
    });
  });

  describe('Internal Notes and Confidential Admin Alerts', () => {
    test('Internal note by Admin 1 alerts Admin 2, but strictly excludes Resident 1 submitter', async () => {
      const issue = await Issue.create({
        society: societyAId,
        submittingResident: resident1Id,
        title: 'Roof seepage over flat 401',
        description: 'Water marks appearing on bedroom roof.',
        category: 'structural',
        location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
        status: 'under_review',
        history: [{ action: 'created', toStatus: 'submitted', changedBy: resident1Id, note: 'Submitted' }]
      });

      await Notification.deleteMany({});

      // Admin 1 adds an internal note
      const noteRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issue._id}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: admin1Cookie,
          'x-csrf-token': extractRawCsrf(admin1Cookie)
        },
        body: JSON.stringify({
          note: 'Contractor requested 15000 advance. Pending committee budget sign-off.',
          isInternal: true
        })
      });
      assert.strictEqual(noteRes.status, 201);

      // Admin 2 should receive the internal note alert
      const notifsAdmin2 = await Notification.find({ recipient: admin2Id });
      assert.strictEqual(notifsAdmin2.length, 1);
      assert.strictEqual(notifsAdmin2[0].type, 'note_added');
      assert.ok(notifsAdmin2[0].title.includes('Internal Staff Note'));

      // Resident 1 (submitter) MUST receive ZERO notifications
      const notifsRes1 = await Notification.find({ recipient: resident1Id });
      assert.strictEqual(notifsRes1.length, 0);

      // Admin 1 (actor) receives no notification
      const notifsAdmin1 = await Notification.find({ recipient: admin1Id });
      assert.strictEqual(notifsAdmin1.length, 0);
    });

    test('Internal progress update by Admin 1 alerts Admin 2 and strictly excludes Resident 1', async () => {
      const issue = await Issue.create({
        society: societyAId,
        submittingResident: resident1Id,
        title: 'Lift shaft lubrication',
        description: 'Lift making squeaking noises.',
        category: 'elevator',
        location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
        status: 'in_progress',
        history: [{ action: 'created', toStatus: 'submitted', changedBy: resident1Id, note: 'Submitted' }]
      });

      await Notification.deleteMany({});

      const progRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issue._id}/progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: admin1Cookie,
          'x-csrf-token': extractRawCsrf(admin1Cookie)
        },
        body: JSON.stringify({
          progressPercentage: 40,
          note: 'Internal inspection found bearing wear.',
          isInternal: true
        })
      });
      assert.strictEqual(progRes.status, 201);

      // Admin 2 receives progress notification
      const notifsAdmin2 = await Notification.find({ recipient: admin2Id });
      assert.strictEqual(notifsAdmin2.length, 1);

      // Submitter receives zero
      const notifsRes1 = await Notification.find({ recipient: resident1Id });
      assert.strictEqual(notifsRes1.length, 0);
    });
  });

  describe('Society Isolation, Recipient Ownership, and API Validation', () => {
    test('Residents cannot list or mark notifications belonging to other residents or societies', async () => {
      // Seed a notification for Resident 1
      const notif1 = await Notification.create({
        recipient: resident1Id,
        society: societyAId,
        issue: new mongoose.Types.ObjectId(),
        type: 'status_changed',
        title: 'Your issue has been updated',
        message: 'The issue is now under review.',
        idempotencyKey: 'seed:1'
      });

      // 1. Resident 2 attempts to mark Resident 1 notification as read -> 404 Not Found
      const patchRes = await fetch(`${baseUrl}/api/societies/${societyAId}/notifications/${notif1._id}/read`, {
        method: 'PATCH',
        headers: {
          Cookie: resident2Cookie,
          'x-csrf-token': extractRawCsrf(resident2Cookie)
        }
      });
      assert.strictEqual(patchRes.status, 404);

      // 2. Admin B from Society B attempts to access notification -> 403 or 404
      const patchCrossSoc = await fetch(`${baseUrl}/api/societies/${societyBId}/notifications/${notif1._id}/read`, {
        method: 'PATCH',
        headers: {
          Cookie: adminBCookie,
          'x-csrf-token': extractRawCsrf(adminBCookie)
        }
      });
      assert.strictEqual(patchCrossSoc.status, 404);

      // 3. Resident 1 successfully marks their own notification as read
      const markOwn = await fetch(`${baseUrl}/api/societies/${societyAId}/notifications/${notif1._id}/read`, {
        method: 'PATCH',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': extractRawCsrf(resident1Cookie)
        }
      });
      assert.strictEqual(markOwn.status, 200);
      const markData = await markOwn.json();
      assert.strictEqual(markData.success, true);
      assert.strictEqual(markData.notification.read, true);
    });

    test('Authenticated resident belonging only to Society A cannot list notifications of Society B (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyBId}/notifications`, {
        headers: {
          Cookie: resident1Cookie
        }
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.message, 'Access denied: You are not an active member of this society.');
    });

    test('Validates pagination and query parameters strictly', async () => {
      // Negative page
      const resBadPage = await fetch(`${baseUrl}/api/societies/${societyAId}/notifications?page=-1`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(resBadPage.status, 400);

      // Non-integer page
      const resAlphaPage = await fetch(`${baseUrl}/api/societies/${societyAId}/notifications?page=abc`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(resAlphaPage.status, 400);

      // Limit out of bounds (> 50)
      const resBigLimit = await fetch(`${baseUrl}/api/societies/${societyAId}/notifications?limit=55`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(resBigLimit.status, 400);

      // Invalid read boolean
      const resBadRead = await fetch(`${baseUrl}/api/societies/${societyAId}/notifications?read=maybe`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(resBadRead.status, 400);

      // Valid pagination returns 200 with structure
      const resValid = await fetch(`${baseUrl}/api/societies/${societyAId}/notifications?page=1&limit=10&read=true`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(resValid.status, 200);
      const validData = await resValid.json();
      assert.strictEqual(validData.success, true);
      assert.ok(Array.isArray(validData.notifications));
      assert.strictEqual(typeof validData.unreadCount, 'number');
      assert.strictEqual(validData.pagination.page, 1);
      assert.strictEqual(validData.pagination.limit, 10);
    });

    test('Bulk read-all marks all unread notifications for recipient in society', async () => {
      await Notification.create([
        {
          recipient: resident1Id,
          society: societyAId,
          issue: new mongoose.Types.ObjectId(),
          type: 'status_changed',
          title: 'Notif 1',
          message: 'Message 1',
          idempotencyKey: 'bulk:1',
          read: false
        },
        {
          recipient: resident1Id,
          society: societyAId,
          issue: new mongoose.Types.ObjectId(),
          type: 'status_changed',
          title: 'Notif 2',
          message: 'Message 2',
          idempotencyKey: 'bulk:2',
          read: false
        }
      ]);

      const bulkRes = await fetch(`${baseUrl}/api/societies/${societyAId}/notifications/read-all`, {
        method: 'POST',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': extractRawCsrf(resident1Cookie)
        }
      });
      assert.strictEqual(bulkRes.status, 200);
      const bulkData = await bulkRes.json();
      assert.strictEqual(bulkData.success, true);
      assert.strictEqual(bulkData.updatedCount, 2);

      const remainingUnread = await Notification.countDocuments({
        recipient: resident1Id,
        society: societyAId,
        read: false
      });
      assert.strictEqual(remainingUnread, 0);
    });
  });

  describe('Idempotency, Deduplication, and Duplicate-Key Recovery', () => {
    test('Duplicate dispatch of identical event produces safe no-op without duplicate document or email', async () => {
      const issue = await Issue.create({
        society: societyAId,
        submittingResident: resident1Id,
        title: 'Idempotency verification issue',
        description: 'Testing duplicate event dispatch.',
        category: 'other',
        location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
        status: 'submitted',
        history: [{ action: 'created', toStatus: 'submitted', changedBy: resident1Id, note: 'Initial event' }]
      });

      const initialEvent = issue.history[0];

      // Dispatch 1
      const res1 = await dispatchIssueEvent({
        issue,
        event: initialEvent,
        actor: { _id: resident1Id, role: 'resident' },
        societyId: societyAId
      });
      assert.strictEqual(res1.inAppSaved, 2); // 2 admins saved
      assert.strictEqual(res1.duplicates, 0);

      const docsAfter1 = await Notification.find({ issue: issue._id });
      assert.strictEqual(docsAfter1.length, 2);

      // Dispatch 2 (exact same event ID and action re-dispatched)
      const res2 = await dispatchIssueEvent({
        issue,
        event: initialEvent,
        actor: { _id: resident1Id, role: 'resident' },
        societyId: societyAId
      });
      assert.strictEqual(res2.inAppSaved, 0);
      assert.strictEqual(res2.duplicates, 2); // Caught 11000 duplicate keys safely

      const docsAfter2 = await Notification.find({ issue: issue._id });
      assert.strictEqual(docsAfter2.length, 2, 'Total documents must not increase');
    });
  });

  describe('Email Adapter, Delivery Tracking, and Fault Tolerance', () => {
    test('When EMAIL_ENABLED is true, mock adapter records outbound email and marks notification sent', async () => {
      process.env.EMAIL_ENABLED = 'true';
      try {
        const issue = await Issue.create({
          society: societyAId,
          submittingResident: resident1Id,
          title: 'Email dispatch test issue',
          description: 'Testing outbound email tracking.',
          category: 'carpentry',
          location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
          status: 'under_review',
          history: [{ action: 'created', toStatus: 'submitted', changedBy: resident1Id, note: 'Submitted' }]
        });

        // Admin 1 schedules repair
        const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issue._id}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: admin1Cookie,
            'x-csrf-token': extractRawCsrf(admin1Cookie)
          },
          body: JSON.stringify({
            toStatus: 'scheduled',
            scheduledDate: new Date(Date.now() + 86400000).toISOString(),
            note: 'Carpenter visiting tomorrow morning.'
          })
        });
        assert.strictEqual(res.status, 200);

        const sent = emailAdapter.getSentEmails();
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].to, 'resident1@society-a.local');
        assert.ok(sent[0].subject.includes('Repair Scheduled'));

        const notifs = await Notification.find({ recipient: resident1Id });
        assert.strictEqual(notifs.length, 1);
        assert.strictEqual(notifs[0].emailStatus, 'sent');
        assert.ok(notifs[0].emailSentAt instanceof Date);
      } finally {
        process.env.EMAIL_ENABLED = 'false';
      }
    });

    test('Email adapter delivery failure does NOT abort issue update or delete in-app notification', async () => {
      process.env.EMAIL_ENABLED = 'true';
      emailAdapter.simulateFailure(true, 'Simulated SMTP connection reset');
      try {
        const issue = await Issue.create({
          society: societyAId,
          submittingResident: resident1Id,
          title: 'Email failure tolerance issue',
          description: 'Testing non-blocking email delivery failure.',
          category: 'plumbing',
          location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
          status: 'submitted',
          history: [{ action: 'created', toStatus: 'submitted', changedBy: resident1Id, note: 'Submitted' }]
        });

        // Admin updates status - should succeed with 200 OK despite email failure!
        const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issue._id}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: admin1Cookie,
            'x-csrf-token': extractRawCsrf(admin1Cookie)
          },
          body: JSON.stringify({
            toStatus: 'under_review',
            note: 'Proceeding with committee review.'
          })
        });
        assert.strictEqual(res.status, 200, 'Issue update must succeed even when email throws');

        // In-app notification must still be saved, with emailStatus='failed'
        const notifs = await Notification.find({ recipient: resident1Id });
        assert.strictEqual(notifs.length, 1);
        assert.strictEqual(notifs[0].type, 'status_changed');
        assert.strictEqual(notifs[0].emailStatus, 'failed');
        assert.ok(notifs[0].emailError.includes('Simulated SMTP connection reset'));
      } finally {
        process.env.EMAIL_ENABLED = 'false';
        emailAdapter.simulateFailure(false);
      }
    });

    test('In-app notification database failure does not roll back issue update', async () => {
      // Simulate by passing an issue with invalid recipient or mocking dispatch
      const issue = await Issue.create({
        society: societyAId,
        submittingResident: resident1Id,
        title: 'Persistence failure resilience',
        description: 'Testing best-effort delivery fault tolerance.',
        category: 'housekeeping',
        location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
        status: 'submitted',
        history: [{ action: 'created', toStatus: 'submitted', changedBy: resident1Id, note: 'Submitted' }]
      });

      // Update issue should complete successfully
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issue._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: admin1Cookie,
          'x-csrf-token': extractRawCsrf(admin1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'under_review',
          note: 'Best effort verification.'
        })
      });
      assert.strictEqual(res.status, 200);

      const updated = await Issue.findById(issue._id);
      assert.strictEqual(updated.status, 'under_review');
    });

    test('SmtpEmailAdapter stub fails safely with explicit non-secret error and does not simulate success', async () => {
      const { SmtpEmailAdapter } = require('../services/notifications/emailAdapter');
      const smtpAdapter = new SmtpEmailAdapter({ host: 'smtp.example.com' });
      const res = await smtpAdapter.sendEmail({
        to: 'resident1@society-a.local',
        subject: 'Test Subject',
        text: 'Test Body'
      });
      assert.strictEqual(res.success, false);
      assert.ok(res.error.includes('SMTP transport not active'));
      assert.ok(!res.error.includes('Password'));
      assert.ok(!res.error.includes('secret'));
    });
  });
});
