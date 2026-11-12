import "./load-env";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";

/**
 * API keys that used to be hard-coded in this repo (and therefore public).
 * They are rotated automatically on the next seed run.
 */
const LEGACY_KEYS = new Set([
  "mekari_live_key_001",
  "mekari_acme_key_002",
  "mekari_exhausted_key_003",
  "mekari_eval_key_benchmark",
]);

function generateApiKey(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(18).toString("base64url")}`;
}

async function main() {
  console.log("Seeding initial tenants into SQLite database...");

  // Set ROTATE_API_KEYS=1 to force new keys even for non-legacy tenants.
  const rotate = process.env.ROTATE_API_KEYS === "1";

  const tenants = [
    {
      id: "tenant_mekari_live",
      name: "Mekari Customer Support",
      prefix: "mekari_live",
      quotaRequests: 250,
      usedRequests: 0,
    },
    {
      id: "tenant_tier2_business",
      name: "Acme Corp (Standard Tier)",
      prefix: "mekari_acme",
      quotaRequests: 50,
      usedRequests: 0,
    },
    {
      id: "tenant_exhausted_test",
      name: "Exhausted Quota Sandbox Tenant",
      prefix: "mekari_exhausted",
      quotaRequests: 10,
      usedRequests: 10, // already at quota limit to test fail-closed 429
    },
    {
      id: "tenant_eval_suite",
      name: "Automated Evaluation Test Suite",
      prefix: "mekari_eval",
      quotaRequests: 1000,
      usedRequests: 0,
    },
  ];

  for (const tenant of tenants) {
    const existing = await prisma.tenant.findUnique({ where: { id: tenant.id } });

    // Keep stable keys across runs, but never keep a key that is published in
    // the public repo. ROTATE_API_KEYS=1 rotates unconditionally.
    let apiKey = existing?.apiKey;
    if (!apiKey || rotate || LEGACY_KEYS.has(apiKey)) {
      apiKey = generateApiKey(tenant.prefix);
    }

    const upserted = await prisma.tenant.upsert({
      where: { id: tenant.id },
      update: {
        name: tenant.name,
        apiKey,
        quotaRequests: tenant.quotaRequests,
        usedRequests: tenant.usedRequests,
      },
      create: {
        id: tenant.id,
        name: tenant.name,
        apiKey,
        quotaRequests: tenant.quotaRequests,
        usedRequests: tenant.usedRequests,
      },
    });
    console.log(
      `- Seeded Tenant: ${upserted.name} (Key: ${upserted.apiKey}, Quota: ${upserted.usedRequests}/${upserted.quotaRequests})`
    );
  }

  console.log("Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
