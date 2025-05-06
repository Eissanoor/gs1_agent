const fs = require('fs');
const path = require('path');
const LOG_FILE = path.join(__dirname, '../global_actions_log.json');

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

module.exports = { logAction };
