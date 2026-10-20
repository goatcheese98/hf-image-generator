import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createHandler, type Environment, type Dependencies } from '../server/handler';
import { ProviderBudget, type DurableState, type BudgetBinding } from '../server/budget';
import { API_PATH } from '../shared/contracts';

export const ORIGIN = 'http://127.0.0.1:4173';
export const USER_TOKEN = 'offline-user-credential';
export const SECRET_SENTINEL = 'NONSECRET_SERVER_CREDENTIAL_CANARY_9851';
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
export function budgetBinding() {
  const storage = new Map<string, unknown>(); let queue = Promise.resolve();
  const state: DurableState = {
    storage: {get: async <T>(key: string) => structuredClone(storage.get(key)) as T | undefined,
      put: async <T>(key: string, value: T) => {storage.set(key, structuredClone(value));}},
    blockConcurrencyWhile: <T>(callback: () => Promise<T>) => {
      const result = queue.then(callback); queue = result.then(() => {}, () => {}); return result;
    },
  };
  const object = new ProviderBudget(state);
  const binding: BudgetBinding = {idFromName: name => name, get: () => object};
  return {binding, storage};
}
const keys = await generateKeyPair('RS256');
export const jwk = {...await exportJWK(keys.publicKey), kid: 'offline-key', alg: 'RS256', use: 'sig'};
export async function accessToken(options: {audience?: string; subject?: string; expired?: boolean; issuer?: string} = {}) {
  return new SignJWT({}).setProtectedHeader({alg: 'RS256', kid: 'offline-key'})
    .setIssuer(options.issuer ?? 'https://offline.cloudflareaccess.com').setAudience(options.audience ?? 'offline-audience')
    .setSubject(options.subject ?? 'offline-subject').setIssuedAt()
    .setExpirationTime(options.expired ? Math.floor(Date.now()/1000) - 1 : '5m').sign(keys.privateKey);
}
export interface Scenario {failure?: boolean; loading?: boolean; unsupported?: boolean; malformed?: boolean; oversize?: boolean; slow?: boolean; retry?: boolean; unavailable?: boolean}
export function fixture(scenario: Scenario = {}, overrides: Partial<Dependencies> = {}) {
  const {binding, storage} = budgetBinding();
  const calls: {url: string; body: string; usedServiceKey: boolean; usedUserKey: boolean}[] = [];
  let attempts = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.href === 'https://offline.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({keys: [jwk]});
    if (!['huggingface.co','router.huggingface.co'].includes(url.hostname)) throw new Error('Unexpected outbound request');
    const auth = request.headers.get('Authorization');
    calls.push({url: request.url, body: await request.text(), usedServiceKey: auth === `Bearer ${SECRET_SENTINEL}`, usedUserKey: auth === `Bearer ${USER_TOKEN}`});
    if (scenario.slow) return new Promise<Response>(() => {});
    if (scenario.failure) return new Response(SECRET_SENTINEL, {status: 401});
    if (url.hostname === 'huggingface.co') return Response.json({name: 'offline-user'});
    attempts++;
    if (scenario.loading || (scenario.retry && attempts === 1)) return Response.json({error: SECRET_SENTINEL}, {status: 503});
    const body: unknown = JSON.parse(calls.at(-1)?.body ?? '{}');
    if (scenario.unavailable) return new Response(null, {status: 404});
    if (scenario.unsupported && body && typeof body === 'object' && 'parameters' in body && body.parameters && typeof body.parameters === 'object' && 'prompt' in body.parameters) return new Response(null, {status: 422});
    if (scenario.malformed) return new Response(SECRET_SENTINEL, {headers: {'Content-Type': 'image/svg+xml'}});
    if (scenario.oversize) return new Response(new Uint8Array(5_000_001), {headers: {'Content-Type': 'image/png'}});
    return url.pathname.startsWith('/nscale/') ? Response.json({data: [{b64_json: PNG.toString('base64')}]}) : new Response(PNG, {headers: {'Content-Type': 'image/png'}});
  };
  const env: Environment = {PUBLIC_ORIGIN: ORIGIN, BUDGET: binding, HF_SERVICE_TOKEN: SECRET_SENTINEL,
    ACCESS_TEAM_DOMAIN: 'offline.cloudflareaccess.com', ACCESS_AUD: 'offline-audience', ACCESS_SUBJECTS: 'offline-subject'};
  const handle = createHandler({fetch: fakeFetch, retryMs: 1, ...overrides});
  return {env, handle, calls, storage, fakeFetch};
}
export function apiRequest(input: unknown = {action: 'generate', model: 'black-forest-labs/FLUX.1-schnell', prompt: 'offline landscape'}, headers: Record<string,string> = {}) {
  return new Request(`${ORIGIN}${API_PATH}`, {method: 'POST', headers: {Origin: ORIGIN, 'Content-Type': 'application/json',
    'X-Credential-Mode': 'user', Authorization: `Bearer ${USER_TOKEN}`, ...headers}, body: JSON.stringify(input)});
}
