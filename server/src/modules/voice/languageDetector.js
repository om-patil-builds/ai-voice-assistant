/**
 * languageDetector.js
 *
 * Automatic language detection between English ('en'), Marathi ('mr'), and Hindi ('hi').
 * Accurately handles:
 * 1. Pure Devanagari Marathi and Hindi
 * 2. Mixed Marathi-English (Maranglish) and Hindi-English (Hinglish)
 * 3. Romanized / transliterated speech transcripts
 * 4. Pure English
 */

// Devanagari Unicode character range
const DEVANAGARI_REGEX = /[\u0900-\u097F]/;

// Marathi distinctive letter 'ळ' (not in standard modern Hindi vocabulary)
const MARATHI_DISTINCTIVE_LETTER_REGEX = /\u0933/;

// Common Marathi Devanagari words and grammatical markers
const MARATHI_DEVANAGARI_WORDS = new Set([
  'आहे', 'आहेत', 'नाही', 'नाहीत', 'काय', 'कसे', 'कसा', 'कशी', 'कसं',
  'कुठे', 'कधी', 'कशाला', 'का', 'कशासाठी', 'केव्हा',
  'मला', 'तुला', 'आम्हाला', 'तुम्हाला', 'त्याला', 'तिला', 'त्यांना', 'आपले', 'आपल्याला',
  'सांगा', 'सांगावे', 'सांगावं', 'करा', 'करावे', 'करावं', 'शिका', 'शिकावे', 'शिकायचं', 'सांग',
  'म्हणजे', 'बद्दल', 'विषयी', 'सोबत', 'कडून', 'मुळे', 'नंतर', 'आधी', 'मध्ये', 'वर', 'खाली',
  'होते', 'होती', 'होता', 'होतो', 'झाले', 'झाली', 'झाला', 'झालेला', 'झालेलं',
  'नमस्कार', 'धन्यवाद', 'कृपया', 'मित्रा', 'छान', 'बरोबर', 'होय', 'स्टॅक', 'करायचे', 'असावे',
  'पुढे', 'बोला', 'थांबा', 'थांब', 'परत', 'पुन्हा', 'सुरू', 'ठेवा',
  'आपण', 'वापरून', 'वापर', 'शकतो', 'शकते', 'शकतात', 'करणे', 'करायला', 'होईल', 'करणार', 'करतो', 'करते', 'माहिती', 'देऊ'
]);

// Marathi distinctive suffixes (when attached or tokenized)
const MARATHI_SUFFIX_REGEX = /(?:च्या|ची|चे|चा|साठी|मुळे|कडून|प्रमाणे|बद्दल|विषयी)(?:\s|$|[.,!?;:])/;

// Common Hindi Devanagari words and grammatical markers
const HINDI_DEVANAGARI_WORDS = new Set([
  'है', 'हैं', 'नहीं', 'क्या', 'कैसे', 'कैसा', 'कैसी',
  'कहाँ', 'कब', 'क्यों', 'किधर', 'किसलिए',
  'मुझे', 'तुम्हें', 'हमें', 'आपको', 'उसको', 'उनको', 'अपना', 'अपने', 'अपनी',
  'बताओ', 'बताइए', 'करो', 'कीजिए', 'सीखो', 'सीखें', 'करना', 'कहना', 'बोलिए', 'बोलो',
  'मतलब', 'बारे', 'साथ', 'बाद', 'पहले', 'में', 'पर', 'नीचे', 'ऊपर',
  'था', 'थी', 'थे', 'हुआ', 'हुई', 'हुए', 'गया', 'गई', 'गए', 'होगा', 'होगी', 'होंगे',
  'नमस्ते', 'शुक्रिया', 'धन्यवाद', 'कृपया', 'दोस्त', 'अच्छा', 'सही', 'हाँ', 'स्टैक', 'चाहिए',
  'आगे', 'रुको', 'रुकिए', 'दोहराओ', 'दोबारा', 'जारी', 'रखो'
]);

// Hindi distinctive postpositions / suffixes
const HINDI_SUFFIX_REGEX = /(?:के|की|का|को|से|में|पर)(?:\s|$|[.,!?;:])/;

// Romanized Marathi words (Maranglish)
const MARATHI_ROMANIZED_WORDS = new Set([
  'aahe', 'ahe', 'aahet', 'ahet', 'nahi', 'nahit', 'kay', 'kasa', 'kashi', 'kase', 'kasaa',
  'kuthe', 'kadhi', 'kashala', 'mala', 'tula', 'aamhala', 'tumhala', 'tyala', 'tila',
  'sanga', 'saanga', 'mhanje', 'mhanjhe', 'baddal', 'badal', 'vishayi', 'shikaycha', 'karaycha',
  'zhale', 'zhaali', 'zhala', 'namaskar', 'mahiti', 'karto', 'karte', 'ahes', 'thamba', 'thamb',
  'pudhe', 'bola', 'punha', 'parat', 'theva', 'suru'
]);

// Romanized Hindi words (Hinglish)
const HINDI_ROMANIZED_WORDS = new Set([
  'hai', 'hain', 'nahi', 'kya', 'kaise', 'kaisa', 'kaisi', 'kahan', 'kab', 'kyu', 'kyon', 'kyoon',
  'mujhe', 'tumhe', 'aapko', 'usko', 'apna', 'apne', 'apni',
  'batao', 'bataiye', 'matlab', 'baare', 'bare', 'karna', 'karo', 'kijiye', 'bolo', 'boliye',
  'tha', 'thi', 'hua', 'hui', 'hue', 'gaya', 'gayi', 'hoga', 'hogi',
  'namaste', 'shukriya', 'achha', 'accha', 'seekhna', 'sikhna', 'ruko', 'rukye', 'jaari', 'chahiye',
  'aage', 'dohrao', 'dobara', 'rakho'
]);

// Common English markers to prevent false positive code-mixing
const ENGLISH_MARKERS = new Set([
  'what', 'how', 'why', 'who', 'where', 'when', 'which', 'whose', 'whom',
  'explain', 'tell', 'about', 'help', 'build', 'create', 'write',
  'the', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were',
  'can', 'could', 'would', 'should', 'will', 'do', 'does', 'did', 'have', 'has'
]);

/**
 * Normalizes input language string into standardized code ('en', 'hi', 'mr')
 * @param {string} lang
 * @returns {'en'|'hi'|'mr'}
 */
export function normalizeLanguageCode(lang) {
  if (!lang || typeof lang !== 'string') return 'en';
  const clean = lang.toLowerCase().trim();
  if (clean === 'mr' || clean === 'marathi') return 'mr';
  if (clean === 'hi' || clean === 'hindi') return 'hi';
  if (clean === 'en' || clean === 'english') return 'en';
  return 'en';
}

/**
 * Automatically detects the language of a text prompt or transcript.
 *
 * @param {string} text - The input text to analyze
 * @param {string} [sttHint] - Optional language hint detected by STT (e.g. 'mr', 'hi', 'en')
 * @returns {'en'|'hi'|'mr'} Detected language code
 */
export function detectLanguage(text, sttHint = null) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return normalizeLanguageCode(sttHint);
  }

  const cleanText = text.trim();
  const normalizedHint = sttHint ? normalizeLanguageCode(sttHint) : null;

  // 1. Check if the text contains Devanagari characters
  if (DEVANAGARI_REGEX.test(cleanText)) {
    // 1a. If the letter 'ळ' is present, it's unmistakably Marathi
    if (MARATHI_DISTINCTIVE_LETTER_REGEX.test(cleanText)) {
      return 'mr';
    }

    // Tokenize Devanagari words
    const devanagariTokens = cleanText
      .toLowerCase()
      .replace(/[^\u0900-\u097F\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    let marathiScore = 0;
    let hindiScore = 0;

    for (const token of devanagariTokens) {
      if (MARATHI_DEVANAGARI_WORDS.has(token)) {
        marathiScore += 2;
      }
      if (HINDI_DEVANAGARI_WORDS.has(token)) {
        hindiScore += 2;
      }
    }

    // Check distinctive regex patterns (suffixes / postpositions)
    if (MARATHI_SUFFIX_REGEX.test(cleanText)) {
      marathiScore += 1;
    }
    if (HINDI_SUFFIX_REGEX.test(cleanText)) {
      hindiScore += 1;
    }

    if (marathiScore > hindiScore) {
      return 'mr';
    }
    if (hindiScore > marathiScore) {
      return 'hi';
    }

    // If scores are tied, use the STT hint if it's 'mr' or 'hi'
    if (normalizedHint === 'mr' || normalizedHint === 'hi') {
      return normalizedHint;
    }

    // Default Devanagari tie-break
    return 'hi';
  }

  // 2. Check for Romanized text (Maranglish / Hinglish)
  const latinTokens = cleanText
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let romanMarathiScore = 0;
  let romanHindiScore = 0;
  let englishScore = 0;

  for (const token of latinTokens) {
    if (MARATHI_ROMANIZED_WORDS.has(token)) {
      romanMarathiScore += 2;
    }
    if (HINDI_ROMANIZED_WORDS.has(token)) {
      romanHindiScore += 2;
    }
    if (ENGLISH_MARKERS.has(token)) {
      englishScore += 2;
    }
  }

  if (englishScore > 0 && englishScore > romanMarathiScore && englishScore > romanHindiScore) {
    return 'en';
  }

  if (romanMarathiScore > 0 && romanMarathiScore >= romanHindiScore) {
    return 'mr';
  }
  if (romanHindiScore > 0 && romanHindiScore > romanMarathiScore) {
    return 'hi';
  }

  // 3. Fallback: If STT hint is available and was Marathi or Hindi, check if it's reliable
  if (normalizedHint && (normalizedHint === 'mr' || normalizedHint === 'hi')) {
    // If text has common English words like 'what', 'how', 'why', 'explain', favor English
    const englishIndicators = ['what', 'how', 'why', 'explain', 'tell', 'me', 'the', 'is', 'are', 'can', 'you'];
    const hasEnglishWords = englishIndicators.some((w) => latinTokens.includes(w));
    if (!hasEnglishWords) {
      return normalizedHint;
    }
  }

  // Default to English
  return 'en';
}
