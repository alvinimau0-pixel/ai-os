# Hybrid JARVIS Assistant

A Next.js-powered voice-first assistant with local LLM (Ollama) and OpenCode agent brain, running on Windows with embedded PostgreSQL.

## Architecture

- **Frontend**: Next.js (Turbopack) with flat near-black UI, cyan accent, no HUD scanlines/glows in main view.
- **Local Engine**: Ollama (`LLM_BASE_URL`) for fast streaming responses to simple commands.
- **Brain**: OpenCode full agent (via HTTP SSE) for open-ended reasoning, shell commands, and file editing — auto-escalates on explicit `ask the brain:` phrases, empty engine responses, or missing engine.
- **Data**: Embedded PostgreSQL 18.6 (native Windows scheduled task `JarvisPostgresDB` → `pg-start.cmd`).
- **Extensibility**: Skills (local), MCP tools (stdio + HTTP), and scheduled workflows/routines.

## Quick Start

### Prerequisites

- Node.js 20+
- Ollama installed and running with `OLLAMA_CONTEXT_LENGTH=4096`
- OpenCode agent running on `http://127.0.0.1:4096` (Basic auth: opencode / jarvis-brain-dev)
- PostgreSQL embedded service running (see DB setup below)

### Environment

Copy `.env.example` or create `.env`:

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/app_db"

# Local LLM (engine)
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=llama3.2

# OpenCode brain
OPENCODE_URL=http://127.0.0.1:4096
OPENCODE_PASSWORD=jarvis-brain-dev

# Optional: CALENDAR_ICS_URL=https://your-calendar.ics
# Optional: BRAVE_SEARCH_API_KEY=..., TAVILY_API_KEY=...
```

### DB Setup

The embedded PostgreSQL is launched via Windows scheduled task:

```powershell
# Start DB (runs pg-start.cmd as SYSTEM-ish task)
schtasks /run /tn JarvisPostgresDB
```

Or initialize schema manually:

```bash
npm run db:init
```

### Run

```bash
# Dev
npm run dev

# Build
npm run build
npm start
```

## Features

### Local Skills (instant, no cloud)

- **Reminders / Timers** — `remind me to ...`, `set timer 5m`
- **Tasks** — `add task ...`, `list tasks`
- **Notes** — `note ...`
- **Weather** — `weather in Paris`
- **Math / Units / Currency**
- **Dictionary / Wikipedia lookup**
- **Memory** — `remember ...`, `recall ...`
- **Preferences** — set timezone, units, assistant name

### Connection Skills (Phase 4)

- **Web Search** — `search the web for <query>` (Brave/Tavily key → DuckDuckGo fallback)
- **Translation** — `translate <text> to Spanish` (MyMemory API)
- **Calendar (ICS)** — `what's on my calendar` (requires `CALENDAR_ICS_URL`)

### Routines / Workflows

Create voice-triggered or scheduled routines:

```
create routine "morning brief" to give me a summary of my tasks and weather
```

Say the trigger phrase to run it, or set a cron schedule (e.g. `0 8 * * *` for 8 AM daily):

```
create routine "daily report" with schedule "0 8 * * *" to summarize yesterday's notes
```

List, run, or delete routines via chat or the MCP/data layer.

### MCP Tools

MCP servers are stored in the DB (`mcp_servers`). Two transports:

- **stdio**: spawn a process, JSON-RPC over stdin/stdout
- **http**: POST JSON-RPC, accept JSON or SSE stream

Tools are merged into the LLM function-calling list as `mcp__<server>__<tool>`.

Example: an MCP server exposing `search_code` becomes callable by the brain.

### Brain Routing

- **Local**: fast, offline, handles commands/timers/math locally.
- **Hybrid** (default): local for commands, cloud for open-ended.
- **Cloud**: everything through LLM (still uses tools).

Escalation to OpenCode agent happens on:
- Explicit `ask the brain:` prefix
- Empty or failed local engine response
- Missing local engine

OpenCode agent runs in its own session per conversation, streams tool use and text via SSE (raw `node:http` bypasses Next.js fetch buffering).

## API

Key endpoints:

- `POST /api/chat` — send a message, get streaming Server-Sent Events
- `GET /api/settings`, `PUT /api/settings` — user settings
- `GET /api/reminders`, `POST /api/reminders`, `PATCH /api/reminders/:id/status` — reminders
- `GET /api/workflows` — routines (CRUD via data module)
- `GET /api/mcp-servers` — MCP servers (CRUD via data module)

## Architecture Notes

### OpenCode SSE Fix

Next.js's patched `fetch` buffers the response body, breaking SSE. The `OpenCodeEventBus` uses raw `node:http.request` to stream events without buffering.

### Scheduler

`src/instrument.ts` registers a server-start hook that runs:
- Reminder firing (marks overdue reminders as fired) every 30s
- Workflow execution (runs due cron workflows) every 60s

Prevents double-start in dev via `globalThis.jarvisSchedulerStarted`.

### Tool Registry

`tools.ts` exports `getToolSpecs()` (async) to include MCP tools dynamically. `runTool` handles local tools and `mcp__*` passthrough.

### Database

Drizzle ORM with embedded PostgreSQL. Tables: conversations, messages, reminders, tasks, notes, memories, workflows, mcp_servers.

## Files of Interest

- `src/server/opencode.ts` — OpenCode adapter with raw HTTP SSE bus
- `src/server/brain.ts` — hybrid routing, escalation, cloud + OpenCode execution
- `src/server/tools.ts` — tool registry + MCP passthrough
- `src/server/skills/` — local skills (connect.ts: search/translate/calendar; routine.ts: workflows)
- `src/server/mcp.ts` — MCP stdio + HTTP client
- `src/instrument.ts` — server-side scheduler (reminders + workflows)
- `src/components/jarvis/Drawers.tsx` — Settings UI (brain backend picker)

## Performance

On low-memory machines (~0.5 GB free), model inference can be slow (60–120s). Increase timeouts if needed:

- `idleMs` (default 90s): abort if no event arrives
- `totalMs` (default 240s): hard ceiling per run

## License

MIT
