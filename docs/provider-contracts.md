# Official provider contract review (offline)

Reviewed public official documentation/source on 2026-10-20. Only GitHub documentation/source GETs were made. No inference, account, token, paid provider or model-generation request was made. This validates the documented request/response contract, not live deployment availability or billing.

## Pinned authoritative sources

- HuggingFace hub-docs revision `c7ba19d3ad4b2d07f9b30d12c619b38b98220d94`: [text-to-image](https://github.com/huggingface/hub-docs/blob/c7ba19d3ad4b2d07f9b30d12c619b38b98220d94/docs/inference-providers/tasks/text-to-image.md), [image-to-image](https://github.com/huggingface/hub-docs/blob/c7ba19d3ad4b2d07f9b30d12c619b38b98220d94/docs/inference-providers/tasks/image-to-image.md). The text example maps Schnell to Nscale. The image contract specifies base64 `inputs` when parameters are present; its documented parameters do not include `strength`.
- huggingface.js revision `234c367c120753f5e9df3ec30d9c57c687a5e407`: [HF provider implementation](https://github.com/huggingface/huggingface.js/blob/234c367c120753f5e9df3ec30d9c57c687a5e407/packages/inference/src/providers/hf-inference.ts), [image schema](https://github.com/huggingface/huggingface.js/blob/234c367c120753f5e9df3ec30d9c57c687a5e407/packages/tasks/src/tasks/image-to-image/spec/input.json), [Nscale provider](https://github.com/huggingface/huggingface.js/blob/234c367c120753f5e9df3ec30d9c57c687a5e407/packages/inference/src/providers/nscale.ts), [provider routing](https://github.com/huggingface/huggingface.js/blob/234c367c120753f5e9df3ec30d9c57c687a5e407/packages/inference/src/providers/providerHelper.ts). HF-token routing goes through the HuggingFace router; the application does not accept arbitrary endpoints or direct provider-key routing.
- Diffusers revision `e04f0c5f24392fcd34b32d18d0ce03668f9bcd50`: [Flux pipeline](https://github.com/huggingface/diffusers/blob/e04f0c5f24392fcd34b32d18d0ce03668f9bcd50/docs/source/en/api/pipelines/flux.md). Schnell requires guidance 0 and recommends the bounded four-step example.

## Implemented contracts

`server/provider-contract.ts` owns fixed endpoints and payloads. Contract tests assert complete payload objects, rather than accepting any body that returns an image.

| Path | Request | Accepted result |
| --- | --- | --- |
| Schnell text generation | HF router `/nscale/v1/images/generations`; flat `model`, `prompt`, `response_format: b64_json`, width/height 512, steps 4, guidance 0 | Exactly one inline `data[0].b64_json`, decoded within the image byte cap; PNG/JPEG/WebP signature determines MIME |
| Other existing model text generation | HF router `/hf-inference/models/<allowlisted ID>`; JSON `inputs` plus bounded generic text parameters | Bounded raw PNG/JPEG/WebP bytes |
| Other model image-to-image | Same fixed hf-inference route; JSON base64 `inputs` without data-URL prefix; `parameters.prompt`, guidance, steps and `target_size` | Bounded raw image bytes; unsupported task 400/422 may use the explicit text fallback |
| Schnell recreation | Text-only fixed vintage-description fallback using Schnell’s text route | `X-Image-Method: enhanced-text`; UI says the uploaded reference was not analyzed |

Provider output URLs are rejected, never fetched. The expanded base64 envelope has a separate bounded read cap and the decoded image retains the existing five-megabyte cap. Redirects are manual and rejected, so neither credentials nor image fetching can escape the fixed endpoints. Tests cover these policies, malformed/oversize output and the three-call ceiling.

## Availability and limitations

The existing seven model choices remain available in personal-token mode, but their deployment on hf-inference is not claimed. Some are available only through other providers, gated access, an endpoint deployment or not currently served at all. The application does not dynamically select or silently bill another provider. Missing/retired models produce safe `MODEL_UNAVAILABLE` / HTTP 424 with “Choose another model.” Raw provider messages are suppressed. Generic request/task failures may also yield that safe error after an attempted fallback; no image-analysis claim is made.

Hosted mode remains Schnell-only, disabled without verified Access identity, a server secret and durable admission. The existing behavior that resets both selectors to Schnell and disables other options is preserved and regression-tested; explanatory text states the limit. Switching back to personal-token mode requires intentional token entry.

Contract correctness and runtime tests do not establish model availability, provider-side parameter enforcement, gated-model authorization or monetary limits. Human provisioning, restricted HF provider permissions, account spending caps and a separately authorized live nonproduction compatibility check remain required before any release. No deployment or provisioning was performed.
