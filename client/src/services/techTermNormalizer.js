/**
 * techTermNormalizer.js (Client-side)
 *
 * Normalizes speech recognition transcripts and user input for technical terms,
 * frameworks, programming languages, and developer terminology.
 *
 * Handles acoustic variations and phonetic patterns common in Indian English
 * accents and speech-to-text misrecognitions.
 */

export const TECH_TERM_PATTERNS = [
  // 1. MERN Stack & common phonetic misrecognitions
  // (In Indian English accents, 'MERN stack' often transcribes as 'man stack', 'men stack', 'marne stack', 'learn stack', 'burn stack', 'mare in stack', etc.)
  {
    pattern: /(?<!\w)(?:m[\s.-]*e[\s.-]*r[\s.-]*n\.?|mern|marne|marn|men|man|main|mourn|mare\s+in|learn|burn)\s+stack(?!\w)/gi,
    replacement: 'MERN Stack',
  },
  {
    pattern: /(?<!\w)mernstack(?!\w)/gi,
    replacement: 'MERN Stack',
  },
  {
    pattern: /(?<!\w)(?:m[\s.-]+e[\s.-]+r[\s.-]+n\.?)(?!\w)/gi,
    replacement: 'MERN',
  },
  {
    pattern: /(?<!\w)m\.e\.r\.n\.?(?!\w)/gi,
    replacement: 'MERN',
  },
  {
    pattern: /(?<!\w)mern(?!\w)/gi,
    replacement: 'MERN',
  },

  // 2. MEAN Stack
  {
    pattern: /(?<!\w)(?:m[\s.-]*e[\s.-]*a[\s.-]*n\.?|mean)\s+stack(?!\w)/gi,
    replacement: 'MEAN Stack',
  },

  // 3. LAMP Stack
  {
    pattern: /(?<!\w)(?:l[\s.-]*a[\s.-]*m[\s.-]*p\.?|lamp)\s+stack(?!\w)/gi,
    replacement: 'LAMP Stack',
  },

  // 4. MongoDB & phonetic variations ("mango db", "mongo db", "mango database", "mongo data base")
  {
    pattern: /(?<!\w)(?:mango\s*d[\s.]*b\.?|mongo\s*d[\s.]*b\.?|mongo\s*database|mango\s*database|mongodb)(?!\w)/gi,
    replacement: 'MongoDB',
  },

  // 5. Express.js ("express js", "expressjs", "express.js", "express j s")
  {
    pattern: /(?<!\w)express(?:\.js|js|\s+j[\s.]*s\.?)(?!\w)/gi,
    replacement: 'Express.js',
  },

  // 6. React.js & React Native
  {
    pattern: /(?<!\w)react(?:\.js|js|\s+j[\s.]*s\.?)(?!\w)/gi,
    replacement: 'React.js',
  },
  {
    pattern: /(?<!\w)react\s+native(?!\w)/gi,
    replacement: 'React Native',
  },

  // 7. Node.js & phonetic variations ("node js", "nodejs", "node.js", "note js", "know js")
  {
    pattern: /(?<!\w)(?:node(?:\.js|js|\s+j[\s.]*s\.?)|know\s+j[\s.]*s\.?|note\s+j[\s.]*s\.?)(?!\w)/gi,
    replacement: 'Node.js',
  },

  // 8. JavaScript & TypeScript
  {
    pattern: /(?<!\w)(?:java\s+script|javascript)(?!\w)/gi,
    replacement: 'JavaScript',
  },
  {
    pattern: /(?<!\w)(?:type\s+script|typescript)(?!\w)/gi,
    replacement: 'TypeScript',
  },

  // 9. APIs & REST API (including "a p i", "a.p.i.", "rest api", "rest a p i")
  {
    pattern: /(?<!\w)restful\s+(?:api|a[\s.]*p[\s.]*i\.?)(?!\w)/gi,
    replacement: 'RESTful API',
  },
  {
    pattern: /(?<!\w)(?:rest\s+(?:api|a[\s.]*p[\s.]*i\.?)|restapi)(?!\w)/gi,
    replacement: 'REST API',
  },
  {
    pattern: /(?<!\w)(?:a[\s.-]*p[\s.-]*i[\s.-]*s|a\.p\.i\.'?s)(?!\w)/gi,
    replacement: 'APIs',
  },
  {
    pattern: /(?<!\w)(?:a[\s.]*p[\s.]*i\.?)(?!\w)/gi,
    replacement: 'API',
  },

  // 10. Next.js, Vue.js, Angular
  {
    pattern: /(?<!\w)next(?:\.js|js|\s+j[\s.]*s\.?)(?!\w)/gi,
    replacement: 'Next.js',
  },
  {
    pattern: /(?<!\w)vue(?:\.js|js|\s+j[\s.]*s\.?)(?!\w)/gi,
    replacement: 'Vue.js',
  },

  // 11. Databases: PostgreSQL, NoSQL
  {
    pattern: /(?<!\w)(?:postgre\s*sql|postgres\s*ql|postgresql)(?!\w)/gi,
    replacement: 'PostgreSQL',
  },
  {
    pattern: /(?<!\w)no\s+sql(?!\w)/gi,
    replacement: 'NoSQL',
  },

  // 12. GraphQL
  {
    pattern: /(?<!\w)(?:graph\s*ql|graphql)(?!\w)/gi,
    replacement: 'GraphQL',
  },

  // 13. Developer tooling & ecosystem
  {
    pattern: /(?<!\w)(?:n[\s.-]+p[\s.-]+m|n\.p\.m\.)(?!\w)/gi,
    replacement: 'npm',
  },
  {
    pattern: /(?<!\w)git\s*hub(?!\w)/gi,
    replacement: 'GitHub',
  },
  {
    pattern: /(?<!\w)git\s*lab(?!\w)/gi,
    replacement: 'GitLab',
  },
  {
    pattern: /(?<!\w)tailwind(?:\.css|\s+css)?(?!\w)/gi,
    replacement: 'Tailwind CSS',
  },

  // 14. Architecture & roles
  {
    pattern: /(?<!\w)(?:full\s*stack|full\s+steak)(?!\w)/gi,
    replacement: 'full-stack',
  },
  {
    pattern: /(?<!\w)front\s+end(?!\w)/gi,
    replacement: 'frontend',
  },
  {
    pattern: /(?<!\w)back\s+end(?!\w)/gi,
    replacement: 'backend',
  },

  // 15. Devanagari phonetic variations for Hindi and Marathi
  {
    pattern: /(?:मर्न|मैन|मन)\s*स्ट[ॅै]क/gi,
    replacement: 'MERN Stack',
  },
  {
    pattern: /(?:म[ोॉौ]?[ंँ]?(?:न्)?गो\s*(?:डी[\s.]*बी|डेटाबेस|डाटाबेस)|म[ोॉौ]?[ंँ]?(?:न्)?गो\s*डीबी)/gi,
    replacement: 'MongoDB',
  },
  {
    pattern: /(?:एक्सप्रेस\s*(?:डॉट\s*)?जे[\s.]*एस)/gi,
    replacement: 'Express.js',
  },
  {
    pattern: /(?:रि[एअॅ]क्ट\s+नेटिव)/gi,
    replacement: 'React Native',
  },
  {
    pattern: /(?:रि[एअॅ]क्ट\s*(?:डॉट\s*)?जे[\s.]*एस)/gi,
    replacement: 'React.js',
  },
  {
    pattern: /(?:नोड\s*(?:डॉट\s*)?जे[\s.]*एस)/gi,
    replacement: 'Node.js',
  },
  {
    pattern: /(?:जावा\s*स्क्रिप्ट)/gi,
    replacement: 'JavaScript',
  },
  {
    pattern: /(?:टाइप\s*स्क्रिप्ट)/gi,
    replacement: 'TypeScript',
  },
  {
    pattern: /(?:रेस्ट\s+एपीआई)/gi,
    replacement: 'REST API',
  },
  {
    pattern: /(?:एपीआई)/gi,
    replacement: 'API',
  },
];

/**
 * Normalizes speech recognition transcripts and input text for technical terms.
 *
 * @param {string} text - Raw transcript or text input
 * @returns {string} - Cleaned transcript with normalized developer terminology
 */
export function normalizeTechTerms(text) {
  if (!text || typeof text !== 'string') return '';

  let normalized = text;

  for (const { pattern, replacement } of TECH_TERM_PATTERNS) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Clean up any double spaces introduced during normalization
  normalized = normalized.replace(/\s{2,}/g, ' ').trim();

  return normalized;
}

/**
 * Checks if an input is primarily a technical term query
 * @param {string} text
 * @returns {boolean}
 */
export function isTechnicalTermQuery(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim().toLowerCase();

  const techTerms = [
    'mern', 'mern stack', 'mean', 'mean stack', 'lamp stack',
    'mongodb', 'express', 'express.js', 'react', 'react.js',
    'node', 'node.js', 'javascript', 'typescript', 'api', 'rest api',
    'graphql', 'postgresql', 'nosql', 'frontend', 'backend', 'full-stack',
    'मर्न', 'मर्न स्टॅक', 'मर्न स्टैक', 'मोंगो', 'एक्सप्रेस', 'रिएक्ट', 'नोड', 'एपीआई'
  ];

  return techTerms.some((term) => clean === term || clean.includes(term));
}

