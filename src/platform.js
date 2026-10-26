// Ce qui dépend du système (Windows, macOS, Linux) : navigateur sans fenêtre, tar capable de zip, polices.
// Autonome (aucun import de l'application) : utilisable par restore.js et par les tests.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

// Edge ou Chrome (ou Chromium) ; ATELIER_BROWSER force un chemin.
const BROWSERS = IS_WIN ? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
] : IS_MAC ? ['/Applications', join(homedir(), 'Applications')].flatMap((d) => [
  `${d}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
  `${d}/Google Chrome.app/Contents/MacOS/Google Chrome`,
  `${d}/Chromium.app/Contents/MacOS/Chromium`,
]) : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
export const browserPath = () => [process.env.ATELIER_BROWSER, ...BROWSERS].find((p) => p && existsSync(p));

// tar de Windows (bsdtar) : sait créer des zip, contrairement au tar de Git qui peut passer devant dans le PATH.
// macOS fournit aussi bsdtar (/usr/bin/tar).
export const TAR = IS_WIN ? (process.env.SystemRoot || 'C:/Windows').replace(/\\/g, '/') + '/System32/tar.exe' : '/usr/bin/tar';

// Fichier local → URL file:// valide (espaces, accents, lecteur Windows).
export const fileUrl = (p) => pathToFileURL(p).href;

// Polices installées : dossiers parcourus pour signaler les polices manquantes d'une sauvegarde.
const FONT_DIRS = IS_WIN ? ['C:/Windows/Fonts']
  : IS_MAC ? ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', join(homedir(), 'Library/Fonts')]
  : ['/usr/share/fonts', '/usr/local/share/fonts', join(homedir(), '.local/share/fonts')];
export const fontFileNames = () => FONT_DIRS.flatMap((d) => { try { return readdirSync(d); } catch { return []; } });

// ffmpeg : option fontsdir du filtre ass (macOS et Linux trouvent les polices installées sans elle)
// et police du bandeau BROUILLON pour drawtext (chemins déjà échappés pour un filtre ffmpeg).
export const ASS_FONTSDIR = IS_WIN ? `:fontsdir='C\\:/Windows/Fonts'` : '';
export const DRAFT_FONT = IS_WIN ? 'C\\:/Windows/Fonts/arialbd.ttf'
  : IS_MAC ? '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
  : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
