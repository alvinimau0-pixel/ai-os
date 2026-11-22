// Adapter for the OpenCode agent server (v2 HTTP API). The brain is a full
// opencode agent: it keeps its own conversation per JARVIS session and can run
// shell commands, edit files and use its own tools.
//
// Contract (probed against opencode 2.0.18):
//   - HTTP Basic auth, username "opencode", password from OPENCODE_PASSWORD.
//     Credentials live in ./auth; this module never reads the password.
//   - POST /api/session            {title?}          -> {data:{id}}
//   - POST /api/session/{sid}/prompt {text}          -> queues; the agent loop
//     runs asynchronously and its output arrives on the event stream.
//   - GET  /api/event              SSE               -> `data: {type, data:{sessionID, ...}}`
//     Key events: session.text.delta {delta}, session.tool.input.started {id,name},
//     session.tool.success {id}, session.execution.succeeded, session.execution.*.
//   - POST /api/session/{sid}/interrupt              -> abort the agent loop.

import type { BrainStatus } from "@/lib/types";
import { env, getOpenCodeConfig as getOpenCodeAuthConfig, openCodeAuthHeader, redactSecret } from "./auth";
import { getOpenCodeSessionId, setOpenCodeSessionId } from "./data";
import http from "node:http";

/** Password-free: carries only where the agent lives. */
export interface OpenCodeConfig {
  baseUrl: string;
}

export interface OpenCodeRun {
  sessionID: string;
  config: OpenCodeConfig;
}

export type OpenCodeEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; status: "running" | "done"; summary?: string }
  | { type: "error"; message: string };

const PROBE_TTL_MS = 15000;

/** The auth header for a request, or no header at all when there is no password. */
function authHeaders(): Record<string, string> {
  return openCodeAuthHeader() ?? {};
}

// ---------------------------------------------------------------------------
// Config + reachability probe (cached)
// ---------------------------------------------------------------------------

let probeCache: { ok: boolean; at: number } = { ok: false, at: 0 };

export function getOpenCodeModel(): string {
  return env("OPENCODE_MODEL") ?? "default agent";
}

/** Static, password-free config. No network. */
export function getOpenCodeConfig(): OpenCodeConfig {
  return { baseUrl: getOpenCodeAuthConfig().url };
}

/**
 * Is the agent reachable? `GET {url}/api/session` with a 2500 ms timeout; the
 * result (success or failure) is cached for 15 s.
 */
export async function probeOpenCode(fetchImpl: typeof fetch = globalThis.fetch): Promise<boolean> {
  if (Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.ok;
  const { baseUrl } = getOpenCodeConfig();
  let ok = false;
  try {
    const res = await fetchImpl(`${baseUrl}/api/session`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(2500),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  probeCache = { ok, at: Date.now() };
  return ok;
}

/** Test hook: forget the cached probe result. */
export function resetOpenCodeProbe(): void {
  probeCache = { ok: false, at: 0 };
}

export async function getOpenCodeStatus(): Promise<BrainStatus | null> {
  if (!(await probeOpenCode())) return null;
  return { cloudAvailable: true, provider: "OpenCode", model: getOpenCodeModel(), skillCount: 0 };
}

// ---------------------------------------------------------------------------
// Shared event stream: one SSE connection per process, subscribers keyed by
// session id, automatic reconnect while there is at least one subscriber.
// ---------------------------------------------------------------------------

interface OcEvent {
  type: string;
  data?: { sessionID?: unknown; [k: string]: unknown };
}

class OpenCodeEventBus {
  private listeners = new Map<string, Set<(ev: OcEvent) => void>>();
  private connection: AbortController | null = null;
  private backoff = 1000;

  subscribe(sessionID: string, fn: (ev: OcEvent) => void): () => void {
    let set = this.listeners.get(sessionID);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionID, set);
    }
    set.add(fn);
    this.ensure();
    return () => {
      const s = this.listeners.get(sessionID);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) this.listeners.delete(sessionID);
      if (this.listeners.size === 0) {
        this.connection?.abort();
        this.connection = null;
      }
    };
  }

  private ensure(): void {
    if (this.connection) return;
    const ac = new AbortController();
    this.connection = ac;
    void this.loop(ac);
  }

  private async loop(ac: AbortController): Promise<void> {
    while (!ac.signal.aborted && this.listeners.size > 0) {
      const reachable = await probeOpenCode();
      if (ac.signal.aborted || this.listeners.size === 0) {
        if (this.connection === ac) this.connection = null;
        return;
      }
      if (!reachable) {
        await new Promise((r) => setTimeout(r, this.backoff));
        this.backoff = Math.min(this.backoff * 2, 10000);
        continue;
      }
      const url = new URL(`${getOpenCodeConfig().baseUrl}/api/event`);
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname + url.search,
          method: "GET",
          headers: authHeaders(),
        },
        (res) => {
          if (res.statusCode !== 200) {
            console.error(`[opencode-bus] event stream ${res.statusCode}`);
            if (this.connection === ac) this.connection = null;
            return;
          }
          this.backoff = 1000;
          console.log("[opencode-bus] event stream connected");
          let buf = "";
          res.on("data", (chunk) => {
            if (ac.signal.aborted) return;
            buf += chunk.toString();
            let nl = buf.indexOf("\n");
            while (nl !== -1) {
              const line = buf.slice(0, nl).trimEnd();
              buf = buf.slice(nl + 1);
              nl = buf.indexOf("\n");
              if (!line.startsWith("data:")) continue;
              try {
                this.dispatch(JSON.parse(line.slice(5).trim()) as OcEvent);
              } catch {
                /* malformed frame — skip */
              }
            }
          });
          res.on("end", () => {
            if (ac.signal.aborted || this.listeners.size === 0) {
              if (this.connection === ac) this.connection = null;
              return;
            }
            this.backoff = Math.min(this.backoff * 2, 10000);
            setTimeout(() => this.loop(ac), this.backoff);
          });
        },
      );
      req.on("error", (err) => {
        if (ac.signal.aborted) return;
        console.error("[opencode-bus] stream error:", err.message);
        if (this.listeners.size > 0) {
          this.backoff = Math.min(this.backoff * 2, 10000);
          setTimeout(() => this.loop(ac), this.backoff);
        } else if (this.connection === ac) {
          this.connection = null;
        }
      });
      ac.signal.addEventListener("abort", () => req.destroy());
      req.end();
      return; // callbacks handle continuation/reconnect
    }
    if (this.connection === ac) this.connection = null;
  }

  private dispatch(ev: OcEvent): void {
    const sid = typeof ev.data?.sessionID === "string" ? ev.data.sessionID : null;
    if (!sid) return;
    const set = this.listeners.get(sid);
    if (!set) return;
    for (const fn of set) fn(ev);
  }
}

const bus = new OpenCodeEventBus();

// ---------------------------------------------------------------------------
// Session mapping: one opencode session per JARVIS conversation.
// ---------------------------------------------------------------------------

export async function ensureOpenCodeSession(conversationId: number): Promise<OpenCodeRun | null> {
  if (!(await probeOpenCode())) return null;
  const cfg = getOpenCodeConfig();
  let sessionID = await getOpenCodeSessionId(conversationId);
  if (sessionID) return { sessionID, config: cfg };
  const res = await fetch(`${cfg.baseUrl}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`opencode session create failed (${res.status})`);
  const j = (await res.json().catch(() => null)) as { data?: { id?: string } } | null;
  sessionID = j?.data?.id ?? null;
  if (!sessionID) throw new Error("opencode session create returned no id");
  await setOpenCodeSessionId(conversationId, sessionID);
  return { sessionID, config: cfg };
}

// ---------------------------------------------------------------------------
// Agent run: send one prompt, stream the response.
// ---------------------------------------------------------------------------

export interface OpenCodeAgentOptions {
  run: OpenCodeRun;
  text: string;
  signal?: AbortSignal;
  /** Give up if nothing arrives for this long. */
  idleMs?: number;
  /** Hard ceiling for the whole run. Agents can be slow on loaded machines. */
  totalMs?: number;
}

class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(v: T): void {
    const r = this.resolvers.shift();
    if (r) r({ value: v, done: false });
    else this.items.push(v);
  }

  close(): void {
    this.closed = true;
    for (const r of this.resolvers.splice(0)) r({ value: undefined as never, done: true });
  }

  next(): Promise<IteratorResult<T>> {
    const v = this.items.shift();
    if (v !== undefined) return Promise.resolve({ value: v, done: false });
    if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((r) => this.resolvers.push(r));
  }
}

function looksLikeFailure(type: string): boolean {
  return /failed|errored|error|aborted|stopped|cancelled|canceled|denied/.test(type);
}

export async function* runOpenCodeAgent(opts: OpenCodeAgentOptions): AsyncGenerator<OpenCodeEvent, void> {
  const { run, signal } = opts;
  const q = new AsyncQueue<OpenCodeEvent | "end">();
  const tools = new Map<string, string>(); // tool call id -> name
  const base = run.config.baseUrl;

  const off = bus.subscribe(run.sessionID, (ev) => {
    const d = ev.data ?? {};
    switch (ev.type) {
      case "session.text.delta": {
        const delta = typeof d.delta === "string" ? d.delta : "";
        if (delta) q.push({ type: "delta", text: delta });
        break;
      }
      case "session.tool.input.started": {
        const name = typeof d.name === "string" ? d.name : "tool";
        const id = typeof d.id === "string" ? d.id : "";
        if (id) tools.set(id, name);
        q.push({ type: "tool", name, status: "running" });
        break;
      }
      case "session.tool.success":
      case "session.tool.error":
      case "session.tool.failure": {
        const id = typeof d.id === "string" ? d.id : "";
        const name = (id && tools.get(id)) ?? (typeof d.name === "string" ? d.name : "tool");
        q.push({ type: "tool", name, status: "done" });
        break;
      }
      default: {
        if (ev.type === "session.execution.succeeded") q.push("end");
        else if (ev.type.startsWith("session.execution.") && looksLikeFailure(ev.type)) {
          q.push({ type: "error", message: `agent run ${ev.type.replace("session.execution.", "")}` });
          q.push("end");
        }
      }
    }
  });

  const onAbort = () => q.push("end");
  signal?.addEventListener("abort", onAbort, { once: true });

  const idleMs = opts.idleMs ?? 90000;
  const totalMs = opts.totalMs ?? 240000;
  const totalTimer = setTimeout(() => q.push({ type: "error", message: "the agent took too long" }), totalMs);

  // Idle watchdog: if no events arrive for `idleMs`, declare the run stalled.
  let lastTick = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastTick > idleMs) q.push({ type: "error", message: "the agent went quiet" });
  }, 5000);

  let interrupted = false;
  /** Stop the remote agent loop and close the queue. Callers yield their own error first. */
  const interrupt = async () => {
    if (interrupted) return;
    interrupted = true;
    q.push("end");
    try {
      await fetch(`${base}/api/session/${run.sessionID}/interrupt`, {
        method: "POST",
        headers: authHeaders(),
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      /* best effort */
    }
  };

  try {
    const res = await fetch(`${base}/api/session/${run.sessionID}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ text: opts.text }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Redact before the body can reach a log or the chat UI.
      throw new Error(`opencode prompt failed (${res.status}: ${redactSecret(body).slice(0, 140)})`);
    }

    for (;;) {
      const item = await q.next();
      lastTick = Date.now();
      if (item.done || item.value === "end") break;
      if (item.value.type === "error") {
        void interrupt();
        yield item.value;
        continue;
      }
      yield item.value;
    }
  } finally {
    off();
    signal?.removeEventListener("abort", onAbort);
    clearTimeout(totalTimer);
    clearInterval(watchdog);
    if (signal?.aborted) void interrupt();
  }
}
