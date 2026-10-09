import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceCommand } from '../src/modules/voice/commandParser.js';
import { TurnManager } from '../src/modules/voice/turnManager.js';
import { SessionController } from '../src/modules/voice/sessionController.js';

test('Latency & Throughput Benchmark - 20 runs report', async () => {
  const runs = 20;
  const commandParserTimes = [];
  const stateTransitionTimes = [];
  const sessionPersistenceTimes = [];

  const turnManager = new TurnManager();
  const testPhrases = [
    'stop',
    'continue',
    'repeat that',
    'clear chat',
    'Explain the theory of general relativity and how mass bends space time',
    'mute audio',
    'Can you tell me about the James Webb Space Telescope?',
    'resume please',
    'halt',
    'How do black holes collide?',
  ];

  for (let i = 0; i < runs; i++) {
    const sessionId = `benchmark_session_${i}`;
    await SessionController.getOrCreateSession(sessionId);

    // 1. Command Parser latency
    const phrase = testPhrases[i % testPhrases.length];
    const t0 = performance.now();
    parseVoiceCommand(phrase);
    const t1 = performance.now();
    commandParserTimes.push(t1 - t0);

    // 2. Interruption state transition latency
    const t2 = performance.now();
    await turnManager.handleInterrupt({
      sessionId,
      turnId: `bench_turn_${i}`,
      sendEvent: () => {},
    });
    const t3 = performance.now();
    stateTransitionTimes.push(t3 - t2);

    // 3. Session persistence roundtrip latency
    const t4 = performance.now();
    await SessionController.saveUserMessage(sessionId, `bench_turn_${i}`, 'Benchmark prompt');
    await SessionController.saveAssistantMessage(sessionId, `bench_turn_${i}`, 'Benchmark answer', 'completed', 0);
    const t5 = performance.now();
    sessionPersistenceTimes.push(t5 - t4);
  }

  const calcStats = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const avg = sum / sorted.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    return { avg, p50, p95, min, max };
  };

  const cmdStats = calcStats(commandParserTimes);
  const stateStats = calcStats(stateTransitionTimes);
  const dbStats = calcStats(sessionPersistenceTimes);

  console.log('\n================ 20-RUN LATENCY BENCHMARK REPORT ================');
  console.log(`Command Parser:    p50 = ${cmdStats.p50.toFixed(3)}ms | p95 = ${cmdStats.p95.toFixed(3)}ms | avg = ${cmdStats.avg.toFixed(3)}ms`);
  console.log(`Barge-In Handshake: p50 = ${stateStats.p50.toFixed(3)}ms | p95 = ${stateStats.p95.toFixed(3)}ms | avg = ${stateStats.avg.toFixed(3)}ms (Target ≤ 250ms)`);
  console.log(`Session History:   p50 = ${dbStats.p50.toFixed(3)}ms | p95 = ${dbStats.p95.toFixed(3)}ms | avg = ${dbStats.avg.toFixed(3)}ms`);
  console.log('===================================================================\n');

  assert.ok(stateStats.p95 < 250, 'Barge-In interruption state transition must be ≤ 250ms p95');
});
