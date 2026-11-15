// Minimal MCP client: stdio + HTTP transports. External tools are merged into
// the brain's tool list as `mcp__<server>__<tool>` per the MCP naming scheme.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ToolSpec } from "./llm";
import { listMcpServers } from "./data";

interface McpServer {
  name: string;
  transport: string;
  command: string | null;
  args: string[];
  url: string | null;
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// stdio transport: one long-lived child process per server, newline JSON-RPC.
// ---------------------------------------------------------------------------

interface StdioConn {
  proc: ChildProcessWithoutNullStreams;
  nextId: number;
  pending: Map<number, (v: unknown) => void>;
  buffer: string;
}

const stdioConns = new Map<string, StdioConn>();

function stdioConnect(server: McpServer): Promise<StdioConn> {
  const existing = stdioConns.get(server.name);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const proc = spawn(server.command!, server.args ?? [], { stdio: ["pipe", "pipe", "pipe"] });
    const conn: StdioConn = { proc, nextId: 1, pending: new Map(), buffer: "" };
    proc.stdout.on("data", (chunk: Buffer) => {
      conn.buffer += chunk.toString();
      let nl = conn.buffer.indexOf("\n");
      while (nl !== -1) {
        const line = conn.buffer.slice(0, nl).trim();
        conn.buffer = conn.buffer.slice(nl + 1);
        nl = conn.buffer.indexOf("\n");
        if (!line) continue;
        let msg: { id?: number; result?: unknown; error?: JsonRpcError } | null = null;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg && typeof msg.id === "number" && conn.pending.has(msg.id)) {
          conn.pending.get(msg.id)!(msg.error ? new Error(msg.error.message) : msg.result);
          conn.pending.delete(msg.id);
        }
      }
    });
    proc.on("error", reject);
    proc.on("exit", () => stdioConns.delete(server.name));
    stdioConns.set(server.name, conn);

    const call = (method: string, params: Record<string, unknown>): Promise<unknown> =>
      new Promise((res, rej) => {
        const id = conn.nextId++;
        conn.pending.set(id, (v) => {
          if (v instanceof Error) rej(v);
          else res(v);
        });
        proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });

    call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "jarvis", version: "1.0.0" },
    })
      .then(() => {
        proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
        resolve(conn);
      })
      .catch((err) => {
        proc.kill();
        reject(err);
      });
  });
}

function stdioCall(server: McpServer, method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const conn = stdioConns.get(server.name);
    if (!conn) return reject(new Error("stdio server not connected"));
    const id = conn.nextId++;
    conn.pending.set(id, (v) => {
      if (v instanceof Error) reject(v);
      else resolve(v);
    });
    conn.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

// ---------------------------------------------------------------------------
// HTTP transport (streamable HTTP: POST JSON-RPC, accept JSON or SSE reply).
// ---------------------------------------------------------------------------

async function httpCall(server: McpServer, method: string, params: Record<string, unknown> | null, id: number): Promise<unknown> {
  const res = await fetch(server.url!, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  const text = await res.text();
  if (text.startsWith("{")) return JSON.parse(text);
  // SSE reply: take the first data: frame carrying our id.
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const msg = JSON.parse(line.slice(5).trim()) as { id?: number };
      if (msg.id === id) return msg;
    } catch {
      /* skip */
    }
  }
  throw new Error("MCP HTTP reply not found");
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

let cache: { at: number; tools: { server: string; tool: string; description?: string; schema?: Record<string, unknown> }[] } = { at: 0, tools: [] };

async function enabledServers(): Promise<McpServer[]> {
  const rows = await listMcpServers();
  return rows.filter((r) => r.enabled).map((r) => ({ name: r.name, transport: r.transport, command: r.command, args: r.args, url: r.url }));
}

async function listToolsFor(server: McpServer): Promise<McpTool[]> {
  if (server.transport === "stdio") {
    const conn = await stdioConnect(server);
    const r = (await stdioCall(server, "tools/list", {})) as { tools?: McpTool[] };
    void conn;
    return r.tools ?? [];
  }
  const r = (await httpCall(server, "tools/list", {}, 1)) as { result?: { tools?: McpTool[] } };
  return r.result?.tools ?? [];
}

/** All MCP tools across enabled servers, namespaced mcp__<server>__<tool>. */
export async function getMcpToolSpecs(): Promise<ToolSpec[]> {
  if (Date.now() - cache.at < 60000 && cache.tools.length >= 0) return cache.tools.map(toSpec);
  const specs: { server: string; tool: string; description?: string; schema?: Record<string, unknown> }[] = [];
  for (const server of await enabledServers()) {
    try {
      for (const t of await listToolsFor(server)) {
        specs.push({ server: server.name, tool: t.name, description: t.description, schema: t.inputSchema });
      }
    } catch (err) {
      console.error(`[mcp] ${server.name} tool listing failed:`, err instanceof Error ? err.message : err);
    }
  }
  cache = { at: Date.now(), tools: specs };
  return specs.map(toSpec);
}

function toSpec(t: { server: string; tool: string; description?: string; schema?: Record<string, unknown> }): ToolSpec {
  return {
    type: "function",
    function: {
      name: `mcp__${t.server}__${t.tool}`,
      description: t.description ?? `MCP tool ${t.tool} on ${t.server}`,
      parameters: (t.schema ?? { type: "object", properties: {} }) as Record<string, unknown>,
    },
  };
}

/** Call an MCP tool by its merged name. Returns the text content. */
export async function runMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const m = name.match(/^mcp__([a-z0-9_-]+)__(.+)$/);
  if (!m) throw new Error(`Not an MCP tool name: ${name}`);
  const serverName = m[1];
  const tool = m[2];
  const server = (await enabledServers()).find((s) => s.name === serverName);
  if (!server) throw new Error(`MCP server "${serverName}" is not enabled`);
  let result: unknown;
  if (server.transport === "stdio") {
    result = await stdioCall(server, "tools/call", { name: tool, arguments: args });
  } else {
    const r = await httpCall(server, "tools/call", { name: tool, arguments: args }, 1);
    result = (r as { result?: unknown }).result ?? r;
  }
  const res = result as { content?: { type?: string; text?: string }[]; isError?: boolean; error?: JsonRpcError };
  if (res?.error) throw new Error(res.error.message);
  const text = (res?.content ?? [])
    .filter((c) => c.type === "text" || !c.type)
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
  if (res?.isError) throw new Error(text || "MCP tool reported an error");
  return text || "(no output)";
}
