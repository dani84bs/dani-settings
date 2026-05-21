import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

suite('Extension Test Suite', function () {
	this.timeout(15000);

	vscode.window.showInformationMessage('Start all tests.');

	suiteSetup(() => {
		const globalStoragePath = path.join(__dirname, '..', '..', '.vscode-test', 'user-data', 'User', 'globalStorage', 'vscodevim.vim');
		fs.mkdirSync(globalStoragePath, { recursive: true });
	});

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Apply recommended settings command runs without crashing and applies settings', async () => {
		await vscode.commands.executeCommand('dani-settings.applyRecommendedSettings');
		const config = vscode.workspace.getConfiguration();
		const startupEditor = config.get('workbench.startupEditor');
		assert.strictEqual(startupEditor, 'none');
		// Give VS Code configuration updates some time to settle before the next test modifies files
		await new Promise(resolve => setTimeout(resolve, 2000));
	});

	test('Sync settings to assets command runs and correctly copies settings and keybindings while removing private sections', async () => {
		const assetsPath = path.join(__dirname, '..', '..', 'assets');
		const syncedSettingsFile = path.join(assetsPath, 'recommended_settings.json');
		const syncedKeybindingsFile = path.join(assetsPath, 'recommended_keybindings.json');

		// Backup original files
		let originalSettings: string | null = null;
		let originalKeybindings: string | null = null;
		if (fs.existsSync(syncedSettingsFile)) {
			originalSettings = fs.readFileSync(syncedSettingsFile, 'utf8');
		}
		if (fs.existsSync(syncedKeybindingsFile)) {
			originalKeybindings = fs.readFileSync(syncedKeybindingsFile, 'utf8');
		}

		try {
			const userPath = path.join(__dirname, '..', '..', '.vscode-test', 'user-data', 'User');
			fs.mkdirSync(userPath, { recursive: true });

			const mockSettingsContent = `{
				"editor.fontSize": 14,
				// PRIVATE:START
				"github.copilot.inlineSuggest.enable": true,
				/* PRIVATE:END */
				"files.autoSave": "afterDelay"
			}`;

			const mockKeybindingsContent = `[
				{
					"key": "ctrl+f",
					"command": "actions.find"
				},
				// PRIVATE:START
				{
					"key": "cmd+i",
					"command": "private.action"
				},
				// PRIVATE:END
				{
					"key": "ctrl+s",
					"command": "workbench.action.files.save"
				}
			]`;

			const testSettingsFile = path.join(userPath, 'settings.json');
			const testKeybindingsFile = path.join(userPath, 'keybindings.json');

			fs.writeFileSync(testSettingsFile, mockSettingsContent, 'utf8');
			fs.writeFileSync(testKeybindingsFile, mockKeybindingsContent, 'utf8');

			// Run command
			await vscode.commands.executeCommand('dani-settings.syncSettingsToAssets');

			assert.ok(fs.existsSync(syncedSettingsFile), 'synced settings file should exist');
			assert.ok(fs.existsSync(syncedKeybindingsFile), 'synced keybindings file should exist');

			const syncedSettings = fs.readFileSync(syncedSettingsFile, 'utf8');
			const syncedKeybindings = fs.readFileSync(syncedKeybindingsFile, 'utf8');

			// Verify they do not contain the private sections
			assert.ok(!syncedSettings.includes('github.copilot.inlineSuggest.enable'), 'should strip copilot setting');
			assert.ok(syncedSettings.includes('editor.fontSize'), 'should keep font size');
			assert.ok(syncedSettings.includes('files.autoSave'), 'should keep autoSave');

			assert.ok(!syncedKeybindings.includes('private.action'), 'should strip private keybinding');
			assert.ok(syncedKeybindings.includes('actions.find'), 'should keep find keybinding');
			assert.ok(syncedKeybindings.includes('workbench.action.files.save'), 'should keep save keybinding');
		} finally {
			// Restore original files
			if (originalSettings !== null) {
				fs.writeFileSync(syncedSettingsFile, originalSettings, 'utf8');
			} else if (fs.existsSync(syncedSettingsFile)) {
				fs.unlinkSync(syncedSettingsFile);
			}

			if (originalKeybindings !== null) {
				fs.writeFileSync(syncedKeybindingsFile, originalKeybindings, 'utf8');
			} else if (fs.existsSync(syncedKeybindingsFile)) {
				fs.unlinkSync(syncedKeybindingsFile);
			}
		}
	});
});
