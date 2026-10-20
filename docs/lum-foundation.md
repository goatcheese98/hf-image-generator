# Existing-layout LUM foundation record

Scope: styling and accessibility within the existing setup → generation → results → debug sections. No Paper file, new layout or human design approval is claimed. Paper cloud is unestablished and local Paper was not opened. HuggingFace identity, logo, default photograph, model choices and native browser controls remain.

Only these three read-only LUM Brain files were consulted:

| Reference | Observed blob SHA |
| --- | --- |
| [design-tokens.ts](https://github.com/goatcheese98/lum-brain/blob/main/src/styles/design-tokens.ts) | `e7e0c2362848c209914a5d9da2bcaa5657b663b8` |
| [fonts.ts](https://github.com/goatcheese98/lum-brain/blob/main/src/styles/fonts.ts) | `d32cace0ed25de3f8e164b9b2d906ca6e782c0e9` |
| [css-standards.md](https://github.com/goatcheese98/lum-brain/blob/main/docs/css-standards.md) | `a0a54906dba295f4a3c0d76b0031e366579dec4a` |

`lum-foundation.css` centralizes the prescribed light/dark palette and 6/8/10/12/16px radii with the reference shadow. `index.css` consumes semantic tokens. Light is white with ink accent; dark uses the specified near-black surfaces and yellow accent, following system preference. Success/error/warning tokens use accessible semantic foregrounds and tinted surfaces; Chromium checks at least 4.5:1 text contrast for all status variants. Body text remains at least 16px on mobile rather than adopting the denser dashboard's 13px.

Geist Variable is actually loaded for the interface and Geist Mono Variable for technical statuses/debug values from pinned `@fontsource-variable/geist` and `geist-mono` 5.3.0 packages. Both ship under SIL OFL 1.1; full notices are retained in `public/licenses`. Font assets are bundled on the same origin. No Google Fonts or other external font request is needed. Fallbacks are system-ui/sans-serif and ui-monospace/monospace. Tests assert that both actual font faces reach loaded state, not merely that a family name appears in CSS.

Keyboard focus is visible. Debug expansion is now a native button with `aria-expanded` and `aria-controls`. Error/success messages have semantic live roles, hidden until populated. Reduced-motion disables animation/transitions, input text remains legible at 390px, and mobile has no horizontal overflow. The new credential source selector is part of the authorized security flow, not a layout redesign. UTF-8 metadata ensures the credential explanation renders correctly.

## Cloud screenshots

Captured using cloud Chromium, loopback assets and offline fixtures. No Mac resources, local cookies, real credentials or production image calls were used. The before image applies the checkpoint's original stylesheet to the current markup to isolate the styling difference; it is not a fabricated full baseline application capture. After screenshots include a realistic prompt and keyboard focus; no generated image claim is implied.

- [Before foundation stylesheet](screenshots/before-foundation.png)
- [Desktop light, 1280px](screenshots/desktop-light.png)
- [Desktop dark, 1280px](screenshots/desktop-dark.png)
- [Mobile light, 390px](screenshots/mobile-light.png)

`tests/visual.spec.ts` reproduces after captures in `work/screenshots` during CI, checks loaded fonts, semantic contrast, focus, reduced motion and keyboard debug controls under the Worker's CSP. Screenshots are evidence for this slice, not a versioned Paper design.
