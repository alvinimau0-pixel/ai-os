import { NextRequest } from 'next/server';
import { listReminders, setReminderStatus } from './server/data';
import { runDueWorkflows } from './server/skills/routine';
import { getSettings } from './server/data';

// Prevent double registration in dev mode (HMR)
declare global {
  var jarvisSchedulerStarted: boolean | undefined;
}

function startScheduler() {
  if (globalThis.jarvisSchedulerStarted) return;
  globalThis.jarvisSchedulerStarted = true;

  console.log('[jarvis] Starting background scheduler...');

  // Server-side reminder firing: mark overdue reminders as fired even when no browser tab is open.
  const reminderInterval = setInterval(async () => {
    try {
      const now = new Date();
      const pending = await listReminders();
      for (const r of pending) {
        if (new Date(r.dueAt) <= now && r.status === "pending") {
          await setReminderStatus(r.id, "fired");
          console.log(`[scheduler] fired reminder #${r.id}: ${r.label}`);
        }
      }
    } catch (err) {
      console.error("[scheduler] reminder check failed:", err);
    }
  }, 30000); // every 30s

  // Workflow scheduler: run due workflows
  const workflowInterval = setInterval(async () => {
    try {
      const settings = await getSettings();
      await runDueWorkflows({ tz: "America/New_York", now: new Date(), settings });
    } catch (err) {
      console.error("[scheduler] workflow run failed:", err);
    }
  }, 60000); // every 60s

  // Cleanup on shutdown (best effort)
  process.on('SIGTERM', () => {
    clearInterval(reminderInterval);
    clearInterval(workflowInterval);
  });
  process.on('SIGINT', () => {
    clearInterval(reminderInterval);
    clearInterval(workflowInterval);
  });
}

export function register() {
  startScheduler();
}

// Optional: you can also run code on each request
export async function middleware(request: NextRequest) {
  // Nothing for now
}
