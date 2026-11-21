import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ObsOverlayServer } from '../src/main/obsOverlay.ts';

test('Both room and livestream OBS sources share the same server and same translation feed', async () => {
  const server = new ObsOverlayServer();
  const abort = new AbortController();
  try {
    const roomUrl = await server.start();
    const streamUrl = roomUrl.replace('/obs', '/captions');
    const [room, stream] = await Promise.all([fetch(roomUrl + '?layout=full&scale=1.1'), fetch(streamUrl + '?layout=captions&mode=de&scale=1.8')]);
    assert.equal(room.status, 200);
    assert.equal(stream.status, 200);
    assert.equal(await room.text(), await stream.text());
    const current = {mode:'both',visibleBlockCount:3,maxWidthPercent:90,fontSizeDe:42,fontSizeAr:42,lineHeight:1.4,textAlign:'center',textColor:'#ffffff',arabicColor:'#ffffff',blocks:[{id:'1',arabic:'الحمد لله',german:'Alles Lob gebührt Allah.'}]};
    server.publish(current);
    const eventResponse = await fetch(roomUrl.replace('/obs','/events'), {signal: abort.signal});
    const msg = new TextDecoder().decode((await eventResponse.body.getReader().read()).value);
    assert.match(msg, /Alles Lob gebührt Allah/);
    assert.match(msg, /الحمد لله/);
  } finally { abort.abort(); server.stop(); }
});

test('The UI creates independent settings and link buttons for each OBS source', () => {
  const ui = readFileSync(new URL('../src/renderer/src/ui/App.tsx', import.meta.url), 'utf8');
  assert.match(ui, /const obsRoomUrl =/);
  assert.match(ui, /const obsStreamUrl =/);
  assert.match(ui, /layout=full/);
  assert.match(ui, /layout=captions/);
  assert.match(ui, /obsRoomScale/);
  assert.match(ui, /obsStreamScale/);
  assert.match(ui, /Raum-Link kopieren/);
  assert.match(ui, /Livestream-Link kopieren/);
  assert.doesNotMatch(ui, /const \[obsLayout,/);
});
