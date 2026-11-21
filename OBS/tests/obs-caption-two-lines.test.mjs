import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main/obsOverlay.ts', import.meta.url), 'utf8');

test('subtitle mode selects recent N German translation blocks', () => {
  assert.match(src, /\.filter\(block => typeof block\?\.german === 'string' && block\.german\.trim\(\)\)/);
  assert.match(src, /\.slice\(-captionLines\)/);
  assert.match(src, /\.map\(block => block\.german\.trim\(\)\)/);
});

test('each subtitle has a separate line and safe text assignment', () => {
  assert.match(src, /captionElements\.forEach\(\(element, index\)/);
  assert.match(src, /element\.textContent = text/);
  assert.match(src, /recent\.length === 1 \? captionLines : 1/);
});

test('room fullscreen layout remains separate', () => {
  assert.match(src, /if \(layout === 'captions'\)/);
  assert.match(src, /const mode = \['de','ar','both'\]/);
  assert.match(src, /content\.replaceChildren\(frag\)/);
});
