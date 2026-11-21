import { contextBridge, ipcRenderer } from 'electron';

export interface GlossaryRule {
  arabicPattern: string;
  germanReplacement: string;
}

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

contextBridge.exposeInMainWorld('khutbah', {
  getObsUrl: () => ipcRenderer.invoke('obs:getUrl'),
  copyObsUrl: (url?: string) => ipcRenderer.invoke('obs:copyUrl', url),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  openProjector: (displayId?: number) => ipcRenderer.invoke('projector:open', displayId),
  closeProjector: () => ipcRenderer.invoke('projector:close'),
  isProjectorOpen: () => ipcRenderer.invoke('projector:isOpen'),
  getInitialContent: () => ipcRenderer.invoke('content:getInitial'),
  publishContent: (payload: ProjectorPayload) => ipcRenderer.send('content:update', payload),
  onContent: (callback: (payload: ProjectorPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ProjectorPayload) =>
      callback(payload);
    ipcRenderer.on('content:update', listener);
    return () => ipcRenderer.removeListener('content:update', listener);
  },
  onProjectorStatus: (callback: (isOpen: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isOpen: boolean) => callback(isOpen);
    ipcRenderer.on('projector:status', listener);
    return () => ipcRenderer.removeListener('projector:status', listener);
  },
  onDisplaysChanged: (
    callback: (
      displays: Array<{ id: number; label: string; width: number; height: number; primary: boolean }>
    ) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      displays: Array<{ id: number; label: string; width: number; height: number; primary: boolean }>
    ) => callback(displays);
    ipcRenderer.on('displays:changed', listener);
    return () => ipcRenderer.removeListener('displays:changed', listener);
  },

  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: {
    apiKey: string;
    languageCode: string;
    enableIslamicGlossary: boolean;
    customGlossary: GlossaryRule[];
    visibleBlockCount?: number;
    chunkIntervalMs?: number;
  }) => ipcRenderer.invoke('settings:save', settings),
  verifyApiKey: (apiKey: string) => ipcRenderer.invoke('cloud:verifyKey', apiKey),
  processAudioSegment: (
    wavArrayBuffer: ArrayBuffer,
    meta?: { utteranceId?: number; isFinalPacket?: boolean }
  ) => ipcRenderer.invoke('cloud:processAudioSegment', wavArrayBuffer, meta),
  translateText: (arabicText: string) => ipcRenderer.invoke('cloud:translateText', arabicText)
});
