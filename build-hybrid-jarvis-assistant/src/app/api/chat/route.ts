import { think } from "@/server/brain";
import { addMessage, createConversation, getConversation, renameConversation } from "@/server/data";
import { safeTz } from "@/server/timeutil";
import type { StreamEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function titleFrom(message: string): string {
  const t = message.replace(/\s+/g, " ").trim();
  const cut = t.length > 48 ? `${t.slice(0, 47)}…` : t;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

export async function POST(req: Request) {
  let body: { message?: unknown; conversationId?: unknown; timeZone?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!message) return Response.json({ error: "A message is required" }, { status: 400 });
  const tz = safeTz(typeof body.timeZone === "string" ? body.timeZone : undefined);

  const requestedId = Number(body.conversationId);
  let convo = Number.isInteger(requestedId) && requestedId > 0 ? await getConversation(requestedId) : null;
  if (!convo) {
    convo = await createConversation(titleFrom(message));
  } else if (convo.title === "New session") {
    convo = { ...convo, title: titleFrom(message) };
    await renameConversation(convo.id, convo.title);
  }
  const conversationId = convo.id;
  const title = convo.title;
  await addMessage({ conversationId, role: "user", content: message });

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      let text = "";
      let route: "local" | "cloud" = "local";
      let skill: string | null = null;
      let model: string | undefined;
      let failed: string | null = null;

      try {
        for await (const ev of think({ message, conversationId, tz, signal: abort.signal })) {
          if (ev.type === "start") {
            route = ev.route;
            model = ev.route === "cloud" ? ev.model : undefined;
          } else if (ev.type === "skill") skill = ev.name;
          else if (ev.type === "delta") text += ev.text;
          send(ev);
        }
      } catch (err) {
        failed = err instanceof Error ? err.message : "Unexpected error";
        console.error("[chat]", failed);
        send({ type: "error", message: "Something went wrong while processing that request." });
      }

      try {
        let messageId = 0;
        if (text.trim()) {
          messageId = await addMessage({ conversationId, role: "assistant", content: text.trim(), source: route, skill, model });
        }
        send({ type: "done", messageId, route, skill, model, conversationId, title });
      } catch (err) {
        console.error("[chat:persist]", err);
      }
      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
