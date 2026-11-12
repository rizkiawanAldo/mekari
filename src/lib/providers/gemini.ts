import { ProviderCallParams, ProviderResult } from "./types";
import { calculateCost } from "../cost";
import { callMockModel } from "./mock";

export async function callGemini(params: ProviderCallParams): Promise<ProviderResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = "gemini-1.5-flash";

  // If no API key configured, use high-fidelity secondary mock
  if (!apiKey) {
    return callMockModel(params, "gemini-1.5-flash");
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs || 6000);

  try {
    const systemInstruction = params.messages.find((m) => m.role === "system")?.content;
    const conversation = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents: conversation,
      generationConfig: {
        temperature: params.temperature ?? 0.2,
        maxOutputTokens: params.maxTokens ?? 512,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || "";

    const promptTokens = data.usageMetadata?.promptTokenCount || 20;
    const completionTokens = data.usageMetadata?.candidatesTokenCount || 25;
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
      throw new Error(`Gemini Fallback timeout exceeded (${params.timeoutMs || 6000}ms)`);
    }
    throw err;
  }
}

