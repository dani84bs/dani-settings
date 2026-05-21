const fs = require('fs');
const path = require('path');

const userPath = path.join(__dirname, '.vscode-test', 'user-data', 'User');
fs.mkdirSync(userPath, { recursive: true });

const settingsFile = path.join(userPath, 'settings.json');
let settings = {};
if (fs.existsSync(settingsFile)) {
	try {
		settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
	} catch (e) {}
}

settings['extensions.autoUpdate'] = false;
settings['extensions.autoCheckUpdates'] = false;
settings['update.mode'] = 'none';

fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 4), 'utf8');
console.log('Test settings initialized at:', settingsFile);
