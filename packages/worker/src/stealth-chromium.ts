import type { BrowserContextOptions, LaunchOptions } from "playwright";
import { chromium as chromiumVanilla } from "playwright";
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

const stealthDisabled = process.env.ATRIUM_STEALTH === "0";

if (!stealthDisabled) {
  chromiumExtra.use(StealthPlugin());
}

/**
 * Chromium launcher: `playwright-extra` + `puppeteer-extra-plugin-stealth` by default,
 * or stock Playwright when `ATRIUM_STEALTH=0`.
 */
export const chromium = stealthDisabled ? chromiumVanilla : chromiumExtra;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Default desktop viewport (overridable via `ATRIUM_VIEWPORT_W` / `ATRIUM_VIEWPORT_H`). */
export function defaultViewportSize(): { width: number; height: number } {
  return {
    width: intEnv("ATRIUM_VIEWPORT_W", 1366),
    height: intEnv("ATRIUM_VIEWPORT_H", 768),
  };
}

/**
 * Browser-context hints that look like a normal desktop Chrome session.
 * Merge with `storageState` / cookies as needed.
 */
export function desktopContextHints(viewport: {
  width: number;
  height: number;
}): BrowserContextOptions {
  const userAgent = process.env.ATRIUM_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
  const locale = process.env.ATRIUM_LOCALE?.trim() || "en-US";
  const timezoneId = process.env.ATRIUM_TIMEZONE?.trim() || "America/Los_Angeles";
  const colorScheme =
    process.env.ATRIUM_COLOR_SCHEME === "dark"
      ? "dark"
      : process.env.ATRIUM_COLOR_SCHEME === "no-preference"
        ? "no-preference"
        : "light";

  return {
    viewport,
    userAgent,
    locale,
    timezoneId,
    colorScheme,
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    reducedMotion: "no-preference",
    forcedColors: "none",
    extraHTTPHeaders: {
      "Accept-Language": `${locale},en;q=0.9`,
    },
  };
}

/** Shared Chromium launch flags (window size aligns with first context viewport). */
export function stealthLaunchOptions(
  headless: boolean,
  viewport: { width: number; height: number },
): LaunchOptions {
  const channel = process.env.ATRIUM_CHROMIUM_CHANNEL?.trim();
  const base: LaunchOptions = {
    headless,
    args: [
      `--window-size=${viewport.width},${viewport.height}`,
      "--window-position=24,24",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--no-first-run",
      "--no-default-browser-check",
      /**
       * Disable cross-device passkey UI features so sites that probe for them
       * fall back to password / OTP without ever showing native dialogs the
       * remote viewer can't see. Belt-and-suspenders to the per-page init script.
       */
      "--disable-features=WebAuthenticationCableLinking,WebAuthenticationConditionalUI,WebAuthenticationCableServer,DigitalAssetLinks",
    ],
  };
  if (
    channel === "chrome" ||
    channel === "chrome-beta" ||
    channel === "chrome-dev" ||
    channel === "msedge"
  ) {
    return { ...base, channel };
  }
  return base;
}
