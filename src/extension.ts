import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as jsonc from 'jsonc-parser/lib/esm/main';

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('dani-settings.applyRecommendedSettings', async () => {
		const settingsPath = path.join(context.extensionPath, 'assets', 'recommended_settings.json');
		try {
			const data = fs.readFileSync(settingsPath, 'utf8');
			const settings = JSON.parse(data);

			for (const [key, value] of Object.entries(settings)) {
				await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
			}

			vscode.window.showInformationMessage('Recommended settings applied!');
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage('Failed to apply recommended settings: ' + errorMsg);
		}
	});

	context.subscriptions.push(disposable);

	let applyKeybindingsDisposable = vscode.commands.registerCommand('dani-settings.applyRecommendedKeybindings', async () => {
		const recommendedKeybindingsPath = path.join(context.extensionPath, 'assets', 'recommended_keybindings.json');

		// Traverse up from globalStorageUri to find the base 'User' folder reliably.
		// Usually: .../User/globalStorage/your-extension-id -> up twice -> .../User/
		const userFolder = path.dirname(path.dirname(context.globalStorageUri.fsPath));
		const userKeybindingsPath = path.join(userFolder, 'keybindings.json');

		try {
			// 1. Read recommended keybindings from the extension assets
			if (!fs.existsSync(recommendedKeybindingsPath)) {
				throw new Error('Recommended keybindings file not found in assets folder.');
			}
			const recommendedData = fs.readFileSync(recommendedKeybindingsPath, 'utf8');
			const recommendedKeybindings = jsonc.parse(recommendedData);

			if (!Array.isArray(recommendedKeybindings)) {
				throw new Error('Recommended keybindings must be a JSON array.');
			}

			// 2. Read existing user keybindings or default to an empty array
			let userKeybindingsText = '[]';
			if (fs.existsSync(userKeybindingsPath)) {
				const existingData = fs.readFileSync(userKeybindingsPath, 'utf8');
				if (existingData.trim() !== '') {
					userKeybindingsText = existingData;
				}
			}

			// 3. Parse existing content to determine the current array length.
			// This is necessary because jsonc.modify requires a numeric index for arrays.
			let currentBindingsArray = jsonc.parse(userKeybindingsText);
			if (!Array.isArray(currentBindingsArray)) {
				// Fallback if the user's file is corrupted or not an array
				userKeybindingsText = '[]';
				currentBindingsArray = [];
			}

			const formattingOptions: jsonc.FormattingOptions = { insertSpaces: true, tabSize: 4 };

			// 4. Append each recommended keybinding one by one
			for (const newBinding of recommendedKeybindings) {
				// Use the current array length as the index to append at the end
				const insertionIndex = currentBindingsArray.length;

				const edits = jsonc.modify(userKeybindingsText, [insertionIndex], newBinding, {
					formattingOptions
				});

				// Apply the edit to the text string (preserves existing comments)
				userKeybindingsText = jsonc.applyEdits(userKeybindingsText, edits);

				// Update our helper array to ensure the next insertionIndex is correct
				currentBindingsArray.push(newBinding);
			}

			// 5. Save the final merged result to disk
			fs.writeFileSync(userKeybindingsPath, userKeybindingsText, 'utf8');

			vscode.window.showInformationMessage('Recommended keybindings applied successfully!');
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage('Failed to apply recommended keybindings: ' + errorMsg);
		}
	});

	context.subscriptions.push(applyKeybindingsDisposable);
}

export function deactivate() { }
