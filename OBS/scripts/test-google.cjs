// Cross-platform tests without Vite or native binaries. No live network requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { transcribeAndTranslateWav, translateArabicToGerman, verifyGoogleApiKey } = require('../src/main/googleCloudService.ts');
const { analyzeTimeDomainSamples, encodeFloat32To16kWav } = require('../src/renderer/src/audio/audioMetrics.ts');
const { applyIslamicTerminology } = require('../src/main/glossary.ts');
const config = (apiKey, extra = {}) => ({ apiKey, languageCode: 'ar-SA', enableIslamicGlossary: false, customGlossary: [], ...extra });
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json'}});
const speech = (text) => json({ results:[{ alternatives:[{ transcript:text, confidence:0.91 }] }] });
const translation = (text) => json({data:{translations:[{translatedText:text}]}});
const realFetch = global.fetch;
async function mockFetch(fn, action) {
  const requests=[];
  global.fetch = async (url, init) => { const req={url,body:JSON.parse(init.body),signal:init.signal};requests.push(req);return fn(req, requests.length); };
  try { await action(requests); } finally { global.fetch=realFetch; }
}
test('original Google request settings and exact translation', async () => {
  await mockFetch((r,i)=> i===1 ? speech('لا يجوز الظلم') : translation('Unrecht ist nicht erlaubt.'), async requests=>{
    const result=await transcribeAndTranslateWav(Buffer.from('test'),config('original-1'));
    assert.deepEqual(requests[0].body.config,{encoding:'LINEAR16',sampleRateHertz:16000,languageCode:'ar-SA',alternativeLanguageCodes:['ar-EG','ar-AE','ar-JO'],enableAutomaticPunctuation:true,model:'latest_short'});
    assert.equal(requests[1].body.q,'لا يجوز الظلم');assert.equal(result.german,'Unrecht ist nicht erlaubt.');assert.equal(result.confidence,0.91);assert.ok(requests[0].signal instanceof AbortSignal);
  });
});
test('fallback matches old request except model on HTTP 400', async()=>{
  await mockFetch((r,i)=>i===1?json({error:{message:'unsupported model'}},400):i===2?speech('العلم'):translation('Wissen'),async requests=>{
    const r=await transcribeAndTranslateWav(Buffer.from('audio'),config('fallback-1'));
    assert.equal(r.german,'Wissen');assert.equal(requests.length,3);assert.deepEqual(requests[1].body,{...requests[0].body,config:{...requests[0].body.config,model:'default'}});
  });
});
test('empty recognition does not request translation',async()=>{
  await mockFetch(()=>json({results:[]}),async requests=>{assert.equal(await transcribeAndTranslateWav(Buffer.from('audio'),config('silence-1')),null);assert.equal(requests.length,1);});
});
test('changed statement, including negation, is not blended with an earlier response',async()=>{
  await mockFetch((r,i)=>i===1?speech('يجوز'):i===2?translation('Es ist erlaubt.'):i===3?speech('لا يجوز'):translation('Es ist nicht erlaubt.'),async requests=>{
    const c=config('negation-1');const first=await transcribeAndTranslateWav(Buffer.from('a'),c);const second=await transcribeAndTranslateWav(Buffer.from('b'),c);assert.equal(first.german,'Es ist erlaubt.');assert.equal(second.german,'Es ist nicht erlaubt.');assert.equal(requests.length,4);
  });
});
test('exact raw cache avoids duplicate request, but punctuation and key changes do not collide',async()=>{
  await mockFetch((r,i)=>translation('Antwort '+i),async requests=>{
    const c=config('cache-1');assert.equal(await translateArabicToGerman('السلام عليكم',c),'Antwort 1');assert.equal(await translateArabicToGerman('السلام عليكم',c),'Antwort 1');assert.equal(await translateArabicToGerman('السلام عليكم؟',c),'Antwort 2');assert.equal(await translateArabicToGerman('السلام عليكم',config('cache-2')),'Antwort 3');assert.equal(requests.length,3);
  });
});
test('glossary is applied fresh to cached raw translation',async()=>{
  await mockFetch(()=>translation('Gottesfurcht'),async requests=>{
    const c=config('glossary-1');assert.equal(await translateArabicToGerman('التقوى',c),'Gottesfurcht');assert.equal(await translateArabicToGerman('التقوى',{...c,enableIslamicGlossary:true}),'Taqwa (Gottesfurcht)');assert.equal(requests.length,1);
  });
});
test('key verification actually checks the network, even after a cache hit',async()=>{
  await mockFetch((r,i)=>i===1?translation('Friede sei mit euch'):json({error:{message:'key revoked'}},403),async requests=>{
    assert.equal((await verifyGoogleApiKey('verify-1')).ok,true);assert.equal((await verifyGoogleApiKey('verify-1')).ok,false);assert.equal(requests.length,2);
  });
});
test('403 speech error does not trigger a fallback or translation',async()=>{
  await mockFetch(()=>json({error:{message:'denied'}},403),async requests=>{await assert.rejects(transcribeAndTranslateWav(Buffer.from('audio'),config('denied-1')),/denied/);assert.equal(requests.length,1);});
});
test('network failure hides API key from surfaced error',async()=>{
  await mockFetch(()=>{throw new Error('secret-key-in-url');},async()=>{await assert.rejects(translateArabicToGerman('سؤال',config('secret-key-in-url')),e=>!e.message.includes('secret-key-in-url')&&e.message.includes('nicht erreichbar'));});
});
test('original silence and 16k WAV behavior',()=>{assert.equal(analyzeTimeDomainSamples(new Float32Array(1024),-45).dbFs,-60);const wav=encodeFloat32To16kWav([new Float32Array(4800).fill(0.25)],48000);const view=new DataView(wav);assert.equal(view.getUint32(24,true),16000);assert.equal(wav.byteLength,3244);});
test('original auto gain and glossary unchanged',()=>{const wav=encodeFloat32To16kWav([new Float32Array(4800).fill(0.05)],48000,{autoNormalize:true});const sample=new DataView(wav).getInt16(44,true);assert.ok(sample>6000&&sample<32767);assert.match(applyIslamicTerminology('Freitagspredigt und Gottesfurcht','خطبة التقوى'),/Khutbah.*Taqwa/);});

test('mixed Egyptian and formal Arabic profile uses exactly two locale candidates', async () => {
  await mockFetch((r,i)=> i===1 ? speech('إحنا لازم نتعلم') : translation('Wir müssen lernen.'), async requests=>{
    const result=await transcribeAndTranslateWav(Buffer.from('test'),config('egypt-mixed',{languageCode:'ar-EG'}));
    assert.equal(requests[0].body.config.languageCode,'ar-EG');
    assert.deepEqual(requests[0].body.config.alternativeLanguageCodes,['ar-SA']);
    assert.equal(requests[0].body.config.model,'latest_short');
    assert.equal(result.german,'Wir müssen lernen.');
  });
});
test('single-locale profiles never send a synthetic language code to Google', async () => {
  const {resolveRecognitionLanguages}=require('../src/main/googleCloudService.ts');
  assert.deepEqual(resolveRecognitionLanguages('ar-EG-only'),{languageCode:'ar-EG',alternativeLanguageCodes:[]});
  assert.deepEqual(resolveRecognitionLanguages('ar-SA-only'),{languageCode:'ar-SA',alternativeLanguageCodes:[]});
});
test('alternate language candidates exclude duplicates and the primary locale',()=>{
  const {resolveRecognitionLanguages}=require('../src/main/googleCloudService.ts');
  assert.deepEqual(resolveRecognitionLanguages('ar-EG',['ar-EG','ar-SA','ar-SA','ar-JO','ar-AE','ar-MA']),{languageCode:'ar-EG',alternativeLanguageCodes:['ar-SA','ar-JO','ar-AE']});
});
