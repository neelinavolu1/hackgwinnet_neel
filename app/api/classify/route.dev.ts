import { handleClassify } from "@/lib/handler";

// `next dev` only (see pageExtensions in next.config.ts). Static export rejects POST routes, so
// production uses functions/api/classify.ts on Cloudflare Pages. Both call the same handler.
export const POST = async (req: Request) => handleClassify(await req.json().catch(() => null), process.env);
