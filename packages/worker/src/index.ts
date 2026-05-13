import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  CDPSession,
  Cookie,
  Page,
} from "playwright";
import { WebSocket, WebSocketServer } from "ws";
import {
  chromium,
  defaultViewportSize,
  desktopContextHints,
  stealthLaunchOptions,
} from "./stealth-chromium.js";
import type {
  ClientCertificate,
  ClientMessage,
  ControlHolder,
  ControlState,
} from "@atriumjs/protocol";
import { parseClientMessage } from "@atriumjs/protocol";

/** Decoded client cert ready to hand to Playwright `newContext({ clientCertificates })`. */
type ClientCertificateRuntime = {
  origin: string;
  cert?: Buffer;
  key?: Buffer;
  pfx?: Buffer;
  passphrase?: string;
};

function decodeClientCertificates(
  list: ClientCertificate[] | undefined,
): ClientCertificateRuntime[] | undefined {
  if (!list?.length) return undefined;
  return list.map((c) => {
    const out: ClientCertificateRuntime = { origin: c.origin };
    if (c.certBase64) out.cert = Buffer.from(c.certBase64, "base64");
    if (c.keyBase64) out.key = Buffer.from(c.keyBase64, "base64");
    if (c.pfxBase64) out.pfx = Buffer.from(c.pfxBase64, "base64");
    if (c.passphrase != null) out.passphrase = c.passphrase;
    return out;
  });
}

function applyClientCertificates(
  base: BrowserContextOptions,
  certs: ClientCertificateRuntime[] | undefined,
): BrowserContextOptions {
  if (!certs?.length) return base;
  return { ...base, clientCertificates: certs as never };
}

export type WorkerServerOptions = {
  port: number;
  sharedSecret: string;
  /** Skip Playwright launch; emit a hello and immediate bye for CI or smoke tests. */
  dryRun?: boolean;
  /** Heap bytes soft cap for the whole worker process before evicting oldest session. */
  memorySoftCapBytes?: number;
  /**
   * Chromium headless mode. Default **headed** (`false`). Set `ATRIUM_WORKER_HEADLESS=1` in the
   * process env or pass `true` here for headless (e.g. CI without Xvfb).
   */
  headless?: boolean;
  /**
   * Registers `POST /internal/session/:id/x-demo/compose-tweet` (X/Twitter demo automation).
   * Off by default; enable for the official demo (`ATRIUM_X_DEMO_COMPOSE=1`).
   */
  enableXDemoCompose?: boolean;
  /**
   * After every API→worker stream WebSocket has disconnected, destroy the Chromium session
   * following this idle delay (ms). `0` disables idle teardown (sessions only end on API DELETE
   * or worker shutdown). Default 30 minutes.
   */
  transportIdleMs?: number;
};

type Sink = { ws: WebSocket | null };

type ScreencastFramePayload = { data: string; sessionId: number };

type LiveSession = {
  sessionId: string;
  sink: Sink;
  browser: Browser;
  context: BrowserContext;
  /** Active tab (same as `tabIds.get(activeTabId)`). */
  page: Page;
  tabIds: Map<string, Page>;
  pageToTabId: WeakMap<Page, string>;
  activeTabId: string;
  cdp: CDPSession;
  control: ControlState;
  screencast: { quality: number; everyNthFrame: number };
  frameSeq: number;
  tabBroadcastTimer?: ReturnType<typeof setTimeout>;
  screencastFrameListener?: (payload: ScreencastFramePayload) => Promise<void>;
  /** Persisted across context rebuilds (e.g. `replaceLiveSessionStorage`). */
  clientCertificates?: ClientCertificateRuntime[];
};

const sessions = new Map<string, LiveSession>();

const idleDestroyTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearIdleDestroy(sessionId: string): void {
  const t = idleDestroyTimers.get(sessionId);
  if (t) clearTimeout(t);
  idleDestroyTimers.delete(sessionId);
}

function scheduleIdleDestroy(sessionId: string, options: WorkerServerOptions): void {
  clearIdleDestroy(sessionId);
  const ms = options.transportIdleMs ?? 30 * 60_000;
  if (ms <= 0) return;
  idleDestroyTimers.set(
    sessionId,
    setTimeout(() => {
      idleDestroyTimers.delete(sessionId);
      const live = sessions.get(sessionId);
      if (!live || live.sink.ws != null) return;
      void destroyLiveSession(sessionId);
    }, ms),
  );
}

function secureTokenEquals(got: string, expected: string): boolean {
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type PendingBootstrap = {
  storageState?: unknown;
  cookies?: unknown[];
  initialUrl?: string;
  viewport?: { width: number; height: number };
  clientCertificates?: ClientCertificate[];
};

const pendingBootstraps = new Map<string, PendingBootstrap>();

/** Control chosen via API before the viewer attaches; merged into the live session on connect. */
const pendingControl = new Map<string, ControlState>();

function parseBearer(auth: string | undefined): string | null {
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim() || null;
}

function sendJson(sink: Sink, obj: unknown): void {
  const w = sink.ws;
  if (w && w.readyState === WebSocket.OPEN) {
    w.send(JSON.stringify(obj));
  }
}

export function internalPath(sessionId: string): string {
  return `/internal/stream/${sessionId}`;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const ch of req) {
    chunks.push(ch as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseBootstrapPayload(raw: unknown): PendingBootstrap | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: PendingBootstrap = {};
  if ("storageState" in o && o.storageState != null && typeof o.storageState === "object") {
    out.storageState = o.storageState;
  }
  if (Array.isArray(o.cookies)) out.cookies = o.cookies as unknown[];
  if (typeof o.initialUrl === "string" && o.initialUrl.length > 0) out.initialUrl = o.initialUrl;
  const vp = o.viewport;
  if (vp && typeof vp === "object") {
    const w = (vp as { w?: unknown }).w;
    const h = (vp as { h?: unknown }).h;
    if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
      out.viewport = { width: Math.floor(w), height: Math.floor(h) };
    }
  }
  if (Array.isArray(o.clientCertificates)) {
    const valid: ClientCertificate[] = [];
    for (const item of o.clientCertificates) {
      if (!item || typeof item !== "object") continue;
      const c = item as Record<string, unknown>;
      const origin = typeof c.origin === "string" ? c.origin : null;
      if (!origin) continue;
      const certBase64 = typeof c.certBase64 === "string" ? c.certBase64 : undefined;
      const keyBase64 = typeof c.keyBase64 === "string" ? c.keyBase64 : undefined;
      const pfxBase64 = typeof c.pfxBase64 === "string" ? c.pfxBase64 : undefined;
      const passphrase = typeof c.passphrase === "string" ? c.passphrase : undefined;
      const hasPem = certBase64 != null && keyBase64 != null;
      const hasPfx = pfxBase64 != null;
      if (!hasPem && !hasPfx) continue;
      valid.push({ origin, certBase64, keyBase64, pfxBase64, passphrase });
    }
    if (valid.length > 0) out.clientCertificates = valid;
  }
  if (
    out.storageState === undefined &&
    (out.cookies?.length ?? 0) === 0 &&
    out.initialUrl === undefined &&
    out.viewport === undefined &&
    (out.clientCertificates?.length ?? 0) === 0
  ) {
    return null;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// X demo compose — typed errors + post-confirmation
// ──────────────────────────────────────────────────────────────────────────────

export class XComposeError extends Error {
  constructor(
    public readonly code:
      | "x_session_expired"
      | "x_challenge_required"
      | "x_rate_limited"
      | "x_post_failed"
      | "x_timeout",
    message: string,
  ) {
    super(message);
    this.name = "XComposeError";
  }
}

function isXLoginUrl(url: string): boolean {
  return /x\.com\/(i\/flow\/login|login)|twitter\.com\/login/.test(url);
}

function isXChallengeUrl(url: string): boolean {
  return (
    /x\.com\/(account\/access|i\/flow\/challenge|i\/access_challenge)/.test(url) ||
    url.includes("arkose") ||
    url.includes("challenge_type")
  );
}

/**
 * Races success signals (editor disappears / URL leaves /compose) against a
 * failure poller (challenge / login redirect / rate limit / timeout).
 * Throws a typed XComposeError on any failure path.
 */
async function waitForXPostConfirmation(
  page: Page,
  editorLocator: ReturnType<Page["locator"]>,
  timeoutMs: number,
): Promise<void> {
  const POLL_MS = 900;
  const deadline = Date.now() + timeoutMs;
  let settled = false;

  await new Promise<void>((resolve, reject) => {
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    // ── success: compose textarea disappears ──────────────────────
    editorLocator
      .first()
      .waitFor({ state: "hidden", timeout: timeoutMs })
      .then(() => finish(), () => { /* handled by poller timeout */ });

    // ── success: URL leaves /compose ─────────────────────────────
    page
      .waitForURL((u: URL) => !u.pathname.startsWith("/compose"), { timeout: timeoutMs })
      .then(() => finish(), () => { /* handled by poller timeout */ });

    // ── failure poller ────────────────────────────────────────────
    void (async () => {
      while (!settled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (settled) return;
        const url = page.url();
        if (isXLoginUrl(url)) {
          finish(
            new XComposeError("x_session_expired", `Redirected to login after posting (${url})`),
          );
          return;
        }
        if (isXChallengeUrl(url)) {
          finish(
            new XComposeError("x_challenge_required", `Challenge page after posting (${url})`),
          );
          return;
        }
      }
      if (!settled) {
        const url = page.url();
        const toast = await page
          .locator('[data-testid="toast"]')
          .first()
          .textContent({ timeout: 500 })
          .catch(() => "");
        if (/unable to send|whoa there|slow down/i.test(toast ?? "")) {
          finish(new XComposeError("x_rate_limited", `Rate limited: ${toast}`));
        } else {
          finish(
            new XComposeError(
              "x_timeout",
              `Post not confirmed within ${timeoutMs}ms. URL: ${url}`,
            ),
          );
        }
      }
    })();
  });

  // Final URL check after a success signal — catch a challenge redirect that
  // fired right as the editor closed.
  const finalUrl = page.url();
  if (isXLoginUrl(finalUrl)) {
    throw new XComposeError(
      "x_session_expired",
      `Session expired immediately after post (${finalUrl})`,
    );
  }
  if (isXChallengeUrl(finalUrl)) {
    throw new XComposeError(
      "x_challenge_required",
      `Challenge shown immediately after post (${finalUrl})`,
    );
  }
}

/**
 * X (Twitter) compose flow — best-effort selectors; the UI changes frequently.
 * Caller must ensure `live.control.holder === "agent"`.
 * Throws XComposeError with a typed `code` on every verifiable failure path.
 */
async function runXComposeTweet(live: LiveSession, text: string): Promise<void> {
  const page = live.page;

  // Navigate to compose
  await page.goto("https://x.com/compose/post", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  // Verify we landed on the compose page, not a login / challenge interstitial
  const postNavUrl = page.url();
  if (isXLoginUrl(postNavUrl)) {
    throw new XComposeError(
      "x_session_expired",
      `X session expired — redirected to login (${postNavUrl})`,
    );
  }
  if (isXChallengeUrl(postNavUrl)) {
    throw new XComposeError(
      "x_challenge_required",
      `X requires extra verification before composing (${postNavUrl})`,
    );
  }

  const editor = page
    .locator('[data-testid="tweetTextarea_0"]')
    .or(page.locator('div[role="textbox"][data-testid^="tweetTextarea"]'))
    .or(page.locator('div[role="textbox"][contenteditable="true"]').first());

  await editor.first().waitFor({ state: "visible", timeout: 30_000 });
  await editor.first().click({ timeout: 15_000 });
  await page.keyboard.type(text, { delay: 12 });
  await new Promise((r) => setTimeout(r, 400));

  // Wait for the tweet button to be enabled, then click
  const tweetBtn = page.locator('[data-testid="tweetButton"]:not([disabled])').first();
  await tweetBtn.waitFor({ state: "visible", timeout: 10_000 });
  await tweetBtn.click({ timeout: 15_000 });

  // Confirm the post actually went through — throws on failure / timeout
  await waitForXPostConfirmation(page, editor, 30_000);
}

function mouseButtonFromPayload(v: unknown): "left" | "right" | "middle" {
  const n = typeof v === "number" ? v : 0;
  if (n === 2) return "right";
  if (n === 1) return "middle";
  return "left";
}

const MAX_CLIPBOARD_CHARS = 200_000;

async function readPageSelectionText(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      const ae = document.activeElement;
      if (!ae) return window.getSelection()?.toString() ?? "";
      if (ae instanceof HTMLTextAreaElement || ae instanceof HTMLInputElement) {
        const s = ae.selectionStart ?? 0;
        const e = ae.selectionEnd ?? 0;
        if (e > s) return ae.value.slice(s, e);
        return "";
      }
      return window.getSelection()?.toString() ?? "";
    });
  } catch {
    return "";
  }
}

async function deletePageSelection(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const ae = document.activeElement;
      if (!ae) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) sel.deleteFromDocument();
        return;
      }
      if (ae instanceof HTMLTextAreaElement || ae instanceof HTMLInputElement) {
        const s = ae.selectionStart ?? 0;
        const e = ae.selectionEnd ?? 0;
        if (e > s) {
          const v = ae.value;
          ae.value = v.slice(0, s) + v.slice(e);
          ae.setSelectionRange(s, s);
          ae.dispatchEvent(new Event("input", { bubbles: true }));
          ae.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
      if (ae instanceof HTMLElement && ae.isContentEditable) {
        document.execCommand?.("delete");
      }
    });
  } catch (e) {
    console.warn("[atrium-worker] deletePageSelection evaluate failed", e);
  }
}

async function dispatchClientInput(live: LiveSession, msg: ClientMessage): Promise<void> {
  if (live.control.holder !== "human") return;
  const page = live.page;
  if (msg.t === "input" && msg.kind === "mouse") {
    const p = msg.payload;
    const type = String(p.type ?? "");
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const btn = mouseButtonFromPayload(p.button);
    if (type === "move") {
      await page.mouse.move(x, y);
      return;
    }
    await page.mouse.move(x, y);
    if (type === "down") await page.mouse.down({ button: btn });
    else if (type === "up") await page.mouse.up({ button: btn });
    return;
  }
  if (msg.t === "input" && msg.kind === "wheel") {
    const p = msg.payload;
    const deltaY = Number(p.deltaY ?? 0);
    const deltaX = Number(p.deltaX ?? 0);
    if (!Number.isFinite(deltaY) && !Number.isFinite(deltaX)) return;
    await page.mouse.wheel(deltaX || 0, deltaY || 0);
    return;
  }
  if (msg.t === "ime") {
    const text = typeof msg.text === "string" ? msg.text : "";
    if (!text) return;
    await page.keyboard.insertText(text);
    return;
  }
  if (msg.t === "input" && msg.kind === "clipboard") {
    const p = msg.payload as { action?: unknown; text?: unknown };
    const action = String(p.action ?? "");
    if (action === "paste") {
      const raw = typeof p.text === "string" ? p.text : "";
      const text = raw.slice(0, MAX_CLIPBOARD_CHARS);
      if (!text) return;
      await page.keyboard.insertText(text);
      return;
    }
    if (action === "copy") {
      const text = (await readPageSelectionText(page)).slice(0, MAX_CLIPBOARD_CHARS);
      if (text) sendJson(live.sink, { t: "clipboard", action: "copy", text });
      return;
    }
    if (action === "cut") {
      const text = (await readPageSelectionText(page)).slice(0, MAX_CLIPBOARD_CHARS);
      if (text) sendJson(live.sink, { t: "clipboard", action: "cut", text });
      await deletePageSelection(page);
      return;
    }
    return;
  }
  if (msg.t === "input" && msg.kind === "key") {
    const p = msg.payload;
    const phase = String(p.type ?? "down");
    const key = String(p.key ?? "");
    const code = String((p as { code?: unknown }).code ?? "");
    if (!key && !code) return;
    const modifierByCode: Record<string, string> = {
      MetaLeft: "Meta",
      MetaRight: "Meta",
      ControlLeft: "Control",
      ControlRight: "Control",
      ShiftLeft: "Shift",
      ShiftRight: "Shift",
      AltLeft: "Alt",
      AltRight: "Alt",
    };
    const spec = key || modifierByCode[code] || code;
    if (phase === "up") await page.keyboard.up(spec);
    else await page.keyboard.down(spec);
  }
}

async function stopScreencastPipeline(live: LiveSession): Promise<void> {
  await live.cdp.send("Page.stopScreencast").catch(() => undefined);
  if (live.screencastFrameListener) {
    live.cdp.off("Page.screencastFrame", live.screencastFrameListener);
    live.screencastFrameListener = undefined;
  }
}

async function startScreencastPipeline(live: LiveSession): Promise<void> {
  const sink = live.sink;
  const now = () => Date.now();

  const applyScreencast = async (): Promise<void> => {
    const vp = live.page.viewportSize() ?? { width: 1280, height: 800 };
    await live.cdp.send("Page.stopScreencast").catch(() => undefined);
    await live.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: live.screencast.quality,
      maxWidth: Math.min(vp.width, 1920),
      maxHeight: Math.min(vp.height, 1200),
      everyNthFrame: live.screencast.everyNthFrame,
    });
  };

  await applyScreencast();

  let lastTune = 0;
  const onFrame = async (payload: ScreencastFramePayload): Promise<void> => {
    const w = sink.ws;
    if (!w || w.readyState !== WebSocket.OPEN) {
      await live.cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId });
      return;
    }
    if (w.bufferedAmount > 4_000_000) {
      await live.cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId });
      const t = Date.now();
      if (t - lastTune > 1500) {
        lastTune = t;
        live.screencast.quality = Math.max(35, live.screencast.quality - 5);
        live.screencast.everyNthFrame = Math.min(4, live.screencast.everyNthFrame + 1);
        await applyScreencast();
      }
      return;
    }
    if (w.bufferedAmount < 400_000) {
      const t = Date.now();
      if (t - lastTune > 2000 && live.screencast.quality < 70) {
        lastTune = t;
        live.screencast.quality = Math.min(70, live.screencast.quality + 3);
        live.screencast.everyNthFrame = Math.max(1, live.screencast.everyNthFrame - 1);
        await applyScreencast();
      }
    }
    live.frameSeq += 1;
    sendJson(sink, {
      t: "frame",
      seq: live.frameSeq,
      ts: now(),
      mime: "image/jpeg",
    });
    w.send(Buffer.from(payload.data, "base64"));
    await live.cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId });
  };
  live.screencastFrameListener = onFrame;
  live.cdp.on("Page.screencastFrame", onFrame);
}

async function broadcastTabsState(live: LiveSession): Promise<void> {
  const tabs: { id: string; url: string; title: string; active: boolean }[] = [];
  for (const [id, tabPage] of live.tabIds) {
    const title = await tabPage.title().catch(() => "");
    tabs.push({
      id,
      url: tabPage.url(),
      title,
      active: id === live.activeTabId,
    });
  }
  sendJson(live.sink, { t: "tabs", tabs });
}

function scheduleTabsBroadcast(live: LiveSession): void {
  if (live.tabBroadcastTimer) clearTimeout(live.tabBroadcastTimer);
  live.tabBroadcastTimer = setTimeout(() => {
    live.tabBroadcastTimer = undefined;
    void broadcastTabsState(live);
  }, 80);
}

async function emitActiveNavigateTitle(live: LiveSession): Promise<void> {
  const pg = live.tabIds.get(live.activeTabId);
  if (!pg) return;
  sendJson(live.sink, { t: "navigate", url: pg.url() });
  const title = await pg.title().catch(() => "");
  sendJson(live.sink, { t: "title", title });
}

/**
 * Emit a `viewport` JSON message reflecting the active page's actual size so the viewer
 * scales pointer events correctly even when popups (e.g. OAuth windows) have a different
 * viewport from the original tab.
 */
function emitActiveViewport(live: LiveSession): void {
  const pg = live.tabIds.get(live.activeTabId);
  if (!pg) return;
  const vp = pg.viewportSize();
  if (!vp) return;
  sendJson(live.sink, { t: "viewport", w: vp.width, h: vp.height });
}

function wireTabPage(live: LiveSession, tabId: string, page: Page): void {
  page.on("framenavigated", () => {
    scheduleTabsBroadcast(live);
    if (live.activeTabId === tabId) {
      void emitActiveNavigateTitle(live);
    }
  });
  page.on("close", () => {
    void onTabPageClosed(live, tabId);
  });
}

async function onTabPageClosed(live: LiveSession, tabId: string): Promise<void> {
  live.tabIds.delete(tabId);
  if (live.activeTabId !== tabId) {
    scheduleTabsBroadcast(live);
    return;
  }
  const nextId = live.tabIds.keys().next().value as string | undefined;
  if (nextId) {
    await switchActiveTab(live, nextId);
  } else {
    await destroyLiveSession(live.sessionId);
  }
}

async function switchActiveTab(live: LiveSession, tabId: string): Promise<void> {
  const pg = live.tabIds.get(tabId);
  if (!pg) return;
  live.page = pg;
  live.activeTabId = tabId;
  await stopScreencastPipeline(live);
  await live.cdp.detach().catch(() => undefined);
  live.cdp = await live.context.newCDPSession(pg);
  await startScreencastPipeline(live);
  scheduleTabsBroadcast(live);
  emitActiveViewport(live);
  await emitActiveNavigateTitle(live);
}

async function onNewPageFromContext(live: LiveSession, newPage: Page): Promise<void> {
  const id = randomUUID();
  live.tabIds.set(id, newPage);
  live.pageToTabId.set(newPage, id);
  wireTabPage(live, id, newPage);
  await switchActiveTab(live, id);
}

function wireContextNewTabListener(live: LiveSession): void {
  live.context.on("page", (p) => {
    void onNewPageFromContext(live, p);
  });
}

/**
 * Init script injected into every page of a context. Goal: make WebAuthn appear
 * **unsupported** so well-behaved sites don't even offer "Sign in with passkey", and any
 * site that tries anyway fails fast (so the user sees password / OTP fallback immediately).
 *
 * - Pre-empt feature checks: `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable`
 *   and `isConditionalMediationAvailable` return `false`. Conditional UI mediation auto-rejects.
 * - Wrap `navigator.credentials.{get,create}` with `publicKey`: throw `NotAllowedError`
 *   immediately and notify the worker via the `__atriumWebAuthnRequest` binding (telemetry only;
 *   the call doesn't await any decision).
 */
const WEBAUTHN_INIT_SCRIPT = `
(() => {
  function notify(ceremony, options) {
    try {
      const pk = options && options.publicKey;
      const rpId = ceremony === "get" ? (pk && pk.rpId) : (pk && pk.rp && pk.rp.id);
      const fn = window.__atriumWebAuthnRequest;
      if (typeof fn !== "function") return;
      Promise.resolve(fn({
        ceremony,
        rpId: rpId || null,
        origin: location.origin,
      })).catch(function () {});
    } catch (_e) { /* noop */ }
  }
  try {
    if (window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = function () {
        return Promise.resolve(false);
      };
      PublicKeyCredential.isConditionalMediationAvailable = function () {
        return Promise.resolve(false);
      };
    }
  } catch (_e) { /* noop */ }
  if (!navigator || !navigator.credentials) return;
  const c = navigator.credentials;
  const origGet = typeof c.get === "function" ? c.get.bind(c) : null;
  const origCreate = typeof c.create === "function" ? c.create.bind(c) : null;
  if (origGet) {
    c.get = async function (options) {
      if (!options || !options.publicKey) return origGet(options);
      notify("get", options);
      throw new DOMException("Passkeys are not supported in this remote browser", "NotAllowedError");
    };
  }
  if (origCreate) {
    c.create = async function (options) {
      if (!options || !options.publicKey) return origCreate(options);
      notify("create", options);
      throw new DOMException("Passkeys are not supported in this remote browser", "NotAllowedError");
    };
  }
})();
`;

/**
 * Fire-and-forget telemetry: the page-side init script throws `NotAllowedError` immediately
 * regardless of the binding's resolution, so we just emit `webauthn_required` for the viewer
 * (used to show a brief toast) and return. No pending decision map needed.
 */
function notifyWebAuthnAttempt(live: LiveSession, payload: unknown): "dismiss" {
  const p = (payload ?? {}) as Record<string, unknown>;
  const ceremony = p.ceremony === "create" ? "create" : "get";
  const rpId = typeof p.rpId === "string" && p.rpId ? p.rpId : undefined;
  const origin = typeof p.origin === "string" && p.origin ? p.origin : undefined;
  const id = randomUUID();
  sendJson(live.sink, { t: "webauthn_required", id, ceremony, rpId, origin });
  return "dismiss";
}

async function wireWebAuthnGate(live: LiveSession): Promise<void> {
  await live.context
    .exposeBinding("__atriumWebAuthnRequest", (_source, payload: unknown) => {
      return notifyWebAuthnAttempt(live, payload);
    })
    .catch(() => undefined);
  await live.context.addInitScript({ content: WEBAUTHN_INIT_SCRIPT });
}

function registerFirstTab(live: LiveSession, page: Page, tabId: string): void {
  live.tabIds.set(tabId, page);
  live.pageToTabId.set(page, tabId);
  live.activeTabId = tabId;
  live.page = page;
  wireTabPage(live, tabId, page);
}

async function handleTabClientMessage(live: LiveSession, msg: ClientMessage): Promise<void> {
  if (msg.t === "tab_activate") {
    if (msg.tabId !== live.activeTabId) {
      await switchActiveTab(live, msg.tabId);
    }
    return;
  }
  if (msg.t === "tab_close") {
    if (live.tabIds.size <= 1) return;
    const pg = live.tabIds.get(msg.tabId);
    if (!pg) return;
    await pg.close().catch(() => undefined);
    return;
  }
  if (msg.t === "reload") {
    await live.page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    return;
  }
  if (msg.t === "back") {
    await live.page.goBack().catch(() => undefined);
    return;
  }
  if (msg.t === "forward") {
    await live.page.goForward().catch(() => undefined);
  }
}

async function handleInternalHttp(
  req: IncomingMessage,
  res: ServerResponse,
  options: WorkerServerOptions,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  /** Unauthenticated probes (e.g. `wait-on http-get://…` before the API dials in). */
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
    return false;
  }

  const token = parseBearer(req.headers.authorization);
  if (!token || !secureTokenEquals(token, options.sharedSecret)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return true;
  }
  const mNav = /^\/internal\/session\/([^/]+)\/navigate$/.exec(url.pathname);
  const mCook = /^\/internal\/session\/([^/]+)\/cookies$/.exec(url.pathname);
  const mStore = /^\/internal\/session\/([^/]+)\/storage-state$/.exec(url.pathname);
  const mBoot = /^\/internal\/session\/([^/]+)\/bootstrap$/.exec(url.pathname);
  const mApply = /^\/internal\/session\/([^/]+)\/apply-session$/.exec(url.pathname);
  const mPend = /^\/internal\/session\/([^/]+)\/pending-bootstrap$/.exec(url.pathname);
  const mCtrl = /^\/internal\/session\/([^/]+)\/control$/.exec(url.pathname);
  const mXt = /^\/internal\/session\/([^/]+)\/x-demo\/compose-tweet$/.exec(url.pathname);

  if (req.method === "DELETE" && mPend) {
    const sessionId = decodeURIComponent(mPend[1]);
    pendingBootstraps.delete(sessionId);
    pendingControl.delete(sessionId);
    await destroyLiveSession(sessionId);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === "POST" && mCtrl) {
    const sessionId = decodeURIComponent(mCtrl[1]);
    const body = (await readJsonBody(req)) as { holder?: string };
    const h = body.holder;
    if (h !== "human" && h !== "agent" && h !== "idle") {
      writeJson(res, 400, { error: "invalid_holder" });
      return true;
    }
    const holder = h as ControlHolder;
    const nowMs = Date.now();
    const state: ControlState = { holder, since: nowMs };
    const live = sessions.get(sessionId);
    if (live) {
      live.control = state;
      sendJson(live.sink, { t: "control", holder: state.holder, reason: "api" });
    } else {
      pendingControl.set(sessionId, state);
    }
    res.writeHead(204);
    res.end();
    return true;
  }

  if (options.enableXDemoCompose === true && req.method === "POST" && mXt) {
    const sessionId = decodeURIComponent(mXt[1]);
    if (options.dryRun) {
      writeJson(res, 501, { error: "dry_run" });
      return true;
    }
    const live = sessions.get(sessionId);
    if (!live) {
      writeJson(res, 404, { error: "session_not_active" });
      return true;
    }
    if (live.control.holder !== "agent") {
      writeJson(res, 409, { error: "control_must_be_agent" });
      return true;
    }
    const body = (await readJsonBody(req)) as { text?: string };
    if (typeof body.text !== "string" || !body.text.trim()) {
      writeJson(res, 400, { error: "missing_text" });
      return true;
    }
    const trimmed = body.text.trim().slice(0, 280);
    try {
      await runXComposeTweet(live, trimmed);
    } catch (e) {
      if (e instanceof XComposeError) {
        const status =
          e.code === "x_session_expired" || e.code === "x_challenge_required" ? 409 : 500;
        writeJson(res, status, { error: e.code, message: e.message });
      } else {
        writeJson(res, 500, {
          error: "x_compose_failed",
          message: e instanceof Error ? e.message : "unknown",
        });
      }
      return true;
    }
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === "POST" && mBoot) {
    const sessionId = decodeURIComponent(mBoot[1]);
    if (options.dryRun) {
      res.writeHead(204);
      res.end();
      return true;
    }
    if (sessions.has(sessionId)) {
      writeJson(res, 409, { error: "session_already_live" });
      return true;
    }
    const body = await readJsonBody(req);
    const pending = parseBootstrapPayload(body);
    if (!pending) {
      writeJson(res, 400, { error: "empty_bootstrap" });
      return true;
    }
    pendingBootstraps.set(sessionId, pending);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === "POST" && mApply) {
    const sessionId = decodeURIComponent(mApply[1]);
    if (options.dryRun) {
      writeJson(res, 501, { error: "dry_run" });
      return true;
    }
    const live = sessions.get(sessionId);
    if (!live) {
      writeJson(res, 404, { error: "session_not_active" });
      return true;
    }
    const body = (await readJsonBody(req)) as { storageState?: unknown; cookies?: unknown[] };
    const hasState =
      body.storageState !== undefined &&
      body.storageState !== null &&
      typeof body.storageState === "object";
    const hasCookies = Array.isArray(body.cookies) && body.cookies.length > 0;
    if (!hasState && !hasCookies) {
      writeJson(res, 400, { error: "missing_storageState_or_cookies" });
      return true;
    }
    try {
      await replaceLiveSessionStorage(live, {
        storageState: hasState ? body.storageState : undefined,
        cookies: hasCookies ? body.cookies : undefined,
      });
    } catch (e) {
      writeJson(res, 400, {
        error: "apply_failed",
        message: e instanceof Error ? e.message : "unknown",
      });
      return true;
    }
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === "POST" && mNav) {
    const sessionId = decodeURIComponent(mNav[1]);
    const body = (await readJsonBody(req)) as { url?: string };
    if (!body.url) {
      writeJson(res, 400, { error: "missing_url" });
      return true;
    }
    const live = sessions.get(sessionId);
    if (!live) {
      writeJson(res, 404, { error: "session_not_active" });
      return true;
    }
    await live.page.goto(body.url, { waitUntil: "domcontentloaded" });
    res.writeHead(204);
    res.end();
    return true;
  }
  if (req.method === "GET" && mCook) {
    const sessionId = decodeURIComponent(mCook[1]);
    const live = sessions.get(sessionId);
    if (!live) {
      writeJson(res, 404, { error: "session_not_active" });
      return true;
    }
    const cookies = await live.context.cookies();
    writeJson(res, 200, cookies);
    return true;
  }
  if (req.method === "GET" && mStore) {
    const sessionId = decodeURIComponent(mStore[1]);
    const live = sessions.get(sessionId);
    if (!live) {
      writeJson(res, 404, { error: "session_not_active" });
      return true;
    }
    const state = await live.context.storageState();
    writeJson(res, 200, state);
    return true;
  }
  return false;
}

async function destroyLiveSession(sessionId: string): Promise<void> {
  clearIdleDestroy(sessionId);
  const live = sessions.get(sessionId);
  if (!live) return;
  sessions.delete(sessionId);
  pendingBootstraps.delete(sessionId);
  pendingControl.delete(sessionId);
  if (live.tabBroadcastTimer) clearTimeout(live.tabBroadcastTimer);
  try {
    await live.context.close();
  } catch (e) {
    console.warn("[atrium-worker] context.close during destroy", e);
  }
  try {
    await live.browser.close();
  } catch (e) {
    console.warn("[atrium-worker] browser.close during destroy", e);
  }
}

async function replaceLiveSessionStorage(
  live: LiveSession,
  payload: { storageState?: unknown; cookies?: unknown[] },
): Promise<void> {
  await stopScreencastPipeline(live);
  if (live.tabBroadcastTimer) clearTimeout(live.tabBroadcastTimer);
  live.tabBroadcastTimer = undefined;

  const size = live.page.viewportSize() ?? { width: 1280, height: 800 };

  await live.context.close().catch(() => undefined);

  const hints = applyClientCertificates(desktopContextHints(size), live.clientCertificates);
  let context: BrowserContext;
  if (payload.storageState != null && typeof payload.storageState === "object") {
    context = await live.browser.newContext({
      ...hints,
      storageState: payload.storageState as never,
    });
  } else {
    context = await live.browser.newContext({ ...hints });
    if (payload.cookies?.length) {
      await context.addCookies(payload.cookies as Cookie[]);
    }
  }

  const page = await context.newPage();
  await page.goto("about:blank", { waitUntil: "domcontentloaded" });
  const cdp = await context.newCDPSession(page);

  const firstId = randomUUID();
  live.context = context;
  live.tabIds = new Map();
  live.pageToTabId = new WeakMap();
  registerFirstTab(live, page, firstId);
  live.cdp = cdp;
  live.frameSeq = 0;
  live.screencast = { quality: 70, everyNthFrame: 1 };
  wireContextNewTabListener(live);
  await wireWebAuthnGate(live);

  await startScreencastPipeline(live);
  void broadcastTabsState(live);
}

function evictOldestIfMemoryPressure(options: WorkerServerOptions): void {
  const cap = options.memorySoftCapBytes ?? 0;
  if (!cap) return;
  if (process.memoryUsage().heapUsed < cap) return;
  const first = sessions.keys().next().value as string | undefined;
  if (first) void destroyLiveSession(first);
}

export async function startWorkerServer(options: WorkerServerOptions): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer(async (req, res) => {
    if (await handleInternalHttp(req, res, options)) return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "atrium-worker" }));
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "internal" || parts[1] !== "stream" || !parts[2]) {
      socket.destroy();
      return;
    }
    const token = parseBearer(req.headers.authorization);
    if (!token || !secureTokenEquals(token, options.sharedSecret)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const sessionId = parts[2];
    wss.handleUpgrade(req, socket, head, (ws) => {
      void attachSessionPipeline(ws, sessionId, options);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    /** `0.0.0.0` ensures IPv4 (e.g. `127.0.0.1` from wait-on / dial clients) works when the host would otherwise bind IPv6-only (`::`). */
    server.listen(options.port, "0.0.0.0", () => resolve());
  });

  const addr = server.address();
  const port =
    typeof addr === "object" && addr !== null && "port" in addr
      ? (addr as { port: number }).port
      : options.port;

  let memoryTimer: ReturnType<typeof setInterval> | undefined;
  if ((options.memorySoftCapBytes ?? 0) > 0) {
    memoryTimer = setInterval(() => evictOldestIfMemoryPressure(options), 5000);
  }

  return {
    port,
    close: async () => {
      if (memoryTimer) clearInterval(memoryTimer);
      for (const id of [...idleDestroyTimers.keys()]) {
        clearIdleDestroy(id);
      }
      pendingBootstraps.clear();
      pendingControl.clear();
      for (const id of [...sessions.keys()]) {
        await destroyLiveSession(id);
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

function wireDialSocket(
  live: LiveSession,
  ws: WebSocket,
  sessionId: string,
  options: WorkerServerOptions,
): void {
  clearIdleDestroy(sessionId);
  const sink = live.sink;
  const prev = sink.ws;
  if (prev && prev !== ws) {
    try {
      prev.removeAllListeners();
      if (prev.readyState === WebSocket.OPEN) prev.close();
    } catch (e) {
      console.warn("[atrium-worker] close previous dial socket", e);
    }
  }
  sink.ws = ws;

  ws.on("message", async (raw) => {
    const liveNow = sessions.get(sessionId);
    if (!liveNow) return;
    const data = raw.toString();
    try {
      const msg = parseClientMessage(JSON.parse(data));
      if (msg.t === "ping") {
        sendJson(liveNow.sink, { t: "pong" });
        return;
      }
      if (
        msg.t === "tab_activate" ||
        msg.t === "tab_close" ||
        msg.t === "reload" ||
        msg.t === "back" ||
        msg.t === "forward"
      ) {
        await handleTabClientMessage(liveNow, msg);
        return;
      }
      if (msg.t === "navigate") {
        await liveNow.page.goto(msg.url, { waitUntil: "domcontentloaded" }).catch((err) => {
          console.warn("[atrium-worker] WS navigate failed", err);
        });
        return;
      }
      if (msg.t === "request_control" || msg.t === "release_control") {
        // Viewer-initiated control change. Authoritative source-of-truth lives in the
        // host app's session store via POST /sessions/:id/control; this WS path mirrors
        // the new holder locally and broadcasts so the active viewer sees the change
        // immediately. Hosts that need cross-node consistency should still call the HTTP
        // endpoint for any state that other API nodes need to read.
        const next: ControlHolder = msg.t === "request_control" ? "human" : "agent";
        liveNow.control = { holder: next, since: Date.now() };
        sendJson(liveNow.sink, { t: "control", holder: next });
        return;
      }
      if (msg.t === "webauthn_decision") {
        return;
      }
      await dispatchClientInput(liveNow, msg);
    } catch (e) {
      console.warn("[atrium-worker] dial message parse/handle error", e);
    }
  });

  ws.on("close", () => {
    if (sink.ws === ws) {
      sink.ws = null;
      scheduleIdleDestroy(sessionId, options);
    }
  });
}

async function attachDryPipeline(ws: WebSocket, sessionId: string): Promise<void> {
  const now = () => Date.now();
  const control: ControlState = { holder: "agent", since: now() };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        t: "hello",
        sessionId,
        control,
        viewport: { w: 1280, h: 800 },
      }),
    );
    ws.send(JSON.stringify({ t: "bye", reason: "destroyed" }));
  }
  ws.close();
}

async function attachSessionPipeline(
  ws: WebSocket,
  sessionId: string,
  options: WorkerServerOptions,
): Promise<void> {
  if (options.dryRun) {
    await attachDryPipeline(ws, sessionId);
    return;
  }

  const existing = sessions.get(sessionId);
  if (existing) {
    wireDialSocket(existing, ws, sessionId, options);
    const vp = existing.page.viewportSize() ?? { width: 1280, height: 800 };
    sendJson(existing.sink, {
      t: "hello",
      sessionId,
      control: existing.control,
      viewport: { w: vp.width, h: vp.height },
    });
    void broadcastTabsState(existing);
    return;
  }

  const sink: Sink = { ws };
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let cdp: CDPSession | undefined;
  const screencast = { quality: 70, everyNthFrame: 1 };

  try {
    const pending = pendingBootstraps.get(sessionId);
    pendingBootstraps.delete(sessionId);

    const nowMs = Date.now();
    const fromPc = pendingControl.get(sessionId);
    const initialControl: ControlState = fromPc ?? { holder: "agent", since: nowMs };
    if (fromPc) pendingControl.delete(sessionId);

    const viewport = pending?.viewport ?? defaultViewportSize();
    const headless = options.headless ?? process.env.ATRIUM_WORKER_HEADLESS === "1";
    browser = await chromium.launch(stealthLaunchOptions(headless, viewport));

    const decodedCerts = decodeClientCertificates(pending?.clientCertificates);
    const hints = applyClientCertificates(desktopContextHints(viewport), decodedCerts);

    if (pending?.storageState != null && typeof pending.storageState === "object") {
      context = await browser.newContext({
        ...hints,
        storageState: pending.storageState as never,
      });
    } else {
      context = await browser.newContext({ ...hints });
      if (pending?.cookies?.length) {
        await context.addCookies(pending.cookies as Cookie[]);
      }
    }

    page = await context.newPage();
    const startUrl = pending?.initialUrl ?? "https://example.com/";
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });

    cdp = await page.context().newCDPSession(page);

    const firstTabId = randomUUID();
    const live: LiveSession = {
      sessionId,
      sink,
      browser,
      context,
      page,
      tabIds: new Map(),
      pageToTabId: new WeakMap(),
      activeTabId: firstTabId,
      cdp,
      control: initialControl,
      screencast,
      frameSeq: 0,
      clientCertificates: decodedCerts,
    };
    sessions.set(sessionId, live);
    registerFirstTab(live, page, firstTabId);
    wireContextNewTabListener(live);
    await wireWebAuthnGate(live);

    await startScreencastPipeline(live);

    const vp = live.page.viewportSize() ?? { width: 1280, height: 800 };
    sendJson(sink, {
      t: "hello",
      sessionId,
      control: live.control,
      viewport: { w: vp.width, h: vp.height },
    });
    void broadcastTabsState(live);

    wireDialSocket(live, ws, sessionId, options);
  } catch (err) {
    pendingBootstraps.delete(sessionId);
    if (sessions.has(sessionId)) {
      await destroyLiveSession(sessionId);
    } else if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn("[atrium-worker] browser.close after start failure", e);
      }
    }
    sendJson(sink, {
      t: "error",
      code: "worker_start_failed",
      message: err instanceof Error ? err.message : "unknown_error",
    });
    sendJson(sink, { t: "bye", reason: "error" });
    ws.close();
  }
}
