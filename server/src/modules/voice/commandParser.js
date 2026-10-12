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
  [COMMANDS.STOP]: /^(?:(?:please|कृपया)\s+)?(?:stop|stop\s+talking|shut\s+up|cancel|halt|रुको|रुकिए|रुक\s+जाओ|बंद\s+करो|चुप\s+रहो|थांबा|थांब|बोलणे\s+थांबवा|बंद\s+करा|स्टॉप|ruko|ruk\s+jao|band\s+karo|thamba|thamb|band\s+kara)$/i,
  [COMMANDS.CONTINUE]: /^(?:(?:please|कृपया)\s+)?(?:continue|continue\s+last\s+response|keep\s+going|go\s+on|resume|जारी\s+रखो|आगे\s+बोलो|आगे\s+बताओ|चालू\s+रखो|पुढे\s+बोला|पुढे\s+सांगा|सुरू\s+ठेवा|चालू\s+ठेवा|कंटिन्यू|aage\s+bolo|aage\s+batao|jaari\s+rakho|pudhe\s+bola|pudhe\s+sanga|suru\s+theva)(?:\s+(?:please|कृपया))?$/i,
  [COMMANDS.REPEAT]: /^(?:(?:please|कृपया)\s+)?(?:repeat\s+that|repeat\s+last\s+(?:response|answer)|say\s+that\s+again|repeat|फिर\s+से\s+बोलो|दोहराओ|दोबारा\s+बोलो|फिर\s+से\s+बताओ|पुन्हा\s+सांगा|पुन्हा\s+बोला|परत\s+सांगा|परत\s+बोला|phir\s+se\s+bolo|dohrao|dobara\s+bolo|punha\s+sanga|punha\s+bola|parat\s+sanga)(?:\s+(?:please|कृपया))?$/i,
  [COMMANDS.MUTE]: /^(?:(?:please|कृपया)\s+)?(?:mute|mute\s+audio|mute\s+voice|म्यूट|म्यूट\s+करो|म्यूट\s+करा|आवाज\s+बंद\s+करो|आवाज\s+बंद\s+करा)(?:\s+(?:please|कृपया))?$/i,
  [COMMANDS.UNMUTE]: /^(?:(?:please|कृपया)\s+)?(?:unmute|unmute\s+audio|unmute\s+voice|अनम्यूट|अनम्यूट\s+करो|अनम्यूट\s+करा|आवाज\s+चालू\s+करो|आवाज\s+चालू\s+करा|आवाज\s+शुरू\s+करो|आवाज\s+सुरू\s+करा)(?:\s+(?:please|कृपया))?$/i,
  [COMMANDS.CLEAR_CHAT]: /^(?:(?:please|कृपया)\s+)?(?:clear\s+chat|clear\s+history|delete\s+chat|clear\s+conversation|चैट\s+साफ\s+करो|चैट\s+हटाओ|चॅट\s+साफ\s+करा|चॅट\s+हटवा|संभाषण\s+साफ\s+करा)(?:\s+(?:please|कृपया))?$/i,
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
