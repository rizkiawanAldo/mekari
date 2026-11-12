import { ProviderCallParams, ProviderResult } from "./types";
import { calculateCost } from "../cost";

export async function callMockModel(
  params: ProviderCallParams,
  modelName: string = "mock-llama-3.1"
): Promise<ProviderResult> {
  const startTime = Date.now();

  // If simulateFailure is enabled, simulate a provider crash / 503 service unavailable
  if (params.simulateFailure) {
    if (params.simulateLatencyMs) {
      await new Promise((resolve) => setTimeout(resolve, params.simulateLatencyMs));
    }
    throw new Error(`[MockBackendError 503] Backend '${modelName}' is temporarily overloaded or unavailable`);
  }

  // Artificial latency for realism or test timeout
  const latency = params.simulateLatencyMs ?? (modelName.includes("gemini") ? 380 : 160);
  await new Promise((resolve) => setTimeout(resolve, latency));

  const userMsg = params.messages.find((m) => m.role === "user")?.content || "";
  const systemMsg = params.messages.find((m) => m.role === "system")?.content || "";

  // Approximate token counts (~4 chars per token)
  const promptChars = params.messages.reduce((acc, m) => acc + m.content.length, 0);
  const promptTokens = Math.max(1, Math.round(promptChars / 4));

  let generatedText = "";

  // Extract dominant intent from system prompt context
  let detectedIntent = "customer_support";
  const intentMatch = systemMsg.match(/\(e\.g\.\s*([^)]+)\)/) || systemMsg.match(/Intent:\s*([a-zA-Z0-9_]+)/);
  if (intentMatch) {
    detectedIntent = intentMatch[1].trim();
  }

  // Extract grounded policy response from retrieved documents in system prompt
  let groundedAnswer =
    "Thank you for contacting Mekari customer support. We have verified your request against our policy guidelines and are pleased to assist you.";
  const docMatch = systemMsg.match(/Official Policy Response:\s*([\s\S]*?)(?=\n\n\[Document|\n\nInstructions:|$)/);
  if (docMatch && docMatch[1].trim()) {
    const rawPolicy = docMatch[1].trim();
    if (modelName.includes("gemini")) {
      // Gemini Tier: adds polite framing & clear next steps
      groundedAnswer = `Hello! Thank you for contacting Mekari Support.\n\n${rawPolicy}\n\nIf you need any further assistance, our team is always glad to help!`;
    } else {
      // Llama Tier: direct, concise grounded answer
      groundedAnswer = rawPolicy;
    }
  }

  // Check if system message requests JSON with intent and answer
  if (systemMsg.includes("JSON") || systemMsg.includes("intent")) {
    generatedText = JSON.stringify(
      {
        intent: detectedIntent,
        answer: groundedAnswer,
        confidence: 0.94,
      },
      null,
      2
    );
  } else {
    generatedText = `Regarding your inquiry ("${userMsg.slice(0, 50)}..."): ${groundedAnswer}`;
  }

  const completionTokens = Math.max(1, Math.round(generatedText.length / 4));
  const totalTokens = promptTokens + completionTokens;
  const latencyMs = Date.now() - startTime;
  const costUsd = calculateCost(modelName, promptTokens, completionTokens);

  return {
    text: generatedText,
    model: modelName,
    promptTokens,
    completionTokens,
    totalTokens,
    latencyMs,
    costUsd,
    fellBackFrom: null,
  };
}
