const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { app, connectDB, disconnectDB } = require('../server');
const User = require('../models/User');
const Society = require('../models/Society');
const SocietyMembership = require('../models/SocietyMembership');
const { Issue } = require('../models/Issue');
const {
  getStorageDir,
  getEvidenceFilePath
} = require('../services/evidence/evidenceStorageService');

describe('Phase 8 — Secure Private Evidence Uploads Tests', () => {
  let server;
  let baseUrl;
  const testDbUri = 'mongodb://127.0.0.1:27017/housing_management_evidence_test';

  let adminACookie;
  let resident1Cookie;
  let resident2Cookie;
  let adminBCookie;
  let residentBCookie;

  let societyAId;
  let societyBId;

  let resident1Id;
  let resident2Id;
  let adminAId;

  let privateUnitIssueId;
  let commonAreaIssueId;
  let cancelledIssueId;
  let verifiedClosedIssueId;
  let societyBIssueId;

  // Helper buffers
  const validJpegBuffer = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43
  ]);

  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
  ]);

  const validWebpBuffer = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x14, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
    Buffer.from('VP8 '),
    Buffer.from([0x08, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00])
  ]);

  const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

  const spoofedHtmlAsJpegBuffer = Buffer.from('<html><body><script>alert("XSS")</script></body></html>');

  const validWebpLosslessBuffer = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x14, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
    Buffer.from('VP8L'),
    Buffer.from([0x08, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
  ]);

  const malformedJpegMarkerBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0x00, 0x12, 0x34]);

  const malformedWebpChunkBuffer = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x14, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
    Buffer.from('FAIL'),
    Buffer.from([0x08, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00])
  ]);

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

    // Clean up test upload files from previous runs
    const storageDir = getStorageDir();
    if (fs.existsSync(storageDir)) {
      const existingFiles = fs.readdirSync(storageDir);
      for (const file of existingFiles) {
        fs.unlinkSync(path.join(storageDir, file));
      }
    }

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 1. Setup Admin A & Society A
    const adminARes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Alice',
        email: 'admin.alice@evidence-society-a.com',
        password: 'Password123!',
        phone: '+919876543201'
      })
    });
    adminACookie = extractCookie(adminARes);
    let csrfToken = extractRawCsrf(adminACookie);
    const adminAData = await adminARes.json();
    adminAId = adminAData.user._id;

    const socARes = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminACookie,
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({
        name: 'Society Alpha Evidence',
        code: 'EVID-A-01'
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
        email: 'resident1@evidence-society-a.com',
        password: 'Password123!',
        phone: '+919876543202'
      })
    });
    resident1Cookie = extractCookie(res1Res);
    const res1Data = await res1Res.json();
    resident1Id = res1Data.user._id;

    await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminACookie,
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({
        email: 'resident1@evidence-society-a.com',
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
        email: 'resident2@evidence-society-a.com',
        password: 'Password123!',
        phone: '+919876543203'
      })
    });
    resident2Cookie = extractCookie(res2Res);
    const res2Data = await res2Res.json();
    resident2Id = res2Data.user._id;

    await fetch(`${baseUrl}/api/societies/${societyAId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminACookie,
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({
        email: 'resident2@evidence-society-a.com',
        role: 'resident',
        flatNumber: 'A-102'
      })
    });

    // 4. Setup Admin B & Society B
    const adminBRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Bob',
        email: 'admin.bob@evidence-society-b.com',
        password: 'Password123!',
        phone: '+919876543204'
      })
    });
    adminBCookie = extractCookie(adminBRes);
    const csrfB = extractRawCsrf(adminBCookie);

    const socBRes = await fetch(`${baseUrl}/api/societies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminBCookie,
        'x-csrf-token': csrfB
      },
      body: JSON.stringify({
        name: 'Society Beta Evidence',
        code: 'EVID-B-01'
      })
    });
    const socBData = await socBRes.json();
    societyBId = socBData.society._id;

    // 5. Setup Resident B in Society B
    const resBRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Resident Bobbie',
        email: 'resident.bobbie@evidence-society-b.com',
        password: 'Password123!',
        phone: '+919876543205'
      })
    });
    residentBCookie = extractCookie(resBRes);
    const resBData = await resBRes.json();

    await fetch(`${baseUrl}/api/societies/${societyBId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminBCookie,
        'x-csrf-token': csrfB
      },
      body: JSON.stringify({
        email: 'resident.bobbie@evidence-society-b.com',
        role: 'resident',
        flatNumber: 'B-201'
      })
    });

    // 6. Create test issues in Society A
    const res1Csrf = extractRawCsrf(resident1Cookie);

    // Private unit issue (Resident 1)
    const unitIssueRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: resident1Cookie,
        'x-csrf-token': res1Csrf
      },
      body: JSON.stringify({
        title: 'Master Bedroom Ceiling Leak',
        description: 'Persistent water seepage causing paint to peel.',
        category: 'plumbing',
        location: {
          type: 'unit',
          blockOrWing: 'Block A',
          flatOrUnit: 'A-101'
        },
        priority: 'high'
      })
    });
    const unitIssueData = await unitIssueRes.json();
    privateUnitIssueId = unitIssueData.issue._id;

    // Common area issue (Resident 1)
    const commIssueRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: resident1Cookie,
        'x-csrf-token': res1Csrf
      },
      body: JSON.stringify({
        title: 'Clubhouse Window Cracked',
        description: 'Large crack observed on the west facade window.',
        category: 'structural',
        location: {
          type: 'common_area',
          areaDescription: 'Clubhouse West Wing'
        },
        priority: 'normal'
      })
    });
    const commIssueData = await commIssueRes.json();
    commonAreaIssueId = commIssueData.issue._id;

    // Cancelled issue
    const cancIssue = new Issue({
      society: societyAId,
      submittingResident: resident1Id,
      title: 'Old Cancelled Issue For Evidence Testing',
      description: 'This issue was cancelled before work started.',
      category: 'electrical',
      location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
      status: 'cancelled',
      history: [{ action: 'created', changedBy: resident1Id }]
    });
    await cancIssue.save();
    cancelledIssueId = cancIssue._id.toString();

    // Verified closed issue
    const closedIssue = new Issue({
      society: societyAId,
      submittingResident: resident1Id,
      title: 'Verified Closed Issue For Evidence Testing',
      description: 'This issue was successfully closed.',
      category: 'carpentry',
      location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
      status: 'verified_closed',
      history: [{ action: 'created', changedBy: resident1Id }]
    });
    await closedIssue.save();
    verifiedClosedIssueId = closedIssue._id.toString();

    // Issue in Society B
    const socBIssue = new Issue({
      society: societyBId,
      submittingResident: resBData.user._id,
      title: 'Society B Elevator Fault',
      description: 'Elevator stops between floors.',
      category: 'elevator',
      location: { type: 'common_area', areaDescription: 'Tower 1 Lift' },
      status: 'in_progress',
      history: [{ action: 'created', changedBy: resBData.user._id }]
    });
    await socBIssue.save();
    societyBIssueId = socBIssue._id.toString();
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await disconnectDB();

    // Clean up test files
    const storageDir = getStorageDir();
    if (fs.existsSync(storageDir)) {
      const files = fs.readdirSync(storageDir);
      for (const file of files) {
        fs.unlinkSync(path.join(storageDir, file));
      }
    }
  });

  describe('1. Authentication and Society Isolation', () => {
    test('Unauthenticated upload request is rejected (401 Unauthorized)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'test.jpg');

      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        body: formData
      });
      assert.strictEqual(res.status, 401);
    });

    test('Unauthenticated download request is rejected (401 Unauthorized)', async () => {
      const fakeEvidenceId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence/${fakeEvidenceId}`);
      assert.strictEqual(res.status, 401);
    });

    test('CROSS-SOCIETY: Admin B cannot upload evidence to Society A issue (404 or 403)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'test.jpg');

      const csrf = extractRawCsrf(adminBCookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: adminBCookie,
          'x-csrf-token': csrf
        },
        body: formData
      });
      // Admin B is not a member of Society A -> 403 Forbidden
      assert.strictEqual(res.status, 403);
    });

    test('CROSS-SOCIETY: Resident B cannot upload evidence to Society A issue (403 Forbidden)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'test.jpg');

      const csrf = extractRawCsrf(residentBCookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: residentBCookie,
          'x-csrf-token': csrf
        },
        body: formData
      });
      assert.strictEqual(res.status, 403);
    });

    test('CROSS-SOCIETY: Admin B cannot download evidence from Society A issue (403 Forbidden)', async () => {
      const fakeEvidenceId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence/${fakeEvidenceId}`, {
        headers: { Cookie: adminBCookie }
      });
      assert.strictEqual(res.status, 403);
    });

    test('CROSS-SOCIETY: Resident B cannot download evidence from Society A issue (403 Forbidden)', async () => {
      const fakeEvidenceId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence/${fakeEvidenceId}`, {
        headers: { Cookie: residentBCookie }
      });
      assert.strictEqual(res.status, 403);
    });
  });

  describe('2. Resident vs Admin Permissions & Unit Privacy', () => {
    let uploadedEvidenceId;

    test('Resident 1 successfully uploads valid JPEG evidence to their unit issue (201 Created)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'ceiling_crack.jpg');
      formData.append('caption', 'Severe crack near window sill');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.evidence._id);
      assert.strictEqual(data.evidence.caption, 'Severe crack near window sill');
      assert.strictEqual(data.evidence.originalFilename, 'ceiling_crack.jpg');
      assert.strictEqual(data.evidence.mimeType, 'image/jpeg');
      assert.strictEqual(data.evidence.isInternal, false);
      assert.strictEqual(data.evidence.sizeBytes, validJpegBuffer.length);
      assert.ok(data.evidence.referenceUrl.includes(`/issues/${privateUnitIssueId}/evidence/${data.evidence._id}`));

      // Stored filename must NEVER be exposed in the response
      assert.strictEqual(data.evidence.storedFilename, undefined);
      assert.strictEqual(data.issue.evidence[0].storedFilename, undefined);

      uploadedEvidenceId = data.evidence._id;
    });

    test('Resident 1 successfully downloads their uploaded evidence (200 OK & binary match)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence/${uploadedEvidenceId}`, {
        headers: { Cookie: resident1Cookie }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'image/jpeg');
      const arrayBuffer = await res.arrayBuffer();
      const downloadedBuffer = Buffer.from(arrayBuffer);
      assert.deepStrictEqual(downloadedBuffer, validJpegBuffer);
    });

    test('Resident 2 CANNOT download evidence from Resident 1 private unit issue (404 Not Found)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence/${uploadedEvidenceId}`, {
        headers: { Cookie: resident2Cookie }
      });
      // Uniformly returns 404 to avoid private unit issue enumeration
      assert.strictEqual(res.status, 404);
    });

    test('Resident 2 CANNOT upload evidence to Resident 1 private unit issue (404 Not Found)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'malicious.jpg');

      const csrf = extractRawCsrf(resident2Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident2Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });
      assert.strictEqual(res.status, 404);
    });

    test('STRICT RULE: Resident upload attempting isInternal=true is rejected (403 Forbidden)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'resident_secret.jpg');
      formData.append('isInternal', 'true');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Residents cannot create or upload internal evidence/i);
    });

    test('STRICT RULE: Resident cannot upload repair completion evidence (403 Forbidden)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'completion_attempt.jpg');
      formData.append('context', 'repair_completion');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.message, /Only administrators may attach repair completion evidence/i);
    });
  });

  describe('3. Internal Evidence Redaction and Access Control', () => {
    let internalEvidenceId;

    test('Admin uploads internal evidence to unit issue (201 Created)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'contractor_quote_evidence.jpg');
      formData.append('caption', 'Internal inspection photo with plumber notes');
      formData.append('isInternal', 'true');

      const csrf = extractRawCsrf(adminACookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: adminACookie,
          'x-csrf-token': csrf
        },
        body: formData
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.evidence.isInternal, true);
      internalEvidenceId = data.evidence._id;
    });

    test('Admin successfully downloads internal evidence (200 OK)', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence/${internalEvidenceId}`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'image/jpeg');
    });

    test('Resident 1 (submitter) CANNOT see internal evidence in issue details JSON response', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const issue = data.issue;

      // Internal evidence must be completely filtered out
      assert.ok(issue.evidence, 'Issue evidence array should exist');
      const hasInternal = issue.evidence.some((e) => e._id === internalEvidenceId || e.isInternal);
      assert.strictEqual(hasInternal, false, 'Internal evidence must not be visible to resident');
    });

    test('Resident 1 (submitter) receives 404 Not Found when attempting direct download of internal evidence ID', async () => {
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence/${internalEvidenceId}`, {
        headers: { Cookie: resident1Cookie }
      });
      // Uniform 404 to leak zero information about existence of internal evidence
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.message, 'Evidence not found.');
    });

    test('Active Resident 2 can upload and download public evidence on a common_area issue (201 Created & 200 OK)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validPngBuffer], { type: 'image/png' }), 'clubhouse_photo.png');
      formData.append('caption', 'Damage photo from courtyard angle');

      const csrf = extractRawCsrf(resident2Cookie);
      const uploadRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${commonAreaIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident2Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });

      assert.strictEqual(uploadRes.status, 201);
      const uploadData = await uploadRes.json();
      const evId = uploadData.evidence._id;

      // Resident 1 (submitter) can also download this evidence
      const downloadRes1 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${commonAreaIssueId}/evidence/${evId}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(downloadRes1.status, 200);

      // Resident 2 (non-submitter member) can also download this common-area evidence
      const downloadRes2 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${commonAreaIssueId}/evidence/${evId}`, {
        headers: { Cookie: resident2Cookie }
      });
      assert.strictEqual(downloadRes2.status, 200);
      assert.strictEqual(downloadRes2.headers.get('content-type'), 'image/png');
    });
  });

  describe('4. File Validation, Signatures, and Security Defense', () => {
    test('Rejects oversized file exceeding 5 MiB (400 Bad Request)', async () => {
      const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024);
      oversizedBuffer[0] = 0xFF;
      oversizedBuffer[1] = 0xD8;
      oversizedBuffer[2] = 0xFF;

      const formData = new FormData();
      formData.append('file', new Blob([oversizedBuffer], { type: 'image/jpeg' }), 'huge.jpg');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /File too large/i);
    });

    test('Rejects dangerous and prohibited file extensions (.exe, .html, .svg, .js) (400 Bad Request)', async () => {
      const extensions = ['malware.exe', 'index.html', 'vector.svg', 'payload.js', 'script.sh'];
      const csrf = extractRawCsrf(resident1Cookie);

      for (const filename of extensions) {
        const formData = new FormData();
        formData.append('file', new Blob([Buffer.from('not allowed')], { type: 'application/octet-stream' }), filename);

        const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
          method: 'POST',
          headers: {
            Cookie: resident1Cookie,
            'x-csrf-token': csrf
          },
          body: formData
        });

        assert.strictEqual(res.status, 400, `Extension ${filename} must be rejected`);
      }
    });

    test('MAGIC-BYTE DEFENSE: Rejects spoofed MIME type when file signature does not match (400 Bad Request)', async () => {
      // HTML payload named fake.jpg with claimed image/jpeg MIME type
      const formData = new FormData();
      formData.append('file', new Blob([spoofedHtmlAsJpegBuffer], { type: 'image/jpeg' }), 'fake.jpg');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /File content does not match the expected file signature/i);
    });

    test('Allows valid WebP and PDF evidence uploads (201 Created)', async () => {
      const csrf = extractRawCsrf(resident1Cookie);

      // WebP
      const webpForm = new FormData();
      webpForm.append('file', new Blob([validWebpBuffer], { type: 'image/webp' }), 'photo.webp');
      const webpRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: { Cookie: resident1Cookie, 'x-csrf-token': csrf },
        body: webpForm
      });
      assert.strictEqual(webpRes.status, 201);

      // PDF
      const pdfForm = new FormData();
      pdfForm.append('file', new Blob([validPdfBuffer], { type: 'application/pdf' }), 'invoice.pdf');
      const pdfRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: { Cookie: resident1Cookie, 'x-csrf-token': csrf },
        body: pdfForm
      });
      assert.strictEqual(pdfRes.status, 201);
    });

    test('Path traversal sequences in filename are sanitized and cannot escape private directory', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), '../../../../etc/passwd.jpg');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(!data.evidence.originalFilename.includes('..'));
      assert.ok(!data.evidence.originalFilename.includes('/'));
      assert.ok(!data.evidence.originalFilename.includes('\\'));
    });

    test('Rejects request without a file (400 Bad Request)', async () => {
      const formData = new FormData();
      formData.append('caption', 'Missing file completely');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });
      assert.strictEqual(res.status, 400);
    });

    test('SIGNATURE HARDENING: Rejects malformed JPEG with invalid SOI marker prefix (400 Bad Request)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([malformedJpegMarkerBuffer], { type: 'image/jpeg' }), 'bad_marker.jpg');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: { Cookie: resident1Cookie, 'x-csrf-token': csrf },
        body: formData
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /File content does not match the expected file signature/i);
    });

    test('SIGNATURE HARDENING: Rejects malformed WebP missing recognized VP8 chunk identifier (400 Bad Request)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([malformedWebpChunkBuffer], { type: 'image/webp' }), 'bad_chunk.webp');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: { Cookie: resident1Cookie, 'x-csrf-token': csrf },
        body: formData
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /File content does not match the expected file signature/i);
    });

    test('Allows valid lossless WebP (VP8L) evidence uploads (201 Created)', async () => {
      const csrf = extractRawCsrf(resident1Cookie);
      const webpForm = new FormData();
      webpForm.append('file', new Blob([validWebpLosslessBuffer], { type: 'image/webp' }), 'photo_lossless.webp');
      const webpRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: { Cookie: resident1Cookie, 'x-csrf-token': csrf },
        body: webpForm
      });
      assert.strictEqual(webpRes.status, 201);
    });

    test('RESOURCE LIMIT: Rejects upload with excessive form fields exceeding limit (400 Bad Request)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'fields_test.jpg');
      for (let i = 0; i < 12; i++) {
        formData.append(`extra_field_${i}`, `value_${i}`);
      }

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: { Cookie: resident1Cookie, 'x-csrf-token': csrf },
        body: formData
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /Too many form fields/i);
    });

    test('RESOURCE LIMIT: Rejects upload with oversized field value exceeding 10 KiB (400 Bad Request)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'oversized_field.jpg');
      formData.append('caption', 'A'.repeat(12 * 1024));

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: { Cookie: resident1Cookie, 'x-csrf-token': csrf },
        body: formData
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /Form field value too large/i);
    });

    test('RESOURCE LIMIT: Rejects upload with unexpected file field name (400 Bad Request)', async () => {
      const formData = new FormData();
      formData.append('wrong_file_field', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'test.jpg');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: { Cookie: resident1Cookie, 'x-csrf-token': csrf },
        body: formData
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /Unexpected file field/i);
    });

    test('FORGED METADATA DEFENSE: Client cannot inject storedFilename through completionDetails API (400 Bad Request)', async () => {
      const inProgIssue = new Issue({
        society: societyAId,
        submittingResident: resident1Id,
        title: 'Issue For Forged Metadata Test',
        description: 'Verifying client cannot supply storedFilename in completionDetails.',
        category: 'electrical',
        location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
        status: 'in_progress',
        history: [{ action: 'created', changedBy: resident1Id }]
      });
      await inProgIssue.save();

      const csrf = extractRawCsrf(adminACookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${inProgIssue._id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminACookie,
          'x-csrf-token': csrf
        },
        body: JSON.stringify({
          toStatus: 'completion_submitted',
          completionDetails: {
            workSummary: 'Attempting to inject unverified storedFilename metadata',
            evidence: [
              {
                caption: 'Forged invoice',
                storedFilename: 'forged_private_file.jpg',
                referenceUrl: 'https://evil.com/fake.jpg'
              }
            ]
          }
        })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Invalid field\(s\) in evidence item.*storedFilename/i);

      // Verify the issue in database was not updated with the forged field
      const fetchedIssue = await Issue.findById(inProgIssue._id);
      assert.strictEqual(fetchedIssue.status, 'in_progress');
      assert.strictEqual(fetchedIssue.completionDetails, undefined);
    });
  });

  describe('5. Defensive Streaming Security Headers', () => {
    test('Download responses strictly set nosniff, CSP default-src none, and private cache-control', async () => {
      // Create a test evidence item
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'header_test.jpg');
      const csrf = extractRawCsrf(resident1Cookie);

      const upRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: { Cookie: resident1Cookie, 'x-csrf-token': csrf },
        body: formData
      });
      const upData = await upRes.json();
      const evId = upData.evidence._id;

      const dlRes = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence/${evId}`, {
        headers: { Cookie: resident1Cookie }
      });

      assert.strictEqual(dlRes.status, 200);
      assert.strictEqual(dlRes.headers.get('x-content-type-options'), 'nosniff');
      assert.strictEqual(dlRes.headers.get('content-security-policy'), "default-src 'none'");
      assert.match(dlRes.headers.get('cache-control'), /private/);
      assert.match(dlRes.headers.get('cache-control'), /no-store/);
      assert.match(dlRes.headers.get('content-disposition'), /inline; filename=/);
    });
  });

  describe('6. State Machine, Concurrency, and Cleanup', () => {
    test('Cannot upload evidence to a cancelled issue (400 Bad Request)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'fail.jpg');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${cancelledIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /Cannot add evidence to a cancelled issue/i);
    });

    test('Resident cannot upload evidence to a verified_closed issue (400 Bad Request)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'fail.jpg');

      const csrf = extractRawCsrf(resident1Cookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${verifiedClosedIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: resident1Cookie,
          'x-csrf-token': csrf
        },
        body: formData
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.match(data.message, /Cannot add evidence to a closed issue/i);
    });

    test('Admin uploads repair_completion context evidence (201 Created)', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validPngBuffer], { type: 'image/png' }), 'completion_proof.png');
      formData.append('caption', 'Completed repair verification photo');
      formData.append('context', 'repair_completion');

      const csrf = extractRawCsrf(adminACookie);
      const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
        method: 'POST',
        headers: {
          Cookie: adminACookie,
          'x-csrf-token': csrf
        },
        body: formData
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.issue.completionDetails.evidence);
      assert.ok(data.issue.completionDetails.evidence.length >= 1);
    });

    test('CLEANUP DEFENSE: If issue save encounters OCC conflict, newly stored file is deleted from disk', async () => {
      const originalSave = Issue.prototype.save;
      let conflictSimulated = false;

      Issue.prototype.save = async function (...args) {
        if (!conflictSimulated && this._id.toString() === privateUnitIssueId.toString()) {
          conflictSimulated = true;
          const versionErr = new mongoose.Error.VersionError(this, this.__v, ['evidence']);
          throw versionErr;
        }
        return originalSave.apply(this, args);
      };

      try {
        const storageDir = getStorageDir();
        const filesBefore = fs.readdirSync(storageDir);

        const formData = new FormData();
        formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'occ_test.jpg');

        const csrf = extractRawCsrf(resident1Cookie);
        const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
          method: 'POST',
          headers: {
            Cookie: resident1Cookie,
            'x-csrf-token': csrf
          },
          body: formData
        });

        // OCC conflict must trigger 409 Conflict
        assert.strictEqual(res.status, 409);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        assert.match(data.message, /Conflict/i);

        // Verify that no orphan file remained from this failed attempt
        const filesAfter = fs.readdirSync(storageDir);
        assert.strictEqual(filesAfter.length, filesBefore.length, 'No orphan file must remain after OCC failure');
      } finally {
        Issue.prototype.save = originalSave;
      }
    });

    test('CLEANUP DEFENSE: Generic database save failure unlinks the newly stored file from disk (500 error)', async () => {
      const originalSave = Issue.prototype.save;
      let failureSimulated = false;

      Issue.prototype.save = async function (...args) {
        if (!failureSimulated && this._id.toString() === privateUnitIssueId.toString()) {
          failureSimulated = true;
          throw new Error('Simulated generic database connection drop during issue.save');
        }
        return originalSave.apply(this, args);
      };

      try {
        const storageDir = getStorageDir();
        const filesBefore = fs.readdirSync(storageDir);

        const formData = new FormData();
        formData.append('file', new Blob([validJpegBuffer], { type: 'image/jpeg' }), 'generic_db_fail.jpg');

        const csrf = extractRawCsrf(resident1Cookie);
        const res = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${privateUnitIssueId}/evidence`, {
          method: 'POST',
          headers: {
            Cookie: resident1Cookie,
            'x-csrf-token': csrf
          },
          body: formData
        });

        // Generic error triggers 500 Internal Server Error
        assert.strictEqual(res.status, 500);

        // Verify that no orphan file remained from this failed attempt and existing files are untouched
        const filesAfter = fs.readdirSync(storageDir);
        assert.strictEqual(filesAfter.length, filesBefore.length, 'No orphan file must remain after generic save failure');
      } finally {
        Issue.prototype.save = originalSave;
      }
    });
  });

  describe('7. Backward Compatibility with Existing Evidence Metadata', () => {
    test('Existing issues with legacy external URL completionDetails.evidence are preserved and readable', async () => {
      const legacyIssue = new Issue({
        society: societyAId,
        submittingResident: resident1Id,
        title: 'Legacy Issue With External Evidence URLs',
        description: 'Testing backward compatibility of external evidence items.',
        category: 'electrical',
        location: { type: 'unit', blockOrWing: 'A', flatOrUnit: '101' },
        status: 'completion_submitted',
        completionDetails: {
          workSummary: 'Replaced electrical panel breakers',
          evidence: [
            {
              caption: 'External receipt scan',
              referenceUrl: 'https://external-storage.example.com/receipt-123.jpg',
              isInternal: false,
              uploadedAt: new Date()
            },
            {
              caption: 'Internal contractor schematic',
              referenceUrl: 'https://internal-docs.example.com/schematic-secret.pdf',
              isInternal: true,
              uploadedAt: new Date()
            }
          ]
        },
        history: [{ action: 'created', changedBy: resident1Id }]
      });
      await legacyIssue.save();

      // Resident viewing legacy issue gets public evidence, internal evidence redacted
      const res1 = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${legacyIssue._id}`, {
        headers: { Cookie: resident1Cookie }
      });
      assert.strictEqual(res1.status, 200);
      const data1 = await res1.json();
      assert.strictEqual(data1.issue.completionDetails.evidence.length, 1);
      assert.strictEqual(data1.issue.completionDetails.evidence[0].caption, 'External receipt scan');

      // Admin viewing legacy issue sees both items
      const resAdmin = await fetch(`${baseUrl}/api/societies/${societyAId}/issues/${legacyIssue._id}`, {
        headers: { Cookie: adminACookie }
      });
      assert.strictEqual(resAdmin.status, 200);
      const dataAdmin = await resAdmin.json();
      assert.strictEqual(dataAdmin.issue.completionDetails.evidence.length, 2);
    });
  });
});
