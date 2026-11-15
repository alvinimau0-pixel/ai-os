import { addReminder, deleteReminder, listReminders, setReminderStatus } from "@/server/data";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listReminders());
}

/** Create a reminder (dueAt ISO string) or a timer (durationSec). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kind = body?.kind === "timer" ? "timer" : "reminder";
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  let dueAt: Date | null = null;
  let durationSec: number | null = null;

  if (typeof body?.durationSec === "number" && body.durationSec >= 1 && body.durationSec <= 60 * 60 * 24 * 30) {
    durationSec = Math.round(body.durationSec);
    dueAt = new Date(Date.now() + durationSec * 1000);
  } else if (typeof body?.dueAt === "string") {
    const d = new Date(body.dueAt);
    if (!Number.isNaN(d.getTime())) dueAt = d;
  }
  if (!dueAt) return Response.json({ error: "Provide durationSec or a valid dueAt" }, { status: 400 });
  if (dueAt.getTime() <= Date.now()) return Response.json({ error: "The time must be in the future" }, { status: 400 });
  if (kind === "reminder" && !label) return Response.json({ error: "A label is required" }, { status: 400 });

  const r = await addReminder({ label: label || "Timer", kind, dueAt, durationSec });
  return Response.json(r, { status: 201 });
}

/** Transition a reminder to "fired" (only if still pending) or "dismissed". */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  const status = body?.status;
  if (!Number.isInteger(id) || (status !== "fired" && status !== "dismissed")) {
    return Response.json({ error: "id and status (fired|dismissed) are required" }, { status: 400 });
  }
  const result = await setReminderStatus(id, status);
  return Response.json(result);
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required" }, { status: 400 });
  const ok = await deleteReminder(id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Reminder not found" }, { status: 404 });
}
