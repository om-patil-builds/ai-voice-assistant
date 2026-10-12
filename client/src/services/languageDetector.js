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

const DEVANAGARI_REGEX = /[\u0900-\u097F]/;
const MARATHI_DISTINCTIVE_LETTER_REGEX = /\u0933/;

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

const MARATHI_SUFFIX_REGEX = /(?:च्या|ची|चे|चा|साठी|मुळे|कडून|प्रमाणे|बद्दल|विषयी)(?:\s|$|[.,!?;:])/;

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

const HINDI_SUFFIX_REGEX = /(?:के|की|का|को|से|में|पर)(?:\s|$|[.,!?;:])/;

const MARATHI_ROMANIZED_WORDS = new Set([
  'aahe', 'ahe', 'aahet', 'ahet', 'nahi', 'nahit', 'kay', 'kasa', 'kashi', 'kase', 'kasaa',
  'kuthe', 'kadhi', 'kashala', 'mala', 'tula', 'aamhala', 'tumhala', 'tyala', 'tila',
  'sanga', 'saanga', 'mhanje', 'mhanjhe', 'baddal', 'badal', 'vishayi', 'shikaycha', 'karaycha',
  'zhale', 'zhaali', 'zhala', 'namaskar', 'mahiti', 'karto', 'karte', 'ahes', 'thamba', 'thamb',
  'pudhe', 'bola', 'punha', 'parat', 'theva', 'suru'
]);

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

export function normalizeLanguageCode(lang) {
  if (!lang || typeof lang !== 'string') return 'en';
  const clean = lang.toLowerCase().trim();
  if (clean.startsWith('mr') || clean.includes('marathi')) return 'mr';
  if (clean.startsWith('hi') || clean.includes('hindi')) return 'hi';
  if (clean.startsWith('en') || clean.includes('english')) return 'en';
  return 'en';
}

export function detectLanguage(text, sttHint = null) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return normalizeLanguageCode(sttHint);
  }

  const cleanText = text.trim();
  const normalizedHint = sttHint ? normalizeLanguageCode(sttHint) : null;

  if (DEVANAGARI_REGEX.test(cleanText)) {
    if (MARATHI_DISTINCTIVE_LETTER_REGEX.test(cleanText)) {
      return 'mr';
    }

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

    if (normalizedHint === 'mr' || normalizedHint === 'hi') {
      return normalizedHint;
    }

    return 'hi';
  }

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

  if (normalizedHint && (normalizedHint === 'mr' || normalizedHint === 'hi')) {
    const englishIndicators = ['what', 'how', 'why', 'explain', 'tell', 'me', 'the', 'is', 'are', 'can', 'you'];
    const hasEnglishWords = englishIndicators.some((w) => latinTokens.includes(w));
    if (!hasEnglishWords) {
      return normalizedHint;
    }
  }

  return 'en';
}
