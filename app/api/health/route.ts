export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "nu-os",
      environment: process.env.NU_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      jarvisAiConfigured: Boolean(process.env.OPENAI_API_KEY),
      jarvisModel: process.env.OPENAI_MODEL || "gpt-6-luna",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
