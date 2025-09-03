import 'dotenv/config';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

type Args = {
  mediaUrl: string;
  title?: string;
  description?: string;
  tags?: string[];
  publish?: boolean;
  headless?: boolean;
  googleEmail?: string;
  googlePassword?: string;
  loginFirst?: boolean;
  googleLoginOnly?: boolean;
  googleLoginManual?: boolean;
  verifyCivitaiSession?: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Record<string, string | string[] | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = 'true';
      } else {
        i++;
        if (key === 'tag' || key === 'tags') {
          const existing = (args['tags'] as string[] | undefined) ?? [];
          (existing as string[]).push(next);
          args['tags'] = existing;
        } else {
          args[key] = next;
        }
      }
    }
  }
  const mediaUrl = (args.media as string) || (args.mediaUrl as string);
  const loginOnlyFlag = String(args['google-login-only'] || '').toLowerCase() === 'true';
  const loginManualFlag = String(args['google-login-manual'] || '').toLowerCase() === 'true';
  const verifyCivitaiFlag = String(args['verify-civitai-session'] || '').toLowerCase() === 'true';
  if (!mediaUrl && !loginOnlyFlag && !loginManualFlag && !verifyCivitaiFlag) {
    throw new Error('Usage: tsx scripts/civitai-post-intent-debug.ts --media <public_image_url> --title <text> --description <text> --tags "a,b,c" [--details <url>] [--publish] [--google-email <email>] [--google-password <pw>] [--headless false] [--google-login-only true]');
  }

  const tagsRaw = (args.tags as string[] | undefined) ?? [];
  const tagsJoined = tagsRaw.length === 1 && (tagsRaw[0] as string).includes(',')
    ? (tagsRaw[0] as string).split(',').map((s) => s.trim()).filter(Boolean)
    : tagsRaw;

  return {
    mediaUrl,
    title: args.title as string | undefined,
    description: args.description as string | undefined,
    tags: (tagsJoined as string[] | undefined) ?? undefined,
    publish: String(args.publish || '').toLowerCase() === 'true',
    headless: String(args.headless || 'true').toLowerCase() !== 'false',
    googleEmail: (args['google-email'] as string) || process.env.GOOGLE_EMAIL || undefined,
    googlePassword: (args['google-password'] as string) || process.env.GOOGLE_PASSWORD || undefined,
    loginFirst: String(args['login-first'] || '').toLowerCase() === 'true',
    googleLoginOnly: String(args['google-login-only'] || '').toLowerCase() === 'true',
    googleLoginManual: String(args['google-login-manual'] || '').toLowerCase() === 'true',
    verifyCivitaiSession: String(args['verify-civitai-session'] || '').toLowerCase() === 'true',
  };
}

async function headOrGetMeta(url: string): Promise<{ ok: boolean; contentType?: string; contentLength?: number; warnings: string[] }>
{
  const warnings: string[] = [];
  try {
    let res = await fetch(url, { method: 'HEAD' });
    if (!res.ok || !res.headers?.get('content-type')) {
      // Fallback to GET (some servers don’t support HEAD properly)
      res = await fetch(url, { method: 'GET' });
    }
    const ct = res.headers?.get('content-type') || undefined;
    const clStr = res.headers?.get('content-length');
    const cl = clStr ? Number(clStr) : undefined;
    if (!ct) warnings.push('No content-type header present.');
    if (typeof cl === 'number' && cl > 50 * 1024 * 1024) warnings.push('Image exceeds 50MB limit.');
    if (ct && !/image\/(png|jpe?g|webp)/i.test(ct)) warnings.push(`Content-Type ${ct} may not be supported by Civitai.`);
    return { ok: true, contentType: ct, contentLength: cl, warnings };
  } catch (e: any) {
    warnings.push(`HEAD/GET check failed: ${e?.message || String(e)}`);
    return { ok: false, warnings };
  }
}

function normalizeTags(input?: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of input ?? []) {
    const tag = String(t).trim();
    if (!tag) continue;
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= 5) break;
  }
  return out;
}

function buildPostIntentUrl({ mediaUrl, title, description, tags }: Args): string {
  const base = 'https://civitai.com/intent/post';
  const params = new URLSearchParams({ mediaUrl });
  if (title) params.append('title', title);
  if (description) params.append('description', description);
  const norm = normalizeTags(tags);
  if (norm && norm.length > 0) params.append('tags', norm.join(','));
  return `${base}?${params.toString()}`;
}

async function loginWithGoogle(page: Page, email: string, password: string): Promise<void> {
  // Proactively clear common cookie consent overlays that intercept clicks
  await dismissCookieBanners(page);
  await page.getByRole('button', { name: /Google/i }).click();

  await page.waitForURL(/accounts\.google\.com/);
  await tryClickGoogleTryAgain(page);
  try {
    const emailField = page.locator('input#identifierId, input[type="email"], input[name="identifier"]').first();
    await emailField.waitFor({ timeout: 15000 });
    await emailField.click({ force: true });
    await emailField.fill(email);
    await clickGoogleNext(page);
  } catch {}

  try {
    await tryClickGoogleTryAgain(page);
    const passField = page.locator('input[name="Passwd"], input[type="password"]').first();
    await passField.waitFor({ timeout: 15000 });
    await passField.click({ force: true });
    await passField.fill(password);
    await clickGoogleNext(page);
  } catch {}
  await page.waitForURL(/civitai\.com/i, { timeout: 120000 }).catch(() => {});
}

async function loginToGoogleDirect(page: Page, email: string, password: string): Promise<void> {
  // Go directly to Google sign-in first
  await page.goto('https://accounts.google.com/signin/v2/identifier', { waitUntil: 'domcontentloaded' });
  await tryClickGoogleTryAgain(page);
  try {
    const emailField = page.locator('input#identifierId, input[type="email"], input[name="identifier"]').first();
    await emailField.waitFor({ timeout: 15000 });
    await emailField.click({ force: true });
    await emailField.fill(email);
    await clickGoogleNext(page);
  } catch {}
  try {
    await tryClickGoogleTryAgain(page);
    const passField = page.locator('input[name="Passwd"], input[type="password"]').first();
    await passField.waitFor({ timeout: 15000 });
    await passField.click({ force: true });
    await passField.fill(password);
    await clickGoogleNext(page);
  } catch {}
  // Wait for Google to complete login
  await page.waitForURL(/google\.(com|[a-z.]+)\//i, { timeout: 120000 }).catch(() => {});
}

async function tryClickGoogleTryAgain(page: Page): Promise<void> {
  // Handle Google interstitials like "This browser or app may not be secure" with "Try again"
  const tryOnce = async (): Promise<boolean> => {
    const selectors = [
      'button:has-text("Try again")',
      'a:has-text("Try again")',
      'div[role="button"]:has-text("Try again")',
      'span[role="button"]:has-text("Try again")',
      'text=Try again',
    ];
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        const vis = await loc.isVisible({ timeout: 500 }).catch(() => false);
        if (vis) {
          await loc.click({ timeout: 1500 }).catch(() => {});
          await page.waitForLoadState('domcontentloaded');
          await page.waitForTimeout(500);
          return true;
        }
      } catch {}
    }
    // Fallback: DOM scan
    try {
      const clicked = await page.evaluate(() => {
        const matches = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"], *')) as HTMLElement[];
        for (const el of matches) {
          const t = (el.textContent || '').trim().toLowerCase();
          if (t === 'try again') {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(500);
        return true;
      }
    } catch {}
    return false;
  };

  for (let i = 0; i < 5; i++) {
    const done = await tryOnce();
    if (done) return;
    await page.waitForTimeout(500);
  }
}

async function clickGoogleNext(page: Page): Promise<void> {
  const selectors = [
    '#identifierNext button',
    '#passwordNext button',
    'button#identifierNext',
    'button#passwordNext',
    '#identifierNext',
    '#passwordNext',
    'div[role="button"]#identifierNext',
    'div[role="button"]#passwordNext',
    'button:has-text("Next")',
    'div[role="button"]:has-text("Next")',
    'span[role="button"]:has-text("Next")',
    'text=Next',
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      const vis = await loc.isVisible({ timeout: 700 }).catch(() => false);
      if (vis) {
        await loc.click({ timeout: 2000 });
        try { await page.waitForLoadState('domcontentloaded'); } catch {}
        await page.waitForTimeout(300).catch(() => {});
        return;
      }
    } catch {}
  }
  // Fallback: press Enter
  try {
    await page.keyboard.press('Enter');
    try { await page.waitForLoadState('domcontentloaded'); } catch {}
    await page.waitForTimeout(300).catch(() => {});
  } catch {}
}

function ensureUserDataDir(): string {
  const candidates: string[] = [];
  if (process.env.PLAYWRIGHT_PROFILE_DIR) {
    candidates.push(path.resolve(process.env.PLAYWRIGHT_PROFILE_DIR));
  }
  // Search upward from script dir for attached profile
  try {
    let current = __dirname;
    for (let i = 0; i < 6; i++) {
      const candidate = path.resolve(current, '.playwright-mcp', 'google-profile');
      if (fs.existsSync(candidate)) {
        candidates.push(candidate);
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {}
  // CWD profile
  candidates.push(path.resolve(process.cwd(), '.playwright-mcp', 'google-profile'));
  // Home fallback
  candidates.push(path.join(os.homedir(), '.jinn', 'playwright-profile'));

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  const fallback = candidates[candidates.length - 1]!;
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

async function createPersistentContext(headless: boolean): Promise<BrowserContext> {
  const userDataDir = ensureUserDataDir();
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    channel: 'chrome',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    // @ts-ignore
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return context;
}

async function googleLoginOnlyFlow(headless: boolean, email?: string, password?: string): Promise<boolean> {
  if (!email || !password) throw new Error('Missing Google credentials');
  const context = await createPersistentContext(headless);
  const page = await context.newPage();
  try {
    await loginToGoogleDirect(page, email, password);
    // Verify by opening My Account page
    await page.goto('https://myaccount.google.com/?pli=1', { waitUntil: 'domcontentloaded' });
    // Heuristic: presence of "Welcome" heading or avatar button
    const welcome = await page.getByRole('heading', { level: 1 }).first().textContent().catch(() => '');
    const avatarVisible = await page.getByRole('button', { name: /Google Account/i }).isVisible().catch(() => false);
    const ok = (welcome || '').toLowerCase().includes('welcome') || avatarVisible;
    console.log('[google-login] ok =', ok);
    return ok;
  } finally {
    await context.close();
  }
}

async function googleLoginManualFlow(headless: boolean): Promise<boolean> {
  const context = await createPersistentContext(headless);
  const page = await context.newPage();
  try {
    await page.goto('https://accounts.google.com/signin/v2/identifier', { waitUntil: 'domcontentloaded' });
    await tryClickGoogleTryAgain(page);
    const start = Date.now();
    while (Date.now() - start < 3 * 60 * 1000) { // wait up to 3 minutes
      // If user has completed login, My Account page or avatar should be visible
      try {
        if (/myaccount\.google\.com/.test(page.url())) {
          console.log('[google-login] detected myaccount');
          return true;
        }
        const avatar = await page.getByRole('button', { name: /Google Account/i }).isVisible({ timeout: 1000 }).catch(() => false);
        if (avatar) {
          console.log('[google-login] detected avatar');
          return true;
        }
      } catch {}
      await tryClickGoogleTryAgain(page);
      await page.waitForTimeout(1500);
    }
    return false;
  } finally {
    await context.close();
  }
}

async function verifyCivitaiSession(headless: boolean): Promise<boolean> {
  const context = await createPersistentContext(headless);
  const page = await context.newPage();
  try {
    await page.goto('https://civitai.com', { waitUntil: 'domcontentloaded' });
    await dismissCookieBanners(page);
    
    // More robust logged-in detection using multiple strategies
    const indicators = await Promise.all([
      // 1. Look for user avatar buttons (most reliable)
      page.locator('button[aria-label*="Avatar"], button:has-text("Avatar")').first().isVisible().catch(() => false),
      
      // 2. Look for user-specific elements (like username in avatar)
      page.locator('button:has-text("nicflamel0x")').first().isVisible().catch(() => false),
      
      // 3. Look for Create button (logged-in users see this)
      page.getByRole('button', { name: /Create/i }).isVisible().catch(() => false),
      
      // 4. Look for user menu or profile elements
      page.locator('[data-testid*="user"], [data-testid*="profile"], [class*="user"], [class*="profile"]').first().isVisible().catch(() => false),
      
      // 5. Check for absence of login/signup buttons
      page.getByRole('button', { name: /Log ?in|Sign ?up|Login|Register/i }).isVisible().then(visible => !visible).catch(() => true),
      
      // 6. Look for any button containing a username pattern
      page.locator('button:has-text(/[a-zA-Z0-9_]{3,}/)').filter({ hasText: /Avatar|Profile|Account/i }).first().isVisible().catch(() => false)
    ]);
    
    const isLoggedIn = indicators.some(Boolean);
    console.log('[verify-session] civitai logged-in =', isLoggedIn);
    console.log('[verify-session] indicators:', indicators.map((v, i) => `[${i}]: ${v}`).join(', '));
    
    return isLoggedIn;
  } finally {
    await context.close();
  }
}

async function publishFlow(url: string, headless: boolean, email?: string, password?: string, loginFirst?: boolean): Promise<string | null> {
  // Use persistent context so existing Google session is reused
  const context = await createPersistentContext(headless);
  const page = await context.newPage();
  try {
    // If requested, sign into Google first, then proceed
    if (loginFirst && email && password) {
      await loginToGoogleDirect(page, email, password);
    }
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await dismissCookieBanners(page);
    if (/\/login\?/.test(page.url())) {
      let logged = false;
      try {
        // Try to log in via existing Google session (no credentials)
        await page.getByRole('button', { name: /Google/i }).click({ timeout: 6000 });
        await page.waitForURL(/accounts\.google\.com|civitai\.com/i, { timeout: 60000 });
        if (/accounts\.google\.com/.test(page.url())) {
          await tryClickGoogleTryAgain(page);
          // If account is already signed-in, Google may instantly redirect back
          await page.waitForURL(/civitai\.com/i, { timeout: 60000 }).catch(() => {});
        }
        logged = /civitai\.com/.test(page.url());
      } catch {}

      if (!logged) {
        if (!email || !password) throw new Error('Login required but no Google credentials provided');
        await loginWithGoogle(page, email, password);
      }

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await dismissCookieBanners(page);
    }
    // Proceed if the intermediate screen shows
    try { await page.getByRole('button', { name: /Proceed|Continue|Create new post/i }).click({ timeout: 12000 }); } catch {}
    await dismissCookieBanners(page);

    // Try a set of common publish/post actions
    const publishLabels = [/Publish/i, /Post/i, /Create Post/i, /Share/i, /Submit/i];
    let clicked = false;
    for (const label of publishLabels) {
      try {
        await page.getByRole('button', { name: label }).click({ timeout: 8000 });
        clicked = true;
        break;
      } catch {}
    }
    if (!clicked) {
      // Fallback: try any button in editor toolbar
      try {
        await page.locator('button:has-text("Publish")').first().click({ timeout: 8000 });
        clicked = true;
      } catch {}
    }
    if (!clicked) {
      // Attempt scroll and retry
      try {
        for (let i = 0; i < 3 && !clicked; i++) {
          await page.mouse.wheel(0, 2000);
          await dismissCookieBanners(page);
          for (const label of publishLabels) {
            try {
              await page.getByRole('button', { name: label }).click({ timeout: 4000 });
              clicked = true;
              break;
            } catch {}
          }
          if (!clicked) {
            try {
              await page.locator('button:has-text("Publish")').first().click({ timeout: 4000 });
              clicked = true;
            } catch {}
          }
        }
      } catch {}
    }

    if (!clicked) {
      // As a final fallback in headful mode, allow manual click and wait for redirect
      await page.waitForURL(/civitai\.com\/posts\//i, { timeout: 180000 }).catch(() => {});
      if (/civitai\.com\/posts\//i.test(page.url())) return page.url();
      throw new Error('Could not find publish button');
    }
    try {
      await page.getByRole('link', { name: /View Post/i }).click({ timeout: 15000 });
      await page.waitForURL(/civitai\.com\/posts\//i, { timeout: 30000 });
      return page.url();
    } catch {
      if (/civitai\.com\/posts\//i.test(page.url())) return page.url();
    }
    return null;
  } finally {
    await context.close();
  }
}

async function dismissCookieBanners(page: Page): Promise<void> {
  const buttonNames = [
    /Accept all/i,
    /Accept All/i,
    /I Accept/i,
    /Agree/i,
    /Allow all/i,
    /OK/i,
    /Continue without/i,
  ];
  for (const name of buttonNames) {
    try {
      await page.getByRole('button', { name }).click({ timeout: 1500 });
      return;
    } catch {}
  }
  // Try specific cookie framework containers
  try {
    const candidates = ['#snigel-cmp-framework', '.snigel-cmp-framework'];
    for (const sel of candidates) {
      const has = await page.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false);
      if (has) {
        // Try clicking any button containing Accept
        const btn = page.locator(`${sel} button:has-text("Accept")`).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 1500 }).catch(() => {});
          return;
        }
        // Fallback: remove overlay via script
        await page.evaluate((s) => {
          const el = document.querySelector(s) as HTMLElement | null;
          if (el) el.remove();
        }, sel).catch(() => {});
      }
    }
  } catch {}
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.googleLoginOnly) {
    const ok = await googleLoginOnlyFlow(!!args.headless, args.googleEmail, args.googlePassword);
    if (!ok) throw new Error('Google login failed');
    console.log('[post-intent] google-login-only success');
    return;
  }

  if (args.googleLoginManual) {
    const ok = await googleLoginManualFlow(!!args.headless);
    if (!ok) throw new Error('Google manual login timeout');
    console.log('[post-intent] google-login-manual success');
    return;
  }

  if (args.verifyCivitaiSession) {
    const ok = await verifyCivitaiSession(!!args.headless);
    if (!ok) throw new Error('Not logged in to Civitai');
    console.log('[post-intent] verify-civitai-session success');
    return;
  }

  console.log('[post-intent] mediaUrl =', args.mediaUrl);

  const meta = await headOrGetMeta(args.mediaUrl);
  if (meta.warnings.length) {
    console.warn('[post-intent] warnings:', meta.warnings.join(' | '));
  }

  const url = buildPostIntentUrl(args);
  console.log('[post-intent] url =', url);

  if (args.publish) {
    const postUrl = await publishFlow(url, !!args.headless, args.googleEmail, args.googlePassword, args.loginFirst);
    if (!postUrl) {
      throw new Error('Failed to publish post');
    }
    console.log('[post-intent] published =', postUrl);
  }
}

main().catch((e) => {
  console.error('[post-intent] failed:', e);
  process.exit(1);
});


