import { test, expect, type Page } from '@playwright/test';

const token = 'offline-user-credential';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
interface FixtureOptions { failure?: boolean; retry?: boolean; unsupported?: boolean; sdkFailure?: boolean }
async function fixtures(page: Page, options: FixtureOptions = {}) {
  const errors: string[] = [];
  const logs: string[] = [];
  const requests: {url: string; body: string; auth: string | undefined}[] = [];
  let imageRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => logs.push(message.text()));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === '127.0.0.1') return route.continue();
    // All provider traffic is fulfilled offline, including identity checks.
    if (url.hostname === 'huggingface.co' || url.hostname === 'api-inference.huggingface.co') {
      requests.push({url: request.url(), body: request.postData() ?? '', auth: request.headers().authorization});
      if (url.pathname === '/api/whoami-v2') return route.fulfill({status: options.failure ? 401 : 200, json: {name: 'offline-user'}});
      imageRequests++;
      if (options.failure) return route.fulfill({status: 401, json: {error: `echo ${token}`}});
      if (options.sdkFailure && imageRequests === 1) return route.fulfill({status: 400, json: {error: 'SDK fixture failure'}});
      if (options.retry && imageRequests === 2) return route.fulfill({status: 503, json: {error: 'loading'}});
      if (options.unsupported && request.headers()['content-type']?.startsWith('multipart/')) return route.fulfill({status: 404, json: {error: 'unsupported'}});
      return route.fulfill({contentType: 'image/png', body: png});
    }
    errors.push(`Unexpected external request: ${url.hostname}`);
    return route.abort();
  });
  await page.goto('./');
  return {errors, logs, requests};
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
  expect(state.requests.at(-1)?.url).toContain('stabilityai/stable-diffusion-xl-base-1.0');
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

test('SDK fallback retries model loading once', async ({page}) => {
  await page.clock.install();
  const state = await fixtures(page, {sdkFailure: true, retry: true});
  await enterToken(page);
  await page.locator('#generate-btn').click();
  await expect.poll(() => state.requests.length).toBe(2);
  await page.clock.fastForward(11000);
  await generated(page);
  expect(state.requests).toHaveLength(3);
  expect(state.errors).toEqual([]);
});

for (const unsupported of [false, true]) {
  test(`recreation with uploaded reference and ${unsupported ? 'enhanced text fallback' : 'image provider'}`, async ({page}) => {
    const state = await fixtures(page, {unsupported});
    await enterToken(page);
    await page.locator('#recreate-mode').check();
    await page.locator('#reference-image-input').setInputFiles({name: 'reference.png', mimeType: 'image/png', buffer: png});
    await expect(page.locator('#old-image')).toHaveAttribute('src', /^data:image/);
    await page.locator('#recreate-prompt').fill('watercolor');
    await page.locator('#recreate-btn').click();
    await generated(page, '#recreated-image');
    await expect(page.locator('#download-recreated')).toBeVisible();
    expect(state.requests[0]?.body).toContain('watercolor');
    if (unsupported) expect(state.requests.at(-1)?.body).toContain('vintage black and white');
    expect(state.errors).toEqual([]);
  });
}

test('persistent loading fails after the single direct retry', async ({page}) => {
  await page.clock.install();
  const state = await fixtures(page, {sdkFailure: true});
  let directRequests = 0;
  await page.route('https://api-inference.huggingface.co/**', async route => {
    directRequests++;
    return route.fulfill({status: directRequests === 1 ? 400 : 503, json: {error: 'loading'}});
  });
  await enterToken(page);
  await page.locator('#generate-btn').click();
  // The SDK and direct fallback share this fixture endpoint.
  await expect.poll(() => directRequests).toBe(2);
  await page.clock.fastForward(11000);
  await expect(page.locator('#generation-status-text')).toHaveText('Generation failed');
  expect(directRequests).toBe(3);
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
