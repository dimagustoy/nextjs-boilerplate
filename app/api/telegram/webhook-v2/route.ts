import { POST as v4Post } from "../webhook-v4/route";
import { POST as legacyPost } from "../webhook-v2-legacy/route";

export async function POST(request: Request): Promise<Response> {
  const internalFallback = request.headers.get("x-jarvis-source") === "webhook-v2";
  const pathname = new URL(request.url).pathname;
  if (internalFallback || pathname.includes("/api/telegram/webhook-v3")) {
    return legacyPost(request);
  }

  const headers = new Headers(request.headers);
  headers.set("x-jarvis-source", "webhook-v2");
  return v4Post(new Request(request, { headers }));
}
