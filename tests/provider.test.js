const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { app, connectDB, disconnectDB } = require('../server');
const User = require('../models/User');
const Society = require('../models/Society');
const SocietyMembership = require('../models/SocietyMembership');
const { Issue } = require('../models/Issue');
const { Provider } = require('../models/Provider');

describe('Phase 4 — Provider Management and Private Issue Suggestions Tests', () => {
  let server;
  let baseUrl;
  const testDbUri = 'mongodb://127.0.0.1:27017/housing_management_provider_test';

  let adminACookie;
  let resident1Cookie;
  let adminBCookie;
  let residentBCookie;

  let societyAId;
  let societyBId;

  let resident1Id;

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
        name: 'Admin Alpha',
        email: 'admin.alpha@example.com',
        password: 'Password123!'
      })
    });
    adminACookie = extractCookie(adminARes);

    const socARes = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminACookie,
        'X-CSRF-Token': extractRawCsrf(adminACookie)
      },
      body: JSON.stringify({
        name: 'Alpha Apex Society',
        code: 'APEX-A-01'
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

    // 3. Setup Admin B and Society B
    const adminBRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Beta',
        email: 'admin.beta@example.com',
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
        name: 'Beta Bay Society',
        code: 'BAY-B-02'
      })
    });
    const socBData = await socBRes.json();
    societyBId = socBData.society._id;

    // 4. Setup Resident B in Society B
    const resBRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident Beta',
        email: 'resb@example.com',
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
        email: 'resb@example.com',
        role: 'resident',
        flatNumber: 'B-202'
      })
    });
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

  describe('Provider Creation and Validation', () => {
    let createdProviderId;

    test('Admin creates a valid provider with full details (201 Created)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'QuickFix Plumbing & Electrical',
          categories: ['plumbing', 'electrical'],
          description: 'Licensed plumbers and electricians available 24/7.',
          serviceArea: {
            allBlocks: true,
            blocks: []
          },
          contactPhone: '9876543210',
          contactEmail: 'contact@quickfix.example.com',
          contactPerson: 'Ramesh Sharma',
          pricing: {
            rateType: 'hourly',
            estimate: '₹300 - ₹600 / hour',
            minRate: 300,
            maxRate: 600
          },
          status: 'active'
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.provider.name, 'QuickFix Plumbing & Electrical');
      assert.strictEqual(data.provider.status, 'active');
      assert.strictEqual(data.provider.categories.length, 2);
      createdProviderId = data.provider._id;

      // Verify MongoDB persistence directly
      const dbProvider = await Provider.findById(createdProviderId);
      assert.ok(dbProvider);
      assert.strictEqual(dbProvider.name, 'QuickFix Plumbing & Electrical');
      assert.strictEqual(dbProvider.contactPhone, '9876543210');
      assert.strictEqual(dbProvider.pricing.minRate, 300);
      assert.strictEqual(dbProvider.pricing.maxRate, 600);
    });

    test('Rejects provider with missing or empty name (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: '  ',
          categories: ['plumbing'],
          contactPhone: '9876543210'
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /name is required/i);
    });

    test('Rejects provider with invalid or empty categories (400 Bad Request)', async () => {
      const res1 = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Invalid Cat Provider',
          categories: [],
          contactPhone: '9876543210'
        })
      });
      assert.strictEqual(res1.status, 400);

      const res2 = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Invalid Cat Provider 2',
          categories: ['not_a_real_category'],
          contactPhone: '9876543210'
        })
      });
      assert.strictEqual(res2.status, 400);
      const data2 = await res2.json();
      assert.match(data2.message, /invalid service category/i);
    });

    test('Rejects provider with missing or invalid phone number (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'No Phone Provider',
          categories: ['carpentry'],
          contactPhone: '12' // Too short (< 5)
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /contact phone/i);
    });

    test('Rejects provider with invalid email format (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Bad Email Provider',
          categories: ['carpentry'],
          contactPhone: '9876543210',
          contactEmail: 'not-an-email'
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /email format is invalid/i);
    });

    test('Rejects provider with inverted pricing where maxRate < minRate (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Inverted Price Provider',
          categories: ['carpentry'],
          contactPhone: '9876543210',
          pricing: {
            minRate: 500,
            maxRate: 200
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /maximum rate cannot be less than minimum rate/i);
    });

    test('Rejects duplicate provider name in the same society (409 Conflict)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'QuickFix Plumbing & Electrical', // Same name as first test
          categories: ['plumbing'],
          contactPhone: '1122334455'
        })
      });

      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.match(data.message, /already exists in this society/i);
    });

    test('Allows same provider name in a different society (201 Created)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyBId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminBCookie,
          'X-CSRF-Token': extractRawCsrf(adminBCookie)
        },
        body: JSON.stringify({
          name: 'QuickFix Plumbing & Electrical', // Same name, but in Society B
          categories: ['plumbing'],
          contactPhone: '9988776655'
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
    });

    test('Rejects unknown and unauthorized fields on creation (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Hacked Provider',
          categories: ['security'],
          contactPhone: '9876543210',
          maliciousField: 'exploit',
          society: 'spoofedSocietyId'
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid or unauthorized field/i);
    });

    test('Rejects negative pricing minRate or maxRate (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Negative Price Provider',
          categories: ['plumbing'],
          contactPhone: '9876543210',
          pricing: {
            minRate: -100
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /minimum rate must be a non-negative number/i);
    });

    test('Rejects invalid pricing rateType (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Bad Rate Type Provider',
          categories: ['plumbing'],
          contactPhone: '9876543210',
          pricing: {
            rateType: 'unsupported_rate'
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid rate type/i);
    });

    test('Rejects unknown keys in pricing or serviceArea (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Unknown Subfield Provider',
          categories: ['plumbing'],
          contactPhone: '9876543210',
          pricing: {
            secretBonus: 500
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid field\(s\) in pricing/i);
    });
  });

  describe('Provider Listing, Detail, and Filtering', () => {
    before(async () => {
      // Create a few more providers in Society A
      await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Elite Carpentry Works',
          categories: ['carpentry'],
          contactPhone: '9123456780',
          serviceArea: { allBlocks: false, blocks: ['Wing A'] },
          status: 'active'
        })
      });

      await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Tower B Only Housekeeping',
          categories: ['housekeeping'],
          contactPhone: '9123456781',
          serviceArea: { allBlocks: false, blocks: ['Tower B'] },
          status: 'inactive'
        })
      });
    });

    test('Admin lists all providers in society with counts (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.count >= 3);
    });

    test('Admin filters providers by status=active (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers?status=active`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.providers.every((p) => p.status === 'active'));
    });

    test('Admin filters providers by category=carpentry (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers?category=carpentry`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.providers.every((p) => p.categories.includes('carpentry')));
    });

    test('Admin searches provider by name (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers?search=Elite`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.count, 1);
      assert.strictEqual(data.providers[0].name, 'Elite Carpentry Works');
    });

    test('Admin retrieves single provider by ID (200 OK)', async () => {
      const listRes = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        headers: { Cookie: adminACookie }
      });
      const listData = await listRes.json();
      const targetId = listData.providers[0]._id;

      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${targetId}`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.provider._id, targetId);
    });

    test('Rejects invalid status filter (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers?status=not_a_status`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid status filter/i);
    });

    test('Rejects invalid category filter (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers?category=flying_carpets`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid category filter/i);
    });

    test('Rejects search query exceeding 100 characters (400 Bad Request)', async () => {
      const longQuery = 'a'.repeat(101);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers?search=${longQuery}`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /search query cannot exceed 100 characters/i);
    });

    test('Supports safe pagination with limit and page parameters (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers?limit=2&page=1`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.page, 1);
      assert.strictEqual(data.count, 2);
      assert.ok(data.totalCount >= 3);
      assert.strictEqual(data.totalPages, Math.ceil(data.totalCount / 2));
    });
  });

  describe('Provider Updates and OCC', () => {
    let providerToUpdateId;

    before(async () => {
      const createRes = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Patch Update Test Provider',
          categories: ['security'],
          contactPhone: '9000000001',
          status: 'active'
        })
      });
      const data = await createRes.json();
      providerToUpdateId = data.provider._id;
    });

    test('Admin updates provider fields successfully (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${providerToUpdateId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          description: 'Updated security company description',
          contactPhone: '9000000099',
          priceEstimate: '₹15,000 / month'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.provider.description, 'Updated security company description');
      assert.strictEqual(data.provider.contactPhone, '9000000099');

      // Verify directly in MongoDB
      const dbProvider = await Provider.findById(providerToUpdateId);
      assert.strictEqual(dbProvider.contactPhone, '9000000099');
      assert.strictEqual(dbProvider.priceEstimate, '₹15,000 / month');
    });

    test('Rejects update with unknown or prohibited fields (400 Bad Request)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${providerToUpdateId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          unknownField: 'badData',
          society: societyBId
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /invalid or unauthorized field/i);
    });

    test('Rejects update attempting to rename provider to an existing name (409 Conflict)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${providerToUpdateId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'QuickFix Plumbing & Electrical' // Already exists
        })
      });

      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.match(data.message, /already exists in this society/i);
    });

    test('Mongoose OCC throws VersionError on stale provider document save', async () => {
      const docA = await Provider.findById(providerToUpdateId);
      const docB = await Provider.findById(providerToUpdateId);

      docA.description = 'First concurrent update';
      await docA.save(); // Increments __v

      docB.description = 'Second concurrent update';
      await assert.rejects(async () => {
        await docB.save();
      }, (err) => {
        assert.strictEqual(err.name, 'VersionError');
        return true;
      });
    });
  });

  describe('Provider Deactivation vs. Permanent Deletion', () => {
    let deactivatableProviderId;
    let referencedProviderId;
    let referencedIssueId;

    before(async () => {
      // 1. Standalone provider for deletion/deactivation
      const res1 = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Standalone Deletable Provider',
          categories: ['elevator'],
          contactPhone: '9444444444'
        })
      });
      const data1 = await res1.json();
      deactivatableProviderId = data1.provider._id;

      // 2. Provider referenced by an issue
      const res2 = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Referenced Elevator Services',
          categories: ['elevator'],
          contactPhone: '9555555555'
        })
      });
      const data2 = await res2.json();
      referencedProviderId = data2.provider._id;

      // Create issue referencing this provider
      const issueRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Tower A Elevator Stuck',
          description: 'Elevator stops between floors 3 and 4.',
          category: 'elevator',
          location: { type: 'common_area', areaDescription: 'Tower A Elevator' }
        })
      });
      const issueData = await issueRes.json();
      referencedIssueId = issueData.issue._id;

      // Admin updates issue with externalProviderDetails referencing the provider
      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${referencedIssueId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          externalProviderDetails: {
            companyOrName: 'Referenced Elevator Services',
            contactPhone: '9555555555',
            trade: 'Elevator'
          }
        })
      });
    });

    test('Referenced provider is deactivated instead of permanently deleted (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${referencedProviderId}`, {
        method: 'DELETE',
        headers: {
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.deactivated, true);
      assert.match(data.message, /deactivated rather than deleted/i);

      // Verify in DB that document still exists but status is inactive
      const dbProvider = await Provider.findById(referencedProviderId);
      assert.ok(dbProvider, 'Provider document must be preserved');
      assert.strictEqual(dbProvider.status, 'inactive');
    });

    test('Unreferenced provider can be permanently deleted when requested (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${deactivatableProviderId}?permanent=true`, {
        method: 'DELETE',
        headers: {
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.deleted, true);

      // Verify in DB that document is removed
      const dbProvider = await Provider.findById(deactivatableProviderId);
      assert.strictEqual(dbProvider, null);
    });

    test('Referenced provider cannot be permanently deleted even when permanent=true is requested (200 OK deactivated)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${referencedProviderId}?permanent=true`, {
        method: 'DELETE',
        headers: {
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.deactivated, true);
      assert.match(data.message, /deactivated rather than deleted/i);

      // Verify document still exists in DB
      const dbProvider = await Provider.findById(referencedProviderId);
      assert.ok(dbProvider, 'Provider document must be preserved');
      assert.strictEqual(dbProvider.status, 'inactive');
    });

    test('Case-insensitive provider reference prevents permanent deletion', async () => {
      // 1. Create a provider
      const pRes = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          name: 'Case Test Plumbing Specialist',
          categories: ['plumbing'],
          contactPhone: '9888888888'
        })
      });
      const pData = await pRes.json();
      const pId = pData.provider._id;

      // 2. Create an issue referencing it with DIFFERENT CASING ('case test plumbing specialist')
      const iRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          title: 'Case Test Pipe Burst',
          description: 'Water pipe leaking in utility room.',
          category: 'plumbing',
          location: { type: 'common_area', areaDescription: 'Utility Room' }
        })
      });
      const iData = await iRes.json();
      const iId = iData.issue._id;

      await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${iId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        },
        body: JSON.stringify({
          externalProviderDetails: {
            companyOrName: 'case test plumbing specialist', // Lowercase
            contactPhone: '9888888888',
            trade: 'Plumbing'
          }
        })
      });

      // 3. Attempt permanent deletion
      const delRes = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${pId}?permanent=true`, {
        method: 'DELETE',
        headers: {
          Cookie: adminACookie,
          'X-CSRF-Token': extractRawCsrf(adminACookie)
        }
      });

      assert.strictEqual(delRes.status, 200);
      const delData = await delRes.json();
      assert.strictEqual(delData.deactivated, true);
      assert.match(delData.message, /deactivated rather than deleted/i);

      const dbCheck = await Provider.findById(pId);
      assert.ok(dbCheck, 'Must not be deleted due to case-insensitive reference match');
    });
  });

  describe('Strict Access Control and Isolation', () => {
    let protectedProviderId;

    before(async () => {
      const listRes = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        headers: { Cookie: adminACookie }
      });
      const listData = await listRes.json();
      protectedProviderId = listData.providers[0]._id;
    });

    test('Residents are strictly forbidden from creating providers (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({
          name: 'Resident Injected Provider',
          categories: ['plumbing'],
          contactPhone: '9000000000'
        })
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /insufficient role permissions/i);
    });

    test('Residents are strictly forbidden from listing providers (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res.status, 403);
    });

    test('Residents are strictly forbidden from viewing provider details (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${protectedProviderId}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res.status, 403);
    });

    test('Residents are strictly forbidden from updating providers (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${protectedProviderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        },
        body: JSON.stringify({ name: 'Hacked Name' })
      });
      assert.strictEqual(res.status, 403);
    });

    test('Residents are strictly forbidden from deleting providers (403 Forbidden)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/${protectedProviderId}`, {
        method: 'DELETE',
        headers: {
          Cookie: resident1Cookie,
          'X-CSRF-Token': extractRawCsrf(resident1Cookie)
        }
      });
      assert.strictEqual(res.status, 403);
    });

    test('Unauthenticated requests are rejected (401 Unauthorized)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`);
      assert.strictEqual(res.status, 401);
    });

    test('CROSS-SOCIETY ISOLATION: Admin B cannot access Society A providers (403 or 404)', async () => {
      // 1. Admin B calls Society A's provider list -> 403 (not a member of Society A)
      const listRes = await fetch(`${baseUrl}/api/societies/${societyAId}/providers`, {
        headers: { Cookie: adminBCookie }
      });
      assert.strictEqual(listRes.status, 403);

      // 2. Admin B calls Society B's provider detail passing Society A's provider ID -> 404
      const detailRes = await fetch(`${baseUrl}/api/societies/${societyBId}/providers/${protectedProviderId}`, {
        headers: { Cookie: adminBCookie }
      });
      assert.strictEqual(detailRes.status, 404);
    });
  });

  describe('Private Provider Suggestions for Issues', () => {
    let unitWingAIssueId;
    let unitWingBIssueId;
    let commonAreaIssueId;

    let universalPlumberId;
    let wingAPlumberId;
    let wingBPlumberId;
    let inactivePlumberId;
    let universalElectricianId;

    before(async () => {
      // 1. Create Providers in Society A with distinct categories, service areas, and statuses
      // Provider 1: Plumbing, allBlocks: true, active
      const p1 = await new Provider({
        society: new mongoose.Types.ObjectId(societyAId),
        name: 'Universal Plumber Company',
        categories: ['plumbing'],
        contactPhone: '9111111111',
        serviceArea: { allBlocks: true, blocks: [] },
        status: 'active',
        createdBy: new mongoose.Types.ObjectId(),
        updatedBy: new mongoose.Types.ObjectId()
      }).save();
      universalPlumberId = p1._id;

      // Provider 2: Plumbing, specific to Wing A, active
      const p2 = await new Provider({
        society: new mongoose.Types.ObjectId(societyAId),
        name: 'Wing A Specialist Plumber',
        categories: ['plumbing'],
        contactPhone: '9222222222',
        serviceArea: { allBlocks: false, blocks: ['Wing A'] },
        status: 'active',
        createdBy: new mongoose.Types.ObjectId(),
        updatedBy: new mongoose.Types.ObjectId()
      }).save();
      wingAPlumberId = p2._id;

      // Provider 3: Plumbing, specific to Wing B, active
      const p3 = await new Provider({
        society: new mongoose.Types.ObjectId(societyAId),
        name: 'Wing B Specialist Plumber',
        categories: ['plumbing'],
        contactPhone: '9333333333',
        serviceArea: { allBlocks: false, blocks: ['Wing B'] },
        status: 'active',
        createdBy: new mongoose.Types.ObjectId(),
        updatedBy: new mongoose.Types.ObjectId()
      }).save();
      wingBPlumberId = p3._id;

      // Provider 4: Plumbing, allBlocks: true, INACTIVE
      const p4 = await new Provider({
        society: new mongoose.Types.ObjectId(societyAId),
        name: 'Retired Inactive Plumber',
        categories: ['plumbing'],
        contactPhone: '9444444444',
        serviceArea: { allBlocks: true, blocks: [] },
        status: 'inactive',
        createdBy: new mongoose.Types.ObjectId(),
        updatedBy: new mongoose.Types.ObjectId()
      }).save();
      inactivePlumberId = p4._id;

      // Provider 5: Electrical, allBlocks: true, active
      const p5 = await new Provider({
        society: new mongoose.Types.ObjectId(societyAId),
        name: 'All-Wings Electrical Services',
        categories: ['electrical'],
        contactPhone: '9555555555',
        serviceArea: { allBlocks: true, blocks: [] },
        status: 'active',
        createdBy: new mongoose.Types.ObjectId(),
        updatedBy: new mongoose.Types.ObjectId()
      }).save();
      universalElectricianId = p5._id;

      // 2. Create Issues in Society A
      // Issue 1: Unit in Wing A, Plumbing
      const i1 = await new Issue({
        society: new mongoose.Types.ObjectId(societyAId),
        submittingResident: new mongoose.Types.ObjectId(resident1Id),
        title: 'Wing A Sink Clog',
        description: 'Sink drains very slowly in kitchen.',
        category: 'plumbing',
        location: { type: 'unit', blockOrWing: 'Wing A', flatOrUnit: '101' },
        status: 'submitted',
        history: [{ action: 'created', toStatus: 'submitted', changedBy: new mongoose.Types.ObjectId(resident1Id) }]
      }).save();
      unitWingAIssueId = i1._id;

      // Issue 2: Unit in Wing B, Plumbing
      const i2 = await new Issue({
        society: new mongoose.Types.ObjectId(societyAId),
        submittingResident: new mongoose.Types.ObjectId(resident1Id),
        title: 'Wing B Toilet Flush Leak',
        description: 'Water running constantly in guest bathroom.',
        category: 'plumbing',
        location: { type: 'unit', blockOrWing: 'Wing B', flatOrUnit: '201' },
        status: 'submitted',
        history: [{ action: 'created', toStatus: 'submitted', changedBy: new mongoose.Types.ObjectId(resident1Id) }]
      }).save();
      unitWingBIssueId = i2._id;

      // Issue 3: Common Area, Plumbing
      const i3 = await new Issue({
        society: new mongoose.Types.ObjectId(societyAId),
        submittingResident: new mongoose.Types.ObjectId(resident1Id),
        title: 'Common Garden Sprinkler Broken',
        description: 'Main sprinkler head missing in central lawn.',
        category: 'plumbing',
        location: { type: 'common_area', areaDescription: 'Central Garden' },
        status: 'submitted',
        history: [{ action: 'created', toStatus: 'submitted', changedBy: new mongoose.Types.ObjectId(resident1Id) }]
      }).save();
      commonAreaIssueId = i3._id;
    });

    test('Suggestions for Wing A unit issue match universal and Wing A providers, strictly excluding Wing B and inactive providers', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${unitWingAIssueId}/provider-suggestions`, {
        headers: { Cookie: adminACookie }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.issueCategory, 'plumbing');

      const suggestedProviderIds = data.suggestions.map((s) => s.provider._id.toString());

      // MUST include universal plumber and Wing A plumber
      assert.ok(suggestedProviderIds.includes(universalPlumberId.toString()), 'Must include universal plumber');
      assert.ok(suggestedProviderIds.includes(wingAPlumberId.toString()), 'Must include Wing A specialist');

      // MUST NOT include Wing B specialist
      assert.ok(!suggestedProviderIds.includes(wingBPlumberId.toString()), 'Must NOT include Wing B specialist for Wing A issue');

      // MUST NOT include inactive plumber
      assert.ok(!suggestedProviderIds.includes(inactivePlumberId.toString()), 'Must NOT include inactive plumber');

      // MUST NOT include different category (electrical)
      assert.ok(!suggestedProviderIds.includes(universalElectricianId.toString()), 'Must NOT include electrical provider for plumbing issue');

      // Verify criteria match classification and disclaimer
      const firstSuggestion = data.suggestions[0];
      assert.strictEqual(firstSuggestion.recommendationLevel, 'criteria_match');
      assert.strictEqual(firstSuggestion.matchDetails.categoryMatched, true);
      assert.strictEqual(firstSuggestion.matchDetails.locationMatched, true);
      assert.match(firstSuggestion.disclaimer, /does not constitute an endorsement/i);
    });

    test('Suggestions for Wing B unit issue match universal and Wing B providers, strictly excluding Wing A', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${unitWingBIssueId}/provider-suggestions`, {
        headers: { Cookie: adminACookie }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();

      const suggestedProviderIds = data.suggestions.map((s) => s.provider._id.toString());
      assert.ok(suggestedProviderIds.includes(universalPlumberId.toString()));
      assert.ok(suggestedProviderIds.includes(wingBPlumberId.toString()), 'Must include Wing B specialist');
      assert.ok(!suggestedProviderIds.includes(wingAPlumberId.toString()), 'Must NOT include Wing A specialist');
    });

    test('Suggestions for Common Area issue match active plumbing providers', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${commonAreaIssueId}/provider-suggestions`, {
        headers: { Cookie: adminACookie }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const suggestedProviderIds = data.suggestions.map((s) => s.provider._id.toString());

      assert.ok(suggestedProviderIds.includes(universalPlumberId.toString()));
      assert.ok(!suggestedProviderIds.includes(inactivePlumberId.toString()), 'Inactive provider must never be suggested');
    });

    test('Provider suggestions via /providers/suggestions/:issueId endpoint works identically (Admin-only)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/suggestions/${unitWingAIssueId}`, {
        headers: { Cookie: adminACookie }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.issueId, unitWingAIssueId.toString());
    });

    test('Residents are strictly forbidden from viewing issue provider suggestions (403 Forbidden)', async () => {
      // 1. Through /issues/:issueId/provider-suggestions
      const res1 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${unitWingAIssueId}/provider-suggestions`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res1.status, 403);

      // 2. Through /providers/suggestions/:issueId
      const res2 = await fetch(`${baseUrl}/api/societies/${societyAId}/providers/suggestions/${unitWingAIssueId}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res2.status, 403);
    });

    test('CROSS-SOCIETY ISOLATION: Admin B cannot request suggestions for Society A issue (404 Not Found)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyBId}/issues/${unitWingAIssueId}/provider-suggestions`, {
        headers: { Cookie: adminBCookie }
      });
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.match(data.message, /not found in this society/i);
    });

    test('Unit issue with unspecified blockOrWing fails safely by excluding block-restricted providers', async () => {
      // Create issue with unit location but empty blockOrWing directly in MongoDB (bypassing pre-validate hook for simulation)
      const rawIssue = await Issue.collection.insertOne({
        society: new mongoose.Types.ObjectId(societyAId),
        submittingResident: new mongoose.Types.ObjectId(resident1Id),
        title: 'Unspecified Wing Plumbing Issue',
        description: 'Leak in unidentified wing.',
        category: 'plumbing',
        location: { type: 'unit', blockOrWing: '', flatOrUnit: '101' },
        status: 'submitted',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${rawIssue.insertedId}/provider-suggestions`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const suggestedProviderIds = data.suggestions.map((s) => s.provider._id.toString());

      // Universal provider matches
      assert.ok(suggestedProviderIds.includes(universalPlumberId.toString()), 'Universal provider should match');
      // Block-restricted providers MUST NOT match when block is unspecified
      assert.ok(!suggestedProviderIds.includes(wingAPlumberId.toString()), 'Wing A specialist must not match unspecified block');
      assert.ok(!suggestedProviderIds.includes(wingBPlumberId.toString()), 'Wing B specialist must not match unspecified block');
    });

    test('Issue with malformed or missing location details fails safely with zero suggestions', async () => {
      // Create issue with malformed location directly in MongoDB
      const rawIssue = await Issue.collection.insertOne({
        society: new mongoose.Types.ObjectId(societyAId),
        submittingResident: new mongoose.Types.ObjectId(resident1Id),
        title: 'Corrupted Location Plumbing Issue',
        description: 'Broken pipe with corrupted location metadata.',
        category: 'plumbing',
        location: { type: 'invalid_type_corrupted' },
        status: 'submitted',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${rawIssue.insertedId}/provider-suggestions`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.count, 0, 'Malformed location must fail safely without broadening results');
      assert.strictEqual(data.suggestions.length, 0);
    });
  });

  describe('Isolation and Separation from Application User Accounts', () => {
    test('Provider records cannot be authenticated as application users (401 Unauthorized)', async () => {
      // Create a provider
      const p = await Provider.findOne({ society: societyAId });
      assert.ok(p);

      // Attempt login with provider contactEmail
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: p.contactEmail || 'contact@quickfix.example.com',
          password: 'Password123!'
        })
      });

      // Provider records are NOT User records -> Login must fail with 401
      assert.strictEqual(loginRes.status, 401);
    });
  });
});
