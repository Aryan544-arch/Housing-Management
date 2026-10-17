const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, connectDB, disconnectDB } = require('../server');
const User = require('../models/User');
const Society = require('../models/Society');
const SocietyMembership = require('../models/SocietyMembership');
const { Issue } = require('../models/Issue');

describe('Targeted Headless Verification — Auth, Authorization, CSRF, Society Scope & Redirects', () => {
  let server;
  let baseUrl;
  const testDbUri = 'mongodb://127.0.0.1:27017/housing_management_headless_test';

  let socA;
  let socB;
  let socPending;
  let socInactive;

  let userActiveMulti;
  let userPending;
  let userInactive;
  let userUnrelated;

  let multiCookie;
  let pendingCookie;
  let inactiveCookie;
  let unrelatedCookie;

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

    // Create system creator user
    const sysAdminRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sys Admin',
        email: 'sysadmin.headless@test.local',
        password: 'Password123!',
        phone: '1111111111'
      })
    });
    const sysAdminData = await sysAdminRes.json();
    const sysAdminId = sysAdminData.user._id;

    // Create Societies
    socA = await Society.create({
      name: 'Headless Society Alpha',
      code: 'HDL-A',
      address: { street: '1 Alpha St', city: 'Metro', state: 'State', postalCode: '10001' },
      createdBy: sysAdminId
    });

    socB = await Society.create({
      name: 'Headless Society Beta',
      code: 'HDL-B',
      address: { street: '2 Beta St', city: 'Metro', state: 'State', postalCode: '10002' },
      createdBy: sysAdminId
    });

    socPending = await Society.create({
      name: 'Headless Society Pending',
      code: 'HDL-P',
      address: { street: '3 Pending St', city: 'Metro', state: 'State', postalCode: '10003' },
      createdBy: sysAdminId
    });

    socInactive = await Society.create({
      name: 'Headless Society Inactive',
      code: 'HDL-I',
      address: { street: '4 Inactive St', city: 'Metro', state: 'State', postalCode: '10004' },
      createdBy: sysAdminId
    });

    // 1. User with Active Memberships in Soc A and Soc B
    const multiRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Multi Active Member',
        email: 'multi.active@test.local',
        password: 'Password123!',
        phone: '2222222222'
      })
    });
    const multiData = await multiRes.json();
    userActiveMulti = multiData.user;
    multiCookie = extractCookie(multiRes);

    await SocietyMembership.create({
      user: userActiveMulti._id,
      society: socA._id,
      role: 'resident',
      flatNumber: 'A-101',
      status: 'active'
    });
    await SocietyMembership.create({
      user: userActiveMulti._id,
      society: socB._id,
      role: 'resident',
      flatNumber: 'B-202',
      status: 'active'
    });

    // Create an issue in Soc A
    await Issue.create({
      society: socA._id,
      submittingResident: userActiveMulti._id,
      title: 'Corridor lamp fixture broken',
      description: 'Corridor lamp fixture in wing A floor 1 needs replacement.',
      category: 'electrical',
      location: { type: 'common_area', areaDescription: 'Wing A Floor 1' },
      priority: 'normal',
      status: 'submitted'
    });

    // 2. User with Pending Membership
    const pendingRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Pending Resident',
        email: 'pending.res@test.local',
        password: 'Password123!',
        phone: '3333333333'
      })
    });
    const pendingData = await pendingRes.json();
    userPending = pendingData.user;
    pendingCookie = extractCookie(pendingRes);

    await SocietyMembership.create({
      user: userPending._id,
      society: socPending._id,
      role: 'resident',
      flatNumber: 'P-301',
      status: 'pending'
    });

    // 3. User with Inactive Membership
    const inactiveRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Inactive Resident',
        email: 'inactive.res@test.local',
        password: 'Password123!',
        phone: '4444444444'
      })
    });
    const inactiveData = await inactiveRes.json();
    userInactive = inactiveData.user;
    inactiveCookie = extractCookie(inactiveRes);

    await SocietyMembership.create({
      user: userInactive._id,
      society: socInactive._id,
      role: 'resident',
      flatNumber: 'I-401',
      status: 'inactive'
    });

    // 4. Unrelated User (No memberships in any society)
    const unrelatedRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Unrelated User',
        email: 'unrelated.res@test.local',
        password: 'Password123!',
        phone: '5555555555'
      })
    });
    const unrelatedData = await unrelatedRes.json();
    userUnrelated = unrelatedData.user;
    unrelatedCookie = extractCookie(unrelatedRes);
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

  // --- ITEM 1: Login, Registration, Logout & Protected Route Behavior ---
  describe('1. Login, Registration, Logout, and Protected-Route Behavior', () => {
    test('Registration sets session cookie and returns user object', async () => {
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Fresh Resident',
          email: 'fresh.resident@test.local',
          password: 'Password123!',
          phone: '9998887776'
        })
      });
      assert.strictEqual(regRes.status, 201);
      const data = await regRes.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.user.email, 'fresh.resident@test.local');

      const cookie = extractCookie(regRes);
      const rawSetCookie = regRes.headers.getSetCookie ? regRes.headers.getSetCookie().join('; ') : (regRes.headers.get('set-cookie') || '');
      assert.ok(cookie.includes('token='));
      assert.ok(/httponly/i.test(rawSetCookie));
    });

    test('Login with valid credentials returns 200 and issues session cookie', async () => {
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'multi.active@test.local',
          password: 'Password123!'
        })
      });
      assert.strictEqual(loginRes.status, 200);
      const data = await loginRes.json();
      assert.strictEqual(data.success, true);
      const cookie = extractCookie(loginRes);
      assert.ok(cookie.includes('token='));
    });

    test('Login with invalid credentials returns 401 with generic error message', async () => {
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'multi.active@test.local',
          password: 'WrongPassword999!'
        })
      });
      assert.strictEqual(loginRes.status, 401);
      const data = await loginRes.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.message, 'Invalid email or password.');
    });

    test('Logout clears session cookie and increments token version', async () => {
      // First obtain fresh login cookie
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'fresh.resident@test.local',
          password: 'Password123!'
        })
      });
      const sessionCookie = extractCookie(loginRes);
      const rawCsrf = extractRawCsrf(sessionCookie);

      // Perform logout
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
          'X-CSRF-Token': rawCsrf
        }
      });
      assert.strictEqual(logoutRes.status, 200);
      const data = await logoutRes.json();
      assert.strictEqual(data.success, true);

      // The old cookie should no longer authenticate protected routes
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: sessionCookie }
      });
      assert.strictEqual(meRes.status, 401);
    });

    test('Protected web route /dashboard redirects unauthenticated user to /login', async () => {
      const res = await fetch(`${baseUrl}/dashboard`, { redirect: 'manual' });
      assert.strictEqual(res.status, 302);
      assert.ok(res.headers.get('location').startsWith('/login'));
    });
  });

  // --- ITEM 2: Authorization for Active, Pending, Inactive, and Unrelated Memberships ---
  describe('2. Authorization for Active, Pending, Inactive, and Unrelated Memberships', () => {
    test('Active resident in Soc A can access Soc A dashboard and API issues', async () => {
      const webRes = await fetch(`${baseUrl}/societies/${socA._id}/dashboard`, {
        headers: { Cookie: multiCookie }
      });
      assert.strictEqual(webRes.status, 200);
      const html = await webRes.text();
      assert.ok(html.includes('Headless Society Alpha'));

      const apiRes = await fetch(`${baseUrl}/api/societies/${socA._id}/issues`, {
        headers: { Cookie: multiCookie }
      });
      assert.strictEqual(apiRes.status, 200);
      const data = await apiRes.json();
      assert.strictEqual(data.success, true);
    });

    test('Pending membership in Soc Pending is blocked from accessing dashboard and API', async () => {
      // Web dashboard redirect
      const webRes = await fetch(`${baseUrl}/societies/${socPending._id}/dashboard`, {
        headers: { Cookie: pendingCookie },
        redirect: 'manual'
      });
      assert.strictEqual(webRes.status, 302);
      assert.strictEqual(webRes.headers.get('location'), '/dashboard');

      // API access denied (403 Forbidden)
      const apiRes = await fetch(`${baseUrl}/api/societies/${socPending._id}/issues`, {
        headers: { Cookie: pendingCookie }
      });
      assert.strictEqual(apiRes.status, 403);
    });

    test('Inactive membership in Soc Inactive is blocked from accessing dashboard and API', async () => {
      // Web dashboard redirect
      const webRes = await fetch(`${baseUrl}/societies/${socInactive._id}/dashboard`, {
        headers: { Cookie: inactiveCookie },
        redirect: 'manual'
      });
      assert.strictEqual(webRes.status, 302);
      assert.strictEqual(webRes.headers.get('location'), '/dashboard');

      // API access denied (403 Forbidden)
      const apiRes = await fetch(`${baseUrl}/api/societies/${socInactive._id}/issues`, {
        headers: { Cookie: inactiveCookie }
      });
      assert.strictEqual(apiRes.status, 403);
    });

    test('Unrelated user (no membership in Soc A) is strictly denied from Soc A dashboard and API', async () => {
      // Web dashboard redirect
      const webRes = await fetch(`${baseUrl}/societies/${socA._id}/dashboard`, {
        headers: { Cookie: unrelatedCookie },
        redirect: 'manual'
      });
      assert.strictEqual(webRes.status, 302);
      assert.strictEqual(webRes.headers.get('location'), '/dashboard');

      // API access denied (403 Forbidden)
      const apiRes = await fetch(`${baseUrl}/api/societies/${socA._id}/issues`, {
        headers: { Cookie: unrelatedCookie }
      });
      assert.strictEqual(apiRes.status, 403);
    });
  });

  // --- ITEM 3: CSRF Protection Rejection and Acceptance ---
  describe('3. CSRF Rejection for Missing/Invalid Tokens and Acceptance of Valid Tokens', () => {
    test('State-changing POST rejected with 403 when CSRF token is completely missing', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${socA._id}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: multiCookie
        },
        body: JSON.stringify({
          title: 'Attempted issue without CSRF',
          description: 'This state-changing request should be rejected by CSRF protection middleware.',
          category: 'plumbing',
          location: { type: 'common_area', areaDescription: 'Lobby' }
        })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.ok(data.message.includes('CSRF'));
    });

    test('State-changing POST rejected with 403 when CSRF token is invalid/tampered', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${socA._id}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: multiCookie,
          'X-CSRF-Token': 'tampered_or_spoofed_csrf_token_value'
        },
        body: JSON.stringify({
          title: 'Attempted issue with forged CSRF',
          description: 'This state-changing request should be rejected by CSRF protection middleware.',
          category: 'plumbing',
          location: { type: 'common_area', areaDescription: 'Lobby' }
        })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.ok(data.message.includes('CSRF'));
    });

    test('State-changing POST accepted with 201 when valid CSRF token is supplied', async () => {
      const rawCsrf = extractRawCsrf(multiCookie);
      assert.ok(rawCsrf, 'Raw CSRF token must be present in multiCookie');

      const res = await fetch(`${baseUrl}/api/societies/${socA._id}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: multiCookie,
          'X-CSRF-Token': rawCsrf
        },
        body: JSON.stringify({
          title: 'Validly authenticated issue report',
          description: 'This state-changing request carries a cryptographic HMAC CSRF token.',
          category: 'plumbing',
          location: { type: 'common_area', areaDescription: 'Main Ground Lobby' },
          priority: 'normal'
        })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.issue.title, 'Validly authenticated issue report');
    });
  });

  // --- ITEM 4: Society Switching and Consistent Use of Selected Society ID ---
  describe('4. Society Switching and Consistent Use of Selected Society ID', () => {
    test('/select-society displays both Soc A and Soc B for multi-society user', async () => {
      const res = await fetch(`${baseUrl}/select-society`, {
        headers: { Cookie: multiCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Headless Society Alpha'));
      assert.ok(html.includes('Headless Society Beta'));
      assert.ok(html.includes(`/societies/${socA._id}/dashboard`));
      assert.ok(html.includes(`/societies/${socB._id}/dashboard`));
    });

    test('Selecting Soc A scopes all navigation and issue queries strictly to Soc A', async () => {
      const res = await fetch(`${baseUrl}/societies/${socA._id}/dashboard`, {
        headers: { Cookie: multiCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Headless Society Alpha'));
      assert.ok(html.includes(`/societies/${socA._id}/issues/new`));
      assert.ok(html.includes(`/societies/${socA._id}/notifications`));
      // Soc A has the corridor lamp fixture issue
      assert.ok(html.includes('Corridor lamp fixture broken'));
    });

    test('Selecting Soc B scopes all navigation strictly to Soc B without Soc A issue leakage', async () => {
      const res = await fetch(`${baseUrl}/societies/${socB._id}/dashboard`, {
        headers: { Cookie: multiCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Headless Society Beta'));
      assert.ok(html.includes(`/societies/${socB._id}/issues/new`));
      assert.ok(html.includes(`/societies/${socB._id}/notifications`));
      // Soc B must NOT show Soc A issues
      assert.ok(!html.includes('Corridor lamp fixture broken'));
    });
  });

  // --- ITEM 5: Redirect Sanitization for External URLs and Redirect Loops ---
  describe('5. Redirect Sanitization for External URLs and Redirect Loops', () => {
    test('Authenticated user with external URL redirect is safely normalized to /dashboard', async () => {
      const res = await fetch(`${baseUrl}/login?redirect=https://evil.com`, {
        headers: { Cookie: multiCookie },
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/dashboard');
    });

    test('Authenticated user with protocol-relative URL is normalized to /dashboard', async () => {
      const res = await fetch(`${baseUrl}/login?redirect=//evil.com`, {
        headers: { Cookie: multiCookie },
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/dashboard');
    });

    test('Authenticated user with backslash bypass (/\\evil.com) is normalized to /dashboard', async () => {
      const res = await fetch(`${baseUrl}/login?redirect=/\\evil.com`, {
        headers: { Cookie: multiCookie },
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/dashboard');
    });

    test('Authenticated user with self-referential /login is normalized to /dashboard', async () => {
      const res = await fetch(`${baseUrl}/login?redirect=/login`, {
        headers: { Cookie: multiCookie },
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/dashboard');
    });

    test('Authenticated user with legitimate internal path is preserved', async () => {
      const res = await fetch(`${baseUrl}/login?redirect=/societies/${socA._id}/dashboard`, {
        headers: { Cookie: multiCookie },
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), `/societies/${socA._id}/dashboard`);
    });

    test('Unauthenticated user visiting /login?redirect=https://evil.com renders sanitized form data-redirect', async () => {
      const res = await fetch(`${baseUrl}/login?redirect=https://evil.com`);
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(!html.includes('data-redirect="https://evil.com"'));
      assert.ok(html.includes('data-redirect=""'));
    });
  });
});
