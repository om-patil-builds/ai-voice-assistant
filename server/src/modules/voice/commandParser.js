/**
 * CommandParser identifies standalone voice control commands.
 * Distinguishes commands from ordinary queries containing command words.
 */

export const COMMANDS = {
  STOP: 'STOP',
  CONTINUE: 'CONTINUE',
  REPEAT: 'REPEAT',
  MUTE: 'MUTE',
  UNMUTE: 'UNMUTE',
  CLEAR_CHAT: 'CLEAR_CHAT',
};

const COMMAND_REGEXES = {
  [COMMANDS.STOP]: /^(?:please\s+)?(?:stop|stop\s+talking|shut\s+up|cancel|halt)$/i,
  [COMMANDS.CONTINUE]: /^(?:please\s+)?(?:continue|continue\s+last\s+response|keep\s+going|go\s+on|resume)(?:\s+please)?$/i,
  [COMMANDS.REPEAT]: /^(?:please\s+)?(?:repeat\s+that|repeat\s+last\s+(?:response|answer)|say\s+that\s+again|repeat)(?:\s+please)?$/i,
  [COMMANDS.MUTE]: /^(?:please\s+)?(?:mute|mute\s+audio|mute\s+voice)(?:\s+please)?$/i,
  [COMMANDS.UNMUTE]: /^(?:please\s+)?(?:unmute|unmute\s+audio|unmute\s+voice)(?:\s+please)?$/i,
  [COMMANDS.CLEAR_CHAT]: /^(?:please\s+)?(?:clear\s+chat|clear\s+history|delete\s+chat|clear\s+conversation)(?:\s+please)?$/i,
};

/**
 * Parse an utterance to check if it's a standalone voice command
 * @param {string} rawText
 * @returns {string|null} Command name or null if not a command
 */
export function parseVoiceCommand(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  const cleaned = rawText
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+$/g, '')
    .trim();

  if (!cleaned) return null;

  for (const [cmd, regex] of Object.entries(COMMAND_REGEXES)) {
    if (regex.test(cleaned)) {
      return cmd;
    }
  }

  return null;
}
