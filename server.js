const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Import routes
const promptRoutes = require('./routes/promptRoutes');
app.use('/api', promptRoutes);

// Utility to log actions globally
function logAction(action) {
    let logs = [];
    if (fs.existsSync(LOG_FILE)) {
        try {
            logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
        } catch {
            logs = [];
        }
    }
    logs.push({ ...action, timestamp: new Date().toISOString() });
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
}

// Helper: Get suggestions for valid actions
function getSuggestions() {
    return [
        'navigate to gs1 page',
        'navigate to kpi page',
        // Add more valid actions here as needed
    ];
}

// Helper: Simple prompt parsing
function parsePrompt(prompt) {
    prompt = prompt.toLowerCase();
    if (prompt.includes('gs1')) {
        return 'gs1';
    } else if (prompt.includes('kpi')) {
        return 'kpi';
    }
    return null;
}

// Main /prompt endpoint
// app.post('/prompt', async (req, res) => {
//     const { prompt } = req.body;
//     if (!prompt) {
//         return res.status(400).json({ message: 'Prompt is required.' });
//     }

//     const action = parsePrompt(prompt);
//     let result = { prompt };

//     if (!action) {
//         result.status = 'failed';
//         result.message = 'Unrecognized prompt.';
//         result.suggestions = getSuggestions();
//         logAction(result);
//         return res.status(400).json(result);
//     }

//     let browser;
//     try {
//         browser = await puppeteer.launch({ headless: true });
//         const page = await browser.newPage();
//         await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

//         if (action === 'gs1') {
//             // Example: navigate to GS1 page (update selector as needed)
//             await page.click('a[href*="gs1"]');
//             await page.waitForTimeout(1000); // Wait for navigation
//             result.status = 'success';
//             result.message = 'Navigated to GS1 page.';
//         } else if (action === 'kpi') {
//             // Example: navigate to KPI page (update selector as needed)
//             await page.click('a[href*="kpi"]');
//             await page.waitForTimeout(1000);
//             result.status = 'success';
//             result.message = 'Navigated to KPI page.';
//         }

//         logAction(result);
//         await browser.close();
//         return res.json(result);
//     } catch (error) {
//         if (browser) await browser.close();
//         result.status = 'error';
//         result.message = 'Failed to perform action.';
//         result.error = error.message;
//         logAction(result);
//         return res.status(500).json(result);
//     }
// });

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
