import { searchKnowledgeBase, SearchResultItem } from "./kb";
import { routeRequest, RoutingOptions } from "../router";

export interface SupportAssistantInput {
  query: string;
  preferredBackend?: "auto" | "groq" | "gemini" | "mock";
  simulatePrimaryFailure?: boolean;
}

export interface SupportAssistantResult {
  answer: string;
  intent: string;
  confidence: number;
  retrievedDocs: SearchResultItem[];
  model: string;
  fellBackFrom: string | null;
  routingReason: string;
  latencyMs: number;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  outcome: "success" | "fallback_success" | "refused" | "error";
}

const CONFIDENCE_REFUSAL_THRESHOLD = 0.35;

export async function processSupportAssistant(
  input: SupportAssistantInput
): Promise<SupportAssistantResult> {
  const { query, preferredBackend, simulatePrimaryFailure } = input;

  // 1. Retrieval over Bitext Knowledge Base slice
  const { results, confidence, dominantIntent } = searchKnowledgeBase(query, 3);

  // 2. Low-confidence Refusal Check (Hallucination Defense)
  if (confidence < CONFIDENCE_REFUSAL_THRESHOLD || results.length === 0) {
    return {
      answer:
        "I apologize, but I could not find relevant information in our customer support knowledge base to assist with your request. For specialized support, please specify your order or account inquiry, or contact our support team at support@mekari.com.",
      intent: "out_of_scope_or_low_confidence",
      confidence,
      retrievedDocs: results,
      model: "system-guardrail",
      fellBackFrom: null,
      routingReason: `Refused: Confidence score (${confidence.toFixed(2)}) is below safety threshold (${CONFIDENCE_REFUSAL_THRESHOLD})`,
      latencyMs: 12,
      costUsd: 0.0,
      promptTokens: Math.round(query.length / 4),
      completionTokens: 35,
      totalTokens: Math.round(query.length / 4) + 35,
      outcome: "refused",
    };
  }

  // 3. Construct Grounded Prompt for Router
  const contextSnippet = results
    .map(
      (r, idx) =>
        `[Document ${idx + 1}] (Intent: ${r.intent}, Category: ${r.category})\nUser Query: ${r.query}\nOfficial Policy Response: ${r.answer}`
    )
    .join("\n\n");

  const systemPrompt = `You are Mekari's expert AI Customer Support Assistant.
Answer the user's inquiry accurately and politely, strictly relying on the provided knowledge base documents.

Knowledge Base Context:
${contextSnippet}

Instructions:
1. Provide a direct, professional, and helpful customer answer based on the context.
2. Identify the most accurate intent from the knowledge base documents (e.g. ${dominantIntent}).
3. Return your final answer formatted strictly as a JSON object:
{
  "intent": "${dominantIntent || "support_inquiry"}",
  "answer": "<Your polished, friendly response here>"
}`;

  const routingOptions: RoutingOptions = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ],
    preferredBackend,
    simulatePrimaryFailure,
    temperature: 0.1,
  };

  // 4. Execute routed LLM request with automatic fallback
  const routerOutput = await routeRequest(routingOptions);

  // 5. Parse Output & Handle Unusable/Degraded Output
  let finalAnswer = "";
  let finalIntent = dominantIntent || "general_support";

  try {
    const rawText = routerOutput.text.trim();
    // Clean potential markdown code blocks
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.answer && typeof parsed.answer === "string") {
        finalAnswer = parsed.answer.trim();
      }
      if (parsed.intent && typeof parsed.intent === "string") {
        finalIntent = parsed.intent.trim();
      }
    } else {
      finalAnswer = rawText;
    }
  } catch (err) {
    console.warn("Failed to parse JSON response from LLM, falling back to raw output", err);
    finalAnswer = routerOutput.text || results[0].answer;
  }

  // Fallback if LLM output was completely empty or unusable
  if (!finalAnswer || finalAnswer.length < 5) {
    console.warn("Model output was unusable. Refusing or falling back to verified knowledge base entry.");
    finalAnswer = results[0]?.answer || "Thank you for contacting Mekari. Your request is being addressed by our team.";
  }

  const outcome = routerOutput.fellBackFrom ? "fallback_success" : "success";

  return {
    answer: finalAnswer,
    intent: finalIntent,
    confidence,
    retrievedDocs: results,
    model: routerOutput.model,
    fellBackFrom: routerOutput.fellBackFrom || null,
    routingReason: routerOutput.routingReason,
    latencyMs: routerOutput.latencyMs,
    costUsd: routerOutput.costUsd,
    promptTokens: routerOutput.promptTokens,
    completionTokens: routerOutput.completionTokens,
    totalTokens: routerOutput.totalTokens,
    outcome,
  };
}
