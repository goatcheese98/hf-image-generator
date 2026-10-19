# HuggingFace Image Generator

A Vite application written in strict TypeScript. Requires Node 22.12+ (CI uses Node 24).

```sh
npm ci
npm run typecheck
npm run build
npx playwright install --with-deps chromium
npm run test:browser
npm run check:assets
npm run dev -- --host 127.0.0.1
```

The module entry is `index.html` → `index.ts`; `utils.ts` is imported by the module graph. Do not serve TypeScript directly with a static file server. `npm run preview -- --host 127.0.0.1` serves the production build at `/hf-image-generator/`. Vite is pinned in the manifest and lockfile. Set `CHROMIUM_PATH` to use an existing Chromium installation for tests.

## Credentials and provider boundary

Enter your own HuggingFace token in the password field. It stays in memory for this page session; clearing the field removes the active credential and reload requires entry again. Requests send it directly to HuggingFace over HTTPS. Pending requests may finish after clearing, but their results are discarded. No credential is stored in local/session storage, cookies, source code or application logs. Raw provider errors are deliberately not displayed because they could echo credentials. Browser extensions and scripts running in the page can access user input; this is an intentional personal credential flow.

There is no application-owned `VITE_HF_TOKEN` fallback. Never put a provider secret into a Vite environment variable or client bundle. Before enabling a public hosted credential, implement a **server-side provider boundary with bounded access**: authenticate callers, authorize operations/models, enforce per-user quotas and rate limits, cap request sizes and provider spending, and redact secrets from logs. An unprotected paid proxy is not acceptable. This change does not introduce a proxy or alter authentication on the provider.

`provider.ts` owns typed generation/recreation contracts, SDK/direct fallback and one bounded direct retry after HTTP 503. The UI owns selection, loading, messages and image display/download. Recreation retains the existing enhanced text fallback for unsupported image-to-image models (400/404); that fallback uses a fixed reference description and does not analyze the uploaded image. API test controls intentionally issue generation requests when used outside the offline suite. Model/provider compatibility has not been tested with live requests.

## Offline regressions

Playwright serves the production bundle over loopback, intercepts every external request, and supplies dummy identity, token and PNG fixtures. Tests cover module startup without export syntax errors, user token entry/clearing/reload, selected models, success/failure, retries, reference upload, recreation fallback, and download bytes. No real provider credentials are required. `check:assets` builds into an ignored temporary directory with a nonsecret credential sentinel and scans every emitted file for that sentinel and the removed build-time variable name.

CI runs locked installation, typecheck/build, asset inspection and Chromium tests before the existing Pages deployment job can run on a push to `main`. Pull requests run verification only.
