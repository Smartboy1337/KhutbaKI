/// <reference types="vite/client" />

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

export interface DisplayItem {
  id: number;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

export interface AppCloudSettings {
  apiKey: string;
  languageCode: string;
  enableIslamicGlossary: boolean;
  customGlossary: GlossaryRule[];
  visibleBlockCount: number;
  chunkIntervalMs: number;
}

export interface PipelineSegmentResult {
  arabic: string;
  german: string;
  latencyMs: number;
  confidence?: number;
}

declare global {
interface Window {
  khutbah: {
    getObsUrl: () => Promise<{ url: string | null; error: string | null }>;
    copyObsUrl: (url?: string) => Promise<boolean>;
    listDisplays: () => Promise<DisplayItem[]>;
    openProjector: (displayId?: number) => Promise<boolean>;
    closeProjector: () => Promise<boolean>;
    isProjectorOpen: () => Promise<boolean>;
    getInitialContent: () => Promise<ProjectorPayload>;
    publishContent: (payload: ProjectorPayload) => void;
    onContent: (callback: (payload: ProjectorPayload) => void) => () => void;
    onProjectorStatus: (callback: (isOpen: boolean) => void) => () => void;
    onDisplaysChanged: (callback: (displays: DisplayItem[]) => void) => () => void;

    loadSettings: () => Promise<AppCloudSettings>;
    saveSettings: (settings: AppCloudSettings) => Promise<boolean>;
    verifyApiKey: (apiKey: string) => Promise<{ ok: boolean; message: string }>;
    processAudioSegment: (
      wavArrayBuffer: ArrayBuffer,
      meta?: { utteranceId?: number; isFinalPacket?: boolean }
    ) => Promise<PipelineSegmentResult | null>;
    translateText: (arabicText: string) => Promise<string>;
  };
}

}
