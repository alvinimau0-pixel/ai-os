import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeOpenCodeAuth, env, getOpenCodeConfig, openCodeAuthHeader, redactSecret } from "./auth";

// Dummy credentials only — no test reads .env or a real OPENCODE_PASSWORD.
const PW = "test-password";
const TOKEN = Buffer.from(`opencode:${PW}`).toString("base64");

function setEnv(vars: { url?: string; password?: string }) {
  vi.stubEnv("OPENCODE_URL", vars.url ?? "");
  vi.stubEnv("OPENCODE_PASSWORD", vars.password ?? "");
}

beforeEach(() => {
  setEnv({}); // never rely on the ambient environment
  // Static auth helpers must never touch the network.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("auth.ts must not call fetch");
    }),
  );
});

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("env", () => {
  it("trims and maps empty strings to undefined", () => {
    vi.stubEnv("OPENCODE_MODEL", "  gpt  ");
    expect(env("OPENCODE_MODEL")).toBe("gpt");
    vi.stubEnv("OPENCODE_MODEL", "   ");
    expect(env("OPENCODE_MODEL")).toBeUndefined();
  });
});

describe("openCodeAuthHeader", () => {
  it("returns null when no password is set", () => {
    expect(openCodeAuthHeader()).toBeNull();
  });

  it("builds Basic auth with username opencode", () => {
    setEnv({ password: PW });
    const h = openCodeAuthHeader();
    expect(h).toEqual({ Authorization: `Basic ${TOKEN}` });
    const decoded = Buffer.from(h!.Authorization.replace(/^Basic /, ""), "base64").toString();
    expect(decoded).toBe(`opencode:${PW}`);
  });

  it("trims the password like the old env() helper", () => {
    setEnv({ password: `  ${PW}\n` });
    expect(openCodeAuthHeader()).toEqual({ Authorization: `Basic ${TOKEN}` });
  });
});

describe("getOpenCodeConfig", () => {
  it("reports a missing password", () => {
    const cfg = getOpenCodeConfig();
    expect(cfg.passwordConfigured).toBe(false);
    expect(cfg.configured).toBe(false);
  });

  it("reports a configured password without exposing it", () => {
    setEnv({ password: PW, url: "http://u:urlsecret@agent.local:4096/" });
    const cfg = getOpenCodeConfig();
    expect(cfg.passwordConfigured).toBe(true);
    expect(cfg.configured).toBe(true);
    const json = JSON.stringify(cfg);
    expect(json).not.toContain(PW);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("urlsecret");
    expect(Object.keys(cfg).sort()).toEqual(["configured", "passwordConfigured", "url"]);
  });

  it("defaults the URL when OPENCODE_URL is unset", () => {
    expect(getOpenCodeConfig().url).toBe("http://127.0.0.1:4096");
  });

  it("strips trailing slashes", () => {
    setEnv({ url: "http://agent.local:9000///" });
    expect(getOpenCodeConfig().url).toBe("http://agent.local:9000");
  });

  it("strips userinfo", () => {
    setEnv({ url: "http://u:p@host:4096/" });
    expect(getOpenCodeConfig().url).toBe("http://host:4096");
    setEnv({ url: "https://user@host/base/" });
    expect(getOpenCodeConfig().url).toBe("https://host/base");
  });

  it("leaves a URL without userinfo otherwise untouched", () => {
    setEnv({ url: "http://Agent.Local:4096/base/path" });
    expect(getOpenCodeConfig().url).toBe("http://Agent.Local:4096/base/path");
  });
});

describe("redactSecret", () => {
  it("replaces the password and its base64 forms", () => {
    setEnv({ password: PW });
    const pwB64 = Buffer.from(PW).toString("base64");
    const out = redactSecret(`bad creds ${PW}; header Basic ${TOKEN}; raw ${pwB64}`);
    expect(out).toBe("bad creds ***; header Basic ***; raw ***");
  });

  it("redacts a password embedded in OPENCODE_URL", () => {
    setEnv({ url: "http://u:urlsecret@host:4096" });
    expect(redactSecret("connect to u:urlsecret@host failed")).toBe("connect to u:***@host failed");
  });

  it("leaves other text intact", () => {
    setEnv({ password: PW });
    expect(redactSecret("upstream said: rate limited")).toBe("upstream said: rate limited");
  });

  it("is a no-op when no secret is configured", () => {
    expect(redactSecret("anything at all")).toBe("anything at all");
  });

  it("tolerates null, undefined and empty strings", () => {
    setEnv({ password: PW });
    expect(redactSecret(null)).toBe("");
    expect(redactSecret(undefined)).toBe("");
    expect(redactSecret("")).toBe("");
  });
});

describe("describeOpenCodeAuth", () => {
  it("not-configured: no URL, no password", () => {
    expect(describeOpenCodeAuth()).toEqual({
      state: "not-configured",
      url: "http://127.0.0.1:4096",
      passwordConfigured: false,
      reachable: null,
    });
  });

  it("missing-password: URL set, no password", () => {
    setEnv({ url: "http://agent.local:4096" });
    expect(describeOpenCodeAuth()).toMatchObject({ state: "missing-password", passwordConfigured: false });
  });

  it("unreachable: credentials present, probe failed", () => {
    setEnv({ password: PW });
    expect(describeOpenCodeAuth(false)).toMatchObject({ state: "unreachable", passwordConfigured: true, reachable: false });
  });

  it("unreachable with reachable=null when not probed yet", () => {
    setEnv({ password: PW });
    expect(describeOpenCodeAuth()).toMatchObject({ state: "unreachable", reachable: null });
  });

  it("connected: credentials present, probe OK", () => {
    setEnv({ password: PW, url: "http://u:urlsecret@agent.local:4096/" });
    const status = describeOpenCodeAuth(true);
    expect(status).toEqual({ state: "connected", url: "http://agent.local:4096", passwordConfigured: true, reachable: true });
    const json = JSON.stringify(status);
    expect(json).not.toContain(PW);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("urlsecret");
  });
});
