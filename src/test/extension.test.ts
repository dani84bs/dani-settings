import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

suite('Extension Test Suite', () => {
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
	});
});
