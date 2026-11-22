// OpenCode credentials. The single place that reads OPENCODE_PASSWORD and the
// single place that turns it into an Authorization header.
//
// Rules (docs/auth-refactor-plan.md §2):
//   - No object returned from here carries the password, its base64 token, or
//     anything derived from it. Only openCodeAuthHeader() produces the
//     credential, and it hands back a header, not the secret.
//   - Nothing in this module touches the network. Reachability is probed in
//     ./opencode and passed in to describeOpenCodeAuth().
//   - redactSecret() is the choke point for any text that could carry the
//     secret into a log or a user-visible string.

export interface OpenCodeAuthConfig {
  /** Sanitised: no userinfo, no trailing slash. */
  url: string;
  passwordConfigured: boolean;
  /** Password present (credentials exist locally). */
  configured: boolean;
}

export type OpenCodeAuthState =
  | "not-configured" // no password in the environment
  | "missing-password" // a URL was set but no password
  | "unreachable" // credentials present, probe failed (or not probed yet)
  | "connected"; // credentials present, probe OK

export interface OpenCodeAuthStatus {
  state: OpenCodeAuthState;
  url: string;
  passwordConfigured: boolean;
  /** null = not probed yet. */
  reachable: boolean | null;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:4096";
const USERNAME = "opencode";
const REDACTED = "***";

/** Trimmed env var, with empty strings mapped to undefined. */
export function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Drop `user:pass@` from a URL without otherwise normalising it. */
function stripUserinfo(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, "$1");
}

function password(): string | null {
  return env("OPENCODE_PASSWORD") ?? null;
}

function basicToken(pw: string): string {
  return Buffer.from(`${USERNAME}:${pw}`).toString("base64");
}

export function getOpenCodeConfig(): OpenCodeAuthConfig {
  const url = stripUserinfo(env("OPENCODE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const passwordConfigured = password() !== null;
  return { url, passwordConfigured, configured: passwordConfigured };
}

/** `{ Authorization: "Basic …" }`, or null when no password is set (send no header at all). */
export function openCodeAuthHeader(): Record<string, string> | null {
  const pw = password();
  if (!pw) return null;
  return { Authorization: `Basic ${basicToken(pw)}` };
}

/**
 * The only auth view the UI may see: booleans, a state enum and a sanitised URL.
 * `reachable` comes from the probe in ./opencode; omit it when not probed.
 */
export function describeOpenCodeAuth(reachable: boolean | null = null): OpenCodeAuthStatus {
  const { url, passwordConfigured } = getOpenCodeConfig();
  let state: OpenCodeAuthState;
  if (!passwordConfigured) state = env("OPENCODE_URL") ? "missing-password" : "not-configured";
  else state = reachable === true ? "connected" : "unreachable";
  return { state, url, passwordConfigured, reachable };
}

function userinfoPassword(): string | null {
  const raw = env("OPENCODE_URL");
  const m = raw?.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#:@]*:([^/?#@]+)@/i);
  return m ? m[1] : null;
}

/** Replace the OpenCode password and its base64 forms with `***`. Tolerates null/undefined. */
export function redactSecret(text: string | null | undefined): string {
  if (!text) return "";
  const secrets = new Set<string>();
  const pw = password();
  if (pw) {
    secrets.add(basicToken(pw));
    secrets.add(Buffer.from(pw).toString("base64"));
    secrets.add(pw);
  }
  const urlPw = userinfoPassword();
  if (urlPw) secrets.add(urlPw);
  let out = text;
  // Longest first so a token is replaced whole before any substring of it.
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) {
    out = out.split(s).join(REDACTED);
  }
  return out;
}
