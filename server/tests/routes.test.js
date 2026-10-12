import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { app } from '../server.js';
import { SessionController } from '../src/modules/voice/sessionController.js';

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('REST API - /health endpoint', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();

  const response = await fetch(`http://localhost:${port}/health`);
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.status, 'ok');
  assert.ok(data.services);
  assert.equal(typeof data.services.mongo, 'string');
});

test('REST API - /api/sessions/:id retrieval and deletion', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();

  const sessionId = 'session_test_api_' + Date.now();

  // 1. Fresh session initializes with 200 OK and empty messages array
  const resInit = await fetch(`http://localhost:${port}/api/sessions/${sessionId}`);
  assert.equal(resInit.status, 200);
  const dataInit = await resInit.json();
  assert.equal(dataInit.id, sessionId);
  assert.deepEqual(dataInit.messages, []);

  // 2. Populate session
  await SessionController.getOrCreateSession(sessionId);
  await SessionController.saveUserMessage(sessionId, 'turn_1', 'Hello test');

  // 3. Known session returns 200 with messages
  const res200 = await fetch(`http://localhost:${port}/api/sessions/${sessionId}`);
  assert.equal(res200.status, 200);
  const data200 = await res200.json();
  assert.equal(data200.id, sessionId);
  assert.equal(data200.messages.length, 1);
  assert.equal(data200.messages[0].text, 'Hello test');

  // 4. DELETE /api/sessions/:id clears messages
  const delRes = await fetch(`http://localhost:${port}/api/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  assert.equal(delRes.status, 200);

  const resAfterDel = await fetch(`http://localhost:${port}/api/sessions/${sessionId}`);
  assert.equal(resAfterDel.status, 200);
  const dataAfterDel = await resAfterDel.json();
  assert.equal(dataAfterDel.messages.length, 0);
});

test('REST API - /api/transcriptions validates empty or missing file', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address();

  // POST without body
  const resMissing = await fetch(`http://localhost:${port}/api/transcriptions`, {
    method: 'POST',
  });
  assert.equal(resMissing.status, 400);

  const errorData = await resMissing.json();
  assert.ok(errorData.error);
});
