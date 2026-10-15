const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { connectDB, disconnectDB } = require('../config/db');

describe('Database Connection Behavior', () => {
  test('connects to valid local MongoDB successfully', async () => {
    const conn = await connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/housing_management_test');
    assert.ok(conn, 'Mongoose connection should be established');
    assert.strictEqual(conn.connection.readyState, 1, 'Mongoose readyState should be 1 (connected)');
    await disconnectDB();
  });

  test('fails and throws error when MONGODB_URI is invalid', async () => {
    // Port 27999 where nothing is running, with a short timeout
    const invalidUri = 'mongodb://127.0.0.1:27999/invalid_db?serverSelectionTimeoutMS=1000';
    await assert.rejects(
      async () => {
        await connectDB(invalidUri);
      },
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      },
      'Should throw connection error when MongoDB is unreachable'
    );
    await disconnectDB();
  });
});
