import { telegram } from "./telegram";

export async function transcribeTelegramAudio(fileId: string, durationSeconds?: number, fileSize?: number) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!openaiKey || !telegramToken) throw new Error("Voice transcription is not configured");
  if (!fileId) throw new Error("Voice file missing");
  if (durationSeconds && durationSeconds > 600) throw new Error("Voice message is too long");
  if (fileSize && fileSize > 20 * 1024 * 1024) throw new Error("Voice file is too large");

  const info = await telegram("getFile", { file_id: fileId }) as { file_path?: string };
  if (!info?.file_path || info.file_path.includes("..")) throw new Error("Voice file unavailable");

  const source = await fetch(`https://api.telegram.org/file/bot${telegramToken}/${info.file_path}`, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!source.ok) throw new Error("Voice download failed");
  const audio = await source.blob();
  if (audio.size > 20 * 1024 * 1024) throw new Error("Voice file is too large");

  const form = new FormData();
  const extension = info.file_path.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "ogg";
  form.append("file", audio, `voice.${extension}`);
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  form.append("language", "ru");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(45000),
    cache: "no-store",
  });
  if (!response.ok) {
    console.error("Jarvis transcription failed", { status: response.status });
    throw new Error("Voice transcription failed");
  }
  const data = await response.json() as { text?: string };
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) throw new Error("Voice transcription empty");
  return text.slice(0, 8000);
}
