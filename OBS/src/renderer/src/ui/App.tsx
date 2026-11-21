import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Radio,
  Settings2,
  Languages,
  Play,
  Pause,
  Square,
  Wifi,
  Cpu,
  Mic2,
  Minus,
  Plus,
  Maximize2,
  X,
  Volume2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Sliders,
  KeyRound,
  Send,
  Trash2,
  Zap,
  Copy,
  Video
} from 'lucide-react';
import { useAudioMonitor, type SpeechChunkPacket } from '../audio/useAudioMonitor';
import albadrLogo from '../assets/albadr-logo.png';
import type { DisplayItem, GlossaryRule, LiveTranscriptBlock, ProjectorPayload } from '../vite-env';

type Mode = 'de' | 'ar' | 'both';
type ActiveTab = 'live' | 'settings';

function SmoothLiveText({
  text,
  isLiveActive,
  className,
  style
}: {
  text: string;
  isLiveActive?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <p className={className} style={style}>
      {text}
      {isLiveActive && (
        <span
          style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: '#d4af37',
            marginLeft: '8px',
            verticalAlign: 'middle',
            opacity: 0.85
          }}
        />
      )}
    </p>
  );
}

export default function App() {
  const isProjector = window.location.hash.includes('projector');

  // Anzeige- & Layout-Einstellungen
  const [mode, setMode] = useState<Mode>('both');
  const [fontSizeDe, setFontSizeDe] = useState<number>(34);
  const [fontSizeAr, setFontSizeAr] = useState<number>(42);
  const [lineHeight, setLineHeight] = useState<number>(1.55);
  const [maxWidthPercent, setMaxWidthPercent] = useState<number>(92);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center');
  const [textColor, setTextColor] = useState<string>('#F5F2EB');
  const [arabicColor, setArabicColor] = useState<string>('#F7D774');
  const [backgroundColor, setBackgroundColor] = useState<string>('#030304');

  // Echtzeit-Geschwindigkeit & Mehrzeilen-Anzeige
  const [visibleBlockCount, setVisibleBlockCount] = useState<number>(5);
  const [chunkIntervalMs, setChunkIntervalMs] = useState<number>(1200);

  // Google Cloud Einstellungen
  const [apiKey, setApiKey] = useState<string>('');
  const [languageCode, setLanguageCode] = useState<string>('ar-SA');
  const [enableIslamicGlossary, setEnableIslamicGlossary] = useState<boolean>(true);
  const [customGlossary, setCustomGlossary] = useState<GlossaryRule[]>([]);
  const [keyVerifyStatus, setKeyVerifyStatus] = useState<{ ok: boolean; message: string } | null>(
    null
  );
  const [isVerifyingKey, setIsVerifyingKey] = useState<boolean>(false);

  // Sitzungs- & Pipeline-Status
  const [activeTab, setActiveTab] = useState<ActiveTab>('live');
  const [running, setRunning] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [projectorOpen, setProjectorOpen] = useState<boolean>(false);
  const [obsUrl, setObsUrl] = useState<string | null>(null);
  const [obsError, setObsError] = useState<string | null>(null);
  const [obsCopied, setObsCopied] = useState<'room' | 'stream' | null>(null);
  const [obsRoomScale, setObsRoomScale] = useState(1);
  const [obsStreamScale, setObsStreamScale] = useState(1);
  const [obsCaptionLines, setObsCaptionLines] = useState(2);
  const [obsCaptionBg, setObsCaptionBg] = useState(0.65);
  const [obsCaptionBottom, setObsCaptionBottom] = useState(5);
  const [displays, setDisplays] = useState<DisplayItem[]>([]);
  const [displayId, setDisplayId] = useState<number | undefined>();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  const [pipelineBusy, setPipelineBusy] = useState<boolean>(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  // Mehrere fortlaufende Textblöcke für Beamer & Vorschau
  const [blocks, setBlocks] = useState<LiveTranscriptBlock[]>([]);

  // Latest-Wins-Puffer: Verhindert Rückstau bei schnellem Sprechen!
  const latestPacketRef = useRef<SpeechChunkPacket | null>(null);
  const pendingFinalPacketsRef = useRef<SpeechChunkPacket[]>([]);
  const finalProcessingRef = useRef(false);
  const liveProcessingRef = useRef(false);
  const newestFinalIdRef = useRef(0);
  const queuedAtRef = useRef(new WeakMap<SpeechChunkPacket, number>());
  const generationRef = useRef(0);
  const backlogPausedRef = useRef(false);
  const runningRef = useRef<boolean>(false);
  const pausedRef = useRef<boolean>(false);
  const finalizedIdsRef = useRef<Set<number>>(new Set());
  const visibleBlockCountRef = useRef<number>(visibleBlockCount);

  useEffect(() => {
    runningRef.current = running;
    pausedRef.current = paused;
  }, [running, paused]);

  useEffect(() => {
    visibleBlockCountRef.current = visibleBlockCount;
  }, [visibleBlockCount]);

  const upsertTranscriptBlock = useCallback(
    (utteranceId: number, arabicText: string, germanText: string, isFinal: boolean) => {
      if (!isFinal && finalizedIdsRef.current.has(utteranceId)) {
        return;
      }
      if (isFinal) {
        finalizedIdsRef.current.add(utteranceId);
      }
      const blockId = `utt-${utteranceId}`;
      setBlocks((prev) => {
        const baseList = prev;

        const existingIndex = baseList.findIndex((b) => b.id === blockId);
        let updated: LiveTranscriptBlock[];

        if (existingIndex >= 0) {
          updated = [...baseList];
          updated[existingIndex] = {
            id: blockId,
            arabic: arabicText,
            german: germanText,
            isLiveActive: !isFinal
          };
        } else {
          // Never label a speculative result as confirmed without a final response.
          const finalizedPrev = baseList.filter((b) => !b.isLiveActive);
          updated = [
            ...finalizedPrev,
            {
              id: blockId,
              arabic: arabicText,
              german: germanText,
              isLiveActive: !isFinal
            }
          ];
        }

        // Immer die letzten N Absätze auf dem Beamer sichtbar halten
        const maxKeep = Math.max(2, visibleBlockCountRef.current);
        return updated.slice(-maxKeep);
      });
    },
    []
  );

  // Two independent lanes: one ordered final lane and one latest-only preview lane.
  // A preview must never replace a final or jump ahead of a waiting final.
  const processPacket = useCallback(async (packet: SpeechChunkPacket) => {
    const generation = generationRef.current;
    const stillCurrent = () => generation === generationRef.current && (packet.isFinalPacket || (
      runningRef.current && !pausedRef.current && packet.utteranceId > newestFinalIdRef.current &&
      !finalProcessingRef.current && pendingFinalPacketsRef.current.length === 0
    ));
    try {
      const result = await window.khutbah.processAudioSegment(packet.wavBuffer, {
        utteranceId: packet.utteranceId, isFinalPacket: packet.isFinalPacket
      });
      if (!stillCurrent()) return;
      if (result?.arabic && result.german) {
        if (!backlogPausedRef.current) setPipelineError(null);
        // Include time spent waiting in the queue, not just cloud request time.
        setLastLatencyMs(Date.now() - (queuedAtRef.current.get(packet) ?? Date.now() - result.latencyMs));
        upsertTranscriptBlock(packet.utteranceId, result.arabic, result.german, packet.isFinalPacket);
      } else if (packet.isFinalPacket) {
        setBlocks(prev => prev.filter(b => b.id !== `utt-${packet.utteranceId}`));
      }
    } catch (err) {
      if (!stillCurrent()) return;
      if (packet.isFinalPacket) setBlocks(prev => prev.filter(b => b.id !== `utt-${packet.utteranceId}`));
      setPipelineError(err instanceof Error ? err.message : 'Fehler bei Live-Spracherkennung/Übersetzung.');
    }
  }, [upsertTranscriptBlock]);

  const drainLivePackets = useCallback(() => {
    const updateBusy = () => setPipelineBusy(finalProcessingRef.current || liveProcessingRef.current);
    // Start final packets immediately, even if an old preview is still in flight.
    if (!finalProcessingRef.current && pendingFinalPacketsRef.current.length > 0) {
      finalProcessingRef.current = true;
      updateBusy();
      void (async () => {
        try {
          while (pendingFinalPacketsRef.current.length > 0) {
            await processPacket(pendingFinalPacketsRef.current.shift()!);
          }
        } finally {
          finalProcessingRef.current = false;
          updateBusy();
          drainLivePackets();
        }
      })();
    }
    // Prioritize final speech; keep only the newest unsent preview under load.
    if (!liveProcessingRef.current && !finalProcessingRef.current && latestPacketRef.current &&
        runningRef.current && !pausedRef.current) {
      liveProcessingRef.current = true;
      updateBusy();
      const packet = latestPacketRef.current;
      latestPacketRef.current = null;
      void processPacket(packet).finally(() => {
        liveProcessingRef.current = false;
        updateBusy();
        drainLivePackets();
      });
    }
  }, [processPacket]);

  const handleSpeechPacketReady = useCallback(
    (packet: SpeechChunkPacket) => {
      if (!runningRef.current || pausedRef.current) return;

      queuedAtRef.current.set(packet, Date.now());
      if (packet.isFinalPacket) {
        newestFinalIdRef.current = Math.max(newestFinalIdRef.current, packet.utteranceId);
        // Wenn das finale Paket desselben Satzes kommt, verwerfe älteren Zwischenstand derselben ID
        if (latestPacketRef.current?.utteranceId === packet.utteranceId) {
          latestPacketRef.current = null;
        }
        pendingFinalPacketsRef.current.push(packet);
        // Never silently delete finished speech. In an exceptional backlog, pause capture
        // and process all already queued final packets in order.
        if (pendingFinalPacketsRef.current.length >= 5) {
          latestPacketRef.current = null;
          backlogPausedRef.current = true;
          pausedRef.current = true;
          setPaused(true);
          setPipelineError('Google Cloud ist zu langsam. Aufnahme pausiert; vorhandene Abschnitte werden verarbeitet. Danach bitte Fortsetzen drücken.');
        }
      } else {
        // Immer nur den aktuellsten Live-Zwischenstand halten (kein Lag!)
        latestPacketRef.current = packet;
      }

      void drainLivePackets();
    },
    [drainLivePackets]
  );

  const audio = useAudioMonitor({
    chunkIntervalMs,
    onSpeechPacketReady: handleSpeechPacketReady
  });

  useEffect(() => {
    audio.setSpeechCaptureActive(running, paused);
  }, [running, paused, audio]);

  // Gespeicherte Cloud-Einstellungen laden
  useEffect(() => {
    if (isProjector) return;
    window.khutbah
      .loadSettings()
      .then((s) => {
        setApiKey(s.apiKey || '');
        setLanguageCode(s.languageCode || 'ar-SA');
        setEnableIslamicGlossary(s.enableIslamicGlossary ?? true);
        setCustomGlossary(s.customGlossary ?? []);
        if (s.visibleBlockCount) setVisibleBlockCount(s.visibleBlockCount);
        if (s.chunkIntervalMs) setChunkIntervalMs(s.chunkIntervalMs);
      })
      .catch(() => {});
  }, [isProjector]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Monitore & Beamer-Zustand synchronisieren
  useEffect(() => {
    if (isProjector) {
      window.khutbah.getInitialContent().then((p) => {
        setMode(p.mode);
        setBlocks(
          p.blocks ?? (p.arabic || p.german ? [{ id: 'legacy', arabic: p.arabic, german: p.german }] : [])
        );
        setFontSizeDe(p.fontSizeDe);
        setFontSizeAr(p.fontSizeAr);
        setLineHeight(p.lineHeight);
        setMaxWidthPercent(p.maxWidthPercent);
        setTextAlign(p.textAlign);
        setTextColor(p.textColor);
        setArabicColor(p.arabicColor);
        setBackgroundColor(p.backgroundColor);
      });
      return window.khutbah.onContent((p) => {
        setMode(p.mode);
        setBlocks(
          p.blocks ?? (p.arabic || p.german ? [{ id: 'legacy', arabic: p.arabic, german: p.german }] : [])
        );
        setFontSizeDe(p.fontSizeDe);
        setFontSizeAr(p.fontSizeAr);
        setLineHeight(p.lineHeight);
        setMaxWidthPercent(p.maxWidthPercent);
        setTextAlign(p.textAlign);
        setTextColor(p.textColor);
        setArabicColor(p.arabicColor);
        setBackgroundColor(p.backgroundColor);
      });
    }

    window.khutbah
      .listDisplays()
      .then((items) => {
        setDisplays(items);
        setDisplayId(items.find((x) => !x.primary)?.id ?? items[0]?.id);
      })
      .catch(() => setDisplays([]));

    window.khutbah.isProjectorOpen().then(setProjectorOpen);
    window.khutbah.getObsUrl().then(({ url, error }) => {
      setObsUrl(url);
      setObsError(error);
    }).catch(() => setObsError('OBS-Ausgabe konnte nicht abgefragt werden.'));

    const unsubDisplays = window.khutbah.onDisplaysChanged((items) => {
      setDisplays(items);
      setDisplayId((prev) =>
        items.some((d) => d.id === prev)
          ? prev
          : items.find((x) => !x.primary)?.id ?? items[0]?.id
      );
    });

    const unsubProj = window.khutbah.onProjectorStatus(setProjectorOpen);

    return () => {
      unsubDisplays();
      unsubProj();
    };
  }, [isProjector]);

  // Jede Text-/Layout-Änderung live an den Beamer senden
  useEffect(() => {
    if (isProjector) return;
    const latest = blocks[blocks.length - 1];
    const payload: ProjectorPayload = {
      mode,
      blocks,
      arabic: latest?.arabic ?? '',
      german: latest?.german ?? '',
      fontSizeDe,
      fontSizeAr,
      lineHeight,
      maxWidthPercent,
      visibleBlockCount,
      textAlign,
      textColor,
      arabicColor,
      backgroundColor
    };
    window.khutbah.publishContent(payload);
  }, [
    mode,
    blocks,
    fontSizeDe,
    fontSizeAr,
    lineHeight,
    maxWidthPercent,
    visibleBlockCount,
    textAlign,
    textColor,
    arabicColor,
    backgroundColor,
    isProjector
  ]);

  // Two independently configurable OBS browser sources, sharing one Google translation stream.
  const obsRoomUrl = obsUrl ? `${obsUrl.replace(/\/obs$/, '/obs')}?layout=full&scale=${obsRoomScale}` : '';
  const obsStreamUrl = obsUrl ? `${obsUrl.replace(/\/obs$/, '/obs')}?layout=captions&mode=de&scale=${obsStreamScale}&captionLines=${obsCaptionLines}&captionBg=${obsCaptionBg}&captionBottom=${obsCaptionBottom}` : '';

  const visibleText = useMemo(
    () => ({ showAr: mode !== 'de', showDe: mode !== 'ar' }),
    [mode]
  );

  // =========================================================================
  // BEAMER-FENSTER (VOLLBILD MIT MEHREREN FORTLAUFENDEN ABSÄTZEN)
  // =========================================================================
  if (isProjector) {
    return (
      <main className="projector" style={{ backgroundColor }}>
        <div
          className="projector-inner"
          style={{
            maxWidth: `${maxWidthPercent}%`,
            textAlign,
            display: 'flex',
            flexDirection: 'column',
            gap: '26px',
            justifyContent: 'flex-end',
            maxHeight: '90vh',
            overflow: 'hidden'
          }}
        >
          {blocks.map((block, idx) => {
            const opacity = 1;

            return (
              <div
                key={block.id}
                style={{
                  opacity,
                  transition: 'opacity 180ms ease',
                  borderBottom:
                    idx < blocks.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                  paddingBottom: idx < blocks.length - 1 ? '18px' : '0'
                }}
              >
                {visibleText.showAr && (
                  <SmoothLiveText
                    text={block.arabic}
                    isLiveActive={block.isLiveActive}
                    className="projector-ar"
                    style={{
                      fontSize: `${fontSizeAr}px`,
                      lineHeight,
                      color: arabicColor,
                      marginBottom: visibleText.showDe ? '10px' : '0'
                    }}
                  />
                )}
                {visibleText.showDe && (
                  <SmoothLiveText
                    text={block.german}
                    isLiveActive={block.isLiveActive}
                    className="projector-de"
                    style={{
                      fontSize: `${fontSizeDe}px`,
                      lineHeight,
                      color: textColor
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="projector-mark">IGB E.V. AL BADR · KHUTBAH AI LIVE</div>
      </main>
    );
  }

  // =========================================================================
  // STEUERUNGS-AKTIONEN
  // =========================================================================
  const hasApiKey = apiKey.trim().length > 10;

  const handleStartSession = async () => {
    if (backlogPausedRef.current && (pendingFinalPacketsRef.current.length > 0 || finalProcessingRef.current)) {
      setPipelineError('Bitte warten, bis die bereits aufgenommenen Abschnitte verarbeitet sind.');
      return;
    }
    backlogPausedRef.current = false;
    setPipelineError(null);
    if (!hasApiKey) {
      setActiveTab('settings');
      setPipelineError('Bitte hinterlege zuerst deinen Google Cloud API-Schlüssel.');
      return;
    }
    if (!audio.isMonitoring) {
      await audio.startMonitoring();
    }
    runningRef.current = true;
    pausedRef.current = false;
    setRunning(true);
    setPaused(false);
  };

  const handleStopSession = () => {
    runningRef.current = false;
    pausedRef.current = false;
    generationRef.current += 1;
    backlogPausedRef.current = false;
    setRunning(false);
    setPaused(false);
    latestPacketRef.current = null;
    pendingFinalPacketsRef.current = [];
    audio.discardCurrentSpeechSegment();
    setBlocks((prev) => prev.filter((b) => !b.isLiveActive));
  };

  const handleClearScreen = () => {
    generationRef.current += 1;
    latestPacketRef.current = null;
    pendingFinalPacketsRef.current = [];
    audio.discardCurrentSpeechSegment();
    finalizedIdsRef.current.clear();
    setBlocks([]);
  };

  const handleSaveAndVerifyKey = async () => {
    setIsVerifyingKey(true);
    setKeyVerifyStatus(null);
    try {
      await window.khutbah.saveSettings({
        apiKey: apiKey.trim(),
        languageCode,
        enableIslamicGlossary,
        customGlossary,
        visibleBlockCount,
        chunkIntervalMs
      });
      const res = await window.khutbah.verifyApiKey(apiKey.trim());
      setKeyVerifyStatus(res);
    } catch (err) {
      setKeyVerifyStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'Speichern fehlgeschlagen.'
      });
    } finally {
      setIsVerifyingKey(false);
    }
  };

  const handleTestLiveTranslation = async () => {
    if (!hasApiKey) {
      setActiveTab('settings');
      return;
    }
    setPipelineError(null);
    setPipelineBusy(true);
    const t0 = Date.now();
    const generation = generationRef.current;
    try {
      const sampleAr = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ، الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ';
      const translated = await window.khutbah.translateText(sampleAr);
      if (translated && generation === generationRef.current) {
        upsertTranscriptBlock(Date.now(), sampleAr, translated, true);
        setLastLatencyMs(Date.now() - t0);
      }
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : 'Übersetzungstest fehlgeschlagen.');
    } finally {
      setPipelineBusy(false);
    }
  };

  const applyPresetProfile = (preset: 'de-large' | 'bilingual' | 'ar-only') => {
    if (preset === 'de-large') {
      setMode('de');
      setFontSizeDe(46);
      setVisibleBlockCount(6);
      setLineHeight(1.45);
      setMaxWidthPercent(94);
      setTextAlign('center');
      setTextColor('#FFFFFF');
      setBackgroundColor('#030304');
    } else if (preset === 'bilingual') {
      setMode('both');
      setFontSizeAr(40);
      setFontSizeDe(32);
      setVisibleBlockCount(5);
      setLineHeight(1.55);
      setMaxWidthPercent(92);
      setTextAlign('center');
      setArabicColor('#F7D774');
      setTextColor('#F5F2EB');
      setBackgroundColor('#030304');
    } else if (preset === 'ar-only') {
      setMode('ar');
      setFontSizeAr(52);
      setVisibleBlockCount(5);
      setLineHeight(1.65);
      setMaxWidthPercent(92);
      setTextAlign('center');
      setArabicColor('#F7D774');
      setBackgroundColor('#030304');
    }
  };

  const thresholdPercent = Math.round(((audio.thresholdDb + 60) / 60) * 100);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="albadr-brand-box">
          <img src={albadrLogo} alt="IGB e.V. Al Badr Logo" className="albadr-logo-img" />
          <div className="albadr-title-row">
            <b>Khutbah AI</b>
            <span className="edition-badge">AL BADR</span>
          </div>
          <span className="albadr-subtitle">Moschee Al Badr · IGB e.V.</span>
        </div>

        <div className="nav-label">AL BADR WORKSPACE</div>
        <div
          className={`nav-item ${activeTab === 'live' ? 'active' : ''}`}
          onClick={() => setActiveTab('live')}
        >
          <AudioLines size={18} /> Live-Übersetzung
          {activeTab === 'live' && <span className="nav-dot" />}
        </div>
        <div
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings2 size={18} /> Layout, API & Tempo
          {activeTab === 'settings' && <span className="nav-dot" />}
        </div>

        <div className="sidebar-bottom">
          <div className="privacy">
            <div className="privacy-dot" />
            <div>
              <b>Datenschutz aktiv</b>
              <small>Audio nur im RAM · Keine Speicherung</small>
            </div>
          </div>
          <small className="version">IGB E.V. AL BADR · ULTRA-FAST STREAM</small>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">FREITAGSPREDIGT / ECHTZEIT-STEUERUNG · AL BADR</div>
            <h1>
              {activeTab === 'live'
                ? 'Live-Übersetzung (Freitagspredigt)'
                : 'Layout, Google Cloud API & Tempo'}
            </h1>
          </div>
          <div className="top-status">
            <span className="status-pill">
              <span
                className="dot"
                style={{
                  background: running ? (paused ? '#f59e0b' : '#10b981') : '#d4af37'
                }}
              />
              {running
                ? paused
                  ? 'Sitzung pausiert'
                  : `Live-Stream aktiv (${(chunkIntervalMs / 1000).toFixed(1)}s Takt)`
                : 'System bereit'}
            </span>
            <div className="mosque-badge-pill">Moschee Al Badr</div>
          </div>
        </header>

        <section className="status-grid">
          <Status
            icon={<Mic2 />}
            label="MIKROFON / MISCHPULT"
            value={
              audio.permissionError
                ? 'Zugriffsfehler'
                : audio.isMonitoring
                  ? audio.isClipping
                    ? 'Übersteuerung!'
                    : `Aktiv (${audio.dbFs} dB)`
                  : 'Bereit'
            }
            state={
              audio.permissionError
                ? 'error'
                : audio.isMonitoring
                  ? audio.isClipping
                    ? 'warn'
                    : 'ok'
                  : 'neutral'
            }
          />
          <Status
            icon={<Wifi />}
            label="NETZWERK"
            value={isOnline ? 'Online (Verbunden)' : 'Offline!'}
            state={isOnline ? 'ok' : 'error'}
          />
          <Status
            icon={<Radio />}
            label="ECHTZEIT-ERKENNUNG"
            value={
              !hasApiKey
                ? 'API-Key fehlt'
                : running
                  ? pipelineBusy
                    ? 'Übersetzt live…'
                    : 'Aktiv (' + languageCode + ')'
                  : 'Bereit (' + languageCode + ')'
            }
            state={!hasApiKey ? 'warn' : running ? 'ok' : 'neutral'}
          />
          <Status
            icon={<Cpu />}
            label="BEAMER-TEXTBLÖCKE"
            value={`${blocks.length} von ${visibleBlockCount} Absätzen`}
            state="ok"
          />
        </section>

        {!hasApiKey && (
          <div
            className="audio-note"
            style={{
              marginBottom: '16px',
              borderColor: '#f59e0b',
              color: '#fde68a',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <KeyRound size={18} style={{ flexShrink: 0 }} />
              <span>
                Hinterlege deinen Google Cloud API-Schlüssel (<code>AIza...</code>), um die
                Echtzeit-Übersetzung zu starten.
              </span>
            </div>
            <button
              className="primary-button"
              style={{ flex: 'none', padding: '0 14px', height: '32px' }}
              onClick={() => setActiveTab('settings')}
            >
              API-Key eintragen
            </button>
          </div>
        )}

        {activeTab === 'live' ? (
          <>
            <section className="control-grid">
              {/* Karte 1: Audio-Monitoring */}
              <div className="panel audio-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">AUDIOQUELLE (MISCHPULT)</span>
                    <h2>Eingangssignal & Pegel</h2>
                  </div>
                  <span className={`tag ${audio.isMonitoring ? 'ready-tag' : 'muted'}`}>
                    {audio.isMonitoring ? 'SIGNAL AKTIV' : 'BEREIT'}
                  </span>
                </div>

                <label className="field-label">AUDIO-EINGABEGERÄT</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    value={audio.selectedDeviceId}
                    onChange={(e) => audio.selectDevice(e.target.value)}
                  >
                    {audio.devices.length === 0 && (
                      <option value="default">Standard-Eingabegerät (Mischpult / Mikrofon)</option>
                    )}
                    {audio.devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary-button"
                    title="Geräteliste aktualisieren"
                    onClick={() => audio.refreshDevices()}
                    style={{ height: '39px', padding: '0 11px' }}
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>

                <div className="meter-head">
                  <span>
                    LIVE-EINGANGSPEGEL{' '}
                    {audio.isMonitoring && (
                      <strong
                        style={{
                          marginLeft: '8px',
                          color: audio.isClipping
                            ? '#ef4444'
                            : audio.isAboveThreshold
                              ? '#22c55e'
                              : '#94a3b8'
                        }}
                      >
                        {audio.isClipping
                          ? '● CLIPPING!'
                          : audio.isAboveThreshold
                            ? '● Sprache aktiv'
                            : '○ Leise'}
                      </strong>
                    )}
                  </span>
                  <span className="db">{audio.isMonitoring ? `${audio.dbFs} dBFS` : '— dBFS'}</span>
                </div>

                <div className="meter" style={{ position: 'relative' }}>
                  <div
                    className="meter-fill"
                    style={{
                      width: `${audio.meterPercent}%`,
                      transition: 'width 60ms linear'
                    }}
                  />
                  <div
                    title={`Pegel-Schwelle: ${audio.thresholdDb} dBFS`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${thresholdPercent}%`,
                      width: '2px',
                      background: '#f8fafc',
                      boxShadow: '0 0 6px #000'
                    }}
                  />
                </div>
                <div className="meter-scale">
                  <span>−60 dB</span>
                  <span>−30 dB</span>
                  <span>−12 dB</span>
                  <span>0 dB (Clip)</span>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button
                    className="secondary-button"
                    style={{
                      flex: 1,
                      height: '32px',
                      fontSize: '12px',
                      borderColor: audio.inputProfile === 'headset' ? '#d4af37' : undefined,
                      color: audio.inputProfile === 'headset' ? '#f6d878' : undefined
                    }}
                    onClick={() => audio.applyInputProfile('headset')}
                  >
                    Headset (Gain 175%)
                  </button>
                  <button
                    className="secondary-button"
                    style={{
                      flex: 1,
                      height: '32px',
                      fontSize: '12px',
                      borderColor: audio.inputProfile === 'mosque-mic' ? '#d4af37' : undefined,
                      color: audio.inputProfile === 'mosque-mic' ? '#f6d878' : undefined
                    }}
                    onClick={() => audio.applyInputProfile('mosque-mic')}
                  >
                    Moschee-Mikrofon (115%)
                  </button>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '12px',
                    marginTop: '12px'
                  }}
                >
                  <div>
                    <div className="meter-head" style={{ margin: '0 0 6px' }}>
                      <span>VERSTÄRKUNG (GAIN)</span>
                      <span className="db">{audio.gainPercent}%</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={400}
                      step={5}
                      value={audio.gainPercent}
                      onChange={(e) => audio.setGainPercent(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#d4af37' }}
                    />
                  </div>
                  <div>
                    <div className="meter-head" style={{ margin: '0 0 6px' }}>
                      <span>PEGEL-SCHWELLE</span>
                      <span className="db">{audio.thresholdDb} dB</span>
                    </div>
                    <input
                      type="range"
                      min={-58}
                      max={-10}
                      step={1}
                      value={audio.thresholdDb}
                      onChange={(e) => audio.setThresholdDb(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#d4af37' }}
                    />
                  </div>
                </div>

                {audio.permissionError && (
                  <div
                    className="audio-note"
                    style={{ borderColor: '#ef4444', color: '#fca5a5' }}
                  >
                    <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                    <span>{audio.permissionError}</span>
                  </div>
                )}

                {audio.testReport && (
                  <div
                    className="audio-note"
                    style={{ borderColor: '#22c55e', color: '#bbf7d0' }}
                  >
                    <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                    <span>{audio.testReport}</span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  {!audio.isMonitoring ? (
                    <button
                      className="secondary-button"
                      style={{ height: '36px', flex: 1 }}
                      onClick={() => audio.startMonitoring()}
                    >
                      <Volume2 size={16} /> Pegel prüfen
                    </button>
                  ) : (
                    <button
                      className="secondary-button"
                      style={{ height: '36px', flex: 1 }}
                      onClick={() => audio.stopMonitoring()}
                    >
                      Pegel stoppen
                    </button>
                  )}

                  <button
                    className="secondary-button"
                    style={{ height: '36px', flex: 1 }}
                    disabled={audio.testState === 'recording' || audio.testState === 'playing'}
                    onClick={() => audio.runAudioTest()}
                  >
                    <AudioLines size={16} />
                    {audio.testState === 'recording'
                      ? 'Nimmt 3,5s auf…'
                      : audio.testState === 'playing'
                        ? 'Spielt Test ab…'
                        : 'Audiotest (3,5s)'}
                  </button>
                </div>
              </div>

              {/* Karte 2: Live-Sitzung (Ultra-Fast Stream) */}
              <div className="panel session-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">ECHTZEIT-PIPELINE (OHNE PAUSEN-WARTEN)</span>
                    <h2>Live-Sitzung</h2>
                  </div>
                  <span className={`tag ${running ? 'live-tag' : 'muted'}`}>
                    {running ? (paused ? 'PAUSIERT' : 'ECHTZEIT AKTIV') : 'BEREIT'}
                  </span>
                </div>

                <div className="session-display" style={{ height: '142px' }}>
                  <div className="session-symbol">
                    <Zap size={24} />
                  </div>
                  <b>
                    {running
                      ? paused
                        ? 'Übersetzung pausiert'
                        : pipelineBusy
                          ? 'Aktualisiert Text live…'
                          : 'Kontinuierliche Live-Übersetzung aktiv'
                      : 'Bereit für sofortige Live-Übersetzung'}
                  </b>
                  <p>
                    {running
                      ? `Erstellt ca. alle ${(chunkIntervalMs / 1000).toFixed(1)}s einen Zwischenstand. Fertige Abschnitte haben Vorrang.`
                      : 'Klicke auf „Starten“, um sofort ohne Verzögerung mitzuschreiben und zu übersetzen.'}
                  </p>
                </div>

                {/* Direkt-Regler für Aktualisierungs-Takt & Textmenge */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '12px',
                    marginTop: '10px'
                  }}
                >
                  <div>
                    <div className="meter-head" style={{ margin: '0 0 4px' }}>
                      <span>LIVE-TAKT (SPEED)</span>
                      <span className="db">{(chunkIntervalMs / 1000).toFixed(1)} Sek.</span>
                    </div>
                    <input
                      type="range"
                      min={800}
                      max={2500}
                      step={200}
                      value={chunkIntervalMs}
                      onChange={(e) => setChunkIntervalMs(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#d4af37' }}
                    />
                  </div>
                  <div>
                    <div className="meter-head" style={{ margin: '0 0 4px' }}>
                      <span>ABSÄTZE AUF BEAMER</span>
                      <span className="db">{visibleBlockCount} Blöcke</span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={10}
                      step={1}
                      value={visibleBlockCount}
                      onChange={(e) => setVisibleBlockCount(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#d4af37' }}
                    />
                  </div>
                </div>

                {pipelineError && (
                  <div
                    className="audio-note"
                    style={{ borderColor: '#ef4444', color: '#fca5a5', marginTop: '8px' }}
                  >
                    <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                    <span>{pipelineError}</span>
                  </div>
                )}

                <div className="session-actions">
                  <button
                    className="primary-button"
                    onClick={handleStartSession}
                    disabled={running && !paused}
                  >
                    <Play size={17} fill="currentColor" /> {paused ? 'Fortsetzen' : 'Starten'}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      pausedRef.current = true;
                      latestPacketRef.current = null;
                      setPaused(true);
                    }}
                    disabled={!running || paused}
                  >
                    <Pause size={17} /> Pause
                  </button>
                  <button
                    className="secondary-button"
                    onClick={handleClearScreen}
                    title="Bildschirm leeren"
                  >
                    <Trash2 size={15} /> Leeren
                  </button>
                  <button
                    className="stop-button"
                    onClick={handleStopSession}
                    disabled={!running}
                    title="Sitzung beenden"
                  >
                    <Square size={15} fill="currentColor" />
                  </button>
                </div>

                <div className="latency-row">
                  <span>LETZTE PAKETZEIT (INKL. WARTEN)</span>
                  <b>{lastLatencyMs !== null ? `${(lastLatencyMs / 1000).toFixed(2)} Sek.` : '—'}</b>
                </div>
              </div>
            </section>

            {/* Karte 3: Beamer-Steuerung & Mehrzeilen-Live-Vorschau */}
            <section className="panel projector-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">AUSGABE / ZWEITER BILDSCHIRM</span>
                  <h2>Beamer-Steuerung</h2>
                </div>
                <span className={`tag ${projectorOpen ? 'live-tag' : 'ready-tag'}`}>
                  {projectorOpen ? 'BEAMER AKTIV (VOLLBILD)' : 'FENSTER VERFÜGBAR'}
                </span>
              </div>

              <div className="projector-controls">
                <div className="display-select">
                  <label className="field-label">ZIELBILDSCHIRM</label>
                  <select
                    value={displayId ?? ''}
                    onChange={(e) => setDisplayId(Number(e.target.value))}
                  >
                    {displays.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label} · {d.width}×{d.height}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="open-projector"
                  onClick={() => window.khutbah.openProjector(displayId)}
                >
                  <Maximize2 size={17} /> {projectorOpen ? 'Auf Bildschirm verschieben' : 'Beamer öffnen'}
                </button>

                {projectorOpen && (
                  <button
                    className="stop-button"
                    style={{ width: 'auto', padding: '0 14px', height: '39px' }}
                    onClick={() => window.khutbah.closeProjector()}
                  >
                    <X size={16} /> Schließen
                  </button>
                )}
              </div>

              <div className="obs-export-panel">
                <div className="obs-export-title"><Video size={18} /> <strong>OBS Studio – Zwei Ausgaben</strong></div>
                <p>Ein Programm, eine Google-Übersetzung, zwei unabhängige Browser-Quellen. Beide Quellen können gleichzeitig in OBS verwendet werden.</p>
                {obsUrl ? (
                  <>
                    <div className="obs-dual-grid">
                      <section className="obs-output-card" aria-label="OBS-Quelle Raum">
                        <div className="obs-output-heading"><strong>1 · Raum / Großbild</strong><span>Wie Beamer</span></div>
                        <p>Fortlaufender Text für den zweiten Raum. Sprache, Schrift, Farben und Absatzanzahl folgen den Beamer-Einstellungen weiter unten.</p>
                        <label>Schriftgröße Raum: {Math.round(obsRoomScale * 100)} %
                          <input type="range" min="0.5" max="2.5" step="0.1" value={obsRoomScale} onChange={(e) => { setObsRoomScale(Number(e.target.value)); setObsCopied(null); }} />
                        </label>
                        <label htmlFor="obs-room-url">OBS-Link Raum</label>
                        <input id="obs-room-url" className="obs-export-url" readOnly value={obsRoomUrl} onFocus={(e) => e.currentTarget.select()} />
                        <button type="button" className="open-projector" onClick={async () => {
                          const ok = await window.khutbah.copyObsUrl(obsRoomUrl);
                          setObsCopied(ok ? 'room' : null);
                        }}><Copy size={16} /> {obsCopied === 'room' ? 'Raum-Link kopiert' : 'Raum-Link kopieren'}</button>
                      </section>
                      <section className="obs-output-card" aria-label="OBS-Quelle Livestream">
                        <div className="obs-output-heading"><strong>2 · Livestream / Kamera</strong><span>Nur Deutsch unten</span></div>
                        <p>Film-Untertitel für YouTube, Facebook und Handys. Nur die aktuelle deutsche Übersetzung unten im Bild; die Kamera bleibt sichtbar. Beim Test muss bereits eine Übersetzung vorhanden sein.</p>
                        <label>Schriftgröße Livestream: {Math.round(obsStreamScale * 100)} %
                          <input type="range" min="0.5" max="2.5" step="0.1" value={obsStreamScale} onChange={(e) => { setObsStreamScale(Number(e.target.value)); setObsCopied(null); }} />
                        </label>
                        <label>Maximale Zeilen: {obsCaptionLines}
                          <input type="range" min="1" max="3" step="1" value={obsCaptionLines} onChange={(e) => { setObsCaptionLines(Number(e.target.value)); setObsCopied(null); }} />
                        </label>
                        <label>Schwarzer Untertitelhintergrund: {Math.round(obsCaptionBg * 100)} %
                          <input type="range" min="0" max="0.9" step="0.05" value={obsCaptionBg} onChange={(e) => { setObsCaptionBg(Number(e.target.value)); setObsCopied(null); }} />
                        </label>
                        <label>Abstand vom unteren Bildrand: {obsCaptionBottom} %
                          <input type="range" min="1" max="20" step="1" value={obsCaptionBottom} onChange={(e) => { setObsCaptionBottom(Number(e.target.value)); setObsCopied(null); }} />
                        </label>
                        <label htmlFor="obs-stream-url">OBS-Link Livestream</label>
                        <input id="obs-stream-url" className="obs-export-url" readOnly value={obsStreamUrl} onFocus={(e) => e.currentTarget.select()} />
                        <button type="button" className="open-projector" onClick={async () => {
                          const ok = await window.khutbah.copyObsUrl(obsStreamUrl);
                          setObsCopied(ok ? 'stream' : null);
                        }}><Copy size={16} /> {obsCopied === 'stream' ? 'Livestream-Link kopiert' : 'Livestream-Link kopieren'}</button>
                      </section>
                    </div>
                    <p className="obs-export-hint">In OBS für jede Ausgabe eine eigene Browserquelle anlegen und den jeweiligen Link einfügen. Vorhandene Livestream-Quellen nach diesem Update mit dem neuen Link aktualisieren. Für Full-HD je 1920 × 1080 einstellen. Die Livestream-Quelle über der Kamera platzieren. Nach Änderungen an OBS-Reglern den entsprechenden Link erneut kopieren und in OBS aktualisieren.</p>
                    <p className="obs-export-hint">Khutbah AI muss laufen. Nach einem Neustart kann sich der lokale Port ändern; dann beide Links neu kopieren. Die Beamer-Einstellungen beeinflussen nur die Raumquelle, nicht die Film-Untertitel.</p>
                  </>
                ) : (
                  <p className="obs-export-error">OBS-Ausgabe nicht verfügbar: {obsError ?? 'Verbindung wird vorbereitet.'}</p>
                )}
              </div>

              <div className="mode-row">
                <span className="field-label">ANZEIGEMODUS</span>
                <div className="segmented">
                  {(
                    [
                      ['de', 'Nur Deutsch'],
                      ['ar', 'Nur Arabisch'],
                      ['both', 'Zweisprachig']
                    ] as [Mode, string][]
                  ).map(([v, l]) => (
                    <button
                      key={v}
                      className={mode === v ? 'selected' : ''}
                      onClick={() => setMode(v)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="preview-heading">
                <span>VORSCHAU ({blocks.length} FORTLAUFENDE ABSÄTZE · ECHTZEIT-BEAMER)</span>
                <span>LIVE-STREAM</span>
              </div>

              <div
                className="preview-screen"
                style={{
                  backgroundColor,
                  textAlign,
                  minHeight: '210px',
                  maxHeight: '340px',
                  overflowY: 'auto',
                  gap: '14px',
                  justifyContent: 'flex-start'
                }}
              >
                {blocks.length === 0 ? (
                  <p style={{ color: '#64748b', fontSize: '13px', margin: 'auto' }}>
                    Warte auf gesprochene Worte…
                  </p>
                ) : (
                  blocks.map((block, idx) => {
                    return (
                      <div
                        key={block.id}
                        style={{
                          opacity: 1,
                          borderBottom:
                            idx < blocks.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                          paddingBottom: idx < blocks.length - 1 ? '10px' : '0'
                        }}
                      >
                        {visibleText.showAr && (
                          <SmoothLiveText
                            text={block.arabic}
                            isLiveActive={block.isLiveActive}
                            className="preview-ar"
                            style={{
                              color: arabicColor,
                              fontSize: `${Math.round(fontSizeAr * 0.48)}px`,
                              lineHeight,
                              marginBottom: visibleText.showDe ? '4px' : '0'
                            }}
                          />
                        )}
                        {visibleText.showDe && (
                          <SmoothLiveText
                            text={block.german}
                            isLiveActive={block.isLiveActive}
                            className="preview-de"
                            style={{
                              color: textColor,
                              fontSize: `${Math.round(fontSizeDe * 0.44)}px`,
                              lineHeight
                            }}
                          />
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="font-row">
                <span className="field-label">SCHRIFTGRÖSSE DEUTSCH</span>
                <div className="font-controls">
                  <button onClick={() => setFontSizeDe((v) => Math.max(18, v - 2))}>
                    <Minus size={15} />
                  </button>
                  <input
                    type="range"
                    min="18"
                    max="68"
                    value={fontSizeDe}
                    onChange={(e) => setFontSizeDe(Number(e.target.value))}
                  />
                  <button onClick={() => setFontSizeDe((v) => Math.min(68, v + 2))}>
                    <Plus size={15} />
                  </button>
                  <b>{fontSizeDe}px</b>
                </div>
              </div>

              <div className="font-row">
                <span className="field-label">SCHRIFTGRÖSSE ARABISCH</span>
                <div className="font-controls">
                  <button onClick={() => setFontSizeAr((v) => Math.max(22, v - 2))}>
                    <Minus size={15} />
                  </button>
                  <input
                    type="range"
                    min="22"
                    max="80"
                    value={fontSizeAr}
                    onChange={(e) => setFontSizeAr(Number(e.target.value))}
                  />
                  <button onClick={() => setFontSizeAr((v) => Math.min(80, v + 2))}>
                    <Plus size={15} />
                  </button>
                  <b>{fontSizeAr}px</b>
                </div>
              </div>
            </section>
          </>
        ) : (
          /* Tab 2: Einstellungen */
          <>
            <section className="panel" style={{ marginBottom: '16px' }}>
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">GOOGLE CLOUD ANBINDUNG</span>
                  <h2>API-Schlüssel & Spracherkennung</h2>
                </div>
                <KeyRound size={18} color="#e8c35b" />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr',
                  gap: '14px',
                  marginBottom: '14px'
                }}
              >
                <div>
                  <label className="field-label">GOOGLE CLOUD API-SCHLÜSSEL (AIza...)</label>
                  <input
                    type="password"
                    placeholder="AIzaSy..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    style={{
                      width: '100%',
                      height: '39px',
                      padding: '0 12px',
                      borderRadius: '7px',
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: '#070709',
                      color: '#f8fafc',
                      fontFamily: 'monospace'
                    }}
                  />
                </div>

                <div>
                  <label className="field-label">HAUPTSPRACHE / DIALEKT</label>
                  <select
                    value={languageCode}
                    onChange={(e) => setLanguageCode(e.target.value)}
                  >
                    <option value="ar-SA">Bisheriges Profil – Hocharabisch (ar-SA)</option>
                    <option value="ar-EG">Sheikh: Ägyptisch + Hocharabisch (empfohlen)</option>
                    <option value="ar-EG-only">Nur Ägyptisch (ar-EG)</option>
                    <option value="ar-SA-only">Nur Hocharabisch-Profil (ar-SA)</option>
                    <option value="ar-AE">Vereinigte Arabische Emirate (ar-AE)</option>
                    <option value="ar-JO">Levante / Jordanien (ar-JO)</option>
                    <option value="ar-MA">Marokkanisch (ar-MA)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <input
                  id="glossary-toggle"
                  type="checkbox"
                  checked={enableIslamicGlossary}
                  onChange={(e) => setEnableIslamicGlossary(e.target.checked)}
                  style={{ accentColor: '#d4af37', width: '16px', height: '16px' }}
                />
                <label htmlFor="glossary-toggle" style={{ fontSize: '12px', color: '#cbd5e1', cursor: 'pointer' }}>
                  Islamisches Terminologie-Glossar aktivieren (Khutbah, Taqwa, Sunnah, Zakah usw.)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  className="primary-button"
                  style={{ flex: 'none', padding: '0 18px' }}
                  disabled={!hasApiKey || isVerifyingKey}
                  onClick={handleSaveAndVerifyKey}
                >
                  <CheckCircle2 size={16} />
                  {isVerifyingKey ? 'Prüfe Verbindung…' : 'API-Schlüssel & Tempo speichern'}
                </button>

                <button
                  className="secondary-button"
                  disabled={!hasApiKey || pipelineBusy}
                  onClick={handleTestLiveTranslation}
                >
                  <Send size={15} /> Test-Absatz hinzufügen
                </button>
              </div>

              {keyVerifyStatus && (
                <div
                  className="audio-note"
                  style={{
                    borderColor: keyVerifyStatus.ok ? '#22c55e' : '#ef4444',
                    color: keyVerifyStatus.ok ? '#bbf7d0' : '#fca5a5',
                    marginTop: '12px'
                  }}
                >
                  {keyVerifyStatus.ok ? (
                    <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                  ) : (
                    <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  )}
                  <span>{keyVerifyStatus.message}</span>
                </div>
              )}
            </section>

            {/* Beamer-Layout-Einstellungen */}
            <section className="panel settings-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">DARSTELLUNG & PROFILE</span>
                  <h2>Beamer-Layout & Textmenge anpassen</h2>
                </div>
                <Sliders size={18} color="#e8c35b" />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label className="field-label">SCHNELLPROFILE LADEN</label>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button className="secondary-button" onClick={() => applyPresetProfile('de-large')}>
                    Profil: Deutsch groß (6 Absätze)
                  </button>
                  <button className="secondary-button" onClick={() => applyPresetProfile('bilingual')}>
                    Profil: Zweisprachig (5 Absätze)
                  </button>
                  <button className="secondary-button" onClick={() => applyPresetProfile('ar-only')}>
                    Profil: Nur Arabisch groß
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '18px',
                  marginBottom: '20px'
                }}
              >
                <div>
                  <label className="field-label">
                    GLEICHZEITIG SICHTBARE ABSÄTZE AUF BEAMER: {visibleBlockCount}
                  </label>
                  <input
                    type="range"
                    min={2}
                    max={10}
                    step={1}
                    value={visibleBlockCount}
                    onChange={(e) => setVisibleBlockCount(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#d4af37' }}
                  />
                </div>

                <div>
                  <label className="field-label">
                    ECHTZEIT-AKTUALISIERUNGSTAKT: {(chunkIntervalMs / 1000).toFixed(1)} SEKUNDEN
                  </label>
                  <input
                    type="range"
                    min={800}
                    max={2500}
                    step={200}
                    value={chunkIntervalMs}
                    onChange={(e) => setChunkIntervalMs(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#d4af37' }}
                  />
                </div>

                <div>
                  <label className="field-label">ZEILENABSTAND: {lineHeight.toFixed(2)}</label>
                  <input
                    type="range"
                    min={1.2}
                    max={2.2}
                    step={0.05}
                    value={lineHeight}
                    onChange={(e) => setLineHeight(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#d4af37' }}
                  />
                </div>

                <div>
                  <label className="field-label">TEXTBREITE AUF BEAMER: {maxWidthPercent}%</label>
                  <input
                    type="range"
                    min={55}
                    max={98}
                    step={1}
                    value={maxWidthPercent}
                    onChange={(e) => setMaxWidthPercent(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#d4af37' }}
                  />
                </div>

                <div>
                  <label className="field-label">TEXTAUSRICHTUNG</label>
                  <div className="segmented">
                    {(
                      [
                        ['left', 'Linksbündig'],
                        ['center', 'Zentriert'],
                        ['right', 'Rechtsbündig']
                      ] as ['left' | 'center' | 'right', string][]
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        className={textAlign === val ? 'selected' : ''}
                        onClick={() => setTextAlign(val)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <div>
                    <label className="field-label">TEXT DEUTSCH</label>
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">TEXT ARABISCH</label>
                    <input
                      type="color"
                      value={arabicColor}
                      onChange={(e) => setArabicColor(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">HINTERGRUND</label>
                    <input
                      type="color"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        <footer>
          Khutbah AI <span>·</span> Moschee Al Badr (IGB e.V.) <span>·</span> Ultra-Fast Live-Stream
        </footer>
      </main>
    </div>
  );
}

function Status({
  icon,
  label,
  value,
  state
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  state: 'ok' | 'warn' | 'error' | 'neutral';
}) {
  const dotColor =
    state === 'ok'
      ? '#22c55e'
      : state === 'warn'
        ? '#f59e0b'
        : state === 'error'
          ? '#ef4444'
          : '#64748b';

  return (
    <div className="status-card">
      <div className="status-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <i className="status-indicator" style={{ background: dotColor }} />
    </div>
  );
}
