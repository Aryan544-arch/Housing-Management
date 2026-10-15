const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { app, connectDB, disconnectDB } = require('../server');
const User = require('../models/User');
const Society = require('../models/Society');
const SocietyMembership = require('../models/SocietyMembership');

describe('Authentication and Society Membership Foundation Tests', () => {
  let server;
  let baseUrl;
  const testDbUri = 'mongodb://127.0.0.1:27017/housing_management_auth_test';

  before(async () => {
    // Connect to dedicated test database
    await connectDB(testDbUri);

    // Clean test collections
    await User.deleteMany({});
    await Society.deleteMany({});
    await SocietyMembership.deleteMany({});

    // Start ephemeral server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    // Clean test collections and tear down
    await User.deleteMany({});
    await Society.deleteMany({});
    await SocietyMembership.deleteMany({});
    await disconnectDB();

    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  // Helper to extract cookies from response (handling multiple Set-Cookie headers)
  function extractCookie(response) {
    if (typeof response.headers.getSetCookie === 'function') {
      const cookies = response.headers.getSetCookie();
      return cookies.map((c) => c.split(';')[0]).join('; ');
    }
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return '';
    return setCookie.split(';')[0];
  }

  // Helper to extract raw CSRF token from cookie header
  function extractRawCsrf(cookieString) {
    if (!cookieString) return '';
    const match = cookieString.match(/_csrf=([^;]+)/);
    if (!match) return '';
    return match[1].split('.')[0];
  }

  describe('User Registration', () => {
    test('POST /api/auth/register creates user, sets HttpOnly cookie, and omits password', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Alice Johnson',
          email: 'alice@example.com',
          password: 'Password123!',
          phone: '9876543210'
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.user.email, 'alice@example.com');
      assert.strictEqual(data.user.name, 'Alice Johnson');
      assert.strictEqual(data.user.password, undefined, 'Password must not be returned');

      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie, 'Set-Cookie header must be present');
      assert.match(setCookie, /token=/, 'Token cookie must be set');
      assert.match(setCookie, /HttpOnly/i, 'Cookie must be HttpOnly');
    });

    test('POST /api/auth/register rejects duplicate email with 409', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Duplicate Alice',
          email: 'alice@example.com',
          password: 'Password123!'
        })
      });

      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /already exists/i);
    });

    test('POST /api/auth/register rejects invalid inputs (< 8 char password, invalid email)', async () => {
      const res1 = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bob',
          email: 'invalid-email',
          password: 'Password123!'
        })
      });
      assert.strictEqual(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bob',
          email: 'bob@example.com',
          password: 'short'
        })
      });
      assert.strictEqual(res2.status, 400);
    });
  });

  describe('User Login and Profile', () => {
    test('POST /api/auth/login succeeds with valid credentials and sets HttpOnly cookie', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'Password123!'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.user.email, 'alice@example.com');
      assert.strictEqual(data.user.password, undefined);

      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie);
      assert.match(setCookie, /token=/);
      assert.match(setCookie, /HttpOnly/i);
    });

    test('POST /api/auth/login fails with invalid password (401)', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'WrongPassword!'
        })
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /invalid email or password/i);
    });

    test('POST /api/auth/login fails for nonexistent user (401)', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'Password123!'
        })
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    test('GET /api/auth/me rejects unauthenticated request (401)', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    test('GET /api/auth/me returns current user when valid cookie provided', async () => {
      // Login first
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'Password123!'
        })
      });
      const cookie = extractCookie(loginRes);

      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookie }
      });

      assert.strictEqual(meRes.status, 200);
      const data = await meRes.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.user.email, 'alice@example.com');
      assert.ok(Array.isArray(data.memberships));
    });

    test('POST /api/auth/logout clears auth cookie and invalidates token server-side', async () => {
      // Login to obtain active cookie
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@example.com',
          password: 'Password123!'
        })
      });
      const activeCookie = extractCookie(loginRes);

      // Perform logout while sending the active cookie and matching CSRF token
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: activeCookie,
          'X-CSRF-Token': extractRawCsrf(activeCookie)
        }
      });
      assert.strictEqual(logoutRes.status, 200);
      const setCookie = logoutRes.headers.get('set-cookie');
      assert.ok(setCookie);
      assert.match(setCookie, /token=;|token=deleted|Max-Age=0|expires=/i);

      // Verify that reusing the PREVIOUS token is now rejected due to tokenVersion increment
      const reuseRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: activeCookie }
      });
      assert.strictEqual(reuseRes.status, 401);
      const reuseData = await reuseRes.json();
      assert.strictEqual(reuseData.success, false);
      assert.match(reuseData.message, /Session invalidated/i);
    });
  });

  describe('Society Membership and Cross-Society Authorization', () => {
    let user1Cookie;
    let user2Cookie;
    let societyAId;
    let societyBId;

    before(async () => {
      // Register User 1 (Admin of Society A)
      const u1Res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Society A Admin',
          email: 'adminA@example.com',
          password: 'Password123!'
        })
      });
      user1Cookie = extractCookie(u1Res);

      // Register User 2 (Admin of Society B)
      const u2Res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Society B Admin',
          email: 'adminB@example.com',
          password: 'Password123!'
        })
      });
      user2Cookie = extractCookie(u2Res);

      // User 1 creates Society A
      const socARes = await fetch(`${baseUrl}/api/societies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: user1Cookie,
          'X-CSRF-Token': extractRawCsrf(user1Cookie)
        },
        body: JSON.stringify({
          name: 'Society Alpha',
          code: 'SOC-ALPHA-01'
        })
      });
      assert.strictEqual(socARes.status, 201);
      const socAData = await socARes.json();
      societyAId = socAData.society._id;
      assert.strictEqual(socAData.membership.role, 'admin');

      // User 2 creates Society B
      const socBRes = await fetch(`${baseUrl}/api/societies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: user2Cookie,
          'X-CSRF-Token': extractRawCsrf(user2Cookie)
        },
        body: JSON.stringify({
          name: 'Society Beta',
          code: 'SOC-BETA-02'
        })
      });
      assert.strictEqual(socBRes.status, 201);
      const socBData = await socBRes.json();
      societyBId = socBData.society._id;
      assert.strictEqual(socBData.membership.role, 'admin');
    });

    test('User 1 can access Society A protected data (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/protected-data`, {
        headers: { Cookie: user1Cookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.societyId, societyAId);
    });

    test('CROSS-SOCIETY ISOLATION: User 1 cannot access Society B data (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyBId}/protected-data`, {
        headers: { Cookie: user1Cookie }
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /not an active member/i);
    });

    test('CROSS-SOCIETY ISOLATION: User 2 cannot access Society A data (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/protected-data`, {
        headers: { Cookie: user2Cookie }
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /not an active member/i);
    });

    test('Role Authorization: Resident in Society A cannot perform admin action (403 Forbidden)', async () => {
      // Register User 3 as resident
      const u3Res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Resident Charlie',
          email: 'charlie@example.com',
          password: 'Password123!'
        })
      });
      const user3Cookie = extractCookie(u3Res);

      // User 1 (Admin of Society A) adds User 3 as resident
      const addRes = await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: user1Cookie,
          'X-CSRF-Token': extractRawCsrf(user1Cookie)
        },
        body: JSON.stringify({
          email: 'charlie@example.com',
          role: 'resident',
          flatNumber: 'B-204'
        })
      });
      assert.strictEqual(addRes.status, 201);

      // User 3 can access general member data of Society A (200 OK)
      const viewRes = await fetch(`${baseUrl}/api/societies/${societyAId}/protected-data`, {
        headers: { Cookie: user3Cookie }
      });
      assert.strictEqual(viewRes.status, 200);

      // User 3 attempts admin-only action -> Must be rejected with 403 Forbidden
      const adminActionRes = await fetch(`${baseUrl}/api/societies/${societyAId}/admin-action`, {
        method: 'POST',
        headers: {
          Cookie: user3Cookie,
          'X-CSRF-Token': extractRawCsrf(user3Cookie)
        }
      });
      assert.strictEqual(adminActionRes.status, 403);
      const adminActionData = await adminActionRes.json();
      assert.strictEqual(adminActionData.success, false);
      assert.match(adminActionData.message, /insufficient role permissions/i);

      // User 1 (Admin) executes same admin action -> Must succeed with 200 OK
      const u1AdminActionRes = await fetch(`${baseUrl}/api/societies/${societyAId}/admin-action`, {
        method: 'POST',
        headers: {
          Cookie: user1Cookie,
          'X-CSRF-Token': extractRawCsrf(user1Cookie)
        }
      });
      assert.strictEqual(u1AdminActionRes.status, 200);
    });

    test('Constraint Enforcement: External providers cannot be added as members', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: user1Cookie,
          'X-CSRF-Token': extractRawCsrf(user1Cookie)
        },
        body: JSON.stringify({
          email: 'charlie@example.com',
          role: 'provider' // Prohibited role
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /resident or admin/i);
    });
  });

  describe('Security and Cryptographic Integrity', () => {
    test('getJwtSecret rejects missing or weak secret in production mode', () => {
      const { getJwtSecret } = require('../middleware/auth');
      const originalEnv = process.env.NODE_ENV;
      const originalSecret = process.env.JWT_SECRET;

      try {
        process.env.NODE_ENV = 'production';

        // Missing secret in production
        delete process.env.JWT_SECRET;
        assert.throws(() => getJwtSecret(), /FATAL: JWT_SECRET must be set in production/);

        // Weak secret in production (< 32 chars)
        process.env.JWT_SECRET = 'short_weak_secret';
        assert.throws(() => getJwtSecret(), /FATAL: JWT_SECRET must be at least 32 characters/);
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalSecret !== undefined) {
          process.env.JWT_SECRET = originalSecret;
        } else {
          delete process.env.JWT_SECRET;
        }
      }
    });

    test('Algorithm restriction: token with invalid signature or forged key is rejected', async () => {
      const jwt = require('jsonwebtoken');
      const forgedToken = jwt.sign({ userId: '507f1f77bcf86cd799439011' }, 'wrong_untrusted_secret', { algorithm: 'HS256' });

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: `token=${forgedToken}` }
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Invalid or expired/i);
    });

    test('CSRF Defense: Cross-origin state-changing request is rejected with 403', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://evil-cross-site-attacker.com'
        },
        body: JSON.stringify({
          name: 'Attacker Form',
          email: 'attacker@evil.com',
          password: 'Password123!'
        })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /CSRF protection: Cross-origin request rejected/i);
    });

    test('CSRF Defense: Double-submit token validation on authenticated requests', async () => {
      // 1. Register a test user (which sets both token and _csrf cookies)
      const userRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'CSRF Test User',
          email: 'csrftest@example.com',
          password: 'Password123!'
        })
      });
      const authCookies = extractCookie(userRes);
      const rawCsrf = extractRawCsrf(authCookies);
      assert.ok(rawCsrf, 'Raw CSRF token should be extractable from response cookies');

      // 2. Attempt state-changing request with valid signed cookie but mismatched X-CSRF-Token
      const attackRes = await fetch(`${baseUrl}/api/societies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookies,
          'X-CSRF-Token': 'wrong_mismatched_token'
        },
        body: JSON.stringify({
          name: 'Attacked Society',
          code: 'CSRF-ATTACK-01'
        })
      });
      assert.strictEqual(attackRes.status, 403);
      const attackData = await attackRes.json();
      assert.match(attackData.message, /CSRF token mismatch/i);

      // 3. Send request with valid matching X-CSRF-Token header -> Should succeed (201)
      const validRes = await fetch(`${baseUrl}/api/societies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookies,
          'X-CSRF-Token': rawCsrf
        },
        body: JSON.stringify({
          name: 'Valid Protected Society',
          code: 'CSRF-VALID-01'
        })
      });
      assert.strictEqual(validRes.status, 201);

      // 4. Browser form submission with _csrf body field -> Should succeed (201)
      const formRes = await fetch(`${baseUrl}/api/societies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookies
        },
        body: JSON.stringify({
          name: 'Form Protected Society',
          code: 'CSRF-FORM-02',
          _csrf: rawCsrf
        })
      });
      assert.strictEqual(formRes.status, 201);
    });

    test('CSRF Defense: Cookie tossing / forged unsigned cookie is rejected', async () => {
      // Register test user
      const userRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Toss Victim',
          email: 'toss@example.com',
          password: 'Password123!'
        })
      });
      const authCookies = extractCookie(userRes);
      const authToken = authCookies.split(';').map((c) => c.trim()).find((c) => c.startsWith('token='));

      // Attacker attempts cookie tossing by injecting an arbitrary unsigned cookie
      const fakeToken = 'attacker_forged_unsigned_token';
      const tossedRes = await fetch(`${baseUrl}/api/societies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `${authToken}; _csrf=${fakeToken}`,
          'X-CSRF-Token': fakeToken
        },
        body: JSON.stringify({
          name: 'Tossed Society',
          code: 'CSRF-TOSS-01'
        })
      });
      assert.strictEqual(tossedRes.status, 403);
      const tossedData = await tossedRes.json();
      assert.match(tossedData.message, /Invalid or tampered CSRF cookie/i);
    });

    test('CSRF Defense: Authenticated request omitting CSRF token or cookie is rejected', async () => {
      // Register test user
      const userRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Omission Victim',
          email: 'omission@example.com',
          password: 'Password123!'
        })
      });
      const authCookie = extractCookie(userRes);

      // Authenticated request without any CSRF cookie or header -> Must be blocked (no bypass by omission)
      const omitRes = await fetch(`${baseUrl}/api/societies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie
        },
        body: JSON.stringify({
          name: 'Omission Society',
          code: 'CSRF-OMIT-01'
        })
      });
      assert.strictEqual(omitRes.status, 403);
      const omitData = await omitRes.json();
      assert.match(omitData.message, /Missing CSRF token or cookie/i);
    });

    test('CSRF Defense: Cross-origin Referer is rejected when Origin is absent', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Referer': 'http://evil-cross-site-attacker.com/malicious-page'
        },
        body: JSON.stringify({
          name: 'Referer Attacker',
          email: 'referer@evil.com',
          password: 'Password123!'
        })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /CSRF protection: Cross-origin referer rejected/i);
    });

    test('Society creation rollback: cleans up society if membership creation fails', async () => {
      const user = await User.create({
        name: 'Rollback Tester',
        email: 'rollback@example.com',
        password: 'Password123!'
      });

      const originalCreate = SocietyMembership.create;
      SocietyMembership.create = async () => {
        throw new Error('Simulated membership database failure');
      };

      try {
        const { createSociety } = require('../controllers/societyController');
        const req = {
          user,
          body: {
            name: 'Rollback Test Society',
            code: 'ROLLBACK-01'
          }
        };
        const res = {
          status: () => res,
          json: () => res
        };

        let caughtError = null;
        await createSociety(req, res, (err) => {
          caughtError = err;
        });

        assert.ok(caughtError, 'Should catch simulated membership error');
        assert.match(caughtError.message, /Simulated membership database failure/);

        // Verify that Society document was deleted and not left orphaned
        const found = await Society.findOne({ code: 'ROLLBACK-01' });
        assert.strictEqual(found, null, 'Orphaned society must be cleaned up on failure');
      } finally {
        SocietyMembership.create = originalCreate;
      }
    });
  });
});
