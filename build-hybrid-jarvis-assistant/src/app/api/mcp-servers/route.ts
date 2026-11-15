import { addMcpServer, deleteMcpServer, listMcpServers, setMcpServerEnabled } from "@/server/data";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listMcpServers());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  const transport = body?.transport === "http" ? "http" : "stdio";
  const command = typeof body?.command === "string" ? body.command : undefined;
  const args = Array.isArray(body?.args) ? body.args.filter((a: unknown): a is string => typeof a === "string") : undefined;
  const url = typeof body?.url === "string" ? body.url : undefined;
  try {
    const server = await addMcpServer({ name, transport, command, args, url });
    return Response.json(server, { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not add the MCP server" }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required" }, { status: 400 });
  if (typeof body?.enabled !== "boolean") return Response.json({ error: "An enabled flag is required" }, { status: 400 });
  const ok = await setMcpServerEnabled(id, body.enabled);
  if (!ok) return Response.json({ error: "MCP server not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required" }, { status: 400 });
  const ok = await deleteMcpServer(id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "MCP server not found" }, { status: 404 });
}
