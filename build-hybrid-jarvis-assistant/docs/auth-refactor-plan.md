# Auth refactor — OpenCode authentication (phase 1 plan)

Paths are relative to `build-hybrid-jarvis-assistant/`. Phase 1 is documentation only.

## 1. Current state

### Env vars read

| Var | Read at | Notes |
| --- | --- | --- |
| `OPENCODE_URL` | `src/server/opencode.ts:62` | Falls back to `DEFAULT_BASE_URL = "http://127.0.0.1:4096"` (`src/server/opencode.ts:34`); trailing slashes stripped with `.replace(/\/+$/, "")`. |
| `OPENCODE_PASSWORD` | `src/server/opencode.ts:63` | The only OpenCode secret. `null` when unset. |
| `OPENCODE_MODEL` | `src/server/opencode.ts:55` | Display label only, default `"default agent"`. |

All three are read through the local helper `env()` (`src/server/opencode.ts:37-40`), which trims and maps empty strings to `undefined`. Values come from `process.env`; `.env` is git-ignored (`.gitignore:10-12`) and is loaded by Next.js, not by app code (`dotenv` is imported only in `drizzle.config.ts:1`).

Adjacent credentials follow the same pattern and are **out of scope**: `LLM_*` / `OPENAI_*` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY` (`src/server/llm.ts:24-30`, `src/server/llm.ts:39-58`), `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY` (`src/server/web.ts:240`, `src/server/web.ts:249`), `DATABASE_URL` (`src/db/index.ts:4`).

### Where the header is built and sent

`authHeader(cfg)` (`src/server/opencode.ts:42-46`) is the single builder: it base64-encodes `opencode:<password>` and returns `{ Authorization: "Basic <token>" }`, or `{}` (no header at all) when the password is missing. Username `opencode` is hard-coded at `src/server/opencode.ts:44`.

Five call sites send it:

1. `src/server/opencode.ts:68` — reachability probe: `GET {url}/api/session`, `AbortSignal.timeout(2500)`.
2. `src/server/opencode.ts:146` — SSE event bus: `GET {url}/api/event` over raw `node:http` (`src/server/opencode.ts:140-147`; raw http is deliberate, see `README.md:141`).
3. `src/server/opencode.ts:222` — `POST {url}/api/session` (session create, 10 s timeout at `src/server/opencode.ts:224`).
4. `src/server/opencode.ts:338` — `POST {url}/api/session/{sid}/interrupt` (4 s timeout at `src/server/opencode.ts:339`).
5. `src/server/opencode.ts:349` — `POST {url}/api/session/{sid}/prompt`.

The password travels inside `OpenCodeConfig` (`src/server/opencode.ts:19-22`) and is re-packed into `OpenCodeRun.config` (`src/server/opencode.ts:24-27`, `src/server/opencode.ts:219`, `src/server/opencode.ts:231`) so `runOpenCodeAgent` can rebuild the header (`src/server/opencode.ts:280-281`).

### The conflation that motivates the refactor

`getOpenCodeConfig()` (`src/server/opencode.ts:58-77`) is both the credential getter **and** the reachability probe: it returns `null` when the probe fails (`src/server/opencode.ts:75-76`). A missing password and a dead server therefore look identical. Consequences:

- `getOpenCodeStatus()` (`src/server/opencode.ts:79-83`) returns `null` in both cases, and `getBrainStatus` (`src/server/llm.ts:60-73`) falls back to the cloud-provider branch (`src/server/llm.ts:66-72`).
- `ensureOpenCodeSession` returns `null` (`src/server/opencode.ts:216-217`), which surfaces as the user-visible string `"OpenCode server unreachable"` (`src/server/brain.ts:155-156`) — even when the real cause is a missing `OPENCODE_PASSWORD`.
- The OpenCode status is only probed when the backend setting is `opencode` (`src/server/llm.ts:61-65`); with backend `api` OpenCode is never probed.
- The probe result is cached per process for 15 s, successes and failures alike (`src/server/opencode.ts:35`, `src/server/opencode.ts:59`, `src/server/opencode.ts:75`). `probeCache.model` (`src/server/opencode.ts:52`) is written but never read — dead field.

### Where the secret can leak

- `src/server/opencode.ts:355` embeds the **upstream response body** in an error: `opencode prompt failed (${res.status}: ${body.slice(0, 140)})`. That message becomes `lastReason` (`src/server/brain.ts:258`), is logged (`src/server/brain.ts:259`) and is echoed **to the user** at `src/server/brain.ts:267` and `src/server/brain.ts:270` → `src/server/brain.ts:66`. Arbitrary OpenCode response text therefore reaches the chat UI.
- The same path exists for the cloud engine: `describeError` (`src/server/llm.ts:115-124`) embeds the upstream body, which reaches `src/server/brain.ts:249` → `src/server/brain.ts:267`.
- `src/server/opencode.ts:150` logs only the status code; `src/server/opencode.ts:185` logs `err.message` from `node:http` (no headers). Neither prints the token today.
- The Basic token itself is never logged, but base64 is reversible — treat it as the password.

### Does the secret reach the client today?

No. `BrainStatus` (`src/lib/types.ts:88-93`) carries only `cloudAvailable`, `provider`, `model`, `skillCount`. `/api/settings` returns `{ settings, brain }` (`src/app/api/settings/route.ts:9`, `src/app/api/settings/route.ts:17`) and the bootstrap payload is `{ ...data, brain }` (`src/app/page.tsx:10`, `src/server/data.ts:526-548`). `OpenCodeConfig` is server-internal today — but it *contains* the password, so any future serialisation of it (a route handler returning `getOpenCodeConfig()`) would leak it. That is the risk the new module removes.

## 2. Proposed API contract — `src/server/auth.ts`

```ts
export interface OpenCodeAuthConfig {
  url: string;              // sanitised: no userinfo, no trailing slash
  passwordConfigured: boolean;
  configured: boolean;      // password present (credentials exist locally)
}

export type OpenCodeAuthState =
  | "not-configured"        // no password in the environment
  | "missing-password"      // a URL was set but no password
  | "unreachable"           // credentials present, probe failed
  | "connected";            // credentials present, probe OK

export interface OpenCodeAuthStatus {
  state: OpenCodeAuthState;
  url: string;
  passwordConfigured: boolean;
  reachable: boolean | null;   // null = not probed yet
}

export function getOpenCodeConfig(): OpenCodeAuthConfig;
export function openCodeAuthHeader(): Record<string, string> | null;
export function describeOpenCodeAuth(): OpenCodeAuthStatus;
export function redactSecret(text: string | null | undefined): string;
```

Why this shape:

- **The password is not a field of any returned object.** `getOpenCodeConfig()` returns a *password-free* snapshot, so the type system prevents the accidental `Response.json(getOpenCodeConfig())` leak. Only `openCodeAuthHeader()` can produce the credential, and it hands back a header, not the secret.
- **`configured` is split from reachability.** "Do we have credentials?" is a local, env-derived fact; "is the agent reachable?" is a network fact that changes every 15 s. The current single function conflates them, which is why the UI cannot tell a missing password from a dead server. The probe stays in `src/server/opencode.ts` (it is I/O); the credential facts stay in `auth.ts`.
- **`openCodeAuthHeader()` returns `null` instead of `{}`** so "no credentials" is explicit at the call site. The wire behaviour is unchanged: when there is no password, **no `Authorization` header is sent at all** (`src/server/opencode.ts:43`).
- **`describeOpenCodeAuth()` is the only thing the UI is allowed to see.** It returns booleans, a state enum and a sanitised URL.
- **`redactSecret()` is the single choke point** for anything that could carry the secret (or its base64 form) into a log or a user-visible string.

Never cross the server boundary: the raw password; the base64 Basic token; any derived hash, prefix or length; `OpenCodeConfig`-shaped objects that carry `password`; upstream response bodies that are echoed verbatim. Credentials stay in `process.env` — they are never written to the DB (`src/db/schema.ts:17-22` stores only user settings such as `brainBackend`), never sent to the browser, and never placed in a new file.

## 3. Backend call sites — ordered migration

1. **`src/server/opencode.ts:37-40`** — delete the local `env()` helper; import the shared one from `./auth`.
2. **`src/server/opencode.ts:42-46`** — delete `authHeader()`; import `openCodeAuthHeader()`. Same username, same base64 payload, same "omit the header entirely" rule.
3. **`src/server/opencode.ts:19-22`** — `OpenCodeConfig` loses `password`; keep `baseUrl`. `OpenCodeRun.config` (`src/server/opencode.ts:24-27`) then carries only the URL.
4. **`src/server/opencode.ts:58-77`** — split: `auth.ts#getOpenCodeConfig()` returns the static, password-free config; `opencode.ts` keeps a probe (`probeOpenCode()`) that does the existing `GET /api/session` with the existing 2500 ms timeout and the existing 15 s cache (`src/server/opencode.ts:35`, `src/server/opencode.ts:67-70`, `src/server/opencode.ts:75`).
5. **`src/server/opencode.ts:68`** — probe fetch: header from `openCodeAuthHeader()`; path, method and timeout unchanged.
6. **`src/server/opencode.ts:139-147`** — SSE bus: header from `openCodeAuthHeader()`; keep raw `node:http`, keep the 1 s → 10 s backoff (`src/server/opencode.ts:136`, `src/server/opencode.ts:178`) and the existing log lines.
7. **`src/server/opencode.ts:220-225`** — session create: header + unchanged 10 s timeout.
8. **`src/server/opencode.ts:336-340`** — interrupt: header + unchanged 4 s timeout.
9. **`src/server/opencode.ts:347-356`** — prompt: header; **and** run the upstream body through `redactSecret()` before it is embedded in the error string. This is the one intentional behaviour change (see §7).
10. **`src/server/opencode.ts:79-83`** — `getOpenCodeStatus()` now merges `describeOpenCodeAuth()` with the probe result into the extended `BrainStatus`.
11. **`src/server/llm.ts:60-73`** — `getBrainStatus()` keeps its signature; it merges the auth status into the returned `BrainStatus` (`src/server/llm.ts:61-65` keeps the "probe OpenCode only when the backend is opencode" rule).
12. **`src/server/brain.ts:7`, `src/server/brain.ts:183-185`** — `getOpenCodeConfig()` now returns the password-free config; routing decisions (`ocUsable`) must be based on *reachable*, not on *credentials present*.

### Behaviour that must stay identical

- Probe: `GET {url}/api/session`, 2500 ms timeout, 15 s cache for both success and failure (`src/server/opencode.ts:35`, `src/server/opencode.ts:59`, `src/server/opencode.ts:67-75`).
- URL normalisation and default (`src/server/opencode.ts:34`, `src/server/opencode.ts:62`).
- Basic auth: username `opencode`, base64 of `opencode:<password>`, header omitted when no password (`src/server/opencode.ts:43-45`).
- SSE transport stays raw `node:http` (`src/server/opencode.ts:140`).
- Timeouts: session create 10 s (`src/server/opencode.ts:224`), interrupt 4 s (`src/server/opencode.ts:339`), agent idle 90 s / total 240 s (`src/server/opencode.ts:319-320`).
- User-visible strings: `"OpenCode server unreachable"` (`src/server/brain.ts:156`), `"opencode session create failed (${res.status})"` (`src/server/opencode.ts:226`), `"opencode session create returned no id"` (`src/server/opencode.ts:229`), and the `"opencode prompt failed (...)"` shape (`src/server/opencode.ts:355`).

## 4. UI flow

### What the UI shows today

- Configuration → "Brain routing" section (`src/components/jarvis/Drawers.tsx:216-246`) with one status card keyed only on `brain.cloudAvailable` (`src/components/jarvis/Drawers.tsx:247-273`) that lists cloud API-key env var names (`src/components/jarvis/Drawers.tsx:183`). It says nothing about OpenCode auth.
- Top bar chip: `Cloud · {model}` / `Cloud offline` (`src/components/jarvis/TopBar.tsx:77-80`), and the mode buttons are disabled when `!brain.cloudAvailable` (`src/components/jarvis/TopBar.tsx:55`).
- Systems panel: `Cloud brain: linked / not linked` (`src/components/jarvis/SidePanels.tsx:197-199`, `src/components/jarvis/SidePanels.tsx:216-220`).
- Onboarding step "brain" is completed from `brain.cloudAvailable` (`src/components/jarvis/OnboardingPanel.tsx:44-52`).

### Proposed states in the Configuration / brain area

| State | Condition | Copy (draft) |
| --- | --- | --- |
| Password missing | `passwordConfigured === false` | "OpenCode agent — password not configured. Set `OPENCODE_PASSWORD` in the server environment and restart." |
| Auth configured, connection down | `passwordConfigured === true`, probe failed | "OpenCode agent — auth configured, but the agent at `{url}` did not answer. Check that it is running and that the password matches." |
| Connected | probe OK | "OpenCode agent — connected at `{url}`" (plus the model label). |

The card is shown only when `settings.brainBackend === "opencode"`; otherwise the existing cloud card stays as-is.

### `BrainStatus`

Yes, one new **optional** field is needed, so the "api" backend and existing consumers keep working:

```ts
export interface BrainStatus {
  cloudAvailable: boolean;
  provider: string | null;
  model: string | null;
  skillCount: number;
  auth?: {                 // present only for the opencode backend
    state: "not-configured" | "missing-password" | "unreachable" | "connected";
    url: string;
    passwordConfigured: boolean;
    reachable: boolean;
  };
}
```

Optional + nested keeps the change additive (`src/lib/types.ts:88-93`).

### How the settings API exposes it

No new endpoint and no new table column: `getBrainStatus` (`src/server/llm.ts:60-73`) already feeds both `/api/settings` (`src/app/api/settings/route.ts:9`, `src/app/api/settings/route.ts:17`) and the bootstrap payload (`src/app/page.tsx:10`), so `brain.auth` rides along in the existing response. The client picks it up in `src/components/jarvis/JarvisApp.tsx:119-122` and `src/components/jarvis/JarvisApp.tsx:374-376`, where `setBrain` already exists.

Leak control:

- Only booleans, a state enum and the URL cross the wire. No password, hash, length, base64 token or probe body.
- The URL must be sanitised before display: `OPENCODE_URL` may legally contain userinfo (`http://user:pass@host`), which would itself be a credential. `auth.ts` strips userinfo.
- `sanitizeSettings` (`src/server/data.ts:105-134`) whitelists fields, so a client posting `opencodePassword` is silently ignored — the credential stays env-only, read-only from the API.
- `/api/health` (`src/app/api/health/route.ts:6-12`) stays DB-only; no auth state is exposed there.

## 5. Test gaps

Existing setup: Vitest, node environment, `include: ["src/**/*.test.ts"]`, `@` → `./src` (`vitest.config.ts:4-7`). The only tests today are pure unit tests (`src/lib/onboarding/copy.test.ts`, `src/lib/onboarding/types.test.ts`) — no network, no DB.

Add `src/server/auth.test.ts`:

1. **Header building** — `openCodeAuthHeader()` returns `null` with no password; with a password it returns `{ Authorization: "Basic …" }` whose base64 decodes to `opencode:<password>`.
2. **Missing password** — `getOpenCodeConfig().passwordConfigured === false` and `configured === false`.
3. **No secret in the returned object** — `JSON.stringify(getOpenCodeConfig())` does not contain the password.
4. **URL normalisation** — trailing slashes stripped; default `http://127.0.0.1:4096` when `OPENCODE_URL` is unset; userinfo stripped from `http://u:p@host`.
5. **Redaction** — `redactSecret()` replaces the password and its base64 form with `***`, leaves other text intact, and tolerates `null`/`undefined`/`""`.
6. **State machine** — `describeOpenCodeAuth()` yields `not-configured` / `missing-password` / `unreachable` / `connected` for the four fixtures.
7. **No network calls** — stub `globalThis.fetch` with a spy that fails the test if called; the static parts of `auth.ts` must not call it. The probe is a separate function and gets its own test with an injected fake fetch.
8. **Env hygiene** — set/restore `process.env.OPENCODE_*` per test (`vi.stubEnv`); no reliance on the ambient environment.

Add `src/server/opencode.test.ts` (probe behaviour): probe returns unreachable on 401 and on a thrown fetch; probe success caches for 15 s; the migrated call sites send exactly the expected header — all against a stubbed fetch.

Must **not** be tested with real credentials or a live server:

- No test may read `.env` or any real `OPENCODE_PASSWORD`; use fixed dummy values (`"test-password"`).
- No test may contact the real `127.0.0.1:4096`; the probe must be exercised through a stubbed `fetch`.
- No test may assert "the password is absent from the logs" by capturing real logs — assert on `redactSecret()` output instead.
- No test may assert on a live SSE stream from a real agent.

## 6. Parallel workstreams

| # | Workstream | Files | Depends on | Done when |
| --- | --- | --- | --- | --- |
| 1 | **API contract** | `src/server/auth.ts` (new) | — | Module exports the four names; no returned object contains a secret; `npm run typecheck` passes. |
| 2 | **Backend call sites** | `src/server/opencode.ts`, `src/server/brain.ts`, `src/server/llm.ts` | 1 | No `authHeader`/`env()` left in `opencode.ts`; `OpenCodeConfig` has no `password`; the five header sites use `openCodeAuthHeader()`; timeouts, cache TTL and error strings unchanged. |
| 3 | **UI flow** | `src/lib/types.ts`, `src/components/jarvis/Drawers.tsx`, `src/components/jarvis/TopBar.tsx`, `src/components/jarvis/SidePanels.tsx` | 1 (status shape) | The three states render distinctly; the API response and the DOM contain no secret; `brain.auth` absent for the "api" backend. |
| 4 | **Test gaps** | `src/server/auth.test.ts` (new), `src/server/opencode.test.ts` (new) | 1 (and 2 for the probe tests) | `npm test` green with the eight cases above; no test reads `.env` or a real credential. |

Ownership to avoid merge clashes: workstream 1 owns `src/server/auth.ts` **and** `src/server/auth.test.ts`; workstream 4 owns `src/server/opencode.test.ts` only and appends to `auth.test.ts` after 1 lands. Workstreams 2 and 3 can run in parallel once the shape in §2 is agreed; 3's type change (`src/lib/types.ts`) must not be edited by 2.

## 7. Phased rollout

**Phase 2 — backend (WS1 + WS2).** Acceptance: `src/server/auth.ts` exists with the four exports; `src/server/opencode.ts` no longer reads `OPENCODE_PASSWORD` or builds headers; the five request sites send byte-identical headers (asserted by unit test); probe path/method/timeout, 15 s cache, SSE transport, agent timeouts and all user-visible error strings unchanged; upstream bodies are redacted before reaching a client-facing string; `npm run typecheck && npm test && npm run lint` pass.
*Non-goals:* no new route, no DB column, no client changes, no env renaming, no username other than `opencode`.
*Risks:* splitting "config" from "probe" changes the meaning of `getOpenCodeConfig()` — all callers must move in the same commit; `OpenCodeRun.config` no longer carries a password, so no consumer may assume it does.

**Phase 3 — UI (WS3).** Acceptance: `BrainStatus.auth?` added as optional; the Configuration panel shows the three OpenCode states; TopBar and Systems reflect the OpenCode state when the backend is `opencode`; no password/hash/length/token appears in any API response or rendered DOM; the displayed URL is userinfo-stripped.
*Non-goals:* no UI to set the password (env-only by design); no "test connection" button that lets a browser probe an arbitrary URL (SSRF / credential-probing risk) — if wanted later it must hit a fixed server-side target.
*Risks:* `BrainStatus` ships in the client bundle, so a careless field would serialise a secret; the sanitised-URL rule must be enforced in `auth.ts`, not only in the component.

**Phase 4 — tests (WS4).** Acceptance: unit tests for header building, missing password, URL normalisation, redaction and "no network calls"; probe behaviour covered with a stubbed fetch; `npm test` green; no test reads `.env` or a real credential.
*Non-goals:* no end-to-end test against a live OpenCode server; no performance testing of the SSE bus.
*Risks:* `process.env` leakage between tests (restore in `afterEach`); flaky ordering if the 15 s cache is not reset between cases.

Overall constraint for all phases: the refactor is **behaviour-preserving**. The single intended divergence is redacting the upstream OpenCode response body at `src/server/opencode.ts:355`, which changes a user-visible error string in exchange for not echoing arbitrary upstream text to the chat UI.

## 8. Open decisions for the coordinator (before phase 2)

1. **Redaction is a visible change.** `opencode prompt failed (...)` will show `***` instead of the upstream body (`src/server/opencode.ts:355`). Accept, or keep the body and only redact the credential?
2. **Show the URL in the UI?** Recommended yes (sanitised). It makes "wrong host" diagnosable, but it is new information on screen.
3. **`missing-password` vs `not-configured`.** Both mean "no credential"; is the distinction worth a UI state, or collapse to one "not configured" state?
4. **Username.** `opencode` stays hard-coded (`src/server/opencode.ts:44`). Add `OPENCODE_USERNAME` now, or leave it?
5. **Probe freshness.** Keep the 15 s cache (`src/server/opencode.ts:35`), so "connected" can be up to 15 s stale? A manual refresh button would need a new route.
6. **Probe when the backend is `api`.** Today OpenCode is only probed for the `opencode` backend (`src/server/llm.ts:61-65`). Should the Configuration panel always show the OpenCode state, even when the API backend is selected?
7. **`/api/health`** stays DB-only (`src/app/api/health/route.ts:6-12`)? Adding auth state there would help monitoring but widens the surface.
