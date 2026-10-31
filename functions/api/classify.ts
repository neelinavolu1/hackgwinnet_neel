import { handleClassify } from "../../lib/handler";
import type { ClientEnv } from "../../lib/jev";

// Cloudflare Pages Function: serves POST /api/classify in production.
export const onRequestPost = async ({ request, env }: { request: Request; env: ClientEnv }) =>
  handleClassify(await request.json().catch(() => null), env);
