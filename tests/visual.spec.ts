import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

for (const [name, width, scheme] of [['desktop-light',1280,'light'],['desktop-dark',1280,'dark'],['mobile-light',390,'light']] as const) {
  test(`existing layout uses loaded LUM fonts, focus and responsive tokens: ${name}`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
    const external: string[] = [];
    await page.route('**/*', route => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.goto('./');
    await expect(page.locator('#error-message')).toBeHidden();
    await expect(page.locator('#success-message')).toBeHidden();
    expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
    await page.locator('#prompt-input').fill('A quiet alpine lake at sunrise, soft light on the mountains, natural colors');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(10, 10, 11)');
    expect(await page.evaluate(() => Array.from(document.fonts).some(font => font.family.includes('Geist Variable') && font.status === 'loaded'))).toBe(true);
    expect(await page.evaluate(() => Array.from(document.fonts).some(font => font.family.includes('Geist Mono Variable') && font.status === 'loaded'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('body').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    const contrast = await page.evaluate(() => {
      const ratio = (fg: string, bg: string) => {
        const lum = (color: string) => {
          const values = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
          return (values[0] ?? 0) * .2126 + (values[1] ?? 0) * .7152 + (values[2] ?? 0) * .0722;
        };
        const a = lum(fg), b = lum(bg); return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
      };
      return ['success','error','warning','info'].map(status => {
        const element = document.createElement('span'); element.className = `status-${status}`; document.body.append(element);
        const style = getComputedStyle(element); const value = ratio(style.color, style.backgroundColor); element.remove(); return value;
      });
    });
    for (const value of contrast) expect(value).toBeGreaterThanOrEqual(4.5);
    await page.locator('#generate-btn').focus();
    expect(await page.locator('#generate-btn').evaluate(element => getComputedStyle(element).outlineWidth)).toBe('3px');
    expect(await page.locator('.spinner-circle').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    await page.locator('#debug-header').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#debug-header')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect(page.locator('#debug-header')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#prompt-input').focus();
    await mkdir('work/screenshots', {recursive: true});
    await page.screenshot({path: `work/screenshots/${name}.png`, fullPage: true});
    expect(external).toEqual([]);
  });
}
