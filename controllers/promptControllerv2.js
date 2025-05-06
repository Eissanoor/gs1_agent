const stringSimilarity = require('string-similarity');
const prisma = require('../prismaClient');

// Configurable actions for scalability (imported from config/actions.js)
const ACTIONS = require('../config/actionsv2');

// Map session to selected language
const sessionLangMap = new Map();

// Helper: Get suggestions for language or navigation
function getSuggestions(type = 'all') {
  const langSug = [
    'change language to English',
    'change language to Arabic'
  ];
  const navSug = Object.values(ACTIONS).map(a => a.suggestion);
  if (type === 'language') return langSug;
  if (type === 'navigation') return navSug;
  return [...langSug, ...navSug];
}

// Shuffle array
function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Parse prompt for action key
function parsePrompt(prompt) {
  const low = prompt.toLowerCase();
  if (low.includes('english')) return 'langen';
  if (low.includes('arabic')) return 'langar';
  for (const [key, action] of Object.entries(ACTIONS)) {
    if (action.synonyms.some(s => low.includes(s.toLowerCase()))) {
      return key;
    }
  }
  return null;
}

exports.handlePrompt = async (req, res) => {
  const { prompt } = req.body;
  const sessionId = req.headers['x-session-id'] || req.ip;
  if (!prompt) {
    return res.status(400).json({ message: 'Prompt is required.' });
  }

  const action = parsePrompt(prompt);
  let result = { prompt };

  if (!action) {
    // Try full-text match in pages.custom_section_data
    try {
      const pages = await prisma.pages.findMany({
        where: { custom_section_data: { contains: prompt, mode: 'insensitive' } }
      });
      if (pages.length) {
        return res.json({ status: 'success', pages });
      }
    } catch (err) {
      console.error('DB search error:', err);
    }

    // Contextual suggestions based on prompt intent
    const low = prompt.toLowerCase();
    let suggestions;
    if (low.includes('english') || low.includes('arabic')) {
      suggestions = getSuggestions('language');
    } else {
      // Use fuzzy match to suggest the closest navigation command
      const navSug = getSuggestions('navigation');
      const best = stringSimilarity.findBestMatch(low, navSug).bestMatch.target;
      // Place best match first, then shuffle the rest
      suggestions = [best, ...shuffle(navSug.filter(s => s !== best))];
    }
    // cap the number of suggestions
    suggestions = suggestions.slice(0, 6);
    return res.status(400).json({ status: 'failed', message: 'Unrecognized prompt.', suggestions });
  }

  try {
    // Handle language change commands
    if (action === 'langen') {
      sessionLangMap.set(sessionId, 'en');
      return res.json({ status: 'success', message: 'Language set to English.', language: 'en' });
    }
    if (action === 'langar') {
      sessionLangMap.set(sessionId, 'ar');
      return res.json({ status: 'success', message: 'Language set to Arabic.', language: 'ar' });
    }

    // Handle navigation commands
    if (ACTIONS[action]) {
      const { path: p, suggestion } = ACTIONS[action];
      return res.json({ status: 'success', message: suggestion, path: p, language: sessionLangMap.get(sessionId) || 'en' });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Failed to perform action.', error: error.message });
  }
};
