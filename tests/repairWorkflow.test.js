const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { app, connectDB, disconnectDB } = require('../server');
const User = require('../models/User');
const Society = require('../models/Society');
const SocietyMembership = require('../models/SocietyMembership');
const { Issue } = require('../models/Issue');

describe('Phase 5 — Repair Workflow, Verification, Costs, and Audit Tests', () => {
  let server;
  let baseUrl;
  const testDbUri = 'mongodb://127.0.0.1:27017/housing_management_phase5_test';

  let adminACookie;
  let resident1Cookie;
  let resident2Cookie;
  let adminBCookie;

  let societyAId;
  let societyBId;

  let resident1Id;
  let resident2Id;
  let adminAId;

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
    await connectDB(testDbUri);

    await User.deleteMany({});
    await Society.deleteMany({});
    await SocietyMembership.deleteMany({});
    await Issue.deleteMany({});

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 1. Setup Admin A and Society A
    const adminARes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Alpha Phase 5',
        email: 'admin.alpha.p5@example.com',
        password: 'Password123!'
      })
    });
    adminACookie = extractCookie(adminARes);
    const adminAData = await adminARes.json();
    adminAId = adminAData.user._id || adminAData.user.id;

    const socARes = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminACookie,
        'X-CSRF-Token': extractRawCsrf(adminACookie)
      },
      body: JSON.stringify({
        name: 'Alpha Heights Phase 5',
        code: 'ALPHA-P5-01'
      })
    });
    const socAData = await socARes.json();
    societyAId = socAData.society._id;

    // 2. Setup Resident 1 in Society A
    const res1Res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident One P5',
        email: 'res1.p5@example.com',
        password: 'Password123!',
        phone: '1111111111'
      })
    });
    resident1Cookie = extractCookie(res1Res);
    const res1Data = await res1Res.json();
    resident1Id = res1Data.user._id || res1Data.user.id;

    await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminACookie,
        'X-CSRF-Token': extractRawCsrf(adminACookie)
      },
      body: JSON.stringify({
        email: 'res1.p5@example.com',
        role: 'resident',
        flatNumber: 'A-101'
      })
    });

    // 3. Setup Resident 2 in Society A
    const res2Res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident Two P5',
        email: 'res2.p5@example.com',
        password: 'Password123!',
        phone: '2222222222'
      })
    });
    resident2Cookie = extractCookie(res2Res);
    const res2Data = await res2Res.json();
    resident2Id = res2Data.user._id || res2Data.user.id;

    await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminACookie,
        'X-CSRF-Token': extractRawCsrf(adminACookie)
      },
      body: JSON.stringify({
        email: 'res2.p5@example.com',
        role: 'resident',
        flatNumber: 'A-102'
      })
    });

    // 4. Setup Admin B and Society B
    const adminBRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Beta Phase 5',
        email: 'admin.beta.p5@example.com',
        password: 'Password123!'
      })
    });
    adminBCookie = extractCookie(adminBRes);

    const socBRes = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminBCookie,
        'X-CSRF-Token': extractRawCsrf(adminBCookie)
      },
      body: JSON.stringify({
        name: 'Beta Bay Phase 5',
        code: 'BETA-P5-02'
      })
    });
    const socBData = await socBRes.json();
    societyBId = socBData.society._id;
  });

  after(async () => {
    await User.deleteMany({});
    await Society.deleteMany({});
    await SocietyMembership.deleteMany({});
    await Issue.deleteMany({});
    await disconnectDB();

    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  describe('Scheduling, Rescheduling, and Repair Progress Tracking', () => {
    let issueId;

    before(async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Ceiling Water Leakage',
          description: 'Water seeping through bedroom ceiling during rain.',
          category: 'plumbing',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: 'A-101' }
        })
      });
      const data = await res.json();
      issueId = data.issue._id;

      // Admin reviews issue
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'under_review',
          note: 'Inspecting repair requirements'
        })
      });
    });

    test('Admin schedules repair work with valid scheduledDate (200 OK)', async () => {
      const scheduledDate = new Date(Date.now() + 86400000).toISOString();
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'scheduled',
          scheduledDate,
          note: 'Scheduled plumbing technician visit'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'scheduled');
      assert.ok(data.issue.scheduledDate);
    });

    test('Admin reschedules repair work to updated date (200 OK)', async () => {
      const updatedDate = new Date(Date.now() + 172800000).toISOString();
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'scheduled', // reschedule transition
          scheduledDate: updatedDate,
          note: 'Technician requested 1-day delay for parts'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'scheduled');
    });

    test('Admin records repair progress on active issue (201 Created)', async () => {
      // Transition to in_progress
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'in_progress',
          note: 'Work commenced by technician'
        })
      });

      // Record progress
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          note: 'Replaced main seal; plaster drying',
          progressPercentage: 65,
          isInternal: false
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);

      // Verify audit history contains progress_recorded event
      const lastEvent = data.issue.history[data.issue.history.length - 1];
      assert.strictEqual(lastEvent.action, 'progress_recorded');
      assert.match(lastEvent.note, /\[65%\] Replaced main seal/);
    });

    test('Rejects progress update with invalid percentage < 0 or > 100 (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          note: 'Invalid percentage progress',
          progressPercentage: 150
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /progress percentage must be a finite number between 0 and 100/i);
    });
  });

  describe('Completion Submission, Repair Costs, and Evidence Metadata', () => {
    let issueId;

    beforeEach(async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Main Lobby Light Repair',
          description: 'Lobby ceiling panel light flickering and going dark.',
          category: 'electrical',
          location: { type: 'common_area', areaDescription: 'Main Ground Lobby' }
        })
      });
      const data = await res.json();
      issueId = data.issue._id;

      // Move to in_progress
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'under_review', note: 'Under review' })
      });
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'in_progress', note: 'Electrician on site' })
      });
    });

    test('Admin submits completion with valid costs and evidence metadata (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Driver replaced and tested for 2 hours',
          costs: {
            materialCost: 800,
            laborCost: 1200,
            otherCost: 100,
            totalCost: 2100,
            currency: 'INR'
          },
          completionDetails: {
            workSummary: 'Replaced 45W driver module and re-seated LED panel',
            completedBy: 'QuickFix Electricals',
            evidence: [
              {
                caption: 'Replaced driver module',
                referenceUrl: 'https://internal-docs.example.com/evidence/driver-45w.jpg',
                isInternal: false
              },
              {
                caption: 'Invoice snapshot',
                referenceUrl: 'https://internal-docs.example.com/invoices/inv-90812.pdf',
                isInternal: true
              }
            ]
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'completion_submitted');
      assert.strictEqual(data.issue.costs.totalCost, 2100);
      assert.strictEqual(data.issue.completionDetails.workSummary, 'Replaced 45W driver module and re-seated LED panel');
      assert.strictEqual(data.issue.completionDetails.evidence.length, 2);

      // Verify in MongoDB
      const dbIssue = await Issue.findById(issueId);
      assert.strictEqual(dbIssue.costs.totalCost, 2100);
      assert.strictEqual(dbIssue.costs.currency, 'INR');
    });

    test('Rejects negative cost values (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Done',
          costs: {
            materialCost: -200,
            laborCost: 500
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /cannot be negative/i);
    });

    test('Rejects non-finite and NaN cost values (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Done',
          costs: {
            totalCost: 'not-a-number'
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /valid finite number/i);
    });

    test('Rejects costs exceeding reasonable upper bound (> 30M) (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Done',
          costs: {
            totalCost: 50000000
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /maximum reasonable bound/i);
    });

    test('Rejects unknown/unexpected fields in costs object (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Done',
          costs: {
            totalCost: 1000,
            secretKickback: 500
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid field\(s\) in costs/i);
    });
  });

  describe('Human Verification, Rejection, Resubmission, and Reopening', () => {
    let issueId;

    beforeEach(async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Main Clubhouse Gate Latch',
          description: 'Latch broken on main entrance gate.',
          category: 'carpentry',
          location: { type: 'common_area', areaDescription: 'Clubhouse Entrance' }
        })
      });
      const data = await res.json();
      issueId = data.issue._id;

      // Progress to completion_submitted
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'under_review', note: 'Under review' })
      });
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'in_progress', note: 'In progress' })
      });
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Repaired by carpenter',
          costs: { totalCost: 500 }
        })
      });
    });

    test('STRICT RULE: Resident cannot verify completion or close issue (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'verified_closed',
          note: 'Resident approves'
        })
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.message, /only an authorized society administrator/i);
    });

    test('STRICT RULE: Resident cannot reject completion (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'verification_rejected',
          note: 'Resident rejects'
        })
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.message, /only an authorized society administrator/i);
    });

    test('Rejection requires a mandatory non-empty reason (400 Bad Request if missing)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'verification_rejected',
          note: '' // Empty note
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /explaining why verification was rejected is required/i);
    });

    test('Admin successfully verifies and closes completion (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'verified_closed',
          resolutionSummary: 'Verified latch alignment in person; locks securely.',
          note: 'Verified in person'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'verified_closed');
      assert.strictEqual(data.issue.resolutionSummary, 'Verified latch alignment in person; locks securely.');

      // Check verificationDetails in DB
      const dbIssue = await Issue.findById(issueId);
      assert.strictEqual(dbIssue.verificationDetails.decision, 'verified_closed');
      assert.strictEqual(dbIssue.verificationDetails.verifiedBy.toString(), adminAId);
    });

    test('Correction rework loop: Reject -> In Progress -> Completion Submitted -> Verified Closed', async () => {
      // 1. Admin rejects completion with reason
      const rejRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'verification_rejected',
          note: 'Latch screw is loose; gate still wobbles.'
        })
      });
      assert.strictEqual(rejRes.status, 200);
      const rejData = await rejRes.json();
      assert.strictEqual(rejData.issue.status, 'verification_rejected');

      // 2. Admin returns to in_progress for rework
      const reworkRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'in_progress',
          note: 'Carpenter recalled to fix screws and alignment'
        })
      });
      assert.strictEqual(reworkRes.status, 200);

      // 3. Admin resubmits corrected completion
      const resubmitRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Bolts tightened and tested with heavy gate slam',
          costs: { totalCost: 600 }
        })
      });
      assert.strictEqual(resubmitRes.status, 200);

      // 4. Admin verifies and closes
      const closeRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'verified_closed',
          resolutionSummary: 'Gate latch reinforced with heavy bolts; fully operational.'
        })
      });
      assert.strictEqual(closeRes.status, 200);
    });

    test('Reopening transitions: Submitter can reopen verified_closed issue; non-submitter cannot', async () => {
      // Close the issue first
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'verified_closed',
          resolutionSummary: 'Closed'
        })
      });

      // 1. Reopening requires a note
      const failReopenRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'reopened',
          note: ''
        })
      });
      assert.strictEqual(failReopenRes.status, 400);

      // 2. Submitting resident reopens with note (200 OK)
      const reopenRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'reopened',
          note: 'Latch broke again next morning upon opening.'
        })
      });
      assert.strictEqual(reopenRes.status, 200);
      const reopenData = await reopenRes.json();
      assert.strictEqual(reopenData.issue.status, 'reopened');

      // 3. Reopened issue cannot jump directly to verified_closed
      const invalidJump = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'verified_closed',
          note: 'Illegal jump'
        })
      });
      assert.strictEqual(invalidJump.status, 400);

      // 4. Valid reopening follow-up transition: reopened -> under_review
      const reviewRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'under_review',
          note: 'Assessing root cause of reoccurring latch failure'
        })
      });
      assert.strictEqual(reviewRes.status, 200);
    });
  });

  describe('Security, Isolation, Server-Controlled Data, and Privacy', () => {
    let privateUnitIssueId;

    before(async () => {
      // Create private unit issue for resident 1
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Private Shower Valve Broken',
          description: 'Hot water valve leaking heavily into bathroom floor.',
          category: 'plumbing',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: 'A-101' }
        })
      });
      const data = await res.json();
      privateUnitIssueId = data.issue._id;

      // Admin adds provider details, costs, completion details with internal evidence, and internal notes
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          externalProviderDetails: {
            companyOrName: 'Secret High-End Plumbing Ltd',
            contactPhone: '9888877777',
            trade: 'Plumber'
          },
          costs: {
            materialCost: 1500,
            laborCost: 2000,
            totalCost: 3500,
            currency: 'INR'
          },
          completionDetails: {
            workSummary: 'Replaced brass valve spindle',
            evidence: [
              {
                caption: 'Replaced Spindle Public',
                referenceUrl: 'https://docs.example.com/spindle.jpg',
                isInternal: false
              },
              {
                caption: 'Internal Admin Verification Note',
                referenceUrl: 'https://docs.example.com/internal-check.jpg',
                isInternal: true
              }
            ]
          }
        })
      });

      // Admin adds internal note
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          note: 'Internal note: contractor provided discounted rate',
          isInternal: true
        })
      });
    });

    test('Resident privacy: Non-admin response strictly redacts costs, provider details, internal evidence, and internal notes', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}`, {
        headers: { Cookie: resident1Cookie }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const issue = data.issue;

      // 1. Costs are completely redacted for residents
      assert.strictEqual(issue.costs, undefined, 'Costs must be undefined for resident');

      // 2. Provider details are completely redacted for residents
      assert.strictEqual(issue.externalProviderDetails, undefined, 'externalProviderDetails must be undefined for resident');

      // 3. Internal note is filtered from history
      assert.ok(
        issue.history.every((e) => !e.isInternal),
        'Internal notes must never appear in resident history'
      );

      // 4. Internal evidence items are filtered out
      if (issue.completionDetails && Array.isArray(issue.completionDetails.evidence)) {
        assert.ok(
          issue.completionDetails.evidence.every((ev) => !ev.isInternal),
          'Internal evidence metadata must never appear in resident completion details'
        );
      }
    });

    test('Admin response preserves costs, provider details, and internal metadata', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}`, {
        headers: { Cookie: adminACookie }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const issue = data.issue;

      assert.ok(issue.costs, 'Admin must see costs');
      assert.strictEqual(issue.costs.totalCost, 3500);
      assert.ok(issue.externalProviderDetails, 'Admin must see externalProviderDetails');
      assert.strictEqual(issue.externalProviderDetails.companyOrName, 'Secret High-End Plumbing Ltd');
      assert.ok(issue.history.some((e) => e.isInternal), 'Admin must see internal notes');
    });

    test('Client-supplied actor IDs and timestamps are strictly overridden by server-derived context', async () => {
      const spoofedUserId = new mongoose.Types.ObjectId().toString();
      const spoofedDate = new Date('2020-01-01').toISOString();

      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          note: 'Testing actor override',
          changedBy: spoofedUserId,
          changedAt: spoofedDate
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      const lastNote = data.issue.history[data.issue.history.length - 1];

      // Must be set to adminAId, NOT spoofedUserId
      const actorId = typeof lastNote.changedBy === 'object' && lastNote.changedBy !== null
        ? (lastNote.changedBy._id || lastNote.changedBy).toString()
        : String(lastNote.changedBy);
      assert.strictEqual(actorId, adminAId.toString());
      // Timestamp must be recent, not 2020
      const eventYear = new Date(lastNote.changedAt).getFullYear();
      assert.ok(eventYear >= 2025);
    });

    test('CROSS-SOCIETY ISOLATION: Admin B cannot record progress or update status of Society A issue (404 Not Found)', async () => {
      const res1 = await fetch(`${baseUrl}/api/societies/${societyBId}/issues/${privateUnitIssueId}/progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminBCookie,
          'X-CSRF-Token': extractRawCsrf(adminBCookie)
        },
        body: JSON.stringify({
          note: 'Admin B malicious progress inject'
        })
      });
      assert.strictEqual(res1.status, 404);

      const res2 = await fetch(`${baseUrl}/api/societies/${societyBId}/issues/${privateUnitIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminBCookie,
          'X-CSRF-Token': extractRawCsrf(adminBCookie)
        },
        body: JSON.stringify({
          toStatus: 'cancelled',
          note: 'Admin B malicious cancel'
        })
      });
      assert.strictEqual(res2.status, 404);
    });

    test('Resident 2 cannot view Resident 1 private unit issue (404 Not Found)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}`, {
        headers: { Cookie: resident2Cookie }
      });
      assert.strictEqual(res.status, 404);
    });

    test('Unauthenticated requests are rejected (401 Unauthorized)', async () => {
      const res1 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'No token' })
      });
      assert.strictEqual(res1.status, 401);

      const res2 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStatus: 'under_review' })
      });
      assert.strictEqual(res2.status, 401);
    });

    test('Rejects update body attempting to overwrite prohibited fields (_id, status, history)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          status: 'verified_closed',
          history: []
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /cannot be updated directly/i);
    });

    test('Rejects update body attempting to directly modify verificationDetails or resolutionSummary (400 Bad Request)', async () => {
      const res1 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          verificationDetails: { decision: 'verified_closed' }
        })
      });
      assert.strictEqual(res1.status, 400);
      const data1 = await res1.json();
      assert.match(data1.message, /Field "verificationDetails" cannot be updated directly/i);

      const res2 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          resolutionSummary: 'Attempted direct injection'
        })
      });
      assert.strictEqual(res2.status, 400);
      const data2 = await res2.json();
      assert.match(data2.message, /Field "resolutionSummary" cannot be updated directly/i);
    });

    test('Normal issue update cannot update a cancelled or verified_closed issue (400 Bad Request)', async () => {
      // 1. Create a cancelled issue
      const cRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          title: 'Issue to be cancelled',
          description: 'Testing cancelled update prevention',
          category: 'plumbing',
          location: { type: 'common_area', areaDescription: 'Pool side' }
        })
      });
      const cData = await cRes.json();
      const cIssueId = cData.issue._id;

      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${cIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'cancelled', cancellationReason: 'Not needed' })
      });

      // Try normal update on cancelled issue
      const updateCancelRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${cIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ title: 'Updated cancelled title' })
      });
      assert.strictEqual(updateCancelRes.status, 400);
      const cancelData = await updateCancelRes.json();
      assert.match(cancelData.message, /Cannot update an issue that has been cancelled/i);

      // 2. Create and verify_close an issue
      const vRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          title: 'Issue to be verified',
          description: 'Testing verified_closed update prevention',
          category: 'plumbing',
          location: { type: 'common_area', areaDescription: 'Basement' }
        })
      });
      const vData = await vRes.json();
      const vIssueId = vData.issue._id;

      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${vIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'under_review', note: 'Reviewing' })
      });
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${vIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'in_progress', note: 'Working' })
      });
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${vIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'completion_submitted', note: 'Done' })
      });
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${vIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'verified_closed', note: 'All verified good' })
      });

      // Try normal update on verified_closed issue
      const updateVerifiedRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${vIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ title: 'Updated verified title' })
      });
      assert.strictEqual(updateVerifiedRes.status, 400);
      const verifiedData = await updateVerifiedRes.json();
      assert.match(verifiedData.message, /Cannot update an issue that has been verified and closed/i);
    });

    test('Server strictly computes totalCost from itemized costs overriding spoofed client totalCost', async () => {
      const issueRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          title: 'Total cost calculation test',
          description: 'Testing totalCost server calculation',
          category: 'electrical',
          location: { type: 'common_area', areaDescription: 'Corridor' }
        })
      });
      const issueData = await issueRes.json();
      const testIssueId = issueData.issue._id;

      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'under_review', note: 'Reviewing' })
      });
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'in_progress', note: 'Working' })
      });

      // Submit completion with itemized costs: 500 + 700 + 100 = 1300, but client spoofed totalCost: 10
      const compRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Work completed',
          costs: {
            materialCost: 500,
            laborCost: 700,
            otherCost: 100,
            totalCost: 10
          }
        })
      });

      assert.strictEqual(compRes.status, 200);
      const compData = await compRes.json();
      assert.strictEqual(compData.issue.costs.totalCost, 1300, 'Server must enforce calculated total of 1300');

      const dbDoc = await Issue.findById(testIssueId);
      assert.strictEqual(dbDoc.costs.totalCost, 1300);
    });

    test('Rejects completion with future completedAt timestamp (400 Bad Request)', async () => {
      const issueRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          title: 'Future timestamp test',
          description: 'Testing future completedAt rejection',
          category: 'structural',
          location: { type: 'common_area', areaDescription: 'Roof' }
        })
      });
      const issueData = await issueRes.json();
      const testIssueId = issueData.issue._id;

      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'under_review', note: 'Reviewing' })
      });
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'in_progress', note: 'Working' })
      });

      const futureRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Done in future',
          completionDetails: {
            completedAt: '2099-01-01T00:00:00.000Z'
          }
        })
      });

      assert.strictEqual(futureRes.status, 400);
      const futureData = await futureRes.json();
      assert.match(futureData.message, /cannot be in the future/i);
    });

    test('Rejects evidence with unsafe javascript: URL in referenceUrl (400 Bad Request)', async () => {
      const issueRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          title: 'Unsafe evidence URL test',
          description: 'Testing javascript: URL rejection in evidence',
          category: 'structural',
          location: { type: 'common_area', areaDescription: 'Garden' }
        })
      });
      const issueData = await issueRes.json();
      const testIssueId = issueData.issue._id;

      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'under_review', note: 'Reviewing' })
      });
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'in_progress', note: 'Working' })
      });

      const unsafeRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Done with exploit evidence',
          completionDetails: {
            evidence: [
              {
                caption: 'XSS attempt',
                referenceUrl: 'javascript:alert(document.cookie)'
              }
            ]
          }
        })
      });

      assert.strictEqual(unsafeRes.status, 400);
      const unsafeData = await unsafeRes.json();
      assert.match(unsafeData.message, /invalid or unsafe protocol/i);
    });
  });
});
