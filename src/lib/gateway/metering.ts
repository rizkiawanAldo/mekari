import { prisma } from "../prisma";

export interface MeteringRecordParams {
  tenantId: string;
  endpoint: string;
  model: string;
  fallbackFrom?: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  outcome: string;
  intent?: string | null;
  confidence?: number | null;
  retrievedDocs?: unknown;
  userQuery?: string;
  responseSnippet?: string;
}

export async function recordMeteredRequest(params: MeteringRecordParams) {
  try {
    return await prisma.request.create({
      data: {
        tenantId: params.tenantId,
        endpoint: params.endpoint,
        model: params.model,
        fallbackFrom: params.fallbackFrom || null,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: params.totalTokens,
        costUsd: params.costUsd,
        latencyMs: params.latencyMs,
        outcome: params.outcome,
        intent: params.intent || null,
        confidence: params.confidence || null,
        retrievedDocs: params.retrievedDocs ? JSON.stringify(params.retrievedDocs) : null,
        userQuery: params.userQuery ? params.userQuery.slice(0, 500) : null,
        responseSnippet: params.responseSnippet ? params.responseSnippet.slice(0, 500) : null,
      },
    });
  } catch (err) {
    console.error("Failed to record metering request in DB:", err);
  }
}

