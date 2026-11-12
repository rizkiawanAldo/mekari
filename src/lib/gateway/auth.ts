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
}

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Validates the tenant API key. Fails closed: missing or unknown keys return
 * 401 without revealing which keys exist.
 */
export async function authenticateTenant(apiKeyHeader: string | null): Promise<AuthResult> {
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

  return {
    authorized: true,
    tenant,
  };
}

export type QuotaReservation = { reserved: true; tenant: Tenant } | { reserved: false };

/**
 * Atomically consumes one quota unit, only if the tenant still has headroom.
 * The check-and-increment happen in a single SQL UPDATE so concurrent requests
 * cannot collectively exceed the tenant's quota.
 *
 * On exhaustion a rejected request is recorded in the metering table for audit.
 */
export async function reserveQuota(tenantId: string): Promise<QuotaReservation> {
  const updated = await prisma.$executeRaw`
    UPDATE "Tenant"
    SET "usedRequests" = "usedRequests" + 1
    WHERE "id" = ${tenantId} AND "usedRequests" < "quotaRequests"
  `;

  if (updated === 0) {
    await prisma.request.create({
      data: {
        tenantId,
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

    return { reserved: false };
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { reserved: true, tenant };
}
