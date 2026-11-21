import { applyIslamicTerminology, DEFAULT_ISLAMIC_GLOSSARY, type GlossaryRule } from './glossary';

// Requests are bounded so an unresponsive network cannot block the entire live queue indefinitely.
const REQUEST_TIMEOUT_MS = 12000;
const RAW_CACHE_LIMIT = 150;
let cacheCredential = '';
const rawTranslationCache = new Map<string, string>();

async function googleFetch(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error('Google Cloud antwortet nicht rechtzeitig. Internetverbindung prüfen.');
    }
    // Do not expose a URL that may contain the API key.
    throw new Error('Google Cloud ist nicht erreichbar. Internetverbindung prüfen.');
  }
}

export interface CloudTranslationConfig {
  apiKey: string;
  languageCode: string;
  alternativeLanguageCodes?: string[];
  enableIslamicGlossary: boolean;
  customGlossary: GlossaryRule[];
}

export interface PipelineSegmentResult {
  arabic: string;
  german: string;
  latencyMs: number;
  confidence?: number;
}

// A saved profile is not itself a BCP-47 language code. Map it before calling Google.
export function resolveRecognitionLanguages(profile: string, alternatives?: string[]) {
  const languageCode = profile === 'ar-EG-only' ? 'ar-EG' : profile === 'ar-SA-only' ? 'ar-SA' : profile || 'ar-SA';
  const defaults = profile === 'ar-EG-only' || profile === 'ar-SA-only'
    ? [] : languageCode === 'ar-EG' ? ['ar-SA'] : ['ar-EG', 'ar-AE', 'ar-JO'];
  return { languageCode, alternativeLanguageCodes: [...new Set(alternatives ?? defaults)].filter(code => code !== languageCode).slice(0, 3) };
}

/**
 * Schnelle Erkennung & Übersetzung für kontinuierliche Live-Pakete (ohne auf Sprechpausen zu warten).
 */
export async function transcribeAndTranslateWav(
  wavBuffer: Buffer,
  config: CloudTranslationConfig
): Promise<PipelineSegmentResult | null> {
  const startTime = Date.now();
  const key = config.apiKey.trim();
  if (!key) {
    throw new Error('Kein Google Cloud API-Schlüssel hinterlegt.');
  }

  const audioBase64 = wavBuffer.toString('base64');

  const sttUrl = `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`;
  const language = resolveRecognitionLanguages(config.languageCode, config.alternativeLanguageCodes);
  const sttBody = {
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      ...language,
      enableAutomaticPunctuation: true,
      model: 'latest_short'
    },
    audio: {
      content: audioBase64
    }
  };

  let sttResponse = await googleFetch(sttUrl, sttBody);

  // Fallback auf 'default' Modell falls 'latest_short' für einen spezifischen Dialekt nicht verfügbar ist
  if (!sttResponse.ok && sttResponse.status === 400) {
    sttBody.config.model = 'default';
    sttResponse = await googleFetch(sttUrl, sttBody);
  }

  if (!sttResponse.ok) {
    const errText = await sttResponse.text();
    let message = `Google Speech API Fehler (${sttResponse.status})`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.message) message = parsed.error.message;
    } catch {
      // Fallback behalten
    }
    throw new Error(message);
  }

  const sttJson = (await sttResponse.json()) as {
    results?: Array<{
      alternatives?: Array<{ transcript?: string; confidence?: number }>;
    }>;
  };

  const transcripts: string[] = [];
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const r of sttJson.results ?? []) {
    const alt = r.alternatives?.[0];
    if (alt?.transcript?.trim()) {
      transcripts.push(alt.transcript.trim());
      if (typeof alt.confidence === 'number') {
        confidenceSum += alt.confidence;
        confidenceCount += 1;
      }
    }
  }

  const arabic = transcripts.join(' ').trim();
  if (!arabic) {
    return null;
  }

  const german = await translateArabicToGerman(arabic, config);

  return {
    arabic,
    german,
    latencyMs: Date.now() - startTime,
    confidence: confidenceCount > 0 ? Number((confidenceSum / confidenceCount).toFixed(2)) : undefined
  };
}

export async function translateArabicToGerman(
  arabicText: string,
  config: CloudTranslationConfig,
  bypassCache = false
): Promise<string> {
  const key = config.apiKey.trim();
  if (!key) {
    throw new Error('Kein Google Cloud API-Schlüssel hinterlegt.');
  }

  // Cache ONLY an exact Arabic string and the raw Google response, never a blended
  // interim text. Glossary settings are applied fresh on every call.
  if (cacheCredential !== key) {
    cacheCredential = key;
    rawTranslationCache.clear();
  }
  let rawGerman = bypassCache ? undefined : rawTranslationCache.get(arabicText);
  if (rawGerman === undefined) {
    const translateUrl = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`;
    const trResponse = await googleFetch(translateUrl, {
      q: arabicText,
      source: 'ar',
      target: 'de',
      format: 'text'
    });
    if (!trResponse.ok) {
      const errText = await trResponse.text();
      let message = `Google Translation API Fehler (${trResponse.status})`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed?.error?.message) message = parsed.error.message;
      } catch { /* retain fallback */ }
      throw new Error(message);
    }
    const trJson = (await trResponse.json()) as {
      data?: { translations?: Array<{ translatedText?: string }> };
    };
    rawGerman = trJson.data?.translations?.[0]?.translatedText?.trim() ?? '';
    if (!rawGerman) return '';
    // Avoid cross-key reuse if the key changed while the request was running.
    if (cacheCredential === key) {
      if (rawTranslationCache.size >= RAW_CACHE_LIMIT) {
        const oldest = rawTranslationCache.keys().next().value;
        if (oldest !== undefined) rawTranslationCache.delete(oldest);
      }
      rawTranslationCache.set(arabicText, rawGerman);
    }
  }

  if (config.enableIslamicGlossary) {
    return applyIslamicTerminology(
      rawGerman,
      arabicText,
      config.customGlossary.length > 0 ? config.customGlossary : DEFAULT_ISLAMIC_GLOSSARY
    );
  }

  return rawGerman;
}

export async function verifyGoogleApiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const translated = await translateArabicToGerman('السلام عليكم', {
      apiKey,
      languageCode: 'ar-SA',
      enableIslamicGlossary: false,
      customGlossary: []
    }, true);
    if (!translated) {
      return { ok: false, message: 'API antwortete ohne Übersetzungstext.' };
    }
    return {
      ok: true,
      message: `Verbindung erfolgreich! Testübersetzung: „السلام عليكم“ → „${translated}“`
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Verbindung zu Google Cloud fehlgeschlagen.'
    };
  }
}
