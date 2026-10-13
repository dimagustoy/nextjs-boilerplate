import { timewebRequest } from "@/app/lib/timeweb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AppsResponse = {
  apps?: unknown[];
  meta?: unknown;
  [key: string]: unknown;
};

export async function GET() {
  if (!process.env.TIMEWEB_API_TOKEN) {
    return Response.json(
      { ok: false, configured: false, error: "TIMEWEB_API_TOKEN is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const data = await timewebRequest<AppsResponse>("/apps");
    const apps = Array.isArray(data.apps) ? data.apps : [];

    return Response.json(
      {
        ok: true,
        configured: true,
        provider: "timeweb-cloud",
        reachable: true,
        appsCount: apps.length,
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        provider: "timeweb-cloud",
        reachable: false,
        error: error instanceof Error ? error.message : "Unknown Timeweb API error",
        timestamp: new Date().toISOString(),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
