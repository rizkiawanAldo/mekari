import { ProviderCallParams, ProviderResult } from "./types";
import { calculateCost } from "../cost";
import { callMockModel } from "./mock";

export async function callDeepSeek(
  params: ProviderCallParams,
  model: string = "deepseek-chat"
): Promise<ProviderResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  // If simulate failure requested for demo/testing
  if (params.simulateFailure) {
    throw new Error(`[DeepSeek 500] Simulated Primary Backend Outage (Demonstrating Failover)`);
  }

  // If no API key configured, use high-fidelity mock model
  if (!apiKey) {
    return callMockModel(params, "mock-deepseek-chat");
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs || 8000);

  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: params.messages,
        temperature: params.temperature ?? 0.2,
        max_tokens: params.maxTokens ?? 512,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DeepSeek API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const promptTokens = data.usage?.prompt_tokens || 20;
    const completionTokens = data.usage?.completion_tokens || 30;
    const totalTokens = promptTokens + completionTokens;
    const latencyMs = Date.now() - startTime;
    const costUsd = calculateCost(model, promptTokens, completionTokens);

    return {
      text,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs,
      costUsd,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes("abort")) {
      throw new Error(`DeepSeek timeout exceeded (${params.timeoutMs || 8000}ms)`);
    }
    throw err;
  }
}

