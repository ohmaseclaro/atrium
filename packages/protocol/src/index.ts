import { z } from "zod";

export const controlHolderSchema = z.enum(["agent", "human", "idle"]);
export type ControlHolder = z.infer<typeof controlHolderSchema>;

export const controlStateSchema = z.object({
  holder: controlHolderSchema,
  since: z.number(),
});
export type ControlState = z.infer<typeof controlStateSchema>;

export const sessionStatusSchema = z.enum([
  "pending",
  "worker_assigned",
  "ready",
  "active",
  "terminated",
  "failed",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/** Server → client JSON messages (frame payloads use a separate binary WebSocket frame). */
export const serverMessageSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("hello"),
    sessionId: z.string(),
    control: controlStateSchema,
    viewport: z.object({ w: z.number(), h: z.number() }),
  }),
  z.object({
    t: z.literal("frame"),
    seq: z.number(),
    ts: z.number(),
    mime: z.literal("image/jpeg"),
  }),
  z.object({
    t: z.literal("control"),
    holder: controlHolderSchema,
    reason: z.string().optional(),
  }),
  z.object({ t: z.literal("navigate"), url: z.string() }),
  z.object({ t: z.literal("title"), title: z.string() }),
  z.object({ t: z.literal("favicon"), href: z.string().nullable() }),
  z.object({ t: z.literal("cursor"), cursor: z.string() }),
  z.object({
    t: z.literal("loading"),
    loading: z.boolean(),
    progress: z.number().optional(),
  }),
  z.object({ t: z.literal("viewport"), w: z.number(), h: z.number() }),
  z.object({
    t: z.literal("tabs"),
    tabs: z.array(
      z.object({
        id: z.string(),
        url: z.string(),
        title: z.string(),
        active: z.boolean(),
      }),
    ),
  }),
  z.object({
    t: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    t: z.literal("bye"),
    reason: z.enum(["destroyed", "idle", "evicted", "error"]),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const clientMessageSchema = z.union([
  z.object({
    t: z.literal("input"),
    kind: z.enum(["mouse", "key", "wheel"]),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.object({
    t: z.literal("ime"),
    text: z.string(),
    isComposing: z.boolean(),
  }),
  z.object({ t: z.literal("resize"), w: z.number(), h: z.number() }),
  z.object({ t: z.literal("navigate"), url: z.string() }),
  z.object({ t: z.literal("back") }),
  z.object({ t: z.literal("forward") }),
  z.object({ t: z.literal("reload") }),
  z.object({ t: z.literal("request_control") }),
  z.object({ t: z.literal("release_control") }),
  z.object({ t: z.literal("ping") }),
  z.object({ t: z.literal("tab_activate"), tabId: z.string() }),
  z.object({ t: z.literal("tab_close"), tabId: z.string() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function parseServerMessage(data: unknown): ServerMessage {
  return serverMessageSchema.parse(data);
}

export function parseClientMessage(data: unknown): ClientMessage {
  return clientMessageSchema.parse(data);
}

/**
 * One TLS client certificate / private key pair, scoped to an `origin` (e.g. `https://api.example.com`).
 * Forwarded to Playwright's `BrowserContextOptions.clientCertificates` on the worker.
 *
 * Provide either a **PEM** pair (`certBase64` + `keyBase64`) or a **PFX/PKCS#12** bundle (`pfxBase64` + `passphrase`).
 * All bytes are base64-encoded so they can travel over JSON without binary handling.
 */
export const clientCertificateSchema = z
  .object({
    origin: z.string().url(),
    certBase64: z.string().min(1).optional(),
    keyBase64: z.string().min(1).optional(),
    pfxBase64: z.string().min(1).optional(),
    passphrase: z.string().optional(),
  })
  .strict()
  .refine((v) => (v.certBase64 != null && v.keyBase64 != null) || v.pfxBase64 != null, {
    message: "provide_pem_pair_or_pfx",
  });
export type ClientCertificate = z.infer<typeof clientCertificateSchema>;

/**
 * Optional body for `POST /sessions` — applied on the worker before the first viewer WebSocket connects.
 * Shape matches Playwright `BrowserContextOptions.storageState` plus optional extra cookies, start URL,
 * and `clientCertificates` (so mTLS prompts use the user's certificate, not a cert installed on the worker host).
 */
export const sessionBootstrapBodySchema = z
  .object({
    storageState: z.unknown().optional(),
    cookies: z.array(z.record(z.unknown())).optional(),
    initialUrl: z.string().min(1).optional(),
    viewport: z
      .object({
        w: z.number().int().positive(),
        h: z.number().int().positive(),
      })
      .optional(),
    clientCertificates: z.array(clientCertificateSchema).optional(),
  })
  .strict();
export type SessionBootstrapBody = z.infer<typeof sessionBootstrapBodySchema>;

/**
 * Combined export from the browser (cookies + Playwright `storageState`) or apply payload for an existing session.
 */
export const sessionSnapshotApplyBodySchema = z
  .object({
    storageState: z.unknown().optional(),
    cookies: z.array(z.record(z.unknown())).optional(),
  })
  .strict()
  .refine(
    (b) =>
      (b.cookies?.length ?? 0) > 0 ||
      (b.storageState != null && typeof b.storageState === "object"),
    { message: "provide_storageState_or_cookies" },
  );
export type SessionSnapshotApplyBody = z.infer<typeof sessionSnapshotApplyBodySchema>;
