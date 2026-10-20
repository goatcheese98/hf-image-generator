import { test, expect, type Page } from '@playwright/test';

const token = 'offline-user-credential';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
interface FixtureOptions { failure?: boolean; retry?: boolean; unsupported?: boolean; loading?: boolean; service?: boolean; serviceFailure?: boolean; unavailable?: boolean }
async function fixtures(page: Page, options: FixtureOptions = {}) {
  const errors: string[] = [], logs: string[] = [];
  const requests: {url: string; body: string; auth: string | undefined}[] = [];
  const session = crypto.randomUUID();
  const scenario = options.unavailable ? 'unavailable' : options.serviceFailure ? 'service-failure' : options.failure ? 'failure' : options.loading ? 'loading' : options.retry ? 'retry' : options.unsupported ? 'unsupported' : options.service ? 'service' : 'success';
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => logs.push(message.text()));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') {errors.push(`Unexpected external request: ${url.hostname}`); return route.abort();}
    if (url.pathname.endsWith('/api/provider')) {
      requests.push({url: request.url(), body: request.postData() ?? '', auth: request.headers().authorization});
      return route.continue({headers: {...request.headers(), 'x-offline-session': session, 'x-offline-case': scenario}});
    }
    return route.continue();
  });
  await page.goto('./');
  const upstream = async (): Promise<{url: string; body: string; usedServiceKey: boolean}[]> => {
    const response = await page.request.get(`/__fixtures/state?session=${session}`);
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('calls' in value) || !Array.isArray(value.calls)) throw new Error('Invalid fixture state');
    return value.calls as {url: string; body: string; usedServiceKey: boolean}[];
  };
  return {errors, logs, requests, upstream};
}
async function enterToken(page: Page) { await page.locator('#token-input').fill(token); }
async function generated(page: Page, selector = '#new-image') {
  await expect(page.locator(selector)).toBeVisible();
  await expect(page.locator(selector)).toHaveAttribute('src', /^data:image\/png/);
  await expect.poll(() => page.locator(selector).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
}

test('production module loads without classic export errors; token is opt-in and memory-only', async ({page}) => {
  const state = await fixtures(page);
  await expect(page.locator('#token-status-text')).toHaveText('No token provided');
  await page.locator('#generate-btn').click();
  await expect(page.locator('#error-message')).toContainText('enter a token');
  expect(state.requests).toHaveLength(0);
  await enterToken(page);
  await page.locator('#test-token-btn').click();
  await expect(page.locator('#token-status-text')).toContainText('Valid');
  expect(state.requests[0]?.auth).toBe(`Bearer ${token}`);
  await page.locator('#token-input').fill('');
  await page.locator('#generate-btn').click();
  expect(state.requests).toHaveLength(1);
  await enterToken(page);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.reload();
  await expect(page.locator('#token-input')).toHaveValue('');
  await expect(page.locator('#token-status-text')).toHaveText('No token provided');
  expect(state.errors).toEqual([]);
  expect(state.logs.join('\n')).not.toContain(token);
});

test('selected model generates a decoded image and downloads identical fixture bytes', async ({page}) => {
  const state = await fixtures(page);
  await enterToken(page);
  await page.locator('#model-select').selectOption('stabilityai/stable-diffusion-xl-base-1.0');
  await page.locator('#prompt-input').fill('offline landscape');
  await page.locator('#test-api-btn').click();
  await expect(page.locator('#api-status-text')).toHaveText('Connection successful');
  await page.locator('#generate-btn').click();
  await generated(page);
  expect(state.requests.at(-1)?.body).toContain('stabilityai/stable-diffusion-xl-base-1.0');
  expect(state.requests.at(-1)?.body).toContain('offline landscape');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-image').click()]);
  expect(download.suggestedFilename()).toBe('generated-image.png');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(png);
  expect(state.errors).toEqual([]);
});

test('provider failure resets controls and does not expose echoed credentials', async ({page}) => {
  const state = await fixtures(page, {failure: true});
  await enterToken(page);
  await page.locator('#test-token-btn').click();
  await expect(page.locator('#token-status-text')).toContainText('Invalid');
  await page.locator('#generate-btn').click();
  await expect(page.locator('#generation-status-text')).toHaveText('Generation failed');
  await expect(page.locator('#generate-btn')).toBeEnabled();
  await expect(page.locator('#new-image')).toBeHidden();
  await expect(page.locator('#download-image')).toBeHidden();
  expect(state.logs.join('\n')).not.toContain(token);
  expect(await page.locator('body').innerText()).not.toContain(token);
  expect(state.errors).toEqual([]);
});

test('server boundary retries model loading once', async ({page}) => {
  const state = await fixtures(page, {retry: true});
  await enterToken(page);
  await page.locator('#generate-btn').click();
  await generated(page);
  expect(await state.upstream()).toHaveLength(2);
  expect(state.requests).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

for (const unsupported of [false, true]) {
  test(`recreation with uploaded reference and ${unsupported ? 'enhanced text fallback' : 'image provider'}`, async ({page}) => {
    const state = await fixtures(page, {unsupported});
    await enterToken(page);
    await page.locator('#recreate-mode').check();
    await page.locator('#recreate-model-select').selectOption('stabilityai/stable-diffusion-xl-base-1.0');
    await page.locator('#reference-image-input').setInputFiles({name: 'reference.png', mimeType: 'image/png', buffer: png});
    await expect(page.locator('#old-image')).toHaveAttribute('src', /^data:image/);
    await page.locator('#recreate-prompt').fill('watercolor');
    await page.locator('#recreate-btn').click();
    await generated(page, '#recreated-image');
    await expect(page.locator('#download-recreated')).toBeVisible();
    expect(state.requests[0]?.body).toContain('watercolor');
    if (unsupported) expect((await state.upstream()).at(-1)?.body).toContain('vintage black and white');
    expect(state.errors).toEqual([]);
  });
}

test('persistent loading fails after the single direct retry', async ({page}) => {
  const state = await fixtures(page, {loading: true});
  await enterToken(page);
  await page.locator('#generate-btn').click();
  await expect(page.locator('#generation-status-text')).toHaveText('Generation failed');
  expect(await state.upstream()).toHaveLength(2);
  await expect(page.locator('#generate-btn')).toBeEnabled();
  expect(state.errors).toEqual([]);
});

test('recreation API test uses the default reference and leaves results empty', async ({page}) => {
  const state = await fixtures(page);
  await enterToken(page);
  await page.locator('#recreate-mode').check();
  await page.locator('#test-recreate-api-btn').click();
  await expect(page.locator('#recreate-api-status-text')).toHaveText('Connection successful');
  await expect(page.locator('#download-recreated')).toBeHidden();
  await expect(page.locator('#test-recreate-api-btn')).toBeEnabled();
  expect(state.requests[0]?.body).toContain('test image generation');
  expect(state.errors).toEqual([]);
});


test('authorized hosted access generates, retries and downloads without a browser provider secret', async ({page}) => {
  const state = await fixtures(page, {service: true});
  await page.locator('#model-select').selectOption('stabilityai/stable-diffusion-xl-base-1.0');
  await page.locator('#recreate-mode').check();
  await page.locator('#recreate-model-select').selectOption('stabilityai/stable-diffusion-xl-base-1.0');
  await page.locator('#generate-mode').check();
  await page.locator('#credential-mode').selectOption('service');
  for (const selector of ['#model-select', '#recreate-model-select']) {
    await expect(page.locator(selector)).toHaveValue('black-forest-labs/FLUX.1-schnell');
    expect(await page.locator(`${selector} option`).evaluateAll(options => options.slice(1).every(option => (option as HTMLOptionElement).disabled))).toBe(true);
  }
  await expect(page.locator('#token-input')).toBeDisabled();
  await page.locator('#generate-btn').click();
  await generated(page);
  expect((await state.upstream())[0]?.usedServiceKey).toBe(true);
  expect(await state.upstream()).toHaveLength(2);
  expect(state.requests[0]?.auth).toBeUndefined();
  expect(state.logs.join('\n')).not.toContain('NONSECRET_SERVER_CREDENTIAL_CANARY');
  expect(await page.locator('body').innerText()).not.toContain('NONSECRET_SERVER_CREDENTIAL_CANARY');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-image').click()]);
  expect(download.suggestedFilename()).toBe('generated-image.png');
  expect(state.errors).toEqual([]);
});

test('unauthorized hosted access fails closed and makes no provider calls', async ({page}) => {
  const state = await fixtures(page);
  await page.locator('#credential-mode').selectOption('service');
  await page.locator('#generate-btn').click();
  await expect(page.locator('#generation-status-text')).toHaveText('Generation failed');
  expect(await state.upstream()).toHaveLength(0);
  await expect(page.locator('#generate-btn')).toBeEnabled();
});


test('authorized hosted provider failure resets UI without leaking server credential or raw body', async ({page}) => {
  const state = await fixtures(page, {serviceFailure: true});
  await page.locator('#credential-mode').selectOption('service');
  await page.locator('#generate-btn').click();
  await expect(page.locator('#generation-status-text')).toHaveText('Generation failed');
  expect((await state.upstream())[0]?.usedServiceKey).toBe(true);
  expect(state.logs.join('\n')).not.toContain('NONSECRET_SERVER_CREDENTIAL_CANARY');
  expect(await page.locator('body').innerText()).not.toContain('NONSECRET_SERVER_CREDENTIAL_CANARY');
  await expect(page.locator('#generate-btn')).toBeEnabled();
  await expect(page.locator('#download-image')).toBeHidden();
});


test('unavailable models give a safe actionable message and keep download hidden', async ({page}) => {
  await fixtures(page,{unavailable:true}); await enterToken(page);
  await page.locator('#generate-btn').click();
  await expect(page.locator('#error-message')).toContainText('This model is unavailable from the configured provider. Choose another model.');
  await expect(page.locator('#download-image')).toBeHidden();
});

test('Schnell recreation explains the text-only fallback without claiming image analysis', async ({page}) => {
  const state=await fixtures(page); await enterToken(page);
  await page.locator('#recreate-mode').check(); await page.locator('#recreate-prompt').fill('watercolor');
  await page.locator('#recreate-btn').click(); await generated(page,'#recreated-image');
  await expect(page.locator('#success-message')).toContainText('uploaded reference was not analyzed');
  expect(await state.upstream()).toHaveLength(1);
});
