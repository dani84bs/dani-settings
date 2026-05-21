const fs = require('fs');
const path = require('path');
const os = require('os');
const { createScanner, parse, SyntaxKind } = require('jsonc-parser');

function detectEditorDirFromEnv() {
  const envVars = [
    process.env.VSCODE_IPC_HOOK,
    process.env.VSCODE_CODE_CACHE_PATH
  ];

  for (const val of envVars) {
    if (!val) continue;

    // Check macOS: Application Support/<dir>
    let match = val.match(/Application Support[/\\]([^/\\]+)/i);
    if (match && match[1]) return match[1];

    // Check Windows: AppData/Roaming/<dir>
    match = val.match(/AppData[/\\]Roaming[/\\]([^/\\]+)/i);
    if (match && match[1]) return match[1];

    // Check Linux: .config/<dir>
    match = val.match(/\.config[/\\]([^/\\]+)/i);
    if (match && match[1]) return match[1];
  }

  // Also check other env variables specific to Antigravity
  if (process.env.ANTIGRAVITY_EDITOR_APP_ROOT) {
    return 'Antigravity IDE';
  }

  return null;
}

function detectEditorDirByMtime() {
  const platform = os.platform();
  const home = os.homedir();

  let searchDir;
  if (platform === 'win32') {
    searchDir = process.env.APPDATA;
  } else if (platform === 'darwin') {
    searchDir = path.join(home, 'Library', 'Application Support');
  } else {
    searchDir = path.join(home, '.config');
  }

  if (!searchDir || !fs.existsSync(searchDir)) {
    return null;
  }

  // Known VS Code-based editors
  const candidateDirs = ['Code', 'VSCodium', 'Antigravity IDE', 'Code - Insiders'];
  let bestDirName = null;
  let bestMtime = 0;

  for (const dirName of candidateDirs) {
    const settingsPath = path.join(searchDir, dirName, 'User', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        const stats = fs.statSync(settingsPath);
        if (stats.mtimeMs > bestMtime) {
          bestMtime = stats.mtimeMs;
          bestDirName = dirName;
        }
      } catch (e) {
        // Ignore stats errors
      }
    }
  }

  return bestDirName;
}

function getVscodeUserPath() {
  const platform = os.platform();
  const home = os.homedir();
  let editorDirName = process.env.EDITOR_DIR_NAME;

  if (!editorDirName) {
    editorDirName = detectEditorDirFromEnv();
  }

  if (!editorDirName) {
    editorDirName = detectEditorDirByMtime();
  }

  if (!editorDirName) {
    editorDirName = 'Code';
  }

  console.log(`🔍 Detected editor settings directory: ${editorDirName}`);

  if (platform === 'win32') {
    return path.join(process.env.APPDATA, editorDirName, 'User');
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', editorDirName, 'User');
  } else {
    return path.join(home, '.config', editorDirName, 'User');
  }
}

function removePrivateSection(text) {
  const scanner = createScanner(text, false);
  let result = '';
  let inPrivateSection = false;
  let token = scanner.scan();

  let lastNonTriviaToken = null;

  const allowedBeforeComma = new Set([
    SyntaxKind.CloseBraceToken,
    SyntaxKind.CloseBracketToken,
    SyntaxKind.StringLiteral,
    SyntaxKind.NumericLiteral,
    SyntaxKind.TrueKeyword,
    SyntaxKind.FalseKeyword,
    SyntaxKind.NullKeyword
  ]);

  while (token !== SyntaxKind.EOF) {
    const tokenOffset = scanner.getTokenOffset();
    const tokenLength = scanner.getTokenLength();
    const tokenText = text.substring(tokenOffset, tokenOffset + tokenLength);

    if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) {
      if (tokenText.includes('// PRIVATE:START') || tokenText.includes('/* PRIVATE:START')) {
        inPrivateSection = true;
      }
    }

    if (!inPrivateSection) {
      const isTrivia = token === SyntaxKind.LineCommentTrivia ||
                       token === SyntaxKind.BlockCommentTrivia ||
                       token === SyntaxKind.LineBreakTrivia ||
                       token === SyntaxKind.Trivia;

      let shouldAppend = true;
      if (!isTrivia) {
        if (token === SyntaxKind.CommaToken) {
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

    if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) {
      if (tokenText.includes('// PRIVATE:END') || tokenText.includes('/* PRIVATE:END')) {
        inPrivateSection = false;
      }
    }

    token = scanner.scan();
  }

  const errors = [];
  parse(result, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error('Failed to parse resulting JSON: ' + errors.map(e => `error at offset ${e.offset}`).join(', '));
  }

  return result;
}

function syncSettingsFile(src, dest, type) {
  if (fs.existsSync(src)) {
    const content = fs.readFileSync(src, 'utf8');
    let processedContent = content;
    
    // Only parse if it's a json file, though both are here
    if (src.endsWith('.json')) {
       try {
         processedContent = removePrivateSection(content);
       } catch (e) {
         console.error(`⚠️ Error processing ${type} file: ${e.message}`);
         return;
       }
    }

    fs.writeFileSync(dest, processedContent, 'utf8');
    console.log(`✅ Synchronized ${type} from ${src} (private sections excluded)`);
  } else {
    console.warn(`⚠️ Source ${type} file not found at ${src}`);
  }
}

function syncFiles() {
  const userPath = getVscodeUserPath();
  const assetsPath = path.join(__dirname, 'assets');

  const settingsSrc = path.join(userPath, 'settings.json');
  const keybindingsSrc = path.join(userPath, 'keybindings.json');

  const settingsDest = path.join(assetsPath, 'recommended_settings.json');
  const keybindingsDest = path.join(assetsPath, 'recommended_keybindings.json');

  if (!fs.existsSync(assetsPath)) {
    fs.mkdirSync(assetsPath, { recursive: true });
  }

  try {
    syncSettingsFile(settingsSrc, settingsDest, 'settings');
    syncSettingsFile(keybindingsSrc, keybindingsDest, 'keybindings');
  } catch (error) {
    console.error('Error synchronizing files:', error);
    process.exit(1);
  }
}

syncFiles();
