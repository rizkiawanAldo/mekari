import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        requests: {
          select: {
            costUsd: true,
            totalTokens: true,
            outcome: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const tenantStats = tenants.map((t) => {
      const totalCostUsd = t.requests.reduce((acc, r) => acc + (r.costUsd || 0), 0);
      const totalTokens = t.requests.reduce((acc, r) => acc + (r.totalTokens || 0), 0);
      const successfulRequests = t.requests.filter((r) => r.outcome === "success" || r.outcome === "fallback_success").length;
      const blockedRequests = t.requests.filter((r) => r.outcome === "quota_exceeded").length;

      return {
        id: t.id,
        name: t.name,
        apiKey: t.apiKey,
        quotaRequests: t.quotaRequests,
        usedRequests: t.usedRequests,
        remainingQuota: Math.max(0, t.quotaRequests - t.usedRequests),
        totalCostUsd: Number(totalCostUsd.toFixed(6)),
        totalTokens,
        totalRequestsLogged: t.requests.length,
        successfulRequests,
        blockedRequests,
      };
    });

    const recentRequests = await prisma.request.findMany({
      take: 25,
      orderBy: { createdAt: "desc" },
      include: {
        tenant: {
          select: { name: true },
        },
      },
    });

    return NextResponse.json({
      tenants: tenantStats,
      recentRequests,
    });
  } catch (err: unknown) {
    console.error("Failed to fetch usage stats:", err);
    return NextResponse.json(
      { error: "Internal Server Error fetching usage statistics", details: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tenantId } = body;

    if (action === "reset_quota" && tenantId) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { usedRequests: 0 },
      });
      return NextResponse.json({ message: "Quota reset to 0 used." });
    }

    if (action === "topup" && tenantId) {
      const amount = Number(body.amount) || 50;
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { quotaRequests: { increment: amount } },
      });
      return NextResponse.json({ message: `Quota incremented by ${amount}.` });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
