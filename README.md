# HuggingFace Image Generator

Native browser TypeScript, Vite and a same-origin Cloudflare Worker provider boundary. Node 22.12+; CI uses Node 24. The interface preserves the existing sections and model controls, with LUM foundation styling and bundled Geist fonts.

```sh
npm ci
npm run typecheck
npm run test:api
npm run build
npm run check:assets
npx playwright install --with-deps chromium
npm run test:browser
CLOUDFLARE_SEND_METRICS=false npm run dry-run
```

All tests are offline. Playwright starts a loopback fixture server that runs the **real handler and quota code** with mocked upstream identity/image responses. No real provider credentials or external calls are needed. Set `CHROMIUM_PATH` to use installed Chromium. `npm run test:serve` is a test-only loopback fixture server; never deploy it. `npm run dev` and `npm run preview` serve assets only and do not enable a provider. See [server setup](docs/provider-boundary.md) for the production architecture and human provisioning needs.

The module entry is `index.html` → `index.ts`; `utils.ts` and `shared/contracts.ts` are imported through Vite. Worker code, authorization logic and secrets never enter the browser module graph. `npm run check:assets` builds with nonsecret credential sentinels and scans all emitted client files for the sentinel and server credential/auth identifiers.

## Credentials

“My token” is the default. Enter a personal HuggingFace token intentionally; it stays in memory and is sent to this site's same-origin handler, which forwards it only to fixed HuggingFace HTTPS endpoints. There is no storage, cookie or build-time token fallback. Clearing or switching credential source removes the active user credential; reloading requires entry again. In-flight results are discarded after a credential change. Browser extensions and scripts in the page can read input; use a trusted deployment.

“Hosted access” sends no provider token from the browser. The handler requires configured server bindings, a cryptographically verified Cloudflare Access JWT and an explicitly allowed subject. Unconfigured/unauthorized requests fail closed before any provider call. There are no provisioned secrets, identities, routes or deployments in this change.

Raw provider errors, identity payloads and credentials are never logged or returned. Images and API responses are not cached. The former browser provider SDK is removed; the server owns bounded retry and image-to-image fallback. The fallback uses a fixed vintage photograph description, not image analysis. API test buttons consume the same quotas as generation.

## Verification and styling

See [the foundation record](docs/lum-foundation.md) for permitted references, font licenses, fallback stacks and cloud screenshots. This is styling within the existing layout, not a Paper design or human design approval. CI runs install, strict types, API abuse tests, production build, artifact scanning, dependency audit, Worker dry-run and Chromium flows. The old static Pages deployment job is removed because it cannot host the same-origin API. CI performs **no deployment**.
