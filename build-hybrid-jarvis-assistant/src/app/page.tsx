import JarvisApp from "@/components/jarvis/JarvisApp";
import { getSettings, loadBootstrap } from "@/server/data";
import { getBrainStatus } from "@/server/llm";
import { SKILLS } from "@/server/skills";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const settings = await getSettings();
  const data = await loadBootstrap(await getBrainStatus(SKILLS.length, settings));
  return <JarvisApp initial={data} />;
}
