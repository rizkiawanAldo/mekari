import { prisma } from "../prisma";
import { Tenant } from "@prisma/client";

export interface AuthSuccess {
  authorized: true;
  tenant: Tenant;
}

export interface AuthFailure {
  authorized: false;
  statusCode: number;
  error: string;
  tenant?: Tenant;
}

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Validates the tenant API key and strictly enforces quota that fails closed.
 */
export async function authenticateAndCheckQuota(apiKeyHeader: string | null): Promise<AuthResult> {
  if (!apiKeyHeader) {
    return {
      authorized: false,
      statusCode: 401,
      error: "Missing API Key. Please provide 'x-api-key' header or 'Authorization: Bearer <key>'.",
    };
  }

  const cleanKey = apiKeyHeader.replace(/^Bearer\s+/i, "").trim();

  const tenant = await prisma.tenant.findUnique({
    where: { apiKey: cleanKey },
  });

  if (!tenant) {
    return {
      authorized: false,
      statusCode: 401,
      error: "Unauthorized: Invalid API key provided.",
    };
  }

  // Enforce quota: Fail-closed verification
  if (tenant.usedRequests >= tenant.quotaRequests) {
    // Record rejected request in metering table
    await prisma.request.create({
      data: {
        tenantId: tenant.id,
        endpoint: "/api/chat",
        model: "none",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0.0,
        latencyMs: 1,
        outcome: "quota_exceeded",
        userQuery: "Blocked by Quota Guardrail",
        responseSnippet: "429 Quota Exceeded",
      },
    });

    return {
      authorized: false,
      statusCode: 429,
      error: `Quota Exceeded: Tenant '${tenant.name}' has exhausted its quota (${tenant.usedRequests}/${tenant.quotaRequests} requests used). Request rejected.`,
      tenant,
    };
  }

  return {
    authorized: true,
    tenant,
  };
}

/**
 * Atomically increments the tenant's consumed request counter.
 * Call this only after the request has passed validation, so malformed
 * requests (HTTP 400) do not silently consume quota.
 */
export async function consumeQuota(tenantId: string): Promise<Tenant> {
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { usedRequests: { increment: 1 } },
  });
}

