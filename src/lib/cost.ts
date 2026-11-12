/**
 * Pricing rates per 1,000,000 tokens (USD)
 */
export const MODEL_PRICING: Record<string, { promptPerM: number; completionPerM: number }> = {
  "deepseek-chat": {
    promptPerM: 0.14,
    completionPerM: 0.28,
  },
  "deepseek-reasoner": {
    promptPerM: 0.55,
    completionPerM: 2.19,
  },
  "mock-deepseek-chat": {
    promptPerM: 0.14,
    completionPerM: 0.28,
  },
  "llama-3.1-8b-instant": {
    promptPerM: 0.05,
    completionPerM: 0.08,
  },
  "llama-3.3-70b-versatile": {
    promptPerM: 0.59,
    completionPerM: 0.79,
  },
  "gemini-1.5-flash": {
    promptPerM: 0.075,
    completionPerM: 0.30,
  },
  "gemini-1.5-pro": {
    promptPerM: 1.25,
    completionPerM: 5.00,
  },
  "mock-llama-3.1": {
    promptPerM: 0.05,
    completionPerM: 0.08,
  },
  "mock-gemini-flash": {
    promptPerM: 0.075,
    completionPerM: 0.30,
  },
  // Emergency mock fallback: priced like the cheap primary tier.
  "mock-emergency-fallback": {
    promptPerM: 0.05,
    completionPerM: 0.08,
  },
};

/**
 * Calculates estimated USD cost for a given model and token count.
 */
export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] || { promptPerM: 0.14, completionPerM: 0.28 };
  const promptCost = (promptTokens / 1_000_000) * pricing.promptPerM;
  const completionCost = (completionTokens / 1_000_000) * pricing.completionPerM;
  return Number((promptCost + completionCost).toFixed(7));
}
