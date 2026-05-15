import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as jsonc from 'jsonc-parser/lib/esm/main';

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('dani-codium.applyRecommendedSettings', async () => {
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

	let applyKeybindingsDisposable = vscode.commands.registerCommand('dani-codium.applyRecommendedKeybindings', async () => {
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

	let quickActionsDisposable = vscode.commands.registerCommand('dani-codium.showQuickActions', () => {
		interface QuickActionItem extends vscode.QuickPickItem {
			actionId?: string;
			args?: any;
			subActions?: QuickActionItem[];
		}

		const mapUserActions = (actions: any[]): QuickActionItem[] => {
			return actions.map(action => ({
				label: action.key,
				description: action.description,
				actionId: action.command,
				args: action.args,
				subActions: action.actions ? mapUserActions(action.actions) : undefined
			}));
		};

		const defaultItems: QuickActionItem[] = [
			{
				label: 's',
				description: 'Apply recommended settings',
				actionId: 'dani-codium.applyRecommendedSettings'
			},
			{
				label: 'k',
				description: 'Apply recommended keybindings',
				actionId: 'dani-codium.applyRecommendedKeybindings'
			}
		];

		const config = vscode.workspace.getConfiguration('dani-codium');
		const userActions = config.get<any[]>('quickActions', []);
		const allItems: QuickActionItem[] = [...defaultItems, ...mapUserActions(userActions)];

		const parseArgs = (args: any): any => {
			if (typeof args === 'string') {
				// Check if it's a URI-like string (e.g., file://, http://, vscode://)
				if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(args)) {
					try {
						return vscode.Uri.parse(args);
					} catch {
						return args;
					}
				}
				return args;
			}
			if (Array.isArray(args)) {
				return args.map(parseArgs);
			}
			if (args !== null && typeof args === 'object') {
				const result: any = {};
				for (const key in args) {
					result[key] = parseArgs(args[key]);
				}
				return result;
			}
			return args;
		};

		const showMenu = (items: QuickActionItem[], title?: string, onBack?: () => void) => {
			const BACKSPACE_MARKER = '\u200B';
			const quickPick = vscode.window.createQuickPick<QuickActionItem>();
			
			// Prepend the marker to all labels so they match the initial value and aren't filtered out
			quickPick.items = items.map(item => ({
				...item,
				label: BACKSPACE_MARKER + item.label
			}));
			
			quickPick.placeholder = 'Type a letter to execute an action (Backspace to go back)';
			quickPick.title = title;
			quickPick.value = BACKSPACE_MARKER;

			if (onBack) {
				quickPick.buttons = [vscode.QuickInputButtons.Back];
			}

			const executeAction = async (item: QuickActionItem) => {
				if (item.subActions) {
					quickPick.hide();
					showMenu(item.subActions, `${title ? title + ' > ' : ''}${item.description}`, () => {
						showMenu(items, title, onBack);
					});
				} else if (item.actionId) {
					quickPick.hide();
					try {
						const finalArgs = parseArgs(item.args);
						if (finalArgs !== undefined) {
							if (Array.isArray(finalArgs)) {
								await vscode.commands.executeCommand(item.actionId, ...finalArgs);
							} else {
								await vscode.commands.executeCommand(item.actionId, finalArgs);
							}
						} else {
							await vscode.commands.executeCommand(item.actionId);
						}
					} catch (err) {
						const errorMsg = err instanceof Error ? err.message : String(err);
						vscode.window.showErrorMessage(`Failed to execute command '${item.actionId}': ${errorMsg}`);
					}
				}
			};

			quickPick.onDidChangeValue(value => {
				if (onBack && value === '') {
					quickPick.hide();
					onBack();
					return;
				}

				// If value is just the marker, do nothing
				if (value === BACKSPACE_MARKER) {
					return;
				}

				// If the user somehow deleted the marker but typed something else, 
				// or if they typed a character after the marker.
				const actualInput = value.startsWith(BACKSPACE_MARKER) ? value.slice(BACKSPACE_MARKER.length) : value;
				
				if (actualInput === '') {
					return;
				}

				const matchedItem = items.find(item => item.label.toLowerCase() === actualInput.toLowerCase());
				if (matchedItem) {
					executeAction(matchedItem);
				} else {
					// If no match, reset to the marker so the next backspace works
					// and all items become visible again
					quickPick.value = BACKSPACE_MARKER;
				}
			});

			quickPick.onDidAccept(() => {
				const selectedItem = quickPick.selectedItems[0];
				if (selectedItem) {
					// Need to pass the original item without the prepended marker
					const originalItem = items.find(i => i.label === selectedItem.label.replace(BACKSPACE_MARKER, ''));
					if (originalItem) {
						executeAction(originalItem);
					}
				}
			});

			quickPick.onDidTriggerButton(button => {
				if (button === vscode.QuickInputButtons.Back && onBack) {
					quickPick.hide();
					onBack();
				}
			});

			quickPick.onDidHide(() => quickPick.dispose());
			quickPick.show();
		};

		showMenu(allItems);
	});

	context.subscriptions.push(quickActionsDisposable);
}

export function deactivate() { }
