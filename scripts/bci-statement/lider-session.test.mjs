import test from 'node:test';
import assert from 'node:assert/strict';
import { credentials, run } from './live.mjs';
import { hasHumanControl, humanControlWaiter, controlPending, humanOperation, humanCondition, humanEvent, resumePreparedLider, submissionAlreadyMade, runLider } from './lider-session.mjs';

function controlPage({ hidden = false, visible = false, text = '' } = {}) {
  let pending = true;
  const frame = {
    isDetached: () => false,
    url: () => 'https://www.liderbciserviciosfinancieros.cl/login',
    locator: selector => {
      const locator = {
        count: async () => 0,
        filter: () => locator,
        evaluateAll: async () => !pending ? [] : selector.includes('textarea') ?
          (hidden ? [{provider:'turnstile',completed:false,visibleWidget:false}] : []) :
          (visible ? [{provider:'turnstile',completed:null}] : []),
        innerText: async () => pending ? text : '',
      };
      return locator;
    },
  };
  return { complete() { pending=false; }, url:frame.url, frames:() => [frame], isClosed:() => false };
}

test('Líder requires only its own environment variables, before opening a browser', async () => {
  const keys = Object.keys(credentials({ BCI_LIDER_RUT: 'fixture', BCI_LIDER_CLAVE: 'fixture' }, 'lider'));
  assert.deepEqual(keys, ['BCI_LIDER_RUT', 'BCI_LIDER_CLAVE']);
  await assert.rejects(run({ from: '2026-08-18', to: '2026-10-02', bank: 'lider', env: {} }), { code: 'MISSING_CREDENTIALS' });
});

test('hidden pending response, visible widget and robot text each require human action', async () => {
  for (const shape of [{ hidden: true }, { visible: true }, { text: 'No soy un robot' }, { text: 'Verifique que es un ser humano' }]) {
    const page = controlPage(shape);
    assert.equal(await hasHumanControl(page), true);
    page.complete();
    assert.equal(await hasHumanControl(page), false);
  }
});

test('human wait announces exact URL once and stays pending until control disappears', async () => {
  const page = controlPage({ hidden: true });
  const lines = [];
  const wait = humanControlWaiter(line => lines.push(line));
  let done = false;
  const waiting = wait(page).then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(done, false);
  assert.deepEqual(lines, ['LIDER_CONTROL_URL ' + page.url()]);
  page.complete();
  await waiting;
  await wait(page);
  assert.equal(lines.length, 1);
});


test('completed auxiliary response does not hide a visibly pending control or another provider', () => {
  const completed={provider:'turnstile',completed:true,visibleWidget:false};
  const auxiliary={provider:'turnstile',completed:false,visibleWidget:false};
  // Actual portal shape after human Success: one token and an empty auxiliary.
  assert.equal(controlPending({responses:[completed,auxiliary]}),false);
  assert.equal(controlPending({responses:[completed,auxiliary],text:'Verifique que es un ser humano'}),true);
  assert.equal(controlPending({responses:[completed,{...auxiliary,visibleWidget:true}]}),true);
  assert.equal(controlPending({responses:[completed,{...auxiliary,provider:'hcaptcha'}]}),true);
  assert.equal(controlPending({responses:[completed],widgets:[{provider:'turnstile',completed:false}]}),true);
});

test('response listener starts only after a human wait longer than the active deadline', async () => {
  const {EventEmitter}=await import('node:events');
  const page=new EventEmitter();
  let release; let actions=0; let blocked=true;
  const human=new Promise(resolve=>{release=()=>{blocked=false;resolve();};});
  const operation=humanEvent(page,async()=>{if(blocked)await human;},'response',v=>v==='bank',async()=>{actions++;page.emit('response','bank');},{timeout:20,poll:2});
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(actions,0); assert.equal(page.listenerCount('response'),0);
  release();
  assert.equal(await operation,'bank');
  assert.equal(actions,1); assert.equal(page.listenerCount('response'),0);
});

test('a challenge after the single action pauses the deadline and holds an arrived response', async () => {
  const {EventEmitter}=await import('node:events');
  const page=new EventEmitter();
  let release; let blocked=false; let done=false; let actions=0;
  const human=new Promise(resolve=>{release=()=>{blocked=false;resolve();};});
  const operation=humanEvent(page,async()=>{if(blocked)await human;},'download',()=>true,async()=>{
    actions++; blocked=true;
    setTimeout(()=>page.emit('download','document'),10);
  },{timeout:20,poll:2}).then(v=>{done=true;return v;});
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(done,false); assert.equal(actions,1);
  release(); assert.equal(await operation,'document');
  assert.equal(page.listenerCount('download'),0);
});

test('active timeout removes listeners and stops DOM probes', async () => {
  const {EventEmitter}=await import('node:events');
  const page=new EventEmitter();
  await assert.rejects(humanEvent(page,async()=>{},'response',()=>true,async()=>{}, {timeout:10,poll:2}),{code:'PAGE_TIMEOUT'});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(page.listenerCount('response'),0);
  let probes=0;
  await assert.rejects(humanCondition(page,async()=>{},async()=>{probes++;return false;},{timeout:10,poll:2}),{code:'PAGE_TIMEOUT'});
  const after=probes;
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(probes,after);
});

test('an intermediate challenge without a form waits before probing for the password', async () => {
  const page=controlPage({visible:true});
  let probes=0; let complete=false;
  const pending=humanCondition(page,humanControlWaiter(()=>{}),async()=>{probes++;return true;},{timeout:10,poll:2}).then(()=>{complete=true;});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(probes,0); assert.equal(complete,false);
  page.complete(); await pending;
  assert.equal(probes,1);
});

test('single-submit claim survives a fresh Page wrapper and same-origin navigation', async () => {
  const storage=new Map(); let clicks=0;
  const makePage=()=>({
    url:()=> clicks ? 'https://www.liderbciserviciosfinancieros.cl/private-home/dashboard' : 'https://www.liderbciserviciosfinancieros.cl/login',
    // Evaluate the same production claim against a new document and shared session storage.
    evaluate:async fn=>{
      const oldWindow=globalThis.window, oldStorage=globalThis.sessionStorage;
      globalThis.window={};globalThis.sessionStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
      try{return fn();}finally{globalThis.window=oldWindow;globalThis.sessionStorage=oldStorage;}
    },
    locator:()=>({count:async()=>1,inputValue:async()=>'fixture'}),
    getByRole:()=>({isVisible:async()=>true,isEnabled:async()=>true,click:async()=>{clicks++;}}),
  });
  const page=makePage();
  await resumePreparedLider(page,{BCI_LIDER_CLAVE:'fixture'},()=>{},async()=>{});
  assert.equal(clicks,1);
  const reconnected=makePage();
  assert.equal(await submissionAlreadyMade(reconnected),true);
  await assert.rejects(resumePreparedLider(reconnected,{BCI_LIDER_CLAVE:'fixture'},()=>{},async()=>{}),{code:'LOGIN_ALREADY_SUBMITTED'});
  assert.equal(clicks,1);
});


test('successful dedicated run launches visible and leaves its browser open', async () => {
  let closes=0; let options;
  const context={};
  const browser={newContext:async()=>context,close:async()=>{closes++;}};
  const result=await runLider({from:'2026-08-18',to:'2026-10-02',
    env:{BCI_LIDER_RUT:'fixture',BCI_LIDER_CLAVE:'fixture',DISPLAY:':fixture'}, log:()=>{},
    launch:async value=>{options=value;return browser;},
    authenticate:async c=>{assert.equal(c,context);return {};},
    extract:async()=>({mode:'control-flow-test'}),
  });
  assert.equal(options.headless,false);
  assert.equal('BCI_LIDER_RUT' in options.env,false);
  assert.equal('BCI_LIDER_CLAVE' in options.env,false);
  assert.equal(closes,0);
  assert.equal(result.mode,'control-flow-test');
  await (await import('node:fs/promises')).rm(result.output_directory,{recursive:true});
});
