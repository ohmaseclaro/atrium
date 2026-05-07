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
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function parseServerMessage(data: unknown): ServerMessage {
  return serverMessageSchema.parse(data);
}

export function parseClientMessage(data: unknown): ClientMessage {
  return clientMessageSchema.parse(data);
}
