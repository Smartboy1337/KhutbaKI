import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ObsTranscriptBlock {
  id: string;
  arabic: string;
  german: string;
  isLiveActive?: boolean;
}

export interface ObsPayload {
  blocks: ObsTranscriptBlock[];
  mode: 'de' | 'ar' | 'both';
  visibleBlockCount?: number;
  maxWidthPercent: number;
  fontSizeDe: number;
  fontSizeAr: number;
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right';
  textColor: string;
  arabicColor: string;
}

// OBS needs text and presentation options only. Never send Google credentials or settings.
const initialPayload: ObsPayload = {
  blocks: [],
  mode: 'both',
  visibleBlockCount: 5,
  maxWidthPercent: 92,
  fontSizeDe: 34,
  fontSizeAr: 42,
  lineHeight: 1.55,
  textAlign: 'center',
  textColor: '#F5F2EB',
  arabicColor: '#F7D774'
};

export class ObsOverlayServer {
  private server: Server | null = null;
  private clients = new Set<ServerResponse>();
  private heartbeat: NodeJS.Timeout | null = null;
  private current: ObsPayload = initialPayload;
  private url: string | null = null;

  async start(): Promise<string> {
    if (this.url) return this.url;
    if (this.server) throw new Error('OBS-Server wird bereits gestartet.');

    const server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      // Node listens ONLY on loopback. No external network exposure.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET') {
        res.writeHead(405).end();
        return;
      }
      if (path === '/obs' || path === '/captions') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors *");
        res.writeHead(200).end(OBS_PAGE);
        return;
      }
      if (path === '/events') {
        if (this.clients.size >= 12) {
          res.writeHead(503).end('Too many OBS clients');
          return;
        }
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Connection', 'keep-alive');
        res.writeHead(200);
        res.write(`data: ${JSON.stringify(this.current)}\n\n`);
        this.clients.add(res);
        res.on('close', () => this.clients.delete(res));
        return;
      }
      res.writeHead(404).end('Not found');
    });
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
    } catch (error) {
      this.server = null;
      server.close();
      throw error;
    }
    const address = server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${address.port}/obs`;
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (!client.destroyed) client.write(': heartbeat\n\n');
      }
    }, 15000);
    return this.url;
  }

  getUrl(): string | null {
    return this.url;
  }

  publish(payload: ObsPayload) {
    this.current = {
      blocks: payload.blocks.slice(-12).map(({ id, arabic, german, isLiveActive }) => ({
        id: String(id).slice(0, 100),
        arabic: String(arabic ?? '').slice(0, 15000),
        german: String(german ?? '').slice(0, 15000),
        isLiveActive: Boolean(isLiveActive)
      })),
      mode: ['de','ar','both'].includes(payload.mode) ? payload.mode : 'de',
      visibleBlockCount: Number.isFinite(payload.visibleBlockCount) ? Math.max(1,Math.min(12,Math.round(payload.visibleBlockCount!))) : 5,
      maxWidthPercent: Number.isFinite(payload.maxWidthPercent) ? Math.max(40,Math.min(100,payload.maxWidthPercent)) : 92,
      fontSizeDe: payload.fontSizeDe,
      fontSizeAr: payload.fontSizeAr,
      lineHeight: payload.lineHeight,
      textAlign: payload.textAlign,
      textColor: payload.textColor,
      arabicColor: payload.arabicColor
    };
    const message = `data: ${JSON.stringify(this.current)}\n\n`;
    for (const client of this.clients) {
      if (!client.destroyed) client.write(message);
    }
  }

  stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.server?.close();
    this.server = null;
    this.url = null;
  }
}

const OBS_PAGE = String.raw`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Khutbah AI – OBS</title>
<style>
  :root { color-scheme: light; }
  html,body { margin:0; width:100%; height:100%; overflow:hidden; background:transparent !important; }
  * { box-sizing:border-box; }
  #surface { position:absolute; inset:0; width:100%; height:100%; overflow:hidden; display:flex;
    flex-direction:column; align-items:center; justify-content:center; padding:4vw; }
  #content { display:flex; flex-direction:column; justify-content:flex-end; gap:26px; width:100%; max-height:90vh; overflow:hidden; }
  .entry { flex-shrink:0; min-width:0; padding-bottom:18px; border-bottom:1px solid rgba(255,255,255,.12); }
  .entry:last-child { padding-bottom:0; border-bottom:none; }
  .de,.ar { margin:0; font-family:'Segoe UI',Tahoma,Arial,sans-serif; font-weight:650;
    overflow-wrap:anywhere; white-space:pre-wrap; text-shadow:0 2px 5px rgba(0,0,0,.95),0 0 14px rgba(0,0,0,.85); }
  .ar { font-family:'Noto Naskh Arabic','Traditional Arabic','Segoe UI',sans-serif; direction:rtl; }
  .live-dot { display:inline-block; height:6px; width:6px; border-radius:50%; background:#d4af37;
    margin-inline-start:8px; vertical-align:middle; }
  /* Stream captions: transparent browser source over the camera, readable on phones. */
  body.captions #surface { justify-content:flex-end; align-items:center; padding:0 4% 5%; }
  body.captions #content { width:100% !important; max-height:none; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; gap:0; }
  body.captions .caption-box { max-width:96%; min-width:0; border-radius:10px; padding:10px 22px;
    display:flex; flex-direction:column; align-items:center; gap:4px;
    box-decoration-break:clone; -webkit-box-decoration-break:clone; }
  body.captions .caption-text { font-family:'Segoe UI',Arial,sans-serif; font-weight:700;
    text-align:center !important; overflow:hidden; overflow-wrap:break-word; white-space:pre-wrap;
    display:-webkit-box; -webkit-box-orient:vertical; text-overflow:ellipsis;
    text-shadow:0 2px 5px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,.8); }
  body.captions .caption-text:empty { display:none; }
  body.lower #surface { justify-content:flex-end; padding:28px 48px 44px; }
  body.lower #content { gap:12px; max-height:75vh; }
  body.lower .entry { padding-bottom:6px; }
</style>
</head><body>
<div id="surface"><div id="content" aria-live="polite"></div></div>
<script>
(() => {
  'use strict';
  const qs = new URLSearchParams(location.search);
  // Unless explicitly overridden, OBS follows the application's projector options.
  const selectedMode = qs.get('mode');
  const selectedLines = qs.get('lines');
  // Livestream subtitles are the safe default; the mosque-style output is opt-in.
  const layout = qs.get('layout') === 'full' ? 'full' : qs.get('layout') === 'lower' ? 'lower' : 'captions';
  const scaleQuery = Number(qs.get('scale'));
  const scale = qs.has('scale') && Number.isFinite(scaleQuery) ? Math.max(.5,Math.min(3,scaleQuery)) : 1;
  document.body.classList.toggle('lower',layout === 'lower');
  document.body.classList.toggle('captions',layout === 'captions');
  const captionLines = Math.round(Math.max(1,Math.min(3,Number(qs.get('captionLines')) || 2)));
  const bgValue = Number(qs.get('captionBg'));
  const captionBg = qs.has('captionBg') && Number.isFinite(bgValue) ? Math.max(0,Math.min(.9,bgValue)) : .65;
  const captionBottom = Math.max(1,Math.min(20,Number(qs.get('captionBottom')) || 5));
  let captionElements = [];
  let captionBox = null;
  const content = document.getElementById('content');
  const color = (value,fallback) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  const safeNum = (value,low,high,fallback) => Number.isFinite(Number(value)) ? Math.max(low,Math.min(high,Number(value))) : fallback;
  function paragraph(text,cls,c,size,lh,align,live) {
    const p = document.createElement('p');
    p.className = cls;
    p.textContent = text; // Never interpret transcription as HTML.
    p.style.color = c;
    p.style.fontSize = (size * scale) + 'px';
    p.style.lineHeight = String(lh);
    p.style.textAlign = align;
    if (live) { const dot = document.createElement('span'); dot.className = 'live-dot'; p.appendChild(dot); }
    return p;
  }
  function render(data) {
    if (layout === 'captions') {
      // Two subtitle lines mean up to two recent German translation segments,
      // not just a two-line word wrap of the latest single segment.
      // Older entries remain before the current one, as in normal subtitles.
      const blocks = Array.isArray(data.blocks) ? data.blocks : [];
      const recent = blocks
        .filter(block => typeof block?.german === 'string' && block.german.trim())
        .slice(-captionLines)
        .map(block => block.german.trim());
      if (!captionBox) {
        captionBox = document.createElement('div');
        captionBox.className = 'caption-box';
        content.replaceChildren(captionBox);
      }
      while (captionElements.length < captionLines) {
        const line = document.createElement('p');
        line.className = 'caption-text';
        line.style.margin = '0';
        captionElements.push(line);
        captionBox.appendChild(line);
      }
      document.getElementById('surface').style.paddingBottom = captionBottom + '%';
      captionBox.style.backgroundColor = 'rgba(0,0,0,' + captionBg + ')';
      captionBox.style.visibility = recent.length ? 'visible' : 'hidden';
      captionElements.forEach((element, index) => {
        const text = recent[index] ?? '';
        element.style.display = text ? '-webkit-box' : 'none';
        // One existing segment can use both lines. With multiple segments,
        // allocate one line to each so two translations are actually visible.
        element.style.webkitLineClamp = String(recent.length === 1 ? captionLines : 1);
        element.style.lineHeight = '1.3';
        element.style.fontSize = 'clamp(22px, ' + (2.6 * scale) + 'vw, 62px)';
        element.style.color = color(data.textColor,'#ffffff');
        if (element.textContent !== text) element.textContent = text;
      });
      return;
    }
    const mode = ['de','ar','both'].includes(selectedMode) ? selectedMode :
      (['de','ar','both'].includes(data.mode) ? data.mode : 'de');
    const lines = qs.has('lines') ? safeNum(selectedLines,1,12,5) : safeNum(data.visibleBlockCount,1,12,5);
    const blocks = Array.isArray(data.blocks) ? data.blocks.slice(-Math.round(lines)) : [];
    const align = ['left','right','center'].includes(data.textAlign) ? data.textAlign : 'center';
    const lh = safeNum(data.lineHeight,1,2.5,1.55);
    const deSize = safeNum(data.fontSizeDe,16,110,34);
    const arSize = safeNum(data.fontSizeAr,16,120,42);
    content.style.width = safeNum(data.maxWidthPercent,40,100,92) + '%';
    content.style.textAlign = align;
    const frag = document.createDocumentFragment();
    blocks.forEach((block) => {
      if (!block || (mode === 'de' && !block.german) || (mode === 'ar' && !block.arabic)) return;
      const entry = document.createElement('div'); entry.className = 'entry';
      const live = Boolean(block.isLiveActive);
      if (mode !== 'de' && block.arabic) entry.appendChild(paragraph(block.arabic,'ar',color(data.arabicColor,'#F7D774'),arSize,lh,align,live && mode === 'ar'));
      if (mode !== 'ar' && block.german) {
        const de = paragraph(block.german,'de',color(data.textColor,'#F5F2EB'),deSize,lh,align,live);
        if (mode === 'both') de.style.marginTop = '10px';
        entry.appendChild(de);
      }
      if (entry.childNodes.length) frag.appendChild(entry);
    });
    content.replaceChildren(frag);
  }
  const stream = new EventSource('/events');
  stream.onmessage = e => { try { render(JSON.parse(e.data)); } catch { /* Ignore invalid packets. */ } };
})();
</script>
</body></html>`;
