import { addNote, deleteNote, listNotes } from "@/server/data";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listNotes());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) return Response.json({ error: "Note content is required" }, { status: 400 });
  return Response.json(await addNote(content), { status: 201 });
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required" }, { status: 400 });
  const ok = await deleteNote(id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Note not found" }, { status: 404 });
}
