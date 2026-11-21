import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/renderer/src/ui/App.tsx', import.meta.url), 'utf8');

test('room source uses proven /obs endpoint in full layout', () => {
  assert.match(ui, /const obsRoomUrl = .*layout=full/);
});

test('livestream source uses the same proven /obs endpoint with caption layout', () => {
  const line = ui.split('\n').find(s => s.includes('const obsStreamUrl ='));
  assert.ok(line);
  assert.match(line, /replace\(\/\\\/obs\$\/, '\/obs'\)/);
  assert.match(line, /\?layout=captions&mode=de/);
  assert.doesNotMatch(line, /'\/captions'/);
});

test('each source has own copy button and scale', () => {
  assert.match(ui, /obsRoomScale/);
  assert.match(ui, /obsStreamScale/);
  assert.match(ui, /Raum-Link kopieren/);
  assert.match(ui, /Livestream-Link kopieren/);
});
