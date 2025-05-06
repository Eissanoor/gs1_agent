const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:3092/';

// Configurable actions for scalability (imported from config/actions.js)
const ACTIONS = require('../config/actions');

// Store browser instance globally
let globalBrowser = null;

// Map to persist page per client session
const pageMap = new Map();

// Map session to selected language
const sessionLangMap = new Map();

// Function to get or create browser instance
async function getBrowser() {
    if (!globalBrowser) {
        globalBrowser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ['--start-maximized']
        });
    }
    return globalBrowser;
}

// Function to get or create page for session
async function getPageForSession(sessionId) {
    const browser = await getBrowser();
    if (!pageMap.has(sessionId)) {
        // Optionally use incognito for isolation
        const context = await browser.createIncognitoBrowserContext();
        const page = await context.newPage();
        await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
        pageMap.set(sessionId, page);
    }
    return pageMap.get(sessionId);
}

// Helper: Get suggestions for language, navigation, or both
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

// Fisher-Yates shuffle
function shuffle(array) {
    const a = [...array];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Helper: Simple prompt parsing
function parsePrompt(prompt) {
    const low = prompt.toLowerCase();
    // language commands
    if (low.includes('english')) return 'langen';
    if (low.includes('arabic')) return 'langar';
    // navigation commands
    for (const [key, action] of Object.entries(ACTIONS)) {
        if (action.synonyms.some(s => low.includes(s))) {
            return key;
        }
    }
    return null;
}

exports.handlePrompt = async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ message: 'Prompt is required.' });
    }

    const action = parsePrompt(prompt);
    let result = { prompt };

    if (!action) {
        // Contextual suggestions based on prompt intent
        const low = prompt.toLowerCase();
        let suggestions;
        if (low.includes('english') || low.includes('arabic')) {
            suggestions = getSuggestions('language');
        } else {
            suggestions = getSuggestions('navigation');
        }
        // cap the number of suggestions
        suggestions = shuffle(suggestions).slice(0, 5);
        return res.status(400).json({ status: 'failed', message: 'Unrecognized prompt.', suggestions });
    }

    try {
        // derive session identifier (e.g. from client cookie or IP)
        const sessionId = req.headers['x-session-id'] || req.ip;
        const page = await getPageForSession(sessionId);

        // Handle language change commands by clicking flags in browser
        if (action === 'langen') {
            await page.waitForSelector('#flag-en', { visible: true });
            await page.click('#flag-en');
            sessionLangMap.set(sessionId, 'en');
            return res.json({ status: 'success', message: 'Language set to English.', language: 'en' });
        }
        if (action === 'langar') {
            await page.waitForSelector('#flag-ar', { visible: true });
            await page.click('#flag-ar');
            sessionLangMap.set(sessionId, 'ar');
            return res.json({ status: 'success', message: 'Language set to Arabic.', language: 'ar' });
        }

        // Determine language prefix for URLs
        const lang = sessionLangMap.get(sessionId) || 'en';

        // handle configured navigation
        if (ACTIONS[action]) {
            const { path: p, suggestion } = ACTIONS[action];
            await page.goto(`${BASE_URL}${p}`, { waitUntil: 'networkidle2' });
            result.status = 'success';
            result.message = suggestion.replace('navigate to', 'Navigated to');
            result.language = lang;
            result.url = `/${p}`;
        }

        // Return result without closing browser, so tab stays open
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Failed to perform action.', error: error.message });
    }
};
