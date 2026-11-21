import test from 'node:test';
import assert from 'node:assert/strict';
import { ObsOverlayServer } from '../src/main/obsOverlay.ts';

const sample = {
  mode: 'both',
  visibleBlockCount: 4,
  maxWidthPercent: 96,
  blocks: [{ id: '1', arabic: 'الحمد لله', german: 'Alles Lob gebührt Allah.', isLiveActive: true }],
  fontSizeDe: 42,
  fontSizeAr: 48,
  lineHeight: 1.45,
  textAlign: 'center',
  textColor: '#ffffff',
  arabicColor: '#F7D774'
};

test('OBS endpoint serves transparent HTML with safe text rendering', async () => {
  const server = new ObsOverlayServer();
  try {
    const url = await server.start();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/obs$/);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /background:transparent/);
    assert.match(html, /textContent = text/);
    assert.match(html, /justify-content:center/);
    assert.match(html, /data.visibleBlockCount/);
    assert.match(html, /data.maxWidthPercent/);
    assert.doesNotMatch(html, /AIza|sk-proj-/);
    assert.equal((await fetch(url.replace('/obs', '/missing'))).status, 404);
  } finally {
    server.stop();
  }
});

test('OBS server sends initial content and updates over event stream', async () => {
  const server = new ObsOverlayServer();
  const abort = new AbortController();
  try {
    const url = await server.start();
    server.publish(sample);
    const response = await fetch(url.replace('/obs', '/events'), { signal: abort.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /Alles Lob gebührt Allah/);
    assert.match(first, /\"visibleBlockCount\":4/);
    assert.match(first, /\"maxWidthPercent\":96/);
    assert.match(first, /\"mode\":\"both\"/);
    server.publish({ ...sample, blocks: [{ ...sample.blocks[0], german: 'Aktualisierte Übersetzung' }] });
    const second = new TextDecoder().decode((await reader.read()).value);
    assert.match(second, /Aktualisierte Übersetzung/);
  } finally {
    abort.abort();
    server.stop();
  }
});

test('OBS server does not emit API keys even if accidental keys enter payload', async () => {
  const server = new ObsOverlayServer();
  const abort = new AbortController();
  try {
    const url = await server.start();
    server.publish({ ...sample, apiKey: 'DO-NOT-LEAK' });
    const response = await fetch(url.replace('/obs', '/events'), { signal: abort.signal });
    const first = new TextDecoder().decode((await response.body.getReader().read()).value);
    assert.doesNotMatch(first, /DO-NOT-LEAK/);
    assert.match(first, /Alles Lob gebührt Allah/);
    assert.match(first, /\"visibleBlockCount\":4/);
    assert.match(first, /\"maxWidthPercent\":96/);
    assert.match(first, /\"mode\":\"both\"/);
  } finally {
    abort.abort();
    server.stop();
  }
});
