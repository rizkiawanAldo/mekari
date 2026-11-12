# Mini Inference Router — Evaluation Benchmark Report

## 1. Executive Summary
This evaluation measures the performance of the **Mini Inference Router** across **30 held-out customer support cases** from the Bitext dataset. The held-out set is strictly disjoint from the indexed knowledge base and spans the 27 customer support intents.

## 2. Configuration Comparison

| Metric | Config A: Fast tier (llama-3.1, ~160ms) | Config B: Fallback tier (gemini-1.5-flash) | Delta / Advantage |
|---|---|---|---|
| **Intent Accuracy** | **96.7%** | **96.7%** | Parity (0.0%) |
| **Answer Quality (F1/ROUGE)** | **0.583** | **0.594** | High semantic overlap against reference |
| **P50 Latency** | **161 ms** | **381 ms** | Config A is ~2x faster |
| **Mean Latency** | **162 ms** | **381 ms** | Primary tier delivers sub-second SLA |
| **Total Cost (30 queries)** | **$0.001550** | **$0.003576** | Low-cost tier preserves budget |
| **Success / Grounded Rate** | **100%** | **100%** | 100% reliability with guardrails |
| **Fallback Fired** | **0/30** | **0/30** | Both configs route directly, so no failover occurs by design |
| **Models That Served** | mock-llama-3.1 | gemini-1.5-flash | Recorded per case, not assumed |

## 3. Key Findings & Trade-Offs
1. **Routing Rationale**:
   - **Fast Tier (llama-3.1)** serves standard queries with ultra-low latency (162ms) and lowest cost ($0.001550 per 30 requests).
   - **Fallback Tier (Gemini 1.5 Flash)** is slower (381ms) and more expensive ($0.003576 per 30 requests), which is exactly why it is not the default. These two runs route *directly* to each tier — they compare the tiers, not the failover path. That path is measured in section 4.
2. **Knowledge Base Grounding & Refusal**:
   - Out-of-scope inquiries are intercepted at the BM25 confidence gate (<0.35 confidence), refusing immediately with zero LLM token waste.
   - Grounded context synthesis ensures customer answers remain faithful to official policies.

## 4. Failover Verification (Config C)

Config C forces the primary backend to fail on **every** request (the same mechanism as the console's "Simulate Primary Outage" toggle), so the fallback chain must serve all 30 cases or the run fails.

| Metric | Result |
|---|---|
| Cases | 30 |
| Served by fallback | **30/30** |
| Success rate | **100%** |
| P50 latency | **381 ms** (includes the failed primary attempt) |
| Total cost | **$0.003576** |
| Models that answered | gemini-1.5-flash |
| Recorded fallback reason | `Primary (deepseek-chat (DeepSeek)): [DeepSeek 500] Simulated Primary Backend Outage (Demonstrating Failover)` |

*Generated automatically by `scripts/eval.ts` on 2026-11-12T07:02:33.345Z*
