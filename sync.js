const fs = require('fs');
const path = require('path');
const os = require('os');
const { createScanner, parse } = require('jsonc-parser');

function getVscodeUserPath() {
  const platform = os.platform();
  const home = os.homedir();
  const editorDirName = process.env.EDITOR_DIR_NAME || 'Code';

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

  while (token !== 17) { // SyntaxKind.EOF
    const tokenText = text.substring(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength());

    if (token === 12 || token === 13) {
      if (tokenText.includes('// PRIVATE:START') || tokenText.includes('/* PRIVATE:START')) {
        inPrivateSection = true;
      }
    }

    if (!inPrivateSection) {
      result += tokenText;
    }

    if (token === 12 || token === 13) {
      if (tokenText.includes('// PRIVATE:END') || tokenText.includes('/* PRIVATE:END')) {
        inPrivateSection = false;
      }
    }

    token = scanner.scan();
  }

  try {
    parse(result);
  } catch (error) {
    throw new Error('Failed to parse resulting JSON: ' + error.message);
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
