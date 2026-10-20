// Cloud-only test server. Not imported by the Worker, Vite entry or deployment bundle.
import { createServer } from 'node:http';
import { preview } from 'vite';
import { accessToken, fixture, ORIGIN, type Scenario } from './support';
import { ASSET_HEADERS } from '../server/worker';
import { API_PATH, LIMITS } from '../shared/contracts';

const scenarios: Record<string, Scenario> = {success: {}, failure: {failure: true}, retry: {retry: true}, loading: {loading: true}, unsupported: {unsupported: true}, service: {retry: true}, 'service-failure': {failure: true}};
const sessions = new Map<string, ReturnType<typeof fixture>>();
const assertion = await accessToken();
const vite = await preview({preview: {host: '127.0.0.1', port: 4174, strictPort: true}});
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? '/', ORIGIN);
    if (url.pathname === API_PATH) {
      const id = String(incoming.headers['x-offline-session'] ?? 'default');
      const scenario = String(incoming.headers['x-offline-case'] ?? 'success');
      let context = sessions.get(id);
      if (!context) {context = fixture(scenarios[scenario]); sessions.set(id, context);}
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(key, value);
      if (scenario.startsWith('service')) {headers.delete('Authorization'); headers.set('Cf-Access-Jwt-Assertion', assertion);}
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of incoming) {length += Buffer.byteLength(chunk); if (length > LIMITS.requestBytes) throw new Error('Test request too large'); chunks.push(Buffer.from(chunk));}
      const request = new Request(url, {method: incoming.method ?? 'POST', headers, body: Buffer.concat(chunks)});
      const result = await context.handle(request, context.env);
      outgoing.writeHead(result.status, Object.fromEntries(result.headers)); outgoing.end(Buffer.from(await result.arrayBuffer()));
    } else if (url.pathname === '/__fixtures/state') {
      const context = sessions.get(url.searchParams.get('session') ?? '');
      outgoing.setHeader('Content-Type', 'application/json'); outgoing.end(JSON.stringify({calls: context?.calls ?? []}));
    } else {
      for (const [key, value] of Object.entries(ASSET_HEADERS)) outgoing.setHeader(key, value);
      vite.middlewares(incoming, outgoing);
    }
  } catch {outgoing.writeHead(500); outgoing.end('Offline fixture failure');}
});
server.listen(4173, '127.0.0.1');
process.on('SIGTERM', () => {server.close(); vite.httpServer.close();});
