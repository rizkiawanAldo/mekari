import { ProviderCallParams, ProviderResult } from "./providers/types";
import { callGroq } from "./providers/groq";
import { callGemini } from "./providers/gemini";
import { callMockModel } from "./providers/mock";

export interface RoutingOptions extends ProviderCallParams {
  preferredBackend?: "auto" | "groq" | "gemini" | "mock";
  simulatePrimaryFailure?: boolean;
  primaryTimeoutMs?: number;
}

export interface RouterOutput extends ProviderResult {
  routingReason: string;
}

/**
 * Defensible Routing Engine:
 * - Primary: Groq (llama-3.1-8b-instant) for lowest latency (<400ms) and minimal cost.
 * - Secondary / Fallback: Gemini (gemini-1.5-flash) or Mock when primary fails or times out.
 * - Observable: inspects and captures exact failure reasons when fallback triggers.
 */
export async function routeRequest(options: RoutingOptions): Promise<RouterOutput> {
  const primaryTimeout = options.primaryTimeoutMs || 3000;
  const preferred = options.preferredBackend || "auto";

  // If user explicitly requests gemini
  if (preferred === "gemini") {
    const res = await callGemini(options);
    return {
      ...res,
      routingReason: "Direct routing to Gemini 1.5 Flash (user requested quality tier)",
    };
  }

  // If user explicitly requests mock
  if (preferred === "mock") {
    const res = await callMockModel(options, "mock-llama-3.1");
    return {
      ...res,
      routingReason: "Direct routing to Mock Backend",
    };
  }

  // Default Auto-Routing: Try Primary first (Groq Llama 3.1)
  const primaryParams: ProviderCallParams = {
    ...options,
    timeoutMs: primaryTimeout,
    simulateFailure: options.simulatePrimaryFailure,
  };

  try {
    const res = await callGroq(primaryParams);
    return {
      ...res,
      routingReason: "Primary backend served request (optimal speed & cost tier)",
      fellBackFrom: null,
    };
  } catch (primaryError: unknown) {
    const errorReason = primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.warn(`[Router Alert] Primary backend failed: ${errorReason}. Triggering fallback to Secondary...`);

    // Trigger Secondary / Fallback backend
    const fallbackStartTime = Date.now();
    try {
      const fallbackRes = await callGemini({
        ...options,
        timeoutMs: 6000,
        simulateFailure: false, // fallback should succeed
      });

      const totalLatency = primaryTimeout + (Date.now() - fallbackStartTime);

      return {
        ...fallbackRes,
        latencyMs: totalLatency,
        fellBackFrom: `Primary (llama-3.1): ${errorReason}`,
        routingReason: `Fallback triggered: primary failed (${errorReason}) -> switched to secondary (${fallbackRes.model})`,
      };
    } catch (fallbackError: unknown) {
      // Emergency Mock fallback to avoid total 500 outage
      const mockRes = await callMockModel(options, "mock-emergency-fallback");
      return {
        ...mockRes,
        fellBackFrom: `Primary & Secondary failed: ${errorReason}`,
        routingReason: "Emergency fallback served request after dual provider failures",
      };
    }
  }
}
