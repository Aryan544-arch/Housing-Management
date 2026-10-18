const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, connectDB, disconnectDB } = require('../server');
const User = require('../models/User');
const Society = require('../models/Society');
const SocietyMembership = require('../models/SocietyMembership');
const { Issue } = require('../models/Issue');
const { Provider } = require('../models/Provider');
const { Notification } = require('../models/Notification');
const mongoose = require('mongoose');

describe('Web UI Routes & EJS Rendering Tests', () => {
  let server;
  let baseUrl;
  const testDbUri = 'mongodb://127.0.0.1:27017/housing_management_web_test';

  let adminUser;
  let residentUser;
  let testSociety;
  let testIssue;
  let adminCookie;
  let residentCookie;

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
    await Provider.deleteMany({});
    await Notification.deleteMany({});

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 1. Create Admin User
    const adminRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin User',
        email: 'admin.web@society.local',
        password: 'Password123!',
        phone: '1234567890'
      })
    });
    const adminData = await adminRes.json();
    adminUser = adminData.user;
    adminCookie = extractCookie(adminRes);

    // 2. Create Society with Admin
    const socRes = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        name: 'Metropolis Tower',
        code: 'METRO-1',
        address: { street: '123 Skyline', city: 'Metro', state: 'State', postalCode: '10001' }
      })
    });
    const socData = await socRes.json();
    assert.ok(socData.society, 'Society creation must succeed');
    testSociety = socData.society;

    // 3. Create Resident User
    const resRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident Maya',
        email: 'maya.web@society.local',
        password: 'Password123!',
        phone: '9876543210'
      })
    });
    const resData = await resRes.json();
    residentUser = resData.user;
    residentCookie = extractCookie(resRes);

    // 4. Add Resident to Society
    const addMemberRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        email: 'maya.web@society.local',
        role: 'resident',
        flatNumber: 'B-402'
      })
    });
    const addMemberData = await addMemberRes.json();
    assert.strictEqual(addMemberRes.status, 201);

    // 5. Create a test issue
    const issueRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      },
      body: JSON.stringify({
        title: 'Corridor emergency lighting flickers intermittently',
        description: 'The overhead lighting fixtures in Tower B floor 4 corridor are flickering and require inspection.',
        category: 'electrical',
        location: { type: 'common_area', areaDescription: 'Tower B Floor 4' },
        priority: 'high'
      })
    });
    const issueData = await issueRes.json();
    assert.strictEqual(issueRes.status, 201);
    testIssue = issueData.issue;
  });

  after(async () => {
    await User.deleteMany({});
    await Society.deleteMany({});
    await SocietyMembership.deleteMany({});
    await Issue.deleteMany({});
    await Provider.deleteMany({});
    await disconnectDB();

    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('GET / unauthenticated redirects to /login', async () => {
    const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/login');
  });

  test('GET /login returns 200 HTML with CSRF meta and login form', async () => {
    const res = await fetch(`${baseUrl}/login`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<meta name="csrf-token" content="'));
    assert.ok(html.includes('id="login-form"'));
    assert.ok(html.includes('id="login-email"'));
    assert.ok(html.includes('Access Society Portal'));
  });

  test('GET /register returns 200 HTML with registration form', async () => {
    const res = await fetch(`${baseUrl}/register`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('id="register-form"'));
    assert.ok(html.includes('Create Account'));
    assert.ok(html.includes('id="reg-name"'));
  });

  test('GET /verify-email returns 200 HTML with status report', async () => {
    const res = await fetch(`${baseUrl}/verify-email`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Email Verification'));
    assert.ok(html.includes('IDENTITY VERIFICATION STATUS'));
  });

  test('GET /dashboard unauthenticated redirects to /login', async () => {
    const res = await fetch(`${baseUrl}/dashboard`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.get('location').includes('/login'));
  });

  test('GET /dashboard authenticated with 1 society redirects to /societies/:id/dashboard', async () => {
    const res = await fetch(`${baseUrl}/dashboard`, {
      headers: { Cookie: residentCookie },
      redirect: 'manual'
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), `/societies/${testSociety._id}/dashboard`);
  });

  test('GET /societies/:id/dashboard for resident renders resident dashboard with issue cards', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/dashboard`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('RESIDENT OPERATIONS CONSOLE'));
    assert.ok(html.includes('Metropolis Tower'));
    assert.ok(html.includes('Corridor emergency lighting flickers intermittently'));
    assert.ok(html.includes('Assigned Unit: <strong>B-402</strong>'));
  });

  test('GET /societies/:id/dashboard for admin renders admin queue', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/dashboard`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('SOCIETY OPERATIONS HEADQUARTERS'));
    assert.ok(html.includes('OPERATIONS QUEUE'));
    assert.ok(html.includes('Contractors &amp; Providers') || html.includes('Contractors & Providers'));
  });

  test('GET /societies/:id/issues/new renders issue creation form', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/new`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('id="create-issue-form"'));
    assert.ok(html.includes('Report Building or Unit Issue'));
    assert.ok(html.includes('id="evidence-dropzone"'));
  });

  test('GET /societies/:id/issues/:issueId renders issue details and timeline', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${testIssue._id}`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Corridor emergency lighting flickers intermittently'));
    assert.ok(html.includes('AUDIT TRAIL &amp; PROGRESS TIMELINE') || html.includes('AUDIT TRAIL & PROGRESS TIMELINE'));
    assert.ok(html.includes('AI Triage Advisory Assistant'));
    assert.ok(html.includes('id="add-note-form"'));
  });

  test('GET /societies/:id/admin/providers for admin renders provider directory', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/admin/providers`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('CONTRACTOR ROSTER'));
    assert.ok(html.includes('id="provider-modal"'));
  });

  test('GET /societies/:id/admin/providers for resident redirects away', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/admin/providers`, {
      headers: { Cookie: residentCookie },
      redirect: 'manual'
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), `/societies/${testSociety._id}/dashboard`);
  });

  test('GET /societies/:id/notifications renders notifications center', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/notifications`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Notifications Center'));
    assert.ok(html.includes('id="notifications-list"'));
  });

  // --- Phase 2.2: Authentication & Society Navigation Tests ---

  test('Open redirect prevention: Authenticated user visiting /login?redirect=//evil.com safely defaults to /dashboard', async () => {
    const res = await fetch(`${baseUrl}/login?redirect=//evil.com`, {
      headers: { Cookie: residentCookie },
      redirect: 'manual'
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/dashboard');
  });

  test('Open redirect prevention: Authenticated user visiting /login?redirect=https://evil.com safely defaults to /dashboard', async () => {
    const res = await fetch(`${baseUrl}/login?redirect=https://evil.com`, {
      headers: { Cookie: residentCookie },
      redirect: 'manual'
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/dashboard');
  });

  test('Redirect loop prevention: Authenticated user visiting /login?redirect=/login safely defaults to /dashboard', async () => {
    const res = await fetch(`${baseUrl}/login?redirect=/login`, {
      headers: { Cookie: residentCookie },
      redirect: 'manual'
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/dashboard');
  });

  test('Unauthenticated user visiting /login with malicious redirect renders form with sanitized data-redirect', async () => {
    const res = await fetch(`${baseUrl}/login?redirect=//evil.com`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(!html.includes('data-redirect="//evil.com"'));
  });

  test('GET /verify-email explicitly documents that email verification is not a backend capability', async () => {
    const res = await fetch(`${baseUrl}/verify-email`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Email verification is not currently implemented as a backend capability'));
    assert.ok(html.includes('isActive: true'));
  });

  test('GET /dashboard for user with ZERO memberships renders accessible no-affiliations advisory and society creation form', async () => {
    // Create standalone user with 0 memberships
    const userRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Unassigned Resident',
        email: 'unassigned@society.local',
        password: 'Password123!',
        phone: '1112223333'
      })
    });
    const userCookie = extractCookie(userRes);

    const res = await fetch(`${baseUrl}/dashboard`, {
      headers: { Cookie: userCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('No Society Memberships Found'));
    assert.ok(html.includes('NO REGISTERED AFFILIATIONS'));
    assert.ok(html.includes('your registered email address'));
    assert.ok(!html.includes('unassigned@society.local'), 'Must not expose raw email address in action notice');
    assert.ok(html.includes('id="create-society-form"'), 'Must render society creation form');
    assert.ok(html.includes('id="society-name"'), 'Must include society name input');
    assert.ok(html.includes('id="society-code"'), 'Must include society code input');
    assert.ok(html.includes('/js/society.js'), 'Must include society client script');
  });

  test('User with zero memberships creates their first society and transitions to admin dashboard', async () => {
    // 1. Register fresh user with 0 memberships
    const userRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'First Admin User',
        email: 'firstadmin@society.local',
        password: 'Password123!',
        phone: '9998887777'
      })
    });
    const userCookie = extractCookie(userRes);

    // 2. User creates first society via POST /api/societies
    const createRes = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userCookie,
        'X-CSRF-Token': extractRawCsrf(userCookie)
      },
      body: JSON.stringify({
        name: 'Solaris Residences',
        code: 'SOL-01',
        address: { street: '100 Sunset Boulevard' }
      })
    });
    assert.strictEqual(createRes.status, 201);
    const createData = await createRes.json();
    assert.strictEqual(createData.success, true);
    assert.strictEqual(createData.society.name, 'Solaris Residences');
    assert.strictEqual(createData.society.code, 'SOL-01');
    assert.strictEqual(createData.membership.role, 'admin', 'Creator must be assigned admin role');

    // 3. GET /dashboard now automatically routes to the new society dashboard
    const dashRes = await fetch(`${baseUrl}/dashboard`, {
      headers: { Cookie: userCookie },
      redirect: 'manual'
    });
    assert.strictEqual(dashRes.status, 302);
    assert.strictEqual(dashRes.headers.get('location'), `/societies/${createData.society._id}/dashboard`);

    // 4. Accessing the society dashboard renders the Admin Operations Queue
    const adminDashRes = await fetch(`${baseUrl}/societies/${createData.society._id}/dashboard`, {
      headers: { Cookie: userCookie }
    });
    assert.strictEqual(adminDashRes.status, 200);
    const adminHtml = await adminDashRes.text();
    assert.ok(adminHtml.includes('SOCIETY OPERATIONS HEADQUARTERS'));
    assert.ok(adminHtml.includes('OPERATIONS QUEUE'));
    assert.ok(adminHtml.includes('Solaris Residences'));
  });

  test('GET /dashboard for user with MULTIPLE active societies renders society selection console', async () => {
    // Create a second society
    const soc2Res = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        name: 'Horizon Heights',
        code: 'HORIZON-2',
        address: { street: '456 Ocean Drive', city: 'Metro', state: 'State', postalCode: '10002' }
      })
    });
    const soc2Data = await soc2Res.json();
    assert.ok(soc2Data.society);

    // Add resident to second society as well
    await fetch(`${baseUrl}/api/societies/${soc2Data.society._id}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        email: 'maya.web@society.local',
        role: 'resident',
        flatNumber: 'A-101'
      })
    });

    const res = await fetch(`${baseUrl}/dashboard`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Select Housing Society'));
    assert.ok(html.includes('Metropolis Tower'));
    assert.ok(html.includes('Horizon Heights'));
  });

  test('GET /select-society directly renders selection console for multi-society user', async () => {
    const res = await fetch(`${baseUrl}/select-society`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Select Housing Society'));
    assert.ok(html.includes('Metropolis Tower'));
    assert.ok(html.includes('Horizon Heights'));
  });

  // --- Phase 2.3: Resident Dashboard & Issue Reporting Verification Tests ---

  test('Phase 2.3: Resident Dashboard renders complete filters, category dropdown, sync button, and metrics', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/dashboard`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();

    // Filters and controls
    assert.ok(html.includes('id="filter-status"'), 'Must have status filter');
    assert.ok(html.includes('id="filter-priority"'), 'Must have priority filter');
    assert.ok(html.includes('id="filter-category"'), 'Must have category filter');
    assert.ok(html.includes('id="search-issues"'), 'Must have search input');
    assert.ok(html.includes('id="refresh-manifest-btn"'), 'Must have sync API button');
    assert.ok(html.includes('id="no-matching-issues-row"'), 'Must have empty filtered state row');
    assert.ok(html.includes('id="manifest-loading-indicator"'), 'Must have manifest loading indicator');

    // Metrics cards
    assert.ok(html.includes('id="metric-my-active"'));
    assert.ok(html.includes('id="metric-under-review"'));
    assert.ok(html.includes('id="metric-in-progress"'));
    assert.ok(html.includes('id="metric-closed"'));

    // Category options
    assert.ok(html.includes('value="plumbing"'));
    assert.ok(html.includes('value="electrical"'));
    assert.ok(html.includes('value="carpentry"'));
  });

  test('Phase 2.3: Issue Reporting form renders all 9 categories, location toggles, counters, and CSRF token', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/new`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();

    // Form elements
    assert.ok(html.includes('id="create-issue-form"'));
    assert.ok(html.includes('id="loc-type-unit"'));
    assert.ok(html.includes('id="loc-type-common"'));
    assert.ok(html.includes('id="blockOrWing"'));
    assert.ok(html.includes('id="flatOrUnit"'));
    assert.ok(html.includes('id="areaDescription"'));
    assert.ok(html.includes('id="issue-title"'));
    assert.ok(html.includes('id="issue-desc"'));
    assert.ok(html.includes('id="title-counter"'));
    assert.ok(html.includes('id="desc-counter"'));
    assert.ok(html.includes('id="evidence-dropzone"'));
    assert.ok(html.includes('id="evidence-file-input"'));

    // Pre-filled flat number from user membership
    assert.ok(html.includes('B-402'));

    // All 9 categories
    const categories = ['plumbing', 'electrical', 'carpentry', 'security', 'housekeeping', 'elevator', 'common_area', 'structural', 'other'];
    for (const cat of categories) {
      assert.ok(html.includes(`value="${cat}"`), `Form must contain category: ${cat}`);
    }
  });

  test('Phase 2.3: Resident successfully creates a new residential unit issue via API with CSRF token', async () => {
    const res = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      },
      body: JSON.stringify({
        title: 'Balcony drainage pipe obstructed by debris',
        description: 'Rainwater is accumulating on unit B-402 balcony due to a blocked outer drain outlet.',
        category: 'plumbing',
        location: {
          type: 'unit',
          blockOrWing: 'B',
          flatOrUnit: 'B-402'
        },
        priority: 'high'
      })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.issue.title, 'Balcony drainage pipe obstructed by debris');
    assert.strictEqual(data.issue.status, 'submitted');
    assert.strictEqual(data.issue.priority, 'high');
    assert.strictEqual(data.issue.location.type, 'unit');
  });

  test('Phase 2.3: Resident issue creation rejects invalid inputs violating backend schema', async () => {
    // 1. Missing flatOrUnit for unit issue
    const res1 = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      },
      body: JSON.stringify({
        title: 'Invalid unit issue missing flat number',
        description: 'Detailed description exceeding ten characters minimum length.',
        category: 'plumbing',
        location: {
          type: 'unit',
          blockOrWing: 'B'
        }
      })
    });
    assert.strictEqual(res1.status, 400);

    // 2. Title too short (< 5 chars)
    const res2 = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      },
      body: JSON.stringify({
        title: 'Bad',
        description: 'Detailed description exceeding ten characters minimum length.',
        category: 'plumbing',
        location: {
          type: 'common_area',
          areaDescription: 'Front garden'
        }
      })
    });
    assert.strictEqual(res2.status, 400);
  });

  // --- Phase 2.4: Issue Details, Workflow, Evidence & AI Advisory Tests ---

  test('Phase 2.4: Issue Details page renders real data with reference ID, timestamps, and categories', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${testIssue._id}`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    // Reference ID
    assert.ok(html.includes(`Ref: ${testIssue._id}`));
    // Title & description
    assert.ok(html.includes('Corridor emergency lighting flickers intermittently'));
    assert.ok(html.includes('overhead lighting fixtures in Tower B floor 4'));
    // Category & Priority
    assert.ok(html.includes('electrical'));
    assert.ok(html.includes('high'));
    // Timestamps
    assert.ok(html.includes('Logged:'));
    assert.ok(html.includes('Updated:'));
  });

  test('Phase 2.4: Issue Details renders 404 error page for non-existent issue ID', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${fakeId}`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 404);
    const html = await res.text();
    assert.ok(html.includes('Issue Manifest Not Located'));
    assert.ok(html.includes(`Return to ${testSociety.name} Dashboard`));
    assert.ok(html.includes(`/societies/${testSociety._id}/dashboard`));
  });

  test('Phase 2.4: Issue Details renders 403 error page when resident accesses another resident\'s private unit issue', async () => {
    // 1. Create a 2nd resident in testSociety
    const otherRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident Bob',
        email: 'bob.web@society.local',
        password: 'Password123!',
        phone: '5556667777'
      })
    });
    const otherCookie = extractCookie(otherRes);
    await fetch(`${baseUrl}/api/societies/${testSociety._id}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        email: 'bob.web@society.local',
        role: 'resident',
        flatNumber: 'B-101'
      })
    });

    // 2. Maya creates a private unit issue
    const unitIssueRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      },
      body: JSON.stringify({
        title: 'Master bedroom ceiling leak',
        description: 'Water seepage observed on bedroom ceiling during rainfall.',
        category: 'structural',
        location: {
          type: 'unit',
          blockOrWing: 'B',
          flatOrUnit: 'B-402'
        },
        priority: 'high'
      })
    });
    const unitIssueData = await unitIssueRes.json();
    assert.strictEqual(unitIssueRes.status, 201);
    const mayaUnitIssueId = unitIssueData.issue._id;

    // 3. Bob tries to access Maya's private unit issue
    const forbiddenRes = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${mayaUnitIssueId}`, {
      headers: { Cookie: otherCookie }
    });
    assert.strictEqual(forbiddenRes.status, 403);
    const forbiddenHtml = await forbiddenRes.text();
    assert.ok(forbiddenHtml.includes('Private Unit Issue Restricted'));
    assert.ok(forbiddenHtml.includes('residential unit issues are restricted exclusively to the submitting resident and society management'));

    // 4. Admin CAN access Maya's private unit issue and view submitter contact details
    const adminViewRes = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${mayaUnitIssueId}`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(adminViewRes.status, 200);
    const adminHtml = await adminViewRes.text();
    assert.ok(adminHtml.includes('Master bedroom ceiling leak'));
    assert.ok(adminHtml.includes('Resident Maya'));
    assert.ok(adminHtml.includes('maya.web@society.local'));
  });

  test('Phase 2.4: Admin workflow transitions issue through state machine and resident submitter responds', async () => {
    // 1. Admin transitions testIssue from submitted to under_review
    const step1Res = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        toStatus: 'under_review',
        note: 'Initial triage completed by facility manager'
      })
    });
    assert.strictEqual(step1Res.status, 200);

    // 2. Admin transitions from under_review to awaiting_information
    const step2Res = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        toStatus: 'awaiting_information',
        note: 'Please confirm whether fixtures in the north stairwell are also affected.'
      })
    });
    assert.strictEqual(step2Res.status, 200);

    // 3. Submitter resident responds (providing requested info) returning issue to under_review
    const step3Res = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      },
      body: JSON.stringify({
        toStatus: 'under_review',
        note: 'North stairwell fixtures are functioning normally; only corridor B4 lights flicker.'
      })
    });
    assert.strictEqual(step3Res.status, 200);

    // Verify timeline on HTML view contains both entries
    const detailsRes = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${testIssue._id}`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(detailsRes.status, 200);
    const html = await detailsRes.text();
    assert.ok(html.includes('Please confirm whether fixtures in the north stairwell are also affected.'));
    assert.ok(html.includes('North stairwell fixtures are functioning normally; only corridor B4 lights flicker.'));
  });

  test('Phase 2.4: Evidence upload accepts valid file with CSRF token and records attachment', async () => {
    const formData = new FormData();
    const pdfBuffer = Buffer.from('%PDF-1.4 sample evidence document content for inspection');
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    formData.append('file', blob, 'stairwell_inspection.pdf');
    formData.append('caption', 'Stairwell electrical inspection report');

    const uploadRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}/evidence`, {
      method: 'POST',
      headers: {
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      },
      body: formData
    });
    assert.strictEqual(uploadRes.status, 201);
    const uploadData = await uploadRes.json();
    assert.strictEqual(uploadData.success, true);
    assert.strictEqual(uploadData.evidence.caption, 'Stairwell electrical inspection report');
    assert.strictEqual(uploadData.evidence.originalFilename, 'stairwell_inspection.pdf');

    // Verify evidence is visible on issue details page
    const viewRes = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${testIssue._id}`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(viewRes.status, 200);
    const viewHtml = await viewRes.text();
    assert.ok(viewHtml.includes('Stairwell electrical inspection report'));
    assert.ok(viewHtml.includes('stairwell_inspection.pdf'));
  });

  test('Phase 2.4: AI Advisory endpoint returns guidance or graceful service notice with disclaimer', async () => {
    const advisoryRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}/ai-advisory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      }
    });

    // The endpoint will either return 200 (if active model/mock configured) or 503 (if disabled)
    assert.ok([200, 503].includes(advisoryRes.status));
    const data = await advisoryRes.json();
    if (advisoryRes.status === 200) {
      assert.strictEqual(data.success, true);
      assert.ok(data.advisory.suggestedCategory);
      assert.ok(data.advisory.suggestedPriority);
      assert.ok(data.advisory.explanation);
      assert.ok(data.advisory.disclaimer);
    } else {
      assert.strictEqual(data.success, false);
      assert.ok(data.message.includes('AI advisory service is disabled') || data.message.includes('unavailable'));
    }
  });

  // --- Phase 2.5: Admin Operations Workflow Tests ---

  test('Phase 2.5: Admin Dashboard renders operational tabs, sort selector, interactive metrics, and sync button', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/dashboard`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();

    // Operations Queue & Metrics
    assert.ok(html.includes('OPERATIONS QUEUE &amp; TRIAGE') || html.includes('OPERATIONS QUEUE & TRIAGE'));
    assert.ok(html.includes('Needs Admin Review'));
    assert.ok(html.includes('Awaiting Verification'));
    assert.ok(html.includes('Active Repairs'));
    assert.ok(html.includes('Verified &amp; Closed') || html.includes('Verified & Closed'));

    // Operational Tabs
    assert.ok(html.includes('data-tab="all"'));
    assert.ok(html.includes('data-tab="needs-review"'));
    assert.ok(html.includes('data-tab="in-repair"'));
    assert.ok(html.includes('data-tab="awaiting-verification"'));
    assert.ok(html.includes('data-tab="closed"'));

    // Sorting & Sync
    assert.ok(html.includes('id="sort-issues"'));
    assert.ok(html.includes('Newest First'));
    assert.ok(html.includes('Highest Priority'));
    assert.ok(html.includes('id="refresh-manifest-btn"'));
    assert.ok(html.includes('id="clear-filters-btn"'));
    assert.ok(html.includes('id="no-matching-issues-row"'));
  });

  test('Phase 2.5: Issue Details renders Triage & Reclassify button and modal for admin', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${testIssue._id}`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();

    assert.ok(html.includes('id="open-triage-modal-btn"'));
    assert.ok(html.includes('Triage &amp; Edit Metadata') || html.includes('Triage & Edit Metadata'));
    assert.ok(html.includes('id="triage-modal"'));
    assert.ok(html.includes('id="triage-issue-form"'));
    assert.ok(html.includes('id="triage-priority"'));
    assert.ok(html.includes('id="triage-category"'));
  });

  test('Phase 2.5: Admin successfully updates priority and category via triage endpoint; resident is forbidden', async () => {
    // 1. Admin recalibrates priority to urgent and category to structural
    const adminTriageRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        priority: 'urgent',
        category: 'structural'
      })
    });
    assert.strictEqual(adminTriageRes.status, 200);
    const adminTriageData = await adminTriageRes.json();
    assert.strictEqual(adminTriageData.success, true);
    assert.strictEqual(adminTriageData.issue.priority, 'urgent');
    assert.strictEqual(adminTriageData.issue.category, 'structural');

    // 2. Resident attempts to modify priority (admin-only)
    const residentTriageRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      },
      body: JSON.stringify({
        priority: 'low'
      })
    });
    assert.strictEqual(residentTriageRes.status, 400); // priority is in invalidFields for resident allowlist
  });

  test('Phase 2.5: Cross-society isolation prevents admin from modifying issue belonging to another society', async () => {
    // 1. Create a 2nd society with a separate admin
    const soc2Res = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        name: 'Society Beta Isolated',
        code: 'BETA-ISO',
        address: { street: '456 Beta Way', city: 'Beta City', state: 'State', postalCode: '20002' }
      })
    });
    const soc2Data = await soc2Res.json();
    assert.strictEqual(soc2Res.status, 201);
    const society2 = soc2Data.society;

    // 2. Admin of society2 tries to triage or update status of testIssue (which belongs to testSociety)
    const crossRes = await fetch(`${baseUrl}/api/societies/${society2._id}/issues/${testIssue._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        priority: 'low'
      })
    });
    assert.strictEqual(crossRes.status, 404);
    const crossData = await crossRes.json();
    assert.strictEqual(crossData.success, false);
    assert.ok(crossData.message.includes('not found in this society'));
  });

  // --- Phase 2.6: Provider Management & Contractor Directory Tests ---

  test('Phase 2.6: Admin Provider Directory renders contractor roster, metrics, filters, and modal', async () => {
    // 1. Fetch provider directory as admin
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/admin/providers`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();

    // Verify key UI elements & Architectural Editorial Design System identifiers
    assert.ok(html.includes('CONTRACTOR ROSTER'));
    assert.ok(html.includes('Service Providers &amp; Maintenance Contractors') || html.includes('Service Providers & Maintenance Contractors'));
    assert.ok(html.includes('id="refresh-providers-btn"'));
    assert.ok(html.includes('id="open-add-provider-btn"'));
    assert.ok(html.includes('id="metric-prov-total"'));
    assert.ok(html.includes('id="metric-prov-active"'));
    assert.ok(html.includes('id="metric-prov-inactive"'));
    assert.ok(html.includes('id="prov-filter-category"'));
    assert.ok(html.includes('id="prov-filter-status"'));
    assert.ok(html.includes('id="prov-sort"'));
    assert.ok(html.includes('id="prov-search"'));
    assert.ok(html.includes('id="clear-prov-filters-btn"'));
    assert.ok(html.includes('id="provider-modal"'));
    assert.ok(html.includes('id="provider-form"'));
    assert.ok(html.includes('id="prov-name-input"'));
    assert.ok(html.includes('id="prov-phone-input"'));
    assert.ok(html.includes('id="prov-rate-type"'));
    assert.ok(html.includes('id="prov-all-blocks"'));
  });

  test('Phase 2.6: Resident is strictly forbidden from accessing provider management directory', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/admin/providers`, {
      headers: { Cookie: residentCookie },
      redirect: 'manual'
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), `/societies/${testSociety._id}/dashboard`);
  });

  let createdProviderId;

  test('Phase 2.6: Admin registers new provider with valid schema & CSRF token, and provider appears in directory query', async () => {
    // 1. Post new provider via API with CSRF token
    const createRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/providers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        name: 'Apex Electrical Solutions Ltd',
        categories: ['electrical'],
        contactPhone: '+91 98765 43210',
        contactEmail: 'dispatch@apexelectrical.com',
        contactPerson: 'Rajesh Sharma (Supervisor)',
        description: 'Certified electrical contractors for LT panels and building wiring.',
        serviceArea: { allBlocks: true, blocks: [] },
        pricing: {
          rateType: 'hourly',
          minRate: 450,
          maxRate: 900,
          estimate: '₹450/hr standard service fee'
        },
        priceEstimate: '₹450/hr standard service fee',
        status: 'active'
      })
    });

    assert.strictEqual(createRes.status, 201);
    const createData = await createRes.json();
    assert.strictEqual(createData.success, true);
    assert.ok(createData.provider);
    assert.strictEqual(createData.provider.name, 'Apex Electrical Solutions Ltd');
    assert.strictEqual(createData.provider.status, 'active');
    createdProviderId = createData.provider._id;

    // 2. Fetch directory view to verify rendering of new provider
    const pageRes = await fetch(`${baseUrl}/societies/${testSociety._id}/admin/providers`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(pageRes.status, 200);
    const html = await pageRes.text();
    assert.ok(html.includes('Apex Electrical Solutions Ltd'));
    assert.ok(html.includes('+91 98765 43210'));
    assert.ok(html.includes('dispatch@apexelectrical.com'));
    assert.ok(html.includes('Rajesh Sharma'));
    assert.ok(html.includes('hourly'));
  });

  test('Phase 2.6: Admin updates existing provider details (rate structure, description, service area)', async () => {
    const updateRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/providers/${createdProviderId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        description: 'Updated: 24/7 emergency response certified team.',
        pricing: {
          rateType: 'hourly',
          minRate: 500,
          maxRate: 1000,
          estimate: '₹500/hr emergency rate'
        },
        priceEstimate: '₹500/hr emergency rate',
        serviceArea: {
          allBlocks: false,
          blocks: ['Tower B', 'Tower C']
        }
      })
    });

    assert.strictEqual(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.strictEqual(updateData.success, true);
    assert.strictEqual(updateData.provider.description, 'Updated: 24/7 emergency response certified team.');
    assert.strictEqual(updateData.provider.pricing.minRate, 500);
    assert.strictEqual(updateData.provider.pricing.maxRate, 1000);
    assert.strictEqual(updateData.provider.serviceArea.allBlocks, false);
    assert.deepStrictEqual(updateData.provider.serviceArea.blocks, ['Tower B', 'Tower C']);
  });

  test('Phase 2.6: Admin deactivates and activates contractor via status endpoints', async () => {
    // 1. Deactivate provider via DELETE endpoint (which sets status: inactive)
    const deactRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/providers/${createdProviderId}`, {
      method: 'DELETE',
      headers: {
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      }
    });
    assert.strictEqual(deactRes.status, 200);
    const deactData = await deactRes.json();
    assert.strictEqual(deactData.success, true);
    assert.strictEqual(deactData.provider.status, 'inactive');

    // 2. Re-activate provider via PATCH endpoint
    const reactRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/providers/${createdProviderId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        status: 'active'
      })
    });
    assert.strictEqual(reactRes.status, 200);
    const reactData = await reactRes.json();
    assert.strictEqual(reactData.success, true);
    assert.strictEqual(reactData.provider.status, 'active');
  });

  test('Phase 2.6: Provider suggestions endpoint returns criteria-matched active providers for issue', async () => {
    // Note: Phase 2.5 triage test updated testIssue.category to 'structural'.
    // Ensure createdProvider covers 'structural' category and allBlocks so it matches testIssue
    await fetch(`${baseUrl}/api/societies/${testSociety._id}/providers/${createdProviderId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        categories: ['electrical', 'structural'],
        serviceArea: { allBlocks: true, blocks: [] }
      })
    });

    const suggRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}/provider-suggestions`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(suggRes.status, 200);
    const suggData = await suggRes.json();
    assert.strictEqual(suggData.success, true);
    assert.ok(suggData.suggestions.length >= 1);
    const matched = suggData.suggestions.find((s) => s.provider._id === createdProviderId.toString());
    assert.ok(matched);
    assert.strictEqual(matched.provider.name, 'Apex Electrical Solutions Ltd');
    assert.strictEqual(matched.recommendationLevel, 'criteria_match');
    assert.ok(matched.disclaimer);
  });

  test('Phase 2.6: Admin assigns contractor to issue ticket and issue details page displays contractor for admin', async () => {
    // 1. Admin assigns contractor via PATCH issue
    const assignRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        externalProviderDetails: {
          companyOrName: 'Apex Electrical Solutions Ltd',
          contactPhone: '+91 98765 43210',
          trade: 'electrical'
        }
      })
    });
    assert.strictEqual(assignRes.status, 200);
    const assignData = await assignRes.json();
    assert.strictEqual(assignData.success, true);
    assert.ok(assignData.issue.externalProviderDetails);
    assert.strictEqual(assignData.issue.externalProviderDetails.companyOrName, 'Apex Electrical Solutions Ltd');

    // 2. Admin views issue details HTML page
    const pageRes = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${testIssue._id}`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(pageRes.status, 200);
    const html = await pageRes.text();
    assert.ok(html.includes('ASSIGNED CONTRACTOR:'));
    assert.ok(html.includes('Apex Electrical Solutions Ltd'));
    assert.ok(html.includes('+91 98765 43210'));
    assert.ok(html.includes('id="unassign-contractor-btn"'));
  });

  test('Phase 2.6: Resident viewing issue details has assigned contractor strictly redacted (privacy guarantee)', async () => {
    // 1. API endpoint check: resident gets no externalProviderDetails
    const apiRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(apiRes.status, 200);
    const apiData = await apiRes.json();
    assert.strictEqual(apiData.issue.externalProviderDetails, undefined, 'Resident API must redact provider details');

    // 2. HTML view check: resident does not see contractor details or unassign button
    const pageRes = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${testIssue._id}`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(pageRes.status, 200);
    const html = await pageRes.text();
    assert.ok(!html.includes('Apex Electrical Solutions Ltd'));
    assert.ok(!html.includes('id="unassign-contractor-btn"'));
    assert.ok(!html.includes('id="open-providers-modal-btn"'));
  });

  test('Phase 2.6: Admin unassigns contractor from issue ticket', async () => {
    // Admin clears contractor assignment
    const unassignRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/issues/${testIssue._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      },
      body: JSON.stringify({
        externalProviderDetails: {
          companyOrName: '',
          contactPhone: '',
          trade: ''
        }
      })
    });
    assert.strictEqual(unassignRes.status, 200);
    const unassignData = await unassignRes.json();
    assert.strictEqual(unassignData.success, true);
    assert.strictEqual(unassignData.issue.externalProviderDetails.companyOrName, '');

    // Issue details page shows unassigned status for admin
    const pageRes = await fetch(`${baseUrl}/societies/${testSociety._id}/issues/${testIssue._id}`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(pageRes.status, 200);
    const html = await pageRes.text();
    assert.ok(html.includes('No contractor assigned yet'));
  });

  /* ==========================================================================
     PHASE 2.7: NOTIFICATION INTEGRATION, ACCESSIBILITY & CROSS-ROLE TESTS
     ========================================================================== */
  let residentNotification1;
  let residentNotification2;
  let otherSociety;
  let otherUser;
  let otherUserCookie;

  test('Phase 2.7: Setup test notifications, secondary society, and secondary user', async () => {
    // Create secondary user
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Secondary Resident',
        email: 'secondary.resident@test.domain',
        password: 'Password123!',
        phone: '+919123456789'
      })
    });
    assert.strictEqual(regRes.status, 201);
    otherUserCookie = extractCookie(regRes);
    const regData = await regRes.json();
    otherUser = regData.user;

    // Clean up notifications before Phase 2.7 tests for precise assertion baselines
    await Notification.deleteMany({});

    // Create secondary society
    otherSociety = await Society.create({
      name: 'Secondary Society Estates',
      code: 'SSE-002',
      address: {
        street: '99 Boulevard',
        city: 'Metropolis',
        state: 'State',
        postalCode: '400099'
      },
      createdBy: otherUser._id
    });

    // Make secondary user a resident of otherSociety only
    await SocietyMembership.create({
      user: otherUser._id,
      society: otherSociety._id,
      role: 'resident',
      flatNumber: 'B-202',
      status: 'active'
    });

    // Create 2 notifications for residentUser in testSociety
    residentNotification1 = await Notification.create({
      recipient: residentUser._id,
      society: testSociety._id,
      type: 'repair_scheduled',
      title: 'Issue Status Updated to Scheduled',
      message: 'Repair work has been scheduled for your report.',
      issue: testIssue._id,
      idempotencyKey: `notif-test-${Date.now()}-1`,
      read: false
    });

    residentNotification2 = await Notification.create({
      recipient: residentUser._id,
      society: testSociety._id,
      type: 'note_added',
      title: 'Technician Dispatched',
      message: 'Contractor will attend between 2-4 PM.',
      issue: testIssue._id,
      idempotencyKey: `notif-test-${Date.now()}-2`,
      read: false
    });
  });

  test('Phase 2.7: Unauthenticated access to /societies/:id/notifications redirects to /login', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/notifications`, {
      redirect: 'manual'
    });
    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.get('location').includes('/login'));
  });

  test('Phase 2.7: Cross-society isolation — user without active membership cannot view society notifications', async () => {
    // residentUser is NOT a member of otherSociety
    const res = await fetch(`${baseUrl}/societies/${otherSociety._id}/notifications`, {
      headers: { Cookie: residentCookie },
      redirect: 'manual'
    });
    // Should redirect to /dashboard
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/dashboard');
  });

  test('Phase 2.7: Notification Center renders server-side unread count, badge, tabs, and metrics', async () => {
    const res = await fetch(`${baseUrl}/societies/${testSociety._id}/notifications`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();

    // Verify title & headings
    assert.ok(html.includes('Notifications Center'));
    assert.ok(html.includes('DISPATCH PIPELINE & AUDIT NOTICES'));

    // Verify buttons and controls
    assert.ok(html.includes('id="mark-all-read-btn"'));
    assert.ok(html.includes('id="refresh-notif-btn"'));
    assert.ok(html.includes('id="tab-notif-all"'));
    assert.ok(html.includes('id="tab-notif-unread"'));

    // Verify metrics and notification count
    assert.ok(html.includes('id="metric-unread-notifications"'));
    assert.ok(html.includes('Issue Status Updated to Scheduled'));
    assert.ok(html.includes('Technician Dispatched'));
    assert.ok(html.includes('mark-read-single-btn'));

    // Verify navbar badge rendered unread count 2
    assert.ok(html.includes('id="nav-notification-badge"'));
    assert.ok(html.includes('>2</span>'));
  });

  test('Phase 2.7: Cross-user notification privacy — User cannot view another user notifications via API', async () => {
    // otherUser queries notifications in testSociety -> fails with 403 (not a member of testSociety)
    const noMemberRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/notifications`, {
      headers: { Cookie: otherUserCookie }
    });
    assert.strictEqual(noMemberRes.status, 403);

    // Admin in testSociety queries their notifications -> should see 0 (resident's notifications not visible to admin)
    const adminRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/notifications`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(adminRes.status, 200);
    const adminData = await adminRes.json();
    assert.strictEqual(adminData.success, true);
    assert.strictEqual(adminData.notifications.length, 0);
    assert.strictEqual(adminData.unreadCount, 0);
  });

  test('Phase 2.7: Cross-user ownership protection — User cannot mark another user notification as read', async () => {
    // Admin attempts to mark residentNotification1 as read -> returns 404
    const res = await fetch(`${baseUrl}/api/societies/${testSociety._id}/notifications/${residentNotification1._id}/read`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        'X-CSRF-Token': extractRawCsrf(adminCookie)
      }
    });
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.message, 'Notification not found');

    // Confirm notification in DB remains unread
    const notif = await Notification.findById(residentNotification1._id);
    assert.strictEqual(notif.read, false);
  });

  test('Phase 2.7: Resident marks single notification as read', async () => {
    const res = await fetch(`${baseUrl}/api/societies/${testSociety._id}/notifications/${residentNotification1._id}/read`, {
      method: 'PATCH',
      headers: {
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.notification.read, true);
    assert.ok(data.notification.readAt);

    // Query API to verify unreadCount dropped from 2 to 1
    const listRes = await fetch(`${baseUrl}/api/societies/${testSociety._id}/notifications`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(listRes.status, 200);
    const listData = await listRes.json();
    assert.strictEqual(listData.unreadCount, 1);
  });

  test('Phase 2.7: Resident marks all remaining notifications as read', async () => {
    const res = await fetch(`${baseUrl}/api/societies/${testSociety._id}/notifications/read-all`, {
      method: 'POST',
      headers: {
        Cookie: residentCookie,
        'X-CSRF-Token': extractRawCsrf(residentCookie)
      }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.updatedCount, 1);

    // Verify in DB all notifications are read
    const unreadCountDb = await Notification.countDocuments({
      recipient: residentUser._id,
      society: testSociety._id,
      read: false
    });
    assert.strictEqual(unreadCountDb, 0);

    // Verify Notification Center page renders 0 unread in navbar badge or hides badge
    const pageRes = await fetch(`${baseUrl}/societies/${testSociety._id}/notifications`, {
      headers: { Cookie: residentCookie }
    });
    assert.strictEqual(pageRes.status, 200);
    const html = await pageRes.text();
    assert.ok(html.includes('id="metric-unread-notifications"'));
    assert.ok(html.includes('>0</div>'));
    assert.ok(html.includes('display: none;') && html.includes('nav-notification-badge'));
  });
});

