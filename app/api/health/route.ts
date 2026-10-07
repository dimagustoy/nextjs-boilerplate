export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "nu-os",
      environment: process.env.NU_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      jarvisAiConfigured: Boolean(process.env.OPENAI_API_KEY),
      jarvisModel: process.env.OPENAI_MODEL || "gpt-6-luna",
      jarvisVersion: 3,
      jarvisCapabilities: {
        taskActions: true,
        batchActions: true,
        teamManagement: true,
        projects: true,
        recurringRules: true,
        dependencies: true,
        checklists: true,
        deadlineApprovals: true,
        groupChats: true,
        replyContext: true,
        voice: Boolean(process.env.OPENAI_API_KEY && process.env.TELEGRAM_BOT_TOKEN),
        optimisticLocking: true,
      },
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
