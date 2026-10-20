# Provider boundary and human setup

Status: implemented and offline-tested; no service credential, Access application, Cloudflare resource, route or production release has been provisioned. `wrangler.jsonc` is a deploy configuration for review and dry-run only. `workers_dev` and preview URLs are disabled. Existing production remains untouched.

## Runtime and authorization

The browser POSTs JSON to `/hf-image-generator/api/provider` on its own origin, with explicit `X-Credential-Mode: user|service`. The Worker serves the existing Vite base path and rewrites `/hf-image-generator/assets/*` to its asset binding. API paths never fall through to static assets.

Both modes require an exact configured origin, JSON, an exact action schema, fixed model allowlist, valid image input and the durable admission gate. Origin checks are browser cross-site protection, **not caller authentication**. There is no CORS grant. User mode requires an intentionally supplied Bearer token; it can never select the hosted token. Service mode rejects a simultaneous Authorization header and requires all service configuration plus `Cf-Access-Jwt-Assertion`. Merely sending Access identity/email headers grants nothing.

`jose` verifies RS256 signature against a pinned team-domain HTTPS JWKS endpoint, issuer, audience, subject allowlist, issued-at and expiry (maximum one hour token lifetime). Arbitrary issuer/JWKS URLs are not accepted. Access JWTs are supplied by the edge, not copied from local cookies. Only then is the server secret selected. Hosted access allows FLUX.1 Schnell only. User mode retains all seven existing model choices. No caller can override endpoint, parameters, dimensions or retry count.

Schnell uses the documented HuggingFace Nscale route `https://router.huggingface.co/nscale/v1/images/generations`, flat JSON parameters and bounded inline base64 output. The other existing model IDs use the generic `https://router.huggingface.co/hf-inference/models/<model>` contract; their current availability is not guaranteed and the app does not silently choose another provider. Token checks use `https://huggingface.co/api/whoami-v2`. Redirects are handled manually and non-success statuses rejected; workerd does not support redirect mode `error`. See [official contract review](provider-contracts.md) for pinned sources and exact payloads.

Image-to-image with parameters is JSON with base64 `inputs` and `target_size`, not multipart. The unsupported `strength` parameter is removed. Schnell is treated as text-only: recreation explicitly uses the fixed vintage-description fallback and never forwards reference bytes to Nscale. Other models may fall back on 400/422 task rejection; missing/retired models (404/410) return an actionable `MODEL_UNAVAILABLE` response without a blind recreation retry. Live availability, account permissions, output dimensions and billing still require separately authorized validation.

## Limits

| Boundary | Fixed limit |
| --- | --- |
| JSON body (declared and streamed) | 2,900,000 bytes |
| Reference image | 2,000,000 bytes; PNG/JPEG/WebP signatures |
| Prompt | Nonblank, 2,000 characters |
| Provider image | 5,000,000 bytes; PNG/JPEG/WebP signatures |
| Generation parameters | 512×512; Schnell 4 steps/guidance 0; other models 20 steps/guidance 7.5 |
| Overall handler deadline | 30 seconds, including auth/body/provider reads |
| Upstream calls | At most 3 total; one retry on 503 per operation, 1-second wait |
| Per principal | 4 requests/minute, 20/day, 1 concurrent |
| Global across both credential modes | 12 requests/minute, 100/day, 2 concurrent |
| Admission lease | Expires after 35 seconds if cleanup is lost |

The single named SQLite Durable Object serializes quota reservations in persistent storage, so application isolates cannot each reset their own counter. Rejected upstream calls and identity tests count too. Day/minute boundaries use UTC epoch windows; there may be bursts at window boundaries, but the daily cap remains enforced. Storage holds SHA-256 fingerprints/verified subject hashes, counters and short-lived leases, never raw credentials, prompts or images. No IP header is trusted as identity. Quota storage failure denies requests. Rotating personal tokens cannot bypass the global budget, though they can exhaust it and deny service to others; operators must additionally use edge abuse protection when releasing publicly.

Admission cleanup is awaited within the original deadline, with lease expiry as a backstop. Native fetch is invoked through a global receiver-safe wrapper; Node-only mocks did not expose workerd’s receiver and redirect restrictions. Limits bound request volume and generation parameters; **they are not a monetary billing guarantee**. A human must also configure provider-side spending/usage caps and model permissions. Only a human-reviewed code/configuration change may widen the caps or service model set.

## Exact human provisioning needs (not executed)

1. Choose the intended Cloudflare account and review the Worker/SQLite Durable Object migration (`ProviderBudget`, migration `v1`). Confirm resource costs. Review and authorize routing under the intended existing origin; this task changes no domains or routes.
2. Configure a Cloudflare Access self-hosted application covering the handler (or entire app), with an explicit identity allow policy. Do not permit unauthenticated bypass or a catch-all allow rule. Review a token lifetime of at most one hour. Supply the Access team's `*.cloudflareaccess.com` domain, the application's audience and allowed immutable subject IDs.
3. Configure `PUBLIC_ORIGIN` as the exact scheme/host/port, without a trailing slash; `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and comma-separated `ACCESS_SUBJECTS` are server runtime configuration. No defaults enable hosted access.
4. Provision a fine-grained HuggingFace provider key **only into the Worker secret binding `HF_SERVICE_TOKEN`**, with restricted model permissions and provider-side spending/usage caps. Never use `VITE_*`, repository files, client assets, build defines or logs. No command in this task reads or provisions a real key. Hosted Schnell uses Nscale via the HuggingFace router and HuggingFace credential/billing flow; verify those provider permissions and account spending caps before release.
5. Retain the `BUDGET` Durable Object and `ASSETS` bindings from the reviewed config. Set edge request size/rate protections, log redaction and retention. Do not enable request header/body logging on the provider path. The application emits no credential-bearing logs.
6. Review offline tests, audit and dry-run. Authorize any live nonproduction compatibility check separately, then separately authorize a production release. Nothing in CI deploys; a future release workflow must retain these gates and an explicit environment approval.

## Offline evidence

`tests/api.test.ts` exercises the real handler, JWT verification with ephemeral test-only signing keys, a serialized in-memory Durable Object storage adapter, abuse/size/deadline/quota errors and Worker asset routing. `tests/offline-server.ts` runs only over cloud loopback and mocks all upstream calls. Its scenario headers and fixture identity injection exist only in this test server; it is not referenced by `server/worker.ts` and is absent from deploy bundles. Chromium covers the original eight flows plus authorized/unauthorized hosted access and LUM accessibility. No fixture is a usable production credential.

`tests/runtime.test.ts` separately executes the production Worker bundle in Miniflare/workerd with native assets and real SQLite-backed Durable Objects. It proves independent admissions, simultaneous requests, full runtime restart persistence, lease expiry, UTC rollover, per-principal/global daily limits, fail-closed configuration/auth, provider retry/error and base-path/security headers. Test-only clock substitution is confined to test-created isolates for deterministic rollover; no clock/scenario override exists in production. All outbound traffic is intercepted outside the Worker by the Miniflare harness. CI checks out and records the exact PR head, bounds the job/runtime step, and uploads runtime logs/provenance with `always()` even on failure.

## Dependency disposition

The browser `@huggingface/inference` SDK was removed; the fixed server request path replaces it. `jose` 6.2.13 is the only runtime npm dependency. Vite is pinned to 7.3.7, Wrangler to 4.151.2, and the TypeScript test runner to tsx 4.23.15. Existing TypeScript 5.9.3 and Playwright 1.56.1 remain pinned. Geist/Geist Mono packages are pinned to 5.3.0 with their OFL notices retained. Compatible transitive updates are locked. Miniflare 5.20261019.0-beta (the version already used by Wrangler) is now an explicit pinned test dependency. The initial audit reported six high advisories; the final full dependency audit reported zero advisories of any severity. CI repeats the audit at the high threshold. No vulnerability suppression, secret provisioning or package publication was performed.
