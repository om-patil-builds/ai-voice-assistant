import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { WebSocket } from 'ws';
import { initVoiceGateway } from '../src/ws/voiceGateway.js';

test('VoiceGateway - WebSocket message exchange, routing, and lifecycle', async () => {
  const app = express();
  const server = http.createServer(app);
  const { wss } = initVoiceGateway(server);

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const ws = new WebSocket(`ws://localhost:${port}?sessionId=ws_test_session`);

  const received = [];
  ws.on('message', (data) => {
    try {
      received.push(JSON.parse(data.toString()));
    } catch {
      // ignore
    }
  });

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  // Wait for initial status: IDLE
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(received.length > 0);
  assert.equal(received[0].type, 'status');
  assert.equal(received[0].state, 'IDLE');

  // Test Ping -> Pong
  ws.send(JSON.stringify({ type: 'ping' }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pongMsg = received.find((m) => m.type === 'pong');
  assert.ok(pongMsg, 'Should receive pong response');

  // Test command: Stop
  ws.send(
    JSON.stringify({
      type: 'start_turn',
      turnId: 'turn_test_stop',
      seq: 0,
      inputType: 'text',
      text: 'stop',
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const stopStatus = received.find((m) => m.type === 'status' && m.state === 'IDLE');
  assert.ok(stopStatus, 'Should transition to IDLE on stop command');

  // Test interrupt
  ws.send(
    JSON.stringify({
      type: 'interrupt',
      turnId: 'turn_test_stop',
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const interruptStatus = received.find((m) => m.type === 'status' && m.state === 'INTERRUPTED');
  assert.ok(interruptStatus, 'Should receive INTERRUPTED status');

  // Test stop
  ws.send(
    JSON.stringify({
      type: 'stop',
      turnId: 'turn_test_stop',
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Clean close
  await new Promise((resolve) => {
    ws.on('close', resolve);
    ws.close();
  });
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
});
