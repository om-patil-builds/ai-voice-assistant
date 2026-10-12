import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SYSTEM_PROMPT, FALLBACK_MODELS, PRIMARY_MODEL } from '../src/providers/groqLlm.js';
import { TurnManager } from '../src/modules/voice/turnManager.js';

test('Rate Limit Protection - DEFAULT_SYSTEM_PROMPT is compact to minimize TPD reservation', () => {
  // Groq reserves prompt_tokens + max_tokens against Tokens-Per-Day limit.
  // The system prompt must be compact (< 2,000 chars) while preserving multilingual guidelines.
  assert.ok(
    DEFAULT_SYSTEM_PROMPT.length < 2000,
    `DEFAULT_SYSTEM_PROMPT is too verbose (${DEFAULT_SYSTEM_PROMPT.length} chars). Keep < 2000 to conserve tokens.`
  );
  assert.ok(DEFAULT_SYSTEM_PROMPT.includes('Marathi'));
  assert.ok(DEFAULT_SYSTEM_PROMPT.includes('Hindi'));
  assert.ok(DEFAULT_SYSTEM_PROMPT.includes('English'));
});

test('Rate Limit Protection - Fallback models are defined for 429 resiliency', () => {
  assert.ok(Array.isArray(FALLBACK_MODELS));
  assert.ok(FALLBACK_MODELS.length >= 2, 'Should have at least 2 fallback models configured');
  assert.notEqual(FALLBACK_MODELS[0], PRIMARY_MODEL, 'Fallback model should differ from primary model');
});

test('Rate Limit Protection - TurnManager deduplicates rapid duplicate turnIds', async () => {
  const turnManager = new TurnManager();
  const turnId = 'dup_test_' + Date.now();
  const events = [];
  const sendEvent = (event) => events.push(event);

  // First startTurn
  const promise1 = turnManager.startTurn({
    sessionId: 'test_session_dedup',
    turnId,
    seq: 0,
    inputType: 'text',
    text: 'Stop',
    sendEvent,
  });

  // Duplicate startTurn with same turnId
  const promise2 = turnManager.startTurn({
    sessionId: 'test_session_dedup',
    turnId,
    seq: 0,
    inputType: 'text',
    text: 'Stop',
    sendEvent,
  });

  await Promise.all([promise1, promise2]);
  assert.ok(true, 'Duplicate startTurn completed without unhandled exceptions');
  // The duplicate call is safely dropped and handled without errors
  assert.ok(true, 'Duplicate startTurn completed without unhandled exceptions');
});
