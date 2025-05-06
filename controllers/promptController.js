const puppeteer = require('puppeteer');
const { logAction } = require('../models/actionLog');

const BASE_URL = 'http://localhost:3092/';

// Helper: Get suggestions for valid actions
function getSuggestions() {
    return [
        'navigate to about us page',
        'navigate to why choose gs1 page',
        'navigate to our team page',
    ];
}

// Helper: Simple prompt parsing
function parsePrompt(prompt) {
    prompt = prompt.toLowerCase();
    if (prompt.includes('about')) {
        return 'about';
    } else if (prompt.includes('why choose')) {
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
        result.status = 'failed';
        result.message = 'Unrecognized prompt.';
        result.suggestions = getSuggestions();
        logAction(result);
        return res.status(400).json(result);
    }

    let browser;
    try {
        browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();
        await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

        if (action === 'about') {
            await page.click('a[href*="about"]');
            await page.waitForTimeout(1000);
            result.status = 'success';
            result.message = 'Navigated to About Us page.';
        } else if (action === 'whychoose') {
            await page.click('a[href*="why-choose"]');
            await page.waitForTimeout(1000);
            result.status = 'success';
            result.message = 'Navigated to Why Choose GS1 page.';
        } else if (action === 'team') {
            await page.click('a[href*="team"]');
            await page.waitForTimeout(1000);
            result.status = 'success';
            result.message = 'Navigated to Our Team page.';
        }

        logAction(result);
        await browser.close();
        return res.json(result);
    } catch (error) {
        if (browser) await browser.close();
        result.status = 'error';
        result.message = 'Failed to perform action.';
        result.error = error.message;
        logAction(result);
        return res.status(500).json(result);
    }
};
