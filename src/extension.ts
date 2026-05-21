import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as jsonc from 'jsonc-parser/lib/esm/main';

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('dani-settings.applyRecommendedSettings', async () => {
		const settingsPath = path.join(context.extensionPath, 'assets', 'recommended_settings.json');
		try {
			const data = fs.readFileSync(settingsPath, 'utf8');
			const settings = jsonc.parse(data);

			const failedKeys: string[] = [];
			for (const [key, value] of Object.entries(settings)) {
				try {
					await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
				} catch (err) {
					failedKeys.push(key);
				}
			}

			if (failedKeys.length > 0) {
				vscode.window.showWarningMessage('Some settings could not be applied: ' + failedKeys.join(', '));
			} else {
				vscode.window.showInformationMessage('Recommended settings applied!');
			}
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

	let syncSettingsDisposable = vscode.commands.registerCommand('dani-settings.syncSettingsToAssets', async () => {
		const userFolder = path.dirname(path.dirname(context.globalStorageUri.fsPath));
		const settingsSrc = path.join(userFolder, 'settings.json');
		const keybindingsSrc = path.join(userFolder, 'keybindings.json');

		// Determine all paths to sync to.
		// 1. The extension's internal assets path (default)
		const destinations = [path.join(context.extensionPath, 'assets')];

		// 2. If the user has the project workspace open, add its assets path as well
		if (vscode.workspace.workspaceFolders) {
			for (const folder of vscode.workspace.workspaceFolders) {
				const pkgPath = path.join(folder.uri.fsPath, 'package.json');
				if (fs.existsSync(pkgPath)) {
					try {
						const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
						if (pkg && pkg.name === 'dani-settings') {
							const wsAssetsPath = path.join(folder.uri.fsPath, 'assets');
							if (!destinations.includes(wsAssetsPath)) {
								destinations.push(wsAssetsPath);
							}
						}
					} catch (e) {
						// Ignore package.json parsing errors
					}
				}
			}
		}

		let syncedCount = 0;
		const warnings: string[] = [];

		try {
			for (const assetsPath of destinations) {
				if (!fs.existsSync(assetsPath)) {
					fs.mkdirSync(assetsPath, { recursive: true });
				}

				const settingsDest = path.join(assetsPath, 'recommended_settings.json');
				const keybindingsDest = path.join(assetsPath, 'recommended_keybindings.json');

				const syncFile = (src: string, dest: string, type: string) => {
					if (fs.existsSync(src)) {
						const content = fs.readFileSync(src, 'utf8');
						let processedContent = content;

						if (src.endsWith('.json')) {
							try {
								processedContent = removePrivateSection(content);
							} catch (e) {
								const errorMsg = e instanceof Error ? e.message : String(e);
								warnings.push(`Could not process ${type} file: ${errorMsg}`);
								return;
							}
						}

						fs.writeFileSync(dest, processedContent, 'utf8');
						syncedCount++;
					} else {
						warnings.push(`Source ${type} file not found at ${src}.`);
					}
				};

				syncFile(settingsSrc, settingsDest, 'settings');
				syncFile(keybindingsSrc, keybindingsDest, 'keybindings');
			}

			if (syncedCount === 0) {
				vscode.window.showWarningMessage('No settings or keybindings files were found to synchronize.');
			} else if (warnings.length > 0) {
				vscode.window.showWarningMessage(`Synchronized settings with warnings: ${warnings.join(' ')}`);
			} else {
				vscode.window.showInformationMessage('Settings and keybindings synchronized to assets!');
			}
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			vscode.window.showErrorMessage('Failed to synchronize settings: ' + errorMsg);
		}
	});

	context.subscriptions.push(syncSettingsDisposable);
}

function removePrivateSection(text: string): string {
	const scanner = jsonc.createScanner(text, false);
	let result = '';
	let inPrivateSection = false;
	let token = scanner.scan();

	let lastNonTriviaToken: jsonc.SyntaxKind | null = null;

	const allowedBeforeComma = new Set<jsonc.SyntaxKind>([
		jsonc.SyntaxKind.CloseBraceToken,
		jsonc.SyntaxKind.CloseBracketToken,
		jsonc.SyntaxKind.StringLiteral,
		jsonc.SyntaxKind.NumericLiteral,
		jsonc.SyntaxKind.TrueKeyword,
		jsonc.SyntaxKind.FalseKeyword,
		jsonc.SyntaxKind.NullKeyword
	]);

	while (token !== jsonc.SyntaxKind.EOF) {
		const tokenOffset = scanner.getTokenOffset();
		const tokenLength = scanner.getTokenLength();
		const tokenText = text.substring(tokenOffset, tokenOffset + tokenLength);

		if (token === jsonc.SyntaxKind.LineCommentTrivia || token === jsonc.SyntaxKind.BlockCommentTrivia) {
			if (tokenText.includes('// PRIVATE:START') || tokenText.includes('/* PRIVATE:START')) {
				inPrivateSection = true;
			}
		}

		if (!inPrivateSection) {
			const isTrivia = token === jsonc.SyntaxKind.LineCommentTrivia ||
				token === jsonc.SyntaxKind.BlockCommentTrivia ||
				token === jsonc.SyntaxKind.LineBreakTrivia ||
				token === jsonc.SyntaxKind.Trivia;

			let shouldAppend = true;
			if (!isTrivia) {
				if (token === jsonc.SyntaxKind.CommaToken) {
					if (!lastNonTriviaToken || !allowedBeforeComma.has(lastNonTriviaToken)) {
						shouldAppend = false;
					}
				}
			}

			if (shouldAppend) {
				result += tokenText;
				if (!isTrivia) {
					lastNonTriviaToken = token;
				}
			}
		}

		if (token === jsonc.SyntaxKind.LineCommentTrivia || token === jsonc.SyntaxKind.BlockCommentTrivia) {
			if (tokenText.includes('// PRIVATE:END') || tokenText.includes('/* PRIVATE:END')) {
				inPrivateSection = false;
			}
		}

		token = scanner.scan();
	}

	const errors: jsonc.ParseError[] = [];
	jsonc.parse(result, errors, { allowTrailingComma: true });
	if (errors.length > 0) {
		throw new Error('Failed to parse resulting JSON: ' + errors.map(e => `error at offset ${e.offset}`).join(', '));
	}

	return result;
}

export function deactivate() { }
