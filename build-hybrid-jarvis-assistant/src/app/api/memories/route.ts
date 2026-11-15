import { addMemory, deleteAllMemories, deleteMemory, listMemories } from "@/server/data";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listMemories());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) return Response.json({ error: "Memory content is required" }, { status: 400 });
  const { memory } = await addMemory(content);
  return Response.json(memory, { status: 201 });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("all")) return Response.json({ removed: await deleteAllMemories() });
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required" }, { status: 400 });
  const ok = await deleteMemory(id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Memory not found" }, { status: 404 });
}
