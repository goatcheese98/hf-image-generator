import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, mkdtemp, rm, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {Miniflare, convertV4MiniflareOptions, Response as RuntimeResponse, Log, LogLevel} from 'miniflare';
import {fixture, apiRequest, accessToken, ORIGIN, SECRET_SENTINEL, PNG} from './support';
import {MODELS} from '../shared/contracts';

interface RuntimeNamespace {idFromName(name: string): unknown; get(id: unknown): {fetch(url: string, init: RequestInit): Promise<{status: number}>}}

const bundle = await readFile('work/worker-dry-run/worker.js', 'utf8');
const testedHead = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
await mkdir('work/evidence', {recursive:true});
await writeFile('work/evidence/runtime-head.txt', `${testedHead}\n`);
console.log(`Actual workerd/SQLite tests: git HEAD ${testedHead}`);

async function runtime(directory: string, options: {clock?: number; configured?: boolean; scenario?: Parameters<typeof fixture>[0]} = {}) {
  const upstream = fixture(options.scenario);
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'image-generator', modules: true,
    // Clock substitution exists ONLY in this test-created isolate, not in the
    // Worker, bindings, request headers or deployed artifacts. Storage is real.
    script: (options.clock === undefined ? '' : `Date.now = () => ${options.clock};\n`) + bundle,
    compatibilityDate: '2026-10-19',
    durableObjects: {BUDGET: {className:'ProviderBudget', useSQLite:true}},
    resourcePersistencePath: directory, cf: false, telemetry: {enabled:false},
    assets: {directory:'dist', binding:'ASSETS', run_worker_first:true, routerConfig:{has_user_worker:true}},
    bindings: options.configured === false ? {} : {
      PUBLIC_ORIGIN: ORIGIN, HF_SERVICE_TOKEN: SECRET_SENTINEL,
      ACCESS_TEAM_DOMAIN:'offline.cloudflareaccess.com', ACCESS_AUD:'offline-audience', ACCESS_SUBJECTS:'offline-subject',
    },
    // All outbound traffic is intercepted by Miniflare outside the production
    // Worker. There is no network fallback, production override or usable key.
    outboundService: async request => {
      const response = await upstream.fakeFetch(request.url, {method:request.method,
        headers:Object.fromEntries(request.headers), ...(request.method === 'POST' ? {body:await request.arrayBuffer()} : {})});
      return new RuntimeResponse(await response.arrayBuffer(), {status:response.status, headers:Object.fromEntries(response.headers)});
    },
    log: new Log(LogLevel.ERROR),
  }));
  await mf.ready;
  const gate = async (name: string) => {
    // The pinned Miniflare beta's ReplaceWorkersTypes misidentifies this proxy
    // under DOM+Node types; keep this interop cast narrow rather than using any.
    const namespace = await mf.getDurableObjectNamespace('BUDGET') as unknown as RuntimeNamespace;
    const stub = namespace.get(namespace.idFromName(name));
    return (key: string, lease: string, action = 'acquire') => stub.fetch('https://budget.internal/', {method:'POST',body:JSON.stringify({key,lease,action})});
  };
  const dispatch = async (request = apiRequest()) => mf.dispatchFetch(request.url, {method:request.method,
    headers:Object.fromEntries(request.headers), body:await request.arrayBuffer()});
  return {mf, gate, dispatch, calls:upstream.calls};
}
async function temporary() {return mkdtemp(join(tmpdir(),'image-worker-'));}
async function sqliteFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const path = join(directory,entry.name);
    if (entry.isDirectory()) output.push(...await sqliteFiles(path)); else if (entry.name.endsWith('.sqlite') || entry.name.endsWith('.db')) output.push(path);
  }
  return output;
}

test('real Worker serves base-path HTML, JS, fonts and licenses with security headers', {timeout:60_000}, async () => {
  const directory = await temporary(), r = await runtime(directory);
  try {
    const response = await r.mf.dispatchFetch(`${ORIGIN}/hf-image-generator/`);
    assert.equal(response.status,200);
    assert.match(response.headers.get('Content-Security-Policy') ?? '', /connect-src 'self'/);
    assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
    assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
    const html = await response.text();
    const script = /src="(\/hf-image-generator\/assets\/[^\"]+\.js)"/.exec(html)?.[1]; assert.ok(script);
    assert.equal((await r.mf.dispatchFetch(`${ORIGIN}${script}`)).status,200);
    const assets = await readdir('dist/assets'), font = assets.find(name => name.endsWith('.woff2')); assert.ok(font);
    assert.equal((await r.mf.dispatchFetch(`${ORIGIN}/hf-image-generator/assets/${font}`)).status,200);
    assert.equal((await r.mf.dispatchFetch(`${ORIGIN}/hf-image-generator/licenses/geist-OFL.txt`)).status,200);
    assert.equal((await r.mf.dispatchFetch(`${ORIGIN}/outside`)).status,404);
    assert.equal((await r.mf.dispatchFetch(`${ORIGIN}/hf-image-generator/api/unknown`)).status,404);
    assert.equal(r.calls.length,0);
  } finally {await r.mf.dispose(); await rm(directory,{recursive:true,force:true});}
});

test('actual Worker fails closed with missing configuration and unauthorized hosted access', {timeout:60_000}, async () => {
  const directory = await temporary(); let r = await runtime(directory,{configured:false});
  try {
    assert.equal((await r.dispatch()).status,503); assert.equal(r.calls.length,0);
    await r.mf.dispose(); r = await runtime(directory);
    const request = apiRequest(undefined,{'X-Credential-Mode':'service'}); request.headers.delete('Authorization');
    assert.equal((await r.dispatch(request)).status,401); assert.equal(r.calls.length,0);
  } finally {await r.mf.dispose(); await rm(directory,{recursive:true,force:true});}
});

test('real Worker verifies hosted JWT and retries offline contract response; subsequent request releases admission', {timeout:60_000}, async () => {
  const directory = await temporary(), r = await runtime(directory,{scenario:{retry:true}});
  try {
    const request = apiRequest(undefined,{'X-Credential-Mode':'service','Cf-Access-Jwt-Assertion':await accessToken()}); request.headers.delete('Authorization');
    const response = await r.dispatch(request);
    assert.equal(response.status,200, JSON.stringify({outbound:r.calls})); assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),PNG);
    assert.equal(r.calls.length,2); assert.ok(r.calls.every(call => call.usedServiceKey));
    assert.equal((await r.dispatch(apiRequest())).status,200);
  } finally {await r.mf.dispose(); await rm(directory,{recursive:true,force:true});}
});

test('real SQLite quotas survive independent requests and full runtime restart; lease expiry and UTC day rollover', {timeout:90_000}, async () => {
  const directory = await temporary(), clock = Date.UTC(2026,9,20,12);
  let r = await runtime(directory,{clock});
  const key='a'.repeat(64);
  try {
    let quota = await r.gate('persisted-quota');
    for (let i=0;i<4;i++) {const lease=crypto.randomUUID(); assert.equal((await quota(key,lease)).status,204); await quota(key,lease,'release');}
    assert.equal((await quota(key,crypto.randomUUID())).status,429);
    const expiry = await r.gate('abandoned-lease'); assert.equal((await expiry(key,crypto.randomUUID())).status,204);
    await r.mf.dispose();
    const files=await sqliteFiles(directory); assert.ok(files.length>=2);
    for (const file of files) assert.equal((await readFile(file)).subarray(0,16).toString(),'SQLite format 3\0');
    await writeFile('work/evidence/sqlite-runtime.json',JSON.stringify({testedHead,sqliteDatabases:files.length,persistence:'real SQLite header verified'},null,2));
    r=await runtime(directory,{clock}); quota=await r.gate('persisted-quota');
    assert.equal((await quota(key,crypto.randomUUID())).status,429);
    assert.equal((await (await r.gate('abandoned-lease'))(key,crypto.randomUUID())).status,429);
    await r.mf.dispose(); r=await runtime(directory,{clock:clock+35_001});
    assert.equal((await (await r.gate('abandoned-lease'))(key,crypto.randomUUID())).status,204);
    assert.equal((await (await r.gate('persisted-quota'))(key,crypto.randomUUID())).status,429);
    await r.mf.dispose(); r=await runtime(directory,{clock:clock+86_400_000});
    assert.equal((await (await r.gate('persisted-quota'))(key,crypto.randomUUID())).status,204);
  } finally {await r.mf.dispose(); await rm(directory,{recursive:true,force:true});}
});

test('actual SQLite Durable Object serializes simultaneous per-user and global admission', {timeout:60_000}, async () => {
  const directory = await temporary(), r = await runtime(directory);
  try {
    const same = await r.gate('same-user-concurrency');
    const sameResults = await Promise.all(Array.from({length:5},()=>same('a'.repeat(64),crypto.randomUUID())));
    assert.deepEqual(sameResults.map(response=>response.status).sort(),[204,429,429,429,429]);
    const global = await r.gate('global-concurrency');
    const globalResults=await Promise.all(Array.from({length:5},(_,i)=>global(i.toString(16).repeat(64),crypto.randomUUID())));
    assert.deepEqual(globalResults.map(response=>response.status).sort(),[204,204,429,429,429]);
  } finally {await r.mf.dispose(); await rm(directory,{recursive:true,force:true});}
});

test('real SQLite enforces per-principal 20/day and global 100/day across minute windows/restarts', {timeout:90_000}, async () => {
  const directory=await temporary(), start=Date.UTC(2026,9,20,12);
  let r=await runtime(directory,{clock:start});
  try {
    for (let round=0;round<9;round++) {
      if (round) {await r.mf.dispose(); r=await runtime(directory,{clock:start+round*61_000});}
      const gate=await r.gate('daily-limits');
      if (round===5) assert.equal((await gate('a'.repeat(64),crypto.randomUUID())).status,429);
      const keys=round<5?['a','b','c']:round<8?['d','e','f']:['1'];
      for (const character of keys) for(let i=0;i<4;i++) {
        const key=character.repeat(64),lease=crypto.randomUUID();
        assert.equal((await gate(key,lease)).status,204); await gate(key,lease,'release');
      }
    }
    await r.mf.dispose(); r=await runtime(directory,{clock:start+10*61_000});
    assert.equal((await (await r.gate('daily-limits'))('2'.repeat(64),crypto.randomUUID())).status,429);
    await r.mf.dispose(); r=await runtime(directory,{clock:start+86_400_000});
    assert.equal((await (await r.gate('daily-limits'))('a'.repeat(64),crypto.randomUUID())).status,204);
  }finally{await r.mf.dispose();await rm(directory,{recursive:true,force:true});}
});

test('real Worker returns safe provider/model failures without leaking a server fixture credential', {timeout:60_000}, async () => {
  const directory=await temporary();let r=await runtime(directory,{scenario:{failure:true}});
  try {
    const response=await r.dispatch();assert.equal(response.status,502);assert.ok(!(await response.text()).includes(SECRET_SENTINEL));
    await r.mf.dispose();r=await runtime(directory,{scenario:{unavailable:true}});
    const missing=await r.dispatch();assert.equal(missing.status,424);const payload:unknown=await missing.json();assert.ok(payload && typeof payload==='object' && 'code' in payload);assert.equal(payload.code,'MODEL_UNAVAILABLE');
  }finally{await r.mf.dispose();await rm(directory,{recursive:true,force:true});}
});
