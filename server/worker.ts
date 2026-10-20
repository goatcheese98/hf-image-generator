import { createHandler, type Environment } from './handler';
export { ProviderBudget } from './budget';
interface WorkerEnvironment extends Environment {ASSETS: {fetch(request: Request): Promise<Response>}}
const handle = createHandler();
export const ASSET_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
};
export default {
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/hf-image-generator/api/')) return handle(request, env);
    const url = new URL(request.url);
    if (url.pathname === '/') return Response.redirect(`${url.origin}/hf-image-generator/`, 302);
    if (!url.pathname.startsWith('/hf-image-generator/')) return new Response(null, {status: 404});
    url.pathname = url.pathname.slice('/hf-image-generator'.length);
    const asset = await env.ASSETS.fetch(new Request(url, request));
    const response = new Response(asset.body, asset);
    for (const [key, value] of Object.entries(ASSET_HEADERS)) response.headers.set(key, value);
    return response;
  },
};
