import { addWorkflow, deleteWorkflow, listWorkflows, setWorkflowEnabled } from "@/server/data";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listWorkflows());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const trigger = typeof body?.trigger === "string" ? body.trigger : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!trigger.trim() || !prompt.trim()) {
    return Response.json({ error: "Both a trigger phrase and a prompt are required" }, { status: 400 });
  }
  const schedule = typeof body?.schedule === "string" && body.schedule.trim() ? body.schedule : undefined;
  try {
    const workflow = await addWorkflow({ trigger, prompt, schedule });
    return Response.json(workflow, { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not create the routine" }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required" }, { status: 400 });
  if (typeof body?.enabled !== "boolean") return Response.json({ error: "An enabled flag is required" }, { status: 400 });
  const ok = await setWorkflowEnabled(id, body.enabled);
  if (!ok) return Response.json({ error: "Routine not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required" }, { status: 400 });
  const ok = await deleteWorkflow(id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Routine not found" }, { status: 404 });
}
