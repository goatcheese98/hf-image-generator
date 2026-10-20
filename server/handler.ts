import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { API_PATH, LIMITS, MODELS, type ProviderRequest } from '../shared/contracts';
import type { BudgetBinding } from './budget';

export interface Environment {
  PUBLIC_ORIGIN?: string;
  HF_SERVICE_TOKEN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_SUBJECTS?: string;
  BUDGET?: BudgetBinding;
}
export interface Dependencies {fetch: typeof fetch; timeoutMs?: number; retryMs?: number}
class Rejection extends Error {constructor(readonly status: number) {super('Request rejected');}}
const safeHeaders = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'};
const fail = (status: number) => Response.json({error: status === 429 ? 'Request quota exceeded' : 'Provider request unavailable'}, {status, headers: safeHeaders});
function record(value: unknown): value is Record<string, unknown> {return !!value && typeof value === 'object' && !Array.isArray(value);}
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let listener: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      listener = () => reject(new Rejection(504)); signal.addEventListener('abort', listener, {once: true});
    })]);
  } finally {signal.removeEventListener('abort', listener);}
}
async function bytes(stream: ReadableStream<Uint8Array> | null, max: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) throw new Rejection(400);
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const {done, value} = await bounded(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > max) throw new Rejection(413);
      chunks.push(value);
    }
  } finally {void reader.cancel().catch(() => {});}
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.byteLength;}
  return result;
}
function parse(value: unknown): ProviderRequest {
  if (!record(value)) throw new Rejection(400);
  if (value.action === 'token' && Object.keys(value).length === 1) return {action: 'token'};
  if ((value.action !== 'generate' && value.action !== 'recreate') || Object.keys(value).some(key => !['action','model','prompt','reference'].includes(key))
    || typeof value.model !== 'string' || !MODELS.some(model => model === value.model)
    || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > LIMITS.prompt
    || (value.action === 'generate' && 'reference' in value) || (value.action === 'recreate' && typeof value.reference !== 'string')) throw new Rejection(400);
  return {action: value.action, model: value.model, prompt: value.prompt.trim(), ...(typeof value.reference === 'string' ? {reference: value.reference} : {})};
}
function imageType(data: Uint8Array, type: string): boolean {
  if (type === 'image/png') return data.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => data[i] === n);
  if (type === 'image/jpeg') return data[0] === 255 && data[1] === 216 && data[2] === 255;
  return type === 'image/webp' && new TextDecoder().decode(data.slice(0,4)) === 'RIFF' && new TextDecoder().decode(data.slice(8,12)) === 'WEBP';
}
function reference(source: string): Blob {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(source);
  if (!match?.[1] || !match[2] || match[2].length > Math.ceil(LIMITS.referenceBytes / 3) * 4) throw new Rejection(400);
  let data: Uint8Array<ArrayBuffer>;
  try {data = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));} catch {throw new Rejection(400);}
  if (data.length > LIMITS.referenceBytes || !imageType(data, match[1])) throw new Rejection(400);
  return new Blob([data], {type: match[1]});
}
async function fingerprint(value: string): Promise<string> {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data), n => n.toString(16).padStart(2, '0')).join('');
}
export function createHandler(dependencies: Dependencies = {fetch}) {
  const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
  return async (request: Request, env: Environment): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? LIMITS.timeoutMs);
    const signal = controller.signal;
    let release: (() => Promise<Response>) | undefined;
    try {
      if (new URL(request.url).pathname !== API_PATH) throw new Rejection(404);
      if (request.method !== 'POST') throw new Rejection(405);
      if (!env.PUBLIC_ORIGIN || !env.BUDGET) throw new Rejection(503);
      if (new URL(request.url).origin !== env.PUBLIC_ORIGIN || request.headers.get('Origin') !== env.PUBLIC_ORIGIN
        || (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) throw new Rejection(403);
      if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json') throw new Rejection(415);
      const declared = request.headers.get('Content-Length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > LIMITS.requestBytes)) throw new Rejection(413);
      const mode = request.headers.get('X-Credential-Mode');
      let token: string, principal: string;
      if (mode === 'user') {
        const auth = /^Bearer ([A-Za-z0-9_-]{8,256})$/.exec(request.headers.get('Authorization') ?? '');
        if (!auth?.[1]) throw new Rejection(401);
        token = auth[1]; principal = `user:${token}`;
      } else if (mode === 'service') {
        if (!env.HF_SERVICE_TOKEN || !env.ACCESS_AUD || !env.ACCESS_SUBJECTS || !env.ACCESS_TEAM_DOMAIN
          || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN)) throw new Rejection(503);
        if (request.headers.has('Authorization')) throw new Rejection(400);
        const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
        if (!assertion || assertion.length > 8192) throw new Rejection(401);
        const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
        let keySet = keySets.get(issuer);
        if (!keySet) {
          keySet = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {[customFetch]: dependencies.fetch, timeoutDuration: 3000});
          keySets.clear(); keySets.set(issuer, keySet);
        }
        try {
          const {payload} = await bounded(jwtVerify(assertion, keySet, {issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['sub','iat','exp']}), signal);
          if (!payload.sub || !env.ACCESS_SUBJECTS.split(',').map(subject => subject.trim()).includes(payload.sub) || !payload.exp || !payload.iat
            || payload.iat > Date.now()/1000 + 5 || payload.exp - payload.iat > 3600) throw new Rejection(403);
          principal = `service:${payload.sub}`;
        } catch {throw new Rejection(401);}
        token = env.HF_SERVICE_TOKEN;
      } else throw new Rejection(400);
      let input: ProviderRequest;
      try {input = parse(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await bytes(request.body, LIMITS.requestBytes, signal))));}
      catch (error) {throw error instanceof Rejection ? error : new Rejection(400);}
      if (mode === 'service' && input.action !== 'token' && input.model !== MODELS[0]) throw new Rejection(403);
      const blob = input.action === 'recreate' ? reference(input.reference ?? '') : undefined;
      const key = await fingerprint(principal), lease = crypto.randomUUID();
      const gate = env.BUDGET.get(env.BUDGET.idFromName('global-provider-budget-v1'));
      const admission = () => gate.fetch(new Request('https://budget.internal/', {method: 'POST', body: JSON.stringify({key, lease, action: 'acquire'})}));
      // Leases expire even if a request/isolate is terminated. Quotas count failed calls too.
      const granted = await bounded(admission(), signal);
      if (!granted.ok) throw new Rejection(granted.status === 429 ? 429 : 503);
      release = () => gate.fetch(new Request('https://budget.internal/', {method: 'POST', body: JSON.stringify({key, lease, action: 'release'})}));
      let attempts = 0;
      const call = async (url: string, body?: () => BodyInit, json = true): Promise<Response> => {
        for (let retry = 0; retry < 2; retry++) {
          if (++attempts > LIMITS.attempts) throw new Rejection(502);
          const response = await bounded(dependencies.fetch(url, {method: body ? 'POST' : 'GET', redirect: 'error', signal,
            headers: {Authorization: `Bearer ${token}`, ...(body && json ? {'Content-Type': 'application/json'} : {})}, ...(body ? {body: body()} : {})}), signal);
          if (response.status !== 503 || retry !== 0) return response;
          void response.body?.cancel().catch(() => {});
          await bounded(new Promise(resolve => setTimeout(resolve, dependencies.retryMs ?? 1000)), signal);
        }
        throw new Rejection(502);
      };
      if (input.action === 'token') {
        const response = await call('https://huggingface.co/api/whoami-v2');
        // No identity payload or provider error body crosses the boundary.
        void response.body?.cancel().catch(() => {});
        return response.ok ? Response.json({valid: true}, {headers: safeHeaders}) : fail(401);
      }
      const endpoint = `https://router.huggingface.co/hf-inference/models/${input.model}`;
      const textBody = (prompt: string) => JSON.stringify({inputs: prompt, parameters: {width: 512, height: 512, num_inference_steps: 20, guidance_scale: 7.5}});
      let method = blob ? 'image' : 'text';
      let response = blob ? await call(endpoint, () => {
        const form = new FormData(); form.append('inputs', blob);
        form.append('parameters', JSON.stringify({prompt: input.prompt, strength: 0.75, guidance_scale: 7.5, num_inference_steps: 20}));
        return form;
      }, false) : await call(endpoint, () => textBody(input.prompt));
      if (blob && [400,404].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        method = 'enhanced-text';
        response = await call(endpoint, () => textBody(`${input.prompt}, based on a vintage black and white photograph, maintaining the original composition and subject matter, high quality, detailed`));
      }
      if (!response.ok) {void response.body?.cancel().catch(() => {}); throw new Rejection(502);}
      const type = response.headers.get('Content-Type')?.split(';')[0] ?? '';
      const output = await bytes(response.body, LIMITS.responseBytes, signal);
      if (!imageType(output, type)) throw new Rejection(502);
      return new Response(output, {headers: {...safeHeaders, 'Content-Type': type, 'X-Image-Method': method}});
    } catch (error) {
      return fail(signal.aborted ? 504 : error instanceof Rejection ? error.status : 502);
    } finally {
      clearTimeout(timer);
      // Admission expiry also bounds cleanup if storage is temporarily unavailable.
      if (release) void release().catch(() => {});
    }
  };
}
