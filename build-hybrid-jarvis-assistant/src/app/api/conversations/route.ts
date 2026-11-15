import {
  createConversation,
  deleteAllConversations,
  deleteConversation,
  getConversation,
  getMessages,
  listConversations,
} from "@/server/data";

export const dynamic = "force-dynamic";

/** Without ?id → list of sessions. With ?id → that session's messages. */
export async function GET(req: Request) {
  const idParam = new URL(req.url).searchParams.get("id");
  if (idParam) {
    const id = Number(idParam);
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
    const conversation = await getConversation(id);
    if (!conversation) return Response.json({ error: "Session not found" }, { status: 404 });
    return Response.json({ conversation, messages: await getMessages(id) });
  }
  return Response.json(await listConversations());
}

export async function POST() {
  return Response.json(await createConversation(), { status: 201 });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("all")) return Response.json({ removed: await deleteAllConversations() });
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required" }, { status: 400 });
  const ok = await deleteConversation(id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Session not found" }, { status: 404 });
}
