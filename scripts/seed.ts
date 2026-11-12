import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("Seeding initial tenants into SQLite database...");

  const tenants = [
    {
      id: "tenant_mekari_live",
      name: "Mekari Customer Support",
      apiKey: "mekari_live_key_001",
      quotaRequests: 250,
      usedRequests: 0,
    },
    {
      id: "tenant_tier2_business",
      name: "Acme Corp (Standard Tier)",
      apiKey: "mekari_acme_key_002",
      quotaRequests: 50,
      usedRequests: 0,
    },
    {
      id: "tenant_exhausted_test",
      name: "Exhausted Quota Sandbox Tenant",
      apiKey: "mekari_exhausted_key_003",
      quotaRequests: 10,
      usedRequests: 10, // already at quota limit to test fail-closed 429
    },
    {
      id: "tenant_eval_suite",
      name: "Automated Evaluation Test Suite",
      apiKey: "mekari_eval_key_benchmark",
      quotaRequests: 1000,
      usedRequests: 0,
    },
  ];

  for (const tenant of tenants) {
    const upserted = await prisma.tenant.upsert({
      where: { apiKey: tenant.apiKey },
      update: {
        name: tenant.name,
        quotaRequests: tenant.quotaRequests,
        usedRequests: tenant.usedRequests,
      },
      create: tenant,
    });
    console.log(`- Seeded Tenant: ${upserted.name} (Key: ${upserted.apiKey}, Quota: ${upserted.usedRequests}/${upserted.quotaRequests})`);
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

