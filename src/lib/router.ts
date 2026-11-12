import { ProviderCallParams, ProviderResult } from "./providers/types";
import { callGroq } from "./providers/groq";
import { callGemini } from "./providers/gemini";
import { callDeepSeek } from "./providers/deepseek";
import { callMockModel } from "./providers/mock";

export interface RoutingOptions extends ProviderCallParams {
  preferredBackend?: "auto" | "deepseek" | "groq" | "gemini" | "mock";
  simulatePrimaryFailure?: boolean;
  primaryTimeoutMs?: number;
}

export interface RouterOutput extends ProviderResult {
  routingReason: string;
}

/**
 * Defensible Routing Engine:
 * - Direct: User can target DeepSeek, Groq, Gemini, or Mock directly.
 * - Auto-Routing:
 *   - Primary: Groq (llama-3.1-8b) if available, or DeepSeek (deepseek-chat) if DEEPSEEK_API_KEY is present.
 *   - Secondary / Fallback: Gemini (gemini-1.5-flash) or DeepSeek on failure/timeout.
 *   - Observable: Captures exact failure reason in fellBackFrom.
 */
export async function routeRequest(options: RoutingOptions): Promise<RouterOutput> {
  const primaryTimeout = options.primaryTimeoutMs || 3500;
  const preferred = options.preferredBackend || "auto";

  // 1. Direct Model Preferences
  if (preferred === "deepseek") {
    const res = await callDeepSeek(options);
    return {
      ...res,
      routingReason: "Direct routing to DeepSeek API (deepseek-chat)",
    };
  }

  if (preferred === "gemini") {
    const res = await callGemini(options);
    return {
      ...res,
      routingReason: "Direct routing to Google Gemini 1.5 Flash",
    };
  }

  if (preferred === "groq") {
    const res = await callGroq(options);
    return {
      ...res,
      routingReason: "Direct routing to Groq (Llama 3.1 8B Instant)",
    };
  }

  if (preferred === "mock") {
    const res = await callMockModel(options, "mock-llama-3.1");
    return {
      ...res,
      routingReason: "Direct routing to Mock Backend",
    };
  }

  // 2. Auto-Routing Decision Matrix
  // If user provided DEEPSEEK_API_KEY and no GROQ_API_KEY, use DeepSeek as primary!
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);

  let primaryFn = callGroq;
  let primaryName = "llama-3.1-8b-instant (Groq)";

  if (hasDeepSeek && !hasGroq) {
    primaryFn = (p) => callDeepSeek(p, "deepseek-chat");
    primaryName = "deepseek-chat (DeepSeek)";
  }

  const primaryParams: ProviderCallParams = {
    ...options,
    timeoutMs: primaryTimeout,
    simulateFailure: options.simulatePrimaryFailure,
  };

  const primaryStartTime = Date.now();

  try {
    const res = await primaryFn(primaryParams);
    return {
      ...res,
      routingReason: `Primary backend served request (${primaryName})`,
      fellBackFrom: null,
    };
  } catch (primaryError: unknown) {
    const errorReason = primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.warn(`[Router Alert] Primary (${primaryName}) failed: ${errorReason}. Triggering fallback...`);

    try {
      // Pick fallback: DeepSeek if Groq was primary, or Gemini
      let fallbackRes: ProviderResult;
      if (hasDeepSeek && primaryName.includes("Groq")) {
        fallbackRes = await callDeepSeek({ ...options, timeoutMs: 7000, simulateFailure: false });
      } else {
        fallbackRes = await callGemini({ ...options, timeoutMs: 6000, simulateFailure: false });
      }

      // Total wall-clock time from primary attempt start to fallback completion.
      const totalLatency = Date.now() - primaryStartTime;

      return {
        ...fallbackRes,
        latencyMs: totalLatency,
        fellBackFrom: `Primary (${primaryName}): ${errorReason}`,
        routingReason: `Fallback triggered: ${primaryName} failed (${errorReason}) -> switched to fallback (${fallbackRes.model})`,
      };
    } catch {
      // Emergency Mock fallback to maintain 100% uptime
      const mockRes = await callMockModel(options, "mock-emergency-fallback");
      return {
        ...mockRes,
        fellBackFrom: `Primary & Secondary failed: ${errorReason}`,
        routingReason: "Emergency fallback served request after provider outages",
      };
    }
  }
}
