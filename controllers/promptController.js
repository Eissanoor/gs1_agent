const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:3092/';

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

// Helper: Get suggestions for valid actions
function getSuggestions() {
    return [
        'change language to English',
        'change language to Arabic',
        'navigate to about us page',
        'navigate to why choose us page',
        'navigate to our team page',
    ];
}

// Helper: Simple prompt parsing
function parsePrompt(prompt) {
    prompt = prompt.toLowerCase();
    if (prompt.includes('english')) {
        return 'langen';
    } else if (prompt.includes('arabic')) {
        return 'langar';
    }
    if (prompt.includes('about us')) {
        return 'about';
    } else if (prompt.includes('why choose us')) {
        return 'whychoose';
    } else if (prompt.includes('team')) {
        return 'team';
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
        return res.status(400).json({ status: 'failed', message: 'Unrecognized prompt.', suggestions: getSuggestions() });
    }

    try {
        // derive session identifier (e.g. from client cookie or IP)
        const sessionId = req.headers['x-session-id'] || req.ip;
        const page = await getPageForSession(sessionId);

        // Handle language change commands
        if (action === 'langen') {
            sessionLangMap.set(sessionId, 'en');
            return res.json({ status: 'success', message: 'Language set to English.', language: 'en' });
        }
        if (action === 'langar') {
            sessionLangMap.set(sessionId, 'ar');
            return res.json({ status: 'success', message: 'Language set to Arabic.', language: 'ar' });
        }

        // Determine language prefix for URLs
        const lang = sessionLangMap.get(sessionId) || 'en';

        if (action === 'about') {
            await page.goto(`${BASE_URL}about-us`, { waitUntil: 'networkidle2' });
            result.status = 'success';
            result.message = 'Navigated to About Us page.';
            result.language = lang;
            result.url = '/about-us';
        } else if (action === 'whychoose') {
            await page.goto(`${BASE_URL}why-choose-us`, { waitUntil: 'networkidle2' });
            result.status = 'success';
            result.message = 'Navigated to Why Choose US page.';
            result.language = lang;
            result.url = '/why-choose-us';
        } else if (action === 'team') {
            await page.goto(`${BASE_URL}our-team`, { waitUntil: 'networkidle2' });
            result.status = 'success';
            result.message = 'Navigated to Our Team page.';
            result.language = lang;
            result.url = '/our-team';
        }

        // Return result without closing browser, so tab stays open
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Failed to perform action.', error: error.message });
    }
};
