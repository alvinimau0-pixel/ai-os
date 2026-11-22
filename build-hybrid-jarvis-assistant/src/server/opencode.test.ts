import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No live server, no DB: fetch is stubbed per test, node:http and ./data are mocked.
const { requestMock, dataMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  dataMock: { getOpenCodeSessionId: vi.fn(), setOpenCodeSessionId: vi.fn() },
}));
vi.mock("node:http", () => ({ default: { request: requestMock } }));
vi.mock("./data", () => dataMock);

type OpenCode = typeof import("./opencode");

const PW = "test-password";
const EXPECTED_AUTH = `Basic ${Buffer.from(`opencode:${PW}`).toString("base64")}`;
const BASE = "http://agent.local:4096";

interface Call {
  url: string;
  init: RequestInit;
}

/** Route-based fake fetch. Every call is recorded; unknown routes fail the test. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const key = `${init.method ?? "GET"} ${url}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request: ${key}`);
    return route();
  });
  return { fn, calls };
}

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>;
}

let oc: OpenCode;
let timeoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("OPENCODE_URL", BASE);
  vi.stubEnv("OPENCODE_PASSWORD", PW);
  vi.stubEnv("OPENCODE_MODEL", "");
  requestMock.mockReset();
  requestMock.mockImplementation(() => ({ on: vi.fn(), end: vi.fn(), destroy: vi.fn() }));
  dataMock.getOpenCodeSessionId.mockReset().mockResolvedValue(null);
  dataMock.setOpenCodeSessionId.mockReset().mockResolvedValue(undefined);
  timeoutSpy = vi.spyOn(AbortSignal, "timeout");
  oc = await import("./opencode");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("probeOpenCode", () => {
  it("GETs {url}/api/session with the auth header and a 2500 ms timeout", async () => {
    const f = fakeFetch({ [`GET ${BASE}/api/session`]: () => new Response("[]") });
    expect(await oc.probeOpenCode(f.fn)).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].init.method).toBeUndefined();
    expect(headersOf(f.calls[0])).toEqual({ Authorization: EXPECTED_AUTH });
    expect(timeoutSpy).toHaveBeenCalledWith(2500);
  });

  it("sends no Authorization header when no password is set", async () => {
    vi.stubEnv("OPENCODE_PASSWORD", "");
    const f = fakeFetch({ [`GET ${BASE}/api/session`]: () => new Response("[]") });
    await oc.probeOpenCode(f.fn);
    expect(headersOf(f.calls[0])).toEqual({});
  });

  it("is unreachable on 401", async () => {
    const f = fakeFetch({ [`GET ${BASE}/api/session`]: () => new Response("nope", { status: 401 }) });
    expect(await oc.probeOpenCode(f.fn)).toBe(false);
  });

  it("is unreachable when fetch throws", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await oc.probeOpenCode(fn)).toBe(false);
  });

  it("caches success for 15 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const f = fakeFetch({ [`GET ${BASE}/api/session`]: () => new Response("[]") });
    expect(await oc.probeOpenCode(f.fn)).toBe(true);
    vi.setSystemTime(1_000_000 + 14_999);
    expect(await oc.probeOpenCode(f.fn)).toBe(true);
    expect(f.calls).toHaveLength(1);
    vi.setSystemTime(1_000_000 + 15_000);
    await oc.probeOpenCode(f.fn);
    expect(f.calls).toHaveLength(2);
  });

  it("caches failure for 15 s too", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(2_000_000);
    const fn = vi.fn(async () => new Response("", { status: 503 }));
    expect(await oc.probeOpenCode(fn)).toBe(false);
    vi.setSystemTime(2_000_000 + 10_000);
    expect(await oc.probeOpenCode(fn)).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resetOpenCodeProbe forgets the cached result", async () => {
    const fn = vi.fn(async () => new Response("[]"));
    await oc.probeOpenCode(fn);
    oc.resetOpenCodeProbe();
    await oc.probeOpenCode(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("getOpenCodeConfig / getOpenCodeStatus", () => {
  it("returns a password-free config without probing", () => {
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    const cfg = oc.getOpenCodeConfig();
    expect(cfg).toEqual({ baseUrl: BASE });
    expect(JSON.stringify(cfg)).not.toContain(PW);
    expect(fn).not.toHaveBeenCalled();
  });

  it("status is null when unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    expect(await oc.getOpenCodeStatus()).toBeNull();
  });

  it("status keeps its existing shape when reachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]")));
    expect(await oc.getOpenCodeStatus()).toEqual({ cloudAvailable: true, provider: "OpenCode", model: "default agent", skillCount: 0 });
  });
});

describe("ensureOpenCodeSession", () => {
  it("returns null when the agent is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await oc.ensureOpenCodeSession(1)).toBeNull();
  });

  it("POSTs a new session with the auth header and a 10 s timeout", async () => {
    const f = fakeFetch({
      [`GET ${BASE}/api/session`]: () => new Response("[]"),
      [`POST ${BASE}/api/session`]: () => Response.json({ data: { id: "sess-1" } }),
    });
    vi.stubGlobal("fetch", f.fn);
    const run = await oc.ensureOpenCodeSession(7);
    expect(run).toEqual({ sessionID: "sess-1", config: { baseUrl: BASE } });
    expect(Object.keys(run!.config)).toEqual(["baseUrl"]); // no password travels in the run
    const create = f.calls.find((c) => c.init.method === "POST");
    expect(headersOf(create)).toEqual({ "Content-Type": "application/json", Authorization: EXPECTED_AUTH });
    expect(timeoutSpy).toHaveBeenCalledWith(10000);
    expect(dataMock.setOpenCodeSessionId).toHaveBeenCalledWith(7, "sess-1");
  });

  it("reuses a mapped session without creating one", async () => {
    dataMock.getOpenCodeSessionId.mockResolvedValue("existing");
    const f = fakeFetch({ [`GET ${BASE}/api/session`]: () => new Response("[]") });
    vi.stubGlobal("fetch", f.fn);
    expect(await oc.ensureOpenCodeSession(3)).toEqual({ sessionID: "existing", config: { baseUrl: BASE } });
    expect(f.calls.every((c) => c.init.method === undefined)).toBe(true);
  });

  it("keeps the session-create error strings", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        [`GET ${BASE}/api/session`]: () => new Response("[]"),
        [`POST ${BASE}/api/session`]: () => new Response("boom", { status: 500 }),
      }).fn,
    );
    await expect(oc.ensureOpenCodeSession(1)).rejects.toThrow("opencode session create failed (500)");

    vi.stubGlobal(
      "fetch",
      fakeFetch({
        [`GET ${BASE}/api/session`]: () => new Response("[]"),
        [`POST ${BASE}/api/session`]: () => Response.json({ data: {} }),
      }).fn,
    );
    await expect(oc.ensureOpenCodeSession(1)).rejects.toThrow("opencode session create returned no id");
  });
});

describe("runOpenCodeAgent", () => {
  const run = { sessionID: "s1", config: { baseUrl: BASE } };

  function agentRoutes(prompt: () => Response) {
    return fakeFetch({
      [`GET ${BASE}/api/session`]: () => new Response("[]"),
      [`POST ${BASE}/api/session/s1/prompt`]: prompt,
      [`POST ${BASE}/api/session/s1/interrupt`]: () => new Response(""),
    });
  }

  it("sends identical headers on the SSE bus, prompt and interrupt", async () => {
    const f = agentRoutes(() => new Response(""));
    vi.stubGlobal("fetch", f.fn);
    const ac = new AbortController();
    const gen = oc.runOpenCodeAgent({ run, text: "hi", signal: ac.signal });
    const first = gen.next();

    await vi.waitFor(() => expect(requestMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.endsWith("/prompt"))).toBe(true));
    ac.abort();
    expect((await first).done).toBe(true);
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.endsWith("/interrupt"))).toBe(true));

    // SSE: raw node:http GET /api/event with the same header.
    const opts = requestMock.mock.calls[0][0];
    expect(opts).toMatchObject({ hostname: "agent.local", port: "4096", path: "/api/event", method: "GET" });
    expect(opts.headers).toEqual({ Authorization: EXPECTED_AUTH });

    const prompt = f.calls.find((c) => c.url.endsWith("/prompt"));
    expect(headersOf(prompt)).toEqual({ "Content-Type": "application/json", Authorization: EXPECTED_AUTH });
    expect(prompt?.init.body).toBe(JSON.stringify({ text: "hi" }));

    const interrupt = f.calls.find((c) => c.url.endsWith("/interrupt"));
    expect(headersOf(interrupt)).toEqual({ Authorization: EXPECTED_AUTH });
    expect(timeoutSpy).toHaveBeenCalledWith(4000);
  });

  it("omits the header everywhere when no password is set", async () => {
    vi.stubEnv("OPENCODE_PASSWORD", "");
    const f = agentRoutes(() => new Response(""));
    vi.stubGlobal("fetch", f.fn);
    const ac = new AbortController();
    const gen = oc.runOpenCodeAgent({ run, text: "hi", signal: ac.signal });
    const first = gen.next();
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.endsWith("/prompt"))).toBe(true));
    ac.abort();
    await first;
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.endsWith("/interrupt"))).toBe(true));

    expect(requestMock.mock.calls[0][0].headers).toEqual({});
    for (const c of f.calls) expect(headersOf(c)).not.toHaveProperty("Authorization");
  });

  it("redacts the credential from the upstream body in prompt errors", async () => {
    const leaky = `unauthorized for ${PW} (${EXPECTED_AUTH})`;
    vi.stubGlobal("fetch", agentRoutes(() => new Response(leaky, { status: 401 })).fn);
    const gen = oc.runOpenCodeAgent({ run, text: "hi" });
    const err = await gen.next().then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toBe("opencode prompt failed (401: unauthorized for *** (Basic ***))");
    expect(err?.message).not.toContain(PW);
    expect(err?.message).not.toContain(EXPECTED_AUTH.slice(6));
  });

  it("keeps the 140-char cap on the embedded body", async () => {
    vi.stubGlobal("fetch", agentRoutes(() => new Response("x".repeat(500), { status: 500 })).fn);
    const err = await oc
      .runOpenCodeAgent({ run, text: "hi" })
      .next()
      .catch((e: Error) => e);
    expect((err as Error).message).toBe(`opencode prompt failed (500: ${"x".repeat(140)})`);
  });
});
