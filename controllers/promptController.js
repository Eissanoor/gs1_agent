const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:3092/';

// Store browser instance globally
let globalBrowser = null;
let activePage = null;

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

// Function to get or create active page
async function getActivePage() {
    const browser = await getBrowser();
    if (!activePage) {
        activePage = await browser.newPage();
    }
    return activePage;
}

// Helper: Get suggestions for valid actions
function getSuggestions() {
    return [
        'navigate to about us page',
        'navigate to why choose us page',
        'navigate to our team page',
    ];
}

// Helper: Simple prompt parsing
function parsePrompt(prompt) {
    prompt = prompt.toLowerCase();
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
        // Get persistent page and navigate base
        const page = await getActivePage();
        await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

        if (action === 'about') {
            await page.goto(`${BASE_URL}about-us`, { waitUntil: 'networkidle2' });
            result.status = 'success';
            result.message = 'Navigated to About Us page.';
        } else if (action === 'whychoose') {
            await page.goto(`${BASE_URL}why-choose-us`, { waitUntil: 'networkidle2' });
            result.status = 'success';
            result.message = 'Navigated to Why Choose US page.';
        } else if (action === 'team') {
            await page.goto(`${BASE_URL}our-team`, { waitUntil: 'networkidle2' });
            result.status = 'success';
            result.message = 'Navigated to Our Team page.';
        }

        // Return result without closing browser, so tab stays open
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Failed to perform action.', error: error.message });
    }
};
