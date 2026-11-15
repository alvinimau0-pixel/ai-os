import { addTask, clearCompletedTasks, deleteTask, listTasks, updateTask } from "@/server/data";
import type { Priority } from "@/lib/types";

export const dynamic = "force-dynamic";

const PRIORITIES: Priority[] = ["low", "normal", "high"];

function parseDate(v: unknown): Date | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET() {
  return Response.json(await listTasks());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return Response.json({ error: "A title is required" }, { status: 400 });
  const priority = PRIORITIES.includes(body.priority) ? (body.priority as Priority) : "normal";
  const task = await addTask({ title, priority, dueAt: parseDate(body.dueAt) ?? null });
  return Response.json(task, { status: 201 });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required" }, { status: 400 });
  const task = await updateTask(id, {
    title: typeof body.title === "string" && body.title.trim() ? body.title : undefined,
    done: typeof body.done === "boolean" ? body.done : undefined,
    priority: PRIORITIES.includes(body.priority) ? (body.priority as Priority) : undefined,
    dueAt: parseDate(body.dueAt),
  });
  if (!task) return Response.json({ error: "Task not found" }, { status: 404 });
  return Response.json(task);
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("completed")) {
    return Response.json({ removed: await clearCompletedTasks() });
  }
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required" }, { status: 400 });
  const ok = await deleteTask(id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Task not found" }, { status: 404 });
}
