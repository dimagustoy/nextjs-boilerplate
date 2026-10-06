const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

/**
 * Server-only transport for Vercel AI Gateway.
 * On Vercel, VERCEL_OIDC_TOKEN is injected automatically and avoids a long-lived AI secret.
 * AI_GATEWAY_API_KEY remains supported for local/dev use.
 */
export function aiGatewayToken(): string | null {
  return process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY || null;
}

export function aiGatewayAvailable(): boolean {
  return Boolean(aiGatewayToken());
}

export async function gatewayResponse(body: Record<string, unknown>, timeoutMs = 12000): Promise<any | null> {
  const token = aiGatewayToken();
  if (!token) return null;

  try {
    const response = await fetch(`${GATEWAY_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("AI Gateway request failed", response.status, await response.text().catch(() => ""));
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error("AI Gateway request error", error);
    return null;
  }
}
