-- Bootstrap schema for JARVIS (matches src/db/schema.ts).
-- Run with: node scripts/db-init.mjs

create table if not exists settings (
  id integer primary key default 1,
  assistant_name text not null default 'JARVIS',
  user_name text not null default '',
  brain_mode text not null default 'hybrid',
  brain_backend text not null default 'api',
  voice_name text not null default '',
  voice_rate double precision not null default 1,
  voice_pitch double precision not null default 0.9,
  auto_speak boolean not null default true,
  wake_word text not null default 'jarvis',
  location text not null default '',
  units text not null default 'metric',
  personality text not null default 'classic',
  updated_at timestamptz not null default now()
);

create table if not exists conversations (
  id serial primary key,
  title text not null default 'New session',
  oc_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id serial primary key,
  conversation_id integer not null references conversations(id) on delete cascade,
  role text not null,
  content text not null,
  source text not null default 'local',
  skill text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at);

create table if not exists tasks (
  id serial primary key,
  title text not null,
  done boolean not null default false,
  priority text not null default 'normal',
  due_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists notes (
  id serial primary key,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists reminders (
  id serial primary key,
  label text not null,
  kind text not null default 'reminder',
  due_at timestamptz not null,
  duration_sec integer,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  fired_at timestamptz
);
create index if not exists reminders_status_due_idx on reminders (status, due_at);

create table if not exists memories (
  id serial primary key,
  content text not null,
  created_at timestamptz not null default now()
);

-- Phase 4: routines/workflows (trigger phrase and/or schedule).
create table if not exists workflows (
  id serial primary key,
  trigger text not null unique,
  prompt text not null,
  schedule text,
  enabled boolean not null default true,
  last_run timestamptz,
  created_at timestamptz not null default now()
);

-- Phase 4: external tool servers (MCP).
create table if not exists mcp_servers (
  id serial primary key,
  name text not null unique,
  transport text not null default 'stdio',
  command text,
  args jsonb,
  url text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
