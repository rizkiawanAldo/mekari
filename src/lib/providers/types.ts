export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderCallParams {
  messages: ProviderMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  timeoutMs?: number;
  simulateFailure?: boolean;
  simulateLatencyMs?: number;
}

export interface ProviderResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number;
  fellBackFrom?: string | null;
  error?: string | null;
}

