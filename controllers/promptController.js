const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:3092/';

// Configurable actions for scalability
const ACTIONS = {
    //give me the all words 10 possibliy

    about: {
        synonyms: ['about us', 'about' , 'about us page', 'about page', 
            'about us section', 'about page section', 'navigate to about us page',
             'navigate to about page', 'about us section', 'about page section'  ],
        path: 'about-us',
        suggestion: 'navigate to about us page'
    },
    whychoose: {
        synonyms: ['why choose us', 'why choose' , 'why choose us page', 
            'why choose page', 'why choose us section',
             'why choose page section', 'navigate to why choose us page',
              'navigate to why choose page', 'why choose us section', 
              'why choose page section'    ],
        path: 'why-choose-us',
        suggestion: 'navigate to why choose us page'
    },
    team: {
        synonyms: ['our team', 'team' , 'our team page', 'team page', 
            'our team section', 'go to our team page', 
            'go to team page', 'navigate to our team page', 
            'navigate to team page', 'our team section', 
            'team page section'  ],
        path: 'our-team',
        suggestion: 'navigate to our team page'
    }
};

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
    const langSug = [
        'change language to English',
        'change language to Arabic'
    ];
    const navSug = Object.values(ACTIONS).map(a => a.suggestion);
    return [...langSug, ...navSug];
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
        return res.status(400).json({ status: 'failed', message: 'Unrecognized prompt.', suggestions: getSuggestions() });
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
