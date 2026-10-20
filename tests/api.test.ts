import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessToken, apiRequest, fixture, ORIGIN, PNG, SECRET_SENTINEL, budgetBinding } from './support';
import { API_PATH, LIMITS, MODELS } from '../shared/contracts';
import worker from '../server/worker';

const generation = {action: 'generate', model: MODELS[0], prompt: 'offline landscape'};

test('user credentials traverse only the fixed provider endpoint; binary result has safe headers', async () => {
  const f = fixture(); const response = await f.handle(apiRequest(), f.env);
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Image-Method'), 'text');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0]?.usedUserKey, true);
  assert.equal(f.calls[0]?.url, `https://router.huggingface.co/hf-inference/models/${MODELS[0]}`);
  assert.ok(!JSON.stringify([...f.storage.values()]).includes('offline-user-credential'));
});

for (const [name, input, headers, status] of [
  ['unknown model', {...generation, model: 'https://attacker.invalid/model'}, {}, 400],
  ['unknown field', {...generation, token: 'forbidden'}, {}, 400],
  ['blank prompt', {...generation, prompt: ' '}, {}, 400],
  ['oversize prompt', {...generation, prompt: 'x'.repeat(2001)}, {}, 400],
  ['coerced action array', {...generation, action: ['generate']}, {}, 400],
  ['unknown action', {...generation, action: 'anything'}, {}, 400],
  ['invalid reference', {...generation, action: 'recreate', reference: 'data:image/svg+xml;base64,PHN2Zz4='}, {}, 400],
  ['unexpected reference', {...generation, reference: 'anything'}, {}, 400],
  ['invalid token', generation, {Authorization: 'Bearer short'}, 401],
  ['unknown credential source', generation, {'X-Credential-Mode': 'other'}, 400],
  ['cross origin', generation, {Origin: 'https://attacker.invalid'}, 403],
  ['missing origin', generation, {Origin: ''}, 403],
  ['cross site', generation, {'Sec-Fetch-Site': 'cross-site'}, 403],
  ['wrong content type', generation, {'Content-Type': 'text/plain'}, 415],
  ['declared oversize', generation, {'Content-Length': String(LIMITS.requestBytes + 1)}, 413],
] as const) {
  test(`rejects ${name} before any provider call`, async () => {
    const f = fixture(); const response = await f.handle(apiRequest(input, headers), f.env);
    assert.equal(response.status, status); assert.equal(f.calls.length, 0);
    assert.ok(!(await response.text()).includes(SECRET_SENTINEL));
  });
}

test('actual request size is enforced without relying on content-length', async () => {
  const f = fixture(); const request = apiRequest({x: 'x'.repeat(LIMITS.requestBytes)});
  assert.equal(request.headers.has('Content-Length'), false);
  assert.equal((await f.handle(request, f.env)).status, 413); assert.equal(f.calls.length, 0);
});

test('malformed JSON, method and path are rejected', async () => {
  const f = fixture(), original = apiRequest();
  assert.equal((await f.handle(new Request(original, {body: '{'}), f.env)).status, 400);
  assert.equal((await f.handle(new Request(`${ORIGIN}${API_PATH}`), f.env)).status, 405);
  assert.equal((await f.handle(new Request(`${ORIGIN}/hf-image-generator/api/other`), f.env)).status, 404);
});

test('missing origin or durable quota binding fails closed', async () => {
  const f = fixture();
  assert.equal((await f.handle(apiRequest(), {...f.env, BUDGET: undefined})).status, 503);
  assert.equal((await f.handle(apiRequest(), {...f.env, PUBLIC_ORIGIN: undefined})).status, 503);
  assert.equal(f.calls.length, 0);
});

const serviceHeaders = {'X-Credential-Mode': 'service', Authorization: ''};
function serviceRequest(jwt?: string, input: unknown = generation) {
  const request = apiRequest(input, {...serviceHeaders, ...(jwt ? {'Cf-Access-Jwt-Assertion': jwt} : {})});
  request.headers.delete('Authorization'); return request;
}

test('hosted key is rejected unless configuration and verified Access identity are present', async () => {
  const f = fixture();
  assert.equal((await f.handle(serviceRequest(), {...f.env, HF_SERVICE_TOKEN: undefined})).status, 503);
  assert.equal((await f.handle(serviceRequest(), f.env)).status, 401);
  assert.equal((await f.handle(serviceRequest('not-a-jwt'), f.env)).status, 401);
  for (const options of [{audience: 'wrong'}, {subject: 'unknown'}, {expired: true}, {issuer: 'https://wrong.invalid'}]) {
    assert.equal((await f.handle(serviceRequest(await accessToken(options)), f.env)).status, 401);
  }
  assert.equal(f.calls.length, 0);
});

test('verified service access uses server key; no key or raw error enters response or logs', async () => {
  const f = fixture(); const jwt = await accessToken();
  const logs: string[] = []; const original = console.error;
  console.error = (...values: unknown[]) => {logs.push(values.map(String).join(' '));};
  try {
    const response = await f.handle(serviceRequest(jwt), f.env);
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
    assert.equal(f.calls[0]?.usedServiceKey, true);
    assert.ok(!JSON.stringify(Object.fromEntries(response.headers)).includes(SECRET_SENTINEL));
    const failure = fixture({failure: true});
    const error = await failure.handle(serviceRequest(jwt), failure.env);
    assert.equal(error.status, 502); assert.ok(!(await error.text()).includes(SECRET_SENTINEL));
    assert.ok(!logs.join('\n').includes(SECRET_SENTINEL));
  } finally {console.error = original;}
});

test('service model budget cannot be expanded by caller', async () => {
  const f = fixture();
  const response = await f.handle(serviceRequest(await accessToken(), {...generation, model: MODELS[1]}), f.env);
  assert.equal(response.status, 403); assert.equal(f.calls.length, 0);
});

test('one loading retry succeeds; persistent loading remains bounded', async () => {
  const f = fixture({retry: true}); assert.equal((await f.handle(apiRequest(), f.env)).status, 200); assert.equal(f.calls.length, 2);
  const loading = fixture({loading: true}); assert.equal((await loading.handle(apiRequest(), loading.env)).status, 502); assert.equal(loading.calls.length, 2);
});

test('recreation 404 falls back to enhanced text and does not drop image errors into logs', async () => {
  const f = fixture({unsupported: true});
  const response = await f.handle(apiRequest({...generation, action: 'recreate', reference: `data:image/png;base64,${PNG.toString('base64')}`}), f.env);
  assert.equal(response.status, 200); assert.equal(response.headers.get('X-Image-Method'), 'enhanced-text');
  assert.equal(f.calls.length, 2); assert.ok(f.calls[1]?.body.includes('vintage black and white'));
});

for (const scenario of [{malformed: true}, {oversize: true}]) {
  test(`rejects invalid provider image ${JSON.stringify(scenario)}`, async () => {
    const f = fixture(scenario); const response = await f.handle(apiRequest(), f.env);
    assert.notEqual(response.status, 200); assert.ok(!(await response.text()).includes(SECRET_SENTINEL));
  });
}

test('total deadline includes an unresponsive provider and releases/expires admission', async () => {
  const f = fixture({slow: true}, {timeoutMs: 20});
  const response = await f.handle(apiRequest(), f.env); assert.equal(response.status, 504); assert.equal(f.calls.length, 1);
});

test('per-principal rate limits count failures and persist across handler instances', async () => {
  const f = fixture({failure: true});
  for (let i = 0; i < 4; i++) assert.equal((await f.handle(apiRequest(), f.env)).status, 502);
  assert.equal((await f.handle(apiRequest(), f.env)).status, 429); assert.equal(f.calls.length, 4);
});

test('durable admission bounds concurrency and global request volume', async () => {
  const {binding} = budgetBinding(), gate = binding.get(binding.idFromName('global'));
  const reserve = (key: string, lease: string, action = 'acquire') => gate.fetch(new Request('https://budget.internal/', {method:'POST', body: JSON.stringify({key, lease, action})}));
  const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), leaseA = crypto.randomUUID(), leaseB = crypto.randomUUID();
  assert.equal((await reserve(a, leaseA)).status, 204);
  assert.equal((await reserve(a, crypto.randomUUID())).status, 429);
  assert.equal((await reserve(b, leaseB)).status, 204);
  assert.equal((await reserve(c, crypto.randomUUID())).status, 429);
  await reserve(a, leaseA, 'release'); await reserve(b, leaseB, 'release');
  for (let i = 0; i < 10; i++) {
    const key = i.toString(16).padStart(64,'0'), lease = crypto.randomUUID();
    assert.equal((await reserve(key, lease)).status, 204); await reserve(key, lease, 'release');
  }
  assert.equal((await reserve(c, crypto.randomUUID())).status, 429);
});

test('Worker rewrites the existing Vite base path and keeps API separate from assets', async () => {
  const paths: string[] = [];
  const env = {ASSETS: {fetch: async (request: Request) => {paths.push(new URL(request.url).pathname); return new Response('asset');}}};
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/hf-image-generator/assets/app.js`), env)).status, 200);
  assert.deepEqual(paths, ['/assets/app.js']);
  assert.equal((await worker.fetch(apiRequest(), env)).status, 503);
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/outside`), env)).status, 404);
});

test('durable daily budgets persist and reset only at a new UTC day', async t => {
  let now = Math.floor(Date.now() / 86_400_000) * 86_400_000 + 60_000;
  t.mock.method(Date, 'now', () => now);
  const {binding} = budgetBinding(), gate = binding.get(binding.idFromName('global'));
  const send = (key: string, lease: string, action = 'acquire') => gate.fetch(new Request('https://budget.internal/', {method:'POST', body: JSON.stringify({key, lease, action})}));
  for (let i = 0; i < 100; i++) {
    const key = Math.floor(i / 20).toString(16).padStart(64, '0'), lease = crypto.randomUUID();
    assert.equal((await send(key, lease)).status, 204); await send(key, lease, 'release'); now += 61_000;
    if ((i + 1) % 20 === 0) assert.equal((await send(key, crypto.randomUUID())).status, 429);
  }
  assert.equal((await send('f'.repeat(64), crypto.randomUUID())).status, 429);
  now += 86_400_000;
  assert.equal((await send('f'.repeat(64), crypto.randomUUID())).status, 204);
});

test('abandoned admission lease expires without resetting request counts', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const {binding} = budgetBinding(), gate = binding.get(binding.idFromName('global'));
  const reserve = () => gate.fetch(new Request('https://budget.internal/', {method:'POST', body: JSON.stringify({key:'a'.repeat(64), lease:crypto.randomUUID(), action:'acquire'})}));
  assert.equal((await reserve()).status, 204); assert.equal((await reserve()).status, 429);
  now += 35_001; assert.equal((await reserve()).status, 204);
});

test('recreation plus fallback can never exceed three upstream calls', async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => new Response(null, {status: ++calls === 2 ? 404 : 503});
  const f = fixture({}, {fetch: fakeFetch});
  const response = await f.handle(apiRequest({...generation, action:'recreate', reference:`data:image/png;base64,${PNG.toString('base64')}`}), f.env);
  assert.equal(response.status, 502); assert.equal(calls, 3);
});
