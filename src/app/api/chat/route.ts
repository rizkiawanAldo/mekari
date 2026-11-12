import { NextRequest, NextResponse } from "next/server";
import { authenticateAndCheckQuota } from "@/lib/gateway/auth";
import { recordMeteredRequest } from "@/lib/gateway/metering";
import { processSupportAssistant } from "@/lib/assistant/service";

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // 1. Auth & Quota Guardrail (Fails Closed)
    const apiKey = req.headers.get("x-api-key") || req.headers.get("authorization");
    const authResult = await authenticateAndCheckQuota(apiKey);

    if (!authResult.authorized) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.statusCode }
      );
    }

    const { tenant } = authResult;

    // 2. Parse request payload
    const body = await req.json().catch(() => ({}));
    const query = body.query || body.message;
    const stream = body.stream !== false; // default true
    const preferredBackend = body.preferredBackend || "auto";
    const simulatePrimaryFailure = Boolean(body.simulatePrimaryFailure);

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Bad Request: 'query' or 'message' string is required." },
        { status: 400 }
      );
    }

    // 3. Process through Support Assistant (RAG + Router + Refusal Guardrail)
    const result = await processSupportAssistant({
      query,
      preferredBackend,
      simulatePrimaryFailure,
    });

    const totalLatency = Date.now() - startTime;

    // 4. Record Metering in Database
    await recordMeteredRequest({
      tenantId: tenant.id,
      endpoint: "/api/chat",
      model: result.model,
      fallbackFrom: result.fellBackFrom,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      costUsd: result.costUsd,
      latencyMs: totalLatency,
      outcome: result.outcome,
      intent: result.intent,
      confidence: result.confidence,
      retrievedDocs: result.retrievedDocs,
      userQuery: query,
      responseSnippet: result.answer,
    });

    // 5. Non-streaming response branch (e.g. for batch eval scripts)
    if (!stream) {
      return NextResponse.json({
        answer: result.answer,
        intent: result.intent,
        confidence: result.confidence,
        retrievedDocs: result.retrievedDocs,
        model: result.model,
        fellBackFrom: result.fellBackFrom,
        routingReason: result.routingReason,
        latencyMs: totalLatency,
        costUsd: result.costUsd,
        tokens: {
          prompt: result.promptTokens,
          completion: result.completionTokens,
          total: result.totalTokens,
        },
        outcome: result.outcome,
        remainingQuota: tenant.quotaRequests - tenant.usedRequests,
      });
    }

    // 6. Streaming SSE Response Branch
    const encoder = new TextEncoder();
    const answerWords = result.answer.split(/(\s+)/);

    const readableStream = new ReadableStream({
      async start(controller) {
        // Stream text in small token-like chunks for smooth UX
        for (const word of answerWords) {
          controller.enqueue(
            encoder.encode(`event: token\ndata: ${JSON.stringify({ text: word })}\n\n`)
          );
          // Tiny delay between words for realistic streaming animation
          await new Promise((r) => setTimeout(r, 18));
        }

        // Stream final rich metadata payload for the inspector
        const metaPayload = {
          answer: result.answer,
          intent: result.intent,
          confidence: result.confidence,
          retrievedDocs: result.retrievedDocs,
          model: result.model,
          fellBackFrom: result.fellBackFrom,
          routingReason: result.routingReason,
          latencyMs: totalLatency,
          costUsd: result.costUsd,
          tokens: {
            prompt: result.promptTokens,
            completion: result.completionTokens,
            total: result.totalTokens,
          },
          outcome: result.outcome,
          remainingQuota: tenant.quotaRequests - tenant.usedRequests,
        };

        controller.enqueue(
          encoder.encode(`event: meta\ndata: ${JSON.stringify(metaPayload)}\n\n`)
        );
        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
        controller.close();
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    console.error("Gateway unexpected error:", err);
    return NextResponse.json(
      { error: "Internal Server Error in Inference Gateway", details: String(err) },
      { status: 500 }
    );
  }
}
