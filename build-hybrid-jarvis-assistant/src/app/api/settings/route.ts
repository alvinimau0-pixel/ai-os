import { getSettings, sanitizeSettings, updateSettings } from "@/server/data";
import { getBrainStatus } from "@/server/llm";
import { SKILLS } from "@/server/skills";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return Response.json({ settings, brain: await getBrainStatus(SKILLS.length, settings) });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid body" }, { status: 400 });
  const patch = sanitizeSettings(body as Record<string, unknown>);
  const settings = await updateSettings(patch);
  return Response.json({ settings, brain: await getBrainStatus(SKILLS.length, settings) });
}
