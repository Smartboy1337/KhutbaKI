import { app, BrowserWindow, clipboard, ipcMain, safeStorage, screen, session } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ISLAMIC_GLOSSARY, type GlossaryRule } from './glossary';
import { ObsOverlayServer } from './obsOverlay';
import {
  transcribeAndTranslateWav,
  translateArabicToGerman,
  verifyGoogleApiKey,
  type CloudTranslationConfig
} from './googleCloudService';

export interface LiveTranscriptBlock {
  id: string;
  arabic: string;
  german: string;
  isLiveActive?: boolean;
}

export interface ProjectorPayload {
  mode: 'de' | 'ar' | 'both';
  blocks: LiveTranscriptBlock[];
  arabic: string;
  german: string;
  fontSizeDe: number;
  fontSizeAr: number;
  lineHeight: number;
  maxWidthPercent: number;
  visibleBlockCount?: number;
  textAlign: 'left' | 'center' | 'right';
  textColor: string;
  arabicColor: string;
  backgroundColor: string;
}

interface PersistedSettings {
  encryptedApiKey?: string;
  plainApiKey?: string;
  languageCode: string;
  enableIslamicGlossary: boolean;
  customGlossary: GlossaryRule[];
  visibleBlockCount?: number;
  chunkIntervalMs?: number;
}

const obsOverlay = new ObsOverlayServer();
let obsUrlError: string | null = null;
let controlWindow: BrowserWindow | null = null;
let projectorWindow: BrowserWindow | null = null;

let latestPayload: ProjectorPayload = {
  mode: 'both',
  blocks: [],
  arabic: '',
  german: '',
  fontSizeDe: 34,
  fontSizeAr: 42,
  lineHeight: 1.55,
  maxWidthPercent: 92,
  textAlign: 'center',
  textColor: '#F5F2EB',
  arabicColor: '#F7D774',
  backgroundColor: '#030304'
};

function getSettingsFilePath(): string {
  return join(app.getPath('userData'), 'khutbah-ai-settings.json');
}

function loadSettings(): {
  apiKey: string;
  languageCode: string;
  enableIslamicGlossary: boolean;
  customGlossary: GlossaryRule[];
  visibleBlockCount: number;
  chunkIntervalMs: number;
} {
  const file = getSettingsFilePath();
  if (!existsSync(file)) {
    return {
      apiKey: '',
      languageCode: 'ar-SA',
      enableIslamicGlossary: true,
      customGlossary: DEFAULT_ISLAMIC_GLOSSARY,
      visibleBlockCount: 5,
      chunkIntervalMs: 1200
    };
  }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as PersistedSettings;
    let apiKey = '';
    if (raw.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
      apiKey = safeStorage.decryptString(Buffer.from(raw.encryptedApiKey, 'base64'));
    } else if (raw.plainApiKey) {
      apiKey = raw.plainApiKey;
    }
    return {
      apiKey,
      languageCode: raw.languageCode || 'ar-SA',
      enableIslamicGlossary: raw.enableIslamicGlossary ?? true,
      customGlossary: raw.customGlossary ?? DEFAULT_ISLAMIC_GLOSSARY,
      visibleBlockCount: raw.visibleBlockCount ?? 5,
      chunkIntervalMs: raw.chunkIntervalMs ?? 1200
    };
  } catch {
    return {
      apiKey: '',
      languageCode: 'ar-SA',
      enableIslamicGlossary: true,
      customGlossary: DEFAULT_ISLAMIC_GLOSSARY,
      visibleBlockCount: 5,
      chunkIntervalMs: 1200
    };
  }
}

function saveSettings(input: {
  apiKey: string;
  languageCode: string;
  enableIslamicGlossary: boolean;
  customGlossary: GlossaryRule[];
  visibleBlockCount?: number;
  chunkIntervalMs?: number;
}) {
  const file = getSettingsFilePath();
  const data: PersistedSettings = {
    languageCode: input.languageCode,
    enableIslamicGlossary: input.enableIslamicGlossary,
    customGlossary: input.customGlossary,
    visibleBlockCount: input.visibleBlockCount ?? 5,
    chunkIntervalMs: input.chunkIntervalMs ?? 1200
  };
  if (input.apiKey.trim()) {
    if (safeStorage.isEncryptionAvailable()) {
      data.encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString('base64');
    } else {
      data.plainApiKey = input.apiKey.trim();
    }
  }
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function getDisplayList() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label:
      d.id === primaryId
        ? `Bildschirm ${i + 1} (Hauptmonitor)`
        : `Bildschirm ${i + 1}${d.label ? ` – ${d.label}` : ''}`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primaryId
  }));
}

function broadcastDisplays() {
  const list = getDisplayList();
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('displays:changed', list);
  }
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1460,
    height: 950,
    minWidth: 1050,
    minHeight: 720,
    title: 'Khutbah AI – Moschee Al Badr',
    backgroundColor: '#060607',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    controlWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    controlWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  controlWindow.on('closed', () => {
    controlWindow = null;
    if (projectorWindow && !projectorWindow.isDestroyed()) {
      projectorWindow.close();
    }
  });
}

function openProjector(displayId?: number) {
  const displays = screen.getAllDisplays();
  const target =
    displays.find((d) => d.id === displayId) ??
    displays.find((d) => d.id !== screen.getPrimaryDisplay().id) ??
    screen.getPrimaryDisplay();

  if (projectorWindow && !projectorWindow.isDestroyed()) {
    projectorWindow.setFullScreen(false);
    projectorWindow.setBounds(target.bounds);
    projectorWindow.setFullScreen(true);
    projectorWindow.focus();
    projectorWindow.webContents.send('content:update', latestPayload);
    return;
  }

  projectorWindow = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    fullscreen: true,
    frame: false,
    backgroundColor: latestPayload.backgroundColor,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    projectorWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/projector`);
  } else {
    projectorWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: '/projector'
    });
  }

  projectorWindow.webContents.once('did-finish-load', () => {
    if (projectorWindow && !projectorWindow.isDestroyed()) {
      projectorWindow.webContents.send('content:update', latestPayload);
    }
  });

  projectorWindow.on('closed', () => {
    projectorWindow = null;
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('projector:status', false);
    }
  });

  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('projector:status', true);
  }
}

app.whenReady().then(async () => {
  try {
    await obsOverlay.start();
  } catch (error) {
    obsUrlError = error instanceof Error ? error.message : String(error);
    console.error('OBS overlay could not start:', obsUrlError);
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media';
  });

  ipcMain.handle('obs:getUrl', () => ({ url: obsOverlay.getUrl(), error: obsUrlError }));
  ipcMain.handle('obs:copyUrl', (_event, requestedUrl?: string) => {
    const base = obsOverlay.getUrl();
    if (!base) return false;
    try {
      const parsed = new URL(requestedUrl || base);
      const allowed = new URL(base);
      if (parsed.origin !== allowed.origin || parsed.pathname !== '/obs' || parsed.username || parsed.password) return false;
      const clean = new URL(base);
      if (parsed.searchParams.get('layout') === 'lower') clean.searchParams.set('layout','lower');
      const scale = Number(parsed.searchParams.get('scale'));
      if (parsed.searchParams.has('scale') && Number.isFinite(scale) && scale >= .5 && scale <= 3) clean.searchParams.set('scale',String(scale));
      clipboard.writeText(clean.toString());
      return true;
    } catch { return false; }
  });
  ipcMain.handle('displays:list', () => getDisplayList());
  ipcMain.handle('content:getInitial', () => latestPayload);
  ipcMain.handle('projector:isOpen', () => Boolean(projectorWindow && !projectorWindow.isDestroyed()));

  ipcMain.handle('projector:open', (_event, displayId?: number) => {
    openProjector(displayId);
    return true;
  });

  ipcMain.handle('projector:close', () => {
    if (projectorWindow && !projectorWindow.isDestroyed()) {
      projectorWindow.close();
    }
    return true;
  });

  ipcMain.on('content:update', (_event, payload: ProjectorPayload) => {
    latestPayload = payload;
    obsOverlay.publish(payload);
    if (projectorWindow && !projectorWindow.isDestroyed()) {
      projectorWindow.webContents.send('content:update', payload);
    }
  });

  ipcMain.handle('settings:load', () => loadSettings());

  ipcMain.handle(
    'settings:save',
    (
      _event,
      settings: {
        apiKey: string;
        languageCode: string;
        enableIslamicGlossary: boolean;
        customGlossary: GlossaryRule[];
        visibleBlockCount?: number;
        chunkIntervalMs?: number;
      }
    ) => {
      saveSettings(settings);
      return true;
    }
  );

  ipcMain.handle('cloud:verifyKey', async (_event, apiKey: string) => {
    return verifyGoogleApiKey(apiKey);
  });

  ipcMain.handle(
    'cloud:processAudioSegment',
    async (
      _event,
      wavArrayBuffer: ArrayBuffer,
      _meta?: { utteranceId?: number; isFinalPacket?: boolean },
      overrideConfig?: Partial<CloudTranslationConfig>
    ) => {
      const stored = loadSettings();
      const config: CloudTranslationConfig = {
        apiKey: overrideConfig?.apiKey ?? stored.apiKey,
        languageCode: overrideConfig?.languageCode ?? stored.languageCode,
        enableIslamicGlossary:
          overrideConfig?.enableIslamicGlossary ?? stored.enableIslamicGlossary,
        customGlossary: overrideConfig?.customGlossary ?? stored.customGlossary
      };
      const wavBuffer = Buffer.from(wavArrayBuffer);
      return transcribeAndTranslateWav(wavBuffer, config);
    }
  );

  ipcMain.handle('cloud:translateText', async (_event, arabicText: string) => {
    const stored = loadSettings();
    return translateArabicToGerman(arabicText, stored);
  });

  screen.on('display-added', broadcastDisplays);
  screen.on('display-removed', broadcastDisplays);
  screen.on('display-metrics-changed', broadcastDisplays);

  createControlWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createControlWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => obsOverlay.stop());
