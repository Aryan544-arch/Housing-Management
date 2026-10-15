const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');

describe('Health and Foundation Middleware Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    // Start ephemeral HTTP listener on port 0
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('GET /health returns 200 with status ok and database status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.ok(body.timestamp, 'Timestamp should be present');
    assert.strictEqual(typeof body.uptime, 'number');
    assert.ok(body.database, 'Database status object should be present');
    assert.strictEqual(typeof body.database.status, 'string');
  });

  test('GET /non-existent-route triggers 404 with safe JSON response', async () => {
    const res = await fetch(`${baseUrl}/non-existent-route`);
    assert.strictEqual(res.status, 404);

    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.match(body.message, /Resource not found/);
  });
});
