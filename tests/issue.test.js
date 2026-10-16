const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { app, connectDB, disconnectDB } = require('../server');
const User = require('../models/User');
const Society = require('../models/Society');
const SocietyMembership = require('../models/SocietyMembership');
const { Issue } = require('../models/Issue');

describe('Issue Management Lifecycle, Privacy, and State Machine Tests', () => {
  let server;
  let baseUrl;
  const testDbUri = 'mongodb://127.0.0.1:27017/housing_management_issue_test';

  // State holders for users, cookies, and societies
  let adminACookie;
  let resident1Cookie;
  let resident2Cookie;
  let residentBCookie;

  let societyAId;
  let societyBId;

  let resident1Id;
  let resident2Id;

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

    // 1. Setup Admin A for Society A
    const adminARes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Alpha',
        email: 'admin.alpha@example.com',
        password: 'Password123!'
      })
    });
    adminACookie = extractCookie(adminARes);

    // Create Society A
    const socARes = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminACookie,
        'X-CSRF-Token': extractRawCsrf(adminACookie)
      },
      body: JSON.stringify({
        name: 'Green Heights Society',
        code: 'GH-ALPHA-01'
      })
    });
    const socAData = await socARes.json();
    societyAId = socAData.society._id;

    // 2. Setup Resident 1 in Society A
    const res1Res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident One',
        email: 'res1@example.com',
        password: 'Password123!',
        phone: '1111111111'
      })
    });
    resident1Cookie = extractCookie(res1Res);
    const res1Data = await res1Res.json();
    resident1Id = res1Data.user.id;

    // Admin adds Resident 1 to Society A
    await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminACookie,
        'X-CSRF-Token': extractRawCsrf(adminACookie)
      },
      body: JSON.stringify({
        email: 'res1@example.com',
        role: 'resident',
        flatNumber: 'A-101'
      })
    });

    // 3. Setup Resident 2 in Society A
    const res2Res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident Two',
        email: 'res2@example.com',
        password: 'Password123!',
        phone: '2222222222'
      })
    });
    resident2Cookie = extractCookie(res2Res);
    const res2Data = await res2Res.json();
    resident2Id = res2Data.user.id;

    // Admin adds Resident 2 to Society A
    await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminACookie,
        'X-CSRF-Token': extractRawCsrf(adminACookie)
      },
      body: JSON.stringify({
        email: 'res2@example.com',
        role: 'resident',
        flatNumber: 'B-202'
      })
    });

    // 4. Setup Society B and Resident B (for cross-society isolation tests)
    const adminBRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Beta',
        email: 'admin.beta@example.com',
        password: 'Password123!'
      })
    });
    const adminBCookie = extractCookie(adminBRes);

    const socBRes = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminBCookie,
        'X-CSRF-Token': extractRawCsrf(adminBCookie)
      },
      body: JSON.stringify({
        name: 'Blue Palms Society',
        code: 'BP-BETA-02'
      })
    });
    const socBData = await socBRes.json();
    societyBId = socBData.society._id;

    const resBRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident Beta',
        email: 'resB@example.com',
        password: 'Password123!'
      })
    });
    residentBCookie = extractCookie(resBRes);

    await fetch(`${baseUrl}/api/societies/${societyBId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminBCookie,
        'X-CSRF-Token': extractRawCsrf(adminBCookie)
      },
      body: JSON.stringify({
        email: 'resB@example.com',
        role: 'resident',
        flatNumber: 'C-303'
      })
    });
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

  describe('Issue Creation and Location Validation', () => {
    test('Resident creates unit issue with valid block and flat (201 Created)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Kitchen Pipe Leaking',
          description: 'Water dripping under the sink constantly since morning.',
          category: 'plumbing',
          location: {
            type: 'unit',
            blockOrWing: 'Wing A',
            flatOrUnit: '101'
          }
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.issue.title, 'Kitchen Pipe Leaking');
      assert.strictEqual(data.issue.status, 'submitted');
      assert.strictEqual(data.issue.priority, 'normal');
      assert.strictEqual(data.issue.location.type, 'unit');
      assert.strictEqual(data.issue.location.flatOrUnit, '101');
      assert.ok(Array.isArray(data.issue.history));
      assert.strictEqual(data.issue.history[0].action, 'created');
    });

    test('Resident creates common_area issue with areaDescription (201 Created)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Elevator 2 Flickering Light',
          description: 'Light inside elevator 2 in tower A is buzzing and flickering.',
          category: 'elevator',
          location: {
            type: 'common_area',
            areaDescription: 'Tower A Main Lobby Elevator 2'
          }
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.issue.location.type, 'common_area');
    });

    test('Rejects unit issue missing flat/unit number (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Bathroom Leak Issue',
          description: 'Water is leaking in the bathroom ceiling.',
          category: 'plumbing',
          location: {
            type: 'unit',
            blockOrWing: 'Wing A'
            // flatOrUnit omitted
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /flat\/unit number are required/i);
    });

    test('Rejects common_area issue missing areaDescription (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Garden Light Broken',
          description: 'Garden pathway light broken.',
          category: 'electrical',
          location: {
            type: 'common_area'
            // areaDescription omitted
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /area description is required/i);
    });

    test('Tamper Protection: Client spoofing status or history is overridden by server', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Main Door Lock Jammed',
          description: 'Lock sticks when inserting the key.',
          category: 'carpentry',
          location: {
            type: 'unit',
            blockOrWing: 'Wing A',
            flatOrUnit: '101'
          },
          status: 'verified_closed', // Client attempting to jump to closed
          history: [{ action: 'status_change', toStatus: 'verified_closed' }] // Fake audit
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'submitted', 'Status must always initialize to submitted');
      assert.strictEqual(data.issue.history.length, 1);
      assert.strictEqual(data.issue.history[0].action, 'created');
    });
  });

  describe('Privacy, Scoped Filtering, and Cross-Society Isolation', () => {
    let res1UnitIssueId;
    let res2UnitIssueId;
    let commonAreaIssueId;

    before(async () => {
      // Resident 1 creates private unit issue
      const i1 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Resident 1 Private Bedroom AC Water Leak',
          description: 'AC in master bedroom dripping water on wall.',
          category: 'electrical',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' }
        })
      });
      const d1 = await i1.json();
      res1UnitIssueId = d1.issue._id;

      // Resident 2 creates private unit issue
      const i2 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident2Cookie,
          'X-CSRF-Token': extractRawCsrf(resident2Cookie)
        },
        body: JSON.stringify({
          title: 'Resident 2 Private Balcony Door Sticking',
          description: 'Balcony sliding door cannot close completely.',
          category: 'carpentry',
          location: { type: 'unit', blockOrWing: 'Wing B', flatOrUnit: '202' }
        })
      });
      const d2 = await i2.json();
      res2UnitIssueId = d2.issue._id;

      // Resident 2 creates common area issue
      const i3 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident2Cookie,
          'X-CSRF-Token': extractRawCsrf(resident2Cookie)
        },
        body: JSON.stringify({
          title: 'Common Clubhouse Gym Treadmill Broken',
          description: 'Gym treadmill belt is slipping and unsafe.',
          category: 'common_area',
          location: { type: 'common_area', areaDescription: 'Clubhouse 1st Floor Gym' }
        })
      });
      const d3 = await i3.json();
      commonAreaIssueId = d3.issue._id;
    });

    test('Admin lists all issues in Society A', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.issues.length >= 3);
    });

    test('Resident 1 lists ONLY their own issues plus common-area issues (excludes Resident 2 private issue)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      const issueIds = data.issues.map((i) => i._id);
      assert.ok(issueIds.includes(res1UnitIssueId), 'Resident 1 must see own issue');
      assert.ok(issueIds.includes(commonAreaIssueId), 'Resident 1 must see common area issue');
      assert.ok(!issueIds.includes(res2UnitIssueId), 'Resident 1 must NEVER see Resident 2 private unit issue');
    });

    test('Resident 1 queries ?myIssuesOnly=true -> returns strictly own issues', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues?myIssuesOnly=true`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      const issueIds = data.issues.map((i) => i._id);
      assert.ok(issueIds.includes(res1UnitIssueId));
      assert.ok(!issueIds.includes(commonAreaIssueId), 'myIssuesOnly=true must exclude other common area issues');
    });

    test('Privacy Detail Check: Resident 1 attempts to view Resident 2 private unit issue -> 404 Not Found (prevents ID enumeration)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${res2UnitIssueId}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /not found in this society/i);
    });

    test('Privacy Detail Check: Resident 1 views common area issue submitted by Resident 2 -> 200 OK with redacted submitter contact', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${commonAreaIssueId}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.issue.submittingResident.phone, undefined, 'Submitter phone must be redacted');
      assert.strictEqual(data.issue.submittingResident.email, undefined, 'Submitter email must be redacted');
    });

    test('CROSS-SOCIETY ISOLATION: Member of Society B cannot view or list issues of Society A (403 Forbidden)', async () => {
      const listRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        headers: { Cookie: residentBCookie }
      });
      assert.strictEqual(listRes.status, 403);

      const detailRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${res1UnitIssueId}`, {
        headers: { Cookie: residentBCookie }
      });
      assert.strictEqual(detailRes.status, 403);
    });
  });

  describe('External Provider Data Redaction', () => {
    let issueWithProviderId;

    before(async () => {
      // Resident 1 creates issue
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Main Circuit Breaker Tripping',
          description: 'Power cuts out when heating appliance is turned on.',
          category: 'electrical',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' }
        })
      });
      const createData = await createRes.json();
      issueWithProviderId = createData.issue._id;

      // Admin updates issue with externalProviderDetails and advances to provider_contact_pending
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueWithProviderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          externalProviderDetails: {
            companyOrName: 'Apex Electrical Services',
            contactPhone: '9998887776',
            trade: 'Electrician'
          }
        })
      });
    });

    test('Admin views issue -> externalProviderDetails is present', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueWithProviderId}`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.issue.externalProviderDetails);
      assert.strictEqual(data.issue.externalProviderDetails.companyOrName, 'Apex Electrical Services');
    });

    test('Resident views their own issue -> externalProviderDetails is strictly redacted (undefined)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueWithProviderId}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.externalProviderDetails, undefined, 'Provider details must be hidden from resident');
    });

    test('Resident lists issues -> externalProviderDetails is strictly redacted in array', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const target = data.issues.find((i) => i._id === issueWithProviderId);
      assert.ok(target);
      assert.strictEqual(target.externalProviderDetails, undefined);
    });
  });

  describe('State Machine Transitions and Repair Verification', () => {
    let lifecycleIssueId;

    before(async () => {
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Full Lifecycle Water Leak Test',
          description: 'Sink drainage pipe loose under the cabinet.',
          category: 'plumbing',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' }
        })
      });
      const data = await createRes.json();
      lifecycleIssueId = data.issue._id;
    });

    test('Invalid jump directly from submitted to completion_submitted is rejected (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'completion_submitted' })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid status transition/i);
    });

    test('Admin transitions submitted -> under_review (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'under_review',
          note: 'Committee review initiated'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'under_review');
    });

    test('Transition to scheduled requires scheduledDate (400 Bad Request if missing)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'scheduled'
          // scheduledDate omitted
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /valid scheduledDate is required/i);
    });

    test('Admin transitions under_review -> scheduled with scheduledDate (200 OK)', async () => {
      const scheduledDate = new Date(Date.now() + 86400000).toISOString();
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'scheduled',
          scheduledDate,
          note: 'Plumber visit scheduled'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'scheduled');
    });

    test('Admin transitions scheduled -> in_progress (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'in_progress',
          note: 'Plumber on site repairing pipe'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'in_progress');
    });

    test('Admin transitions in_progress -> completion_submitted (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          note: 'Work finished, pipe tightened and tested'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'completion_submitted');
    });

    test('STRICT RULE: Resident cannot verify or close completion (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'verified_closed',
          note: 'Resident attempted signoff'
        })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Only an authorized society administrator may verify or reject completion/i);
    });

    test('STRICT RULE: Resident cannot reject completion (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'verification_rejected',
          note: 'Resident attempted rejection'
        })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Only an authorized society administrator may verify or reject completion/i);
    });

    test('Admin rejects completion -> verification_rejected requires note (400 if missing)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'verification_rejected'
          // note omitted
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /note explaining why verification was rejected is required/i);
    });

    test('Admin transitions completion_submitted -> verification_rejected with note (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'verification_rejected',
          note: 'Water still seeping at high pressure; needs Teflon replacement'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'verification_rejected');
    });

    test('Admin reworks: verification_rejected -> in_progress -> completion_submitted -> verified_closed (200 OK)', async () => {
      // 1. back to in_progress
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'in_progress', note: 'Plumber reapplying seal' })
      });

      // 2. completion_submitted
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({ toStatus: 'completion_submitted', note: 'Seal redone' })
      });

      // 3. Admin verifies and closes
      const closeRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'verified_closed',
          note: 'Management verified zero leakage under full pressure'
        })
      });
      assert.strictEqual(closeRes.status, 200);
      const closeData = await closeRes.json();
      assert.strictEqual(closeData.issue.status, 'verified_closed');
    });

    test('Reopening: Submitting resident can reopen verified_closed issue with mandatory note (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${lifecycleIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'reopened',
          note: 'Pipe started leaking again after running dishwasher'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'reopened');
    });
  });

  describe('Cancellation Rules and Terminal State Enforcement', () => {
    let cancelableIssueId;

    before(async () => {
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Accidental Duplicate Issue',
          description: 'Created by mistake, please cancel.',
          category: 'other',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' }
        })
      });
      const data = await createRes.json();
      cancelableIssueId = data.issue._id;
    });

    test('Non-submitter resident cannot cancel another resident issue (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${cancelableIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident2Cookie,
          'X-CSRF-Token': extractRawCsrf(resident2Cookie)
        },
        body: JSON.stringify({
          toStatus: 'cancelled',
          cancellationReason: 'I want to cancel this'
        })
      });
      assert.strictEqual(res.status, 403);
    });

    test('Rejects cancellation when cancellationReason and note are missing (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${cancelableIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'cancelled'
          // no cancellationReason or note
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /cancellation reason or note is required/i);

      // Verify DB state remains unchanged
      const dbIssue = await Issue.findById(cancelableIssueId);
      assert.strictEqual(dbIssue.status, 'submitted');
      assert.strictEqual(dbIssue.history.length, 1);
    });

    test('Submitting resident cancels their own issue (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${cancelableIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          toStatus: 'cancelled',
          cancellationReason: 'Found alternative solution'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'cancelled');
    });

    test('TERMINAL STATE: Cancelled issue cannot transition to any other status (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${cancelableIssueId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          toStatus: 'under_review',
          note: 'Attempting to revive cancelled issue'
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /Cannot transition an issue that has been cancelled/i);
    });
  });

  describe('Audit Trail Immutability and Notes', () => {
    let auditIssueId;

    before(async () => {
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Audit Log Integrity Test Issue',
          description: 'Testing that history cannot be wiped or spoofed.',
          category: 'housekeeping',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' }
        })
      });
      const data = await createRes.json();
      auditIssueId = data.issue._id;
    });

    test('Adding a timeline note appends an event without altering issue status', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${auditIssueId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          note: 'Resident follow-up note: please call after 5 PM'
        })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.issue.status, 'submitted');
      assert.strictEqual(data.issue.history.length, 2);
      assert.strictEqual(data.issue.history[1].action, 'note_added');
      assert.match(data.issue.history[1].note, /please call after 5 PM/);
    });

    test('Ordinary field update appends details_updated event and preserves all history', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${auditIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Updated Audit Log Integrity Test Title'
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.issue.title, 'Updated Audit Log Integrity Test Title');
      assert.strictEqual(data.issue.history.length, 3, 'History length must grow to 3, never overwrite');
      assert.strictEqual(data.issue.history[2].action, 'details_updated');
    });

    test('Rejects update body attempting to overwrite prohibited fields (_id, status, history)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${auditIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          history: [] // Attempt to wipe history
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /cannot be updated directly/i);
    });
  });

  describe('Phase 3 Corrections: Concurrency, OCC, and State Consistency', () => {
    test('Mongoose Optimistic Concurrency Control throws VersionError on stale document save', async () => {
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'OCC Verification Plumbing Leak',
          description: 'Testing optimistic concurrency control on MongoDB.',
          category: 'plumbing',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' }
        })
      });
      const data = await createRes.json();
      const issueId = data.issue._id;

      // Load two separate Mongoose document instances of the same issue
      const docA = await Issue.findById(issueId);
      const docB = await Issue.findById(issueId);

      assert.strictEqual(docA.__v, 0);
      assert.strictEqual(docB.__v, 0);

      // Doc A saves first -> increments __v to 1
      docA.status = 'under_review';
      docA.history.push({
        action: 'status_change',
        fromStatus: 'submitted',
        toStatus: 'under_review',
        changedBy: docA.submittingResident,
        note: 'First transition'
      });
      await docA.save();

      const afterDocA = await Issue.findById(issueId);
      assert.strictEqual(afterDocA.__v, 1);
      assert.strictEqual(afterDocA.status, 'under_review');

      // Doc B holds stale __v = 0. Attempting to save MUST throw VersionError
      docB.status = 'cancelled';
      docB.history.push({
        action: 'status_change',
        fromStatus: 'submitted',
        toStatus: 'cancelled',
        changedBy: docB.submittingResident,
        note: 'Stale transition attempt'
      });

      await assert.rejects(async () => {
        await docB.save();
      }, (err) => {
        assert.strictEqual(err.name, 'VersionError');
        return true;
      });

      // Confirm DB was NOT overwritten by docB
      const finalDoc = await Issue.findById(issueId);
      assert.strictEqual(finalDoc.status, 'under_review');
      assert.strictEqual(finalDoc.__v, 1);
    });

    test('HTTP Status Transition handles concurrent requests safely and consistently', async () => {
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Conflict HTTP Response Issue Test',
          description: 'Testing HTTP conflict handling for concurrent requests.',
          category: 'electrical',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' }
        })
      });
      const data = await createRes.json();
      const issueId = data.issue._id;

      // Two concurrent HTTP requests attempting conflicting status transitions
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: adminACookie,
            'X-CSRF-Token': extractRawCsrf(adminACookie)
          },
          body: JSON.stringify({ toStatus: 'under_review', note: 'Admin review' })
        }),
        fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: resident1Cookie,
            'X-CSRF-Token': extractRawCsrf(resident1Cookie)
          },
          body: JSON.stringify({ toStatus: 'cancelled', cancellationReason: 'Resident cancelled' })
        })
      ]);

      const statuses = [res1.status, res2.status];
      // One request must succeed (200). The other either receives 409 (OCC conflict) or 400 (invalid state jump from newly committed status).
      assert.ok(statuses.includes(200), 'At least one concurrent request must succeed');
      assert.ok(statuses.includes(409) || statuses.includes(400), 'Conflicting request must be rejected with 409 or 400');

      // Verify DB record is in a single valid state
      const dbRecord = await Issue.findById(issueId);
      assert.ok(['under_review', 'cancelled'].includes(dbRecord.status));
    });

    test('Successful update persists expected values and audit events in MongoDB', async () => {
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Persisted MongoDB Verification Issue',
          description: 'Testing direct MongoDB verification of updates.',
          category: 'structural',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' }
        })
      });
      const data = await createRes.json();
      const issueId = data.issue._id;

      const updateRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Updated Persisted MongoDB Title',
          description: 'Updated description for database verification.'
        })
      });

      assert.strictEqual(updateRes.status, 200);

      // Verify directly against MongoDB
      const persisted = await Issue.findById(issueId);
      assert.strictEqual(persisted.title, 'Updated Persisted MongoDB Title');
      assert.strictEqual(persisted.description, 'Updated description for database verification.');
      assert.strictEqual(persisted.history.length, 2);
      assert.strictEqual(persisted.history[1].action, 'details_updated');
    });
  });

  describe('Phase 3 Corrections: Location Updates and Field Allowlists', () => {
    let testIssueId;

    before(async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Location and Field Allowlist Test Issue',
          description: 'Testing location update validation and field allowlists.',
          category: 'carpentry',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' }
        })
      });
      const data = await res.json();
      testIssueId = data.issue._id;
    });

    test('Rejects attempt to change location.type on existing issue (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          location: {
            type: 'common_area',
            areaDescription: 'Trying to convert unit to common area'
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /cannot change location type/i);

      // Verify DB remains unchanged
      const dbIssue = await Issue.findById(testIssueId);
      assert.strictEqual(dbIssue.location.type, 'unit');
      assert.strictEqual(dbIssue.location.flatOrUnit, '101');
    });

    test('Rejects invalid unit location update missing flatOrUnit (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          location: {
            blockOrWing: 'Wing A'
            // flatOrUnit missing
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /flat\/unit number are required/i);

      const dbIssue = await Issue.findById(testIssueId);
      assert.strictEqual(dbIssue.location.flatOrUnit, '101');
    });

    test('Resident attempt to update admin-only field priority is rejected (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          priority: 'urgent'
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid or unauthorized field/i);

      // Verify DB priority was not updated
      const dbIssue = await Issue.findById(testIssueId);
      assert.strictEqual(dbIssue.priority, 'normal');
    });

    test('Resident attempt to update externalProviderDetails is rejected (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          externalProviderDetails: {
            companyOrName: 'Unauthorized Contractor'
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid or unauthorized field/i);

      const dbIssue = await Issue.findById(testIssueId);
      assert.strictEqual(dbIssue.externalProviderDetails.companyOrName, '');
    });

    test('Rejects unknown/unsupported update fields (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          arbitraryProperty: 'injectedValue'
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid or unauthorized field/i);

      // Verify DB history was NOT appended with details_updated
      const dbIssue = await Issue.findById(testIssueId);
      assert.strictEqual(dbIssue.history.length, 1);
    });

    test('Valid location update succeeds and persists in MongoDB (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${testIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          location: {
            blockOrWing: 'Wing B',
            flatOrUnit: '102'
          }
        })
      });

      assert.strictEqual(res.status, 200);
      const dbIssue = await Issue.findById(testIssueId);
      assert.strictEqual(dbIssue.location.blockOrWing, 'Wing B');
      assert.strictEqual(dbIssue.location.flatOrUnit, '102');
    });
  });

  describe('Phase 3 Corrections: Privacy, Internal Notes, and Edge Cases', () => {
    let internalNoteIssueId;

    before(async () => {
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Internal Note Privacy Test Issue',
          description: 'Testing that admin internal notes are never sent to residents.',
          category: 'housekeeping',
          location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' }
        })
      });
      const data = await createRes.json();
      internalNoteIssueId = data.issue._id;

      // Admin adds internal note
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${internalNoteIssueId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          note: 'Confidential committee note regarding this resident',
          isInternal: true
        })
      });
    });

    test('Internal notes created by admins are excluded from resident-facing history', async () => {
      // 1. Admin views issue -> internal note is present
      const adminRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${internalNoteIssueId}`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(adminRes.status, 200);
      const adminData = await adminRes.json();
      const adminNotes = adminData.issue.history.filter((h) => h.isInternal);
      assert.strictEqual(adminNotes.length, 1, 'Admin must see internal note');

      // 2. Submitting resident views issue -> internal note is completely absent
      const residentRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${internalNoteIssueId}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(residentRes.status, 200);
      const residentData = await residentRes.json();
      const residentNotes = residentData.issue.history.filter((h) => h.isInternal || h.note.includes('Confidential'));
      assert.strictEqual(residentNotes.length, 0, 'Resident must NOT see internal note');
    });

    test('Submitter contact details remain visible to submitter resident but hidden from others', async () => {
      // Create common-area issue submitted by Resident 2
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident2Cookie,
          'X-CSRF-Token': extractRawCsrf(resident2Cookie)
        },
        body: JSON.stringify({
          title: 'Lobby Fountain Broken',
          description: 'Water pump in main lobby fountain has stopped working.',
          category: 'common_area',
          location: { type: 'common_area', areaDescription: 'Main Entrance Lobby' }
        })
      });
      const createData = await createRes.json();
      const fountainIssueId = createData.issue._id;

      // Submitter (Resident 2) views -> email and phone ARE visible
      const submitterRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${fountainIssueId}`, {
        headers: { Cookie: resident2Cookie }
      });
      const submitterData = await submitterRes.json();
      assert.ok(submitterData.issue.submittingResident.email, 'Submitter sees own email');

      // Non-submitter (Resident 1) views -> email and phone are strictly redacted
      const viewerRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${fountainIssueId}`, {
        headers: { Cookie: resident1Cookie }
      });
      const viewerData = await viewerRes.json();
      assert.strictEqual(viewerData.issue.submittingResident.email, undefined, 'Other resident cannot see submitter email');
      assert.strictEqual(viewerData.issue.submittingResident.phone, undefined, 'Other resident cannot see submitter phone');
    });

    test('Safely handles missing or deleted submitter account without throwing 500', async () => {
      // Create an issue in MongoDB directly with a deleted user ObjectId
      const orphanUserId = new mongoose.Types.ObjectId();
      const orphanIssue = new Issue({
        society: new mongoose.Types.ObjectId(societyAId),
        submittingResident: orphanUserId,
        title: 'Issue With Deleted User Account',
        description: 'Submitter account was deleted or purged from the database.',
        category: 'structural',
        location: { type: 'unit', blockOrWing: 'Wing C', flatOrUnit: '301' },
        status: 'submitted',
        history: [{
          action: 'created',
          toStatus: 'submitted',
          changedBy: orphanUserId,
          note: 'Initial creation'
        }]
      });
      await orphanIssue.save();

      // Resident requests orphan unit issue -> returns 404 (does NOT crash with TypeError 500)
      const resRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${orphanIssue._id}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(resRes.status, 404);

      // Admin requests orphan issue -> returns 200 safely
      const adminRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${orphanIssue._id}`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(adminRes.status, 200);
      const adminData = await adminRes.json();
      assert.strictEqual(adminData.issue.title, 'Issue With Deleted User Account');
    });

    test('Multi-society member cannot access Society B issue through Society A URL (404 Not Found)', async () => {
      // Create an issue strictly in Society B
      const issueB = new Issue({
        society: new mongoose.Types.ObjectId(societyBId),
        submittingResident: new mongoose.Types.ObjectId(resident1Id),
        title: 'Society B Strictly Isolated Issue',
        description: 'Belongs to Society B only.',
        category: 'security',
        location: { type: 'common_area', areaDescription: 'Society B Gate' },
        status: 'submitted',
        history: [{ action: 'created', toStatus: 'submitted', changedBy: new mongoose.Types.ObjectId(resident1Id) }]
      });
      await issueB.save();

      // Resident 1 tries to access Society B issue through Society A URL
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${issueB._id}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.match(data.message, /not found in this society/i);
    });
  });
});
