# Mini Inference Router — Evaluation Benchmark Report

## 1. Executive Summary
This evaluation measures the performance of the **Mini Inference Router** across **30 held-out customer support cases** from the Bitext dataset. The held-out set is strictly disjoint from the indexed knowledge base and spans the 27 customer support intents.

## 2. Configuration Comparison

| Metric | Config A: Primary Llama Tier (Fast / Cost-Optimized) | Config B: Router with Automatic Fallback (Gemini Tier / Failover Protected) | Delta / Advantage |
|---|---|---|---|
| **Intent Accuracy** | **96.7%** | **96.7%** | Parity (0.0%) |
| **Answer Quality (F1/ROUGE)** | **0.583** | **0.594** | High semantic overlap against reference |
| **P50 Latency** | **161 ms** | **381 ms** | Config A is ~2x faster |
| **Mean Latency** | **162 ms** | **381 ms** | Primary tier delivers sub-second SLA |
| **Total Cost (30 queries)** | **$0.001550** | **$0.003576** | Low-cost tier preserves budget |
| **Success / Grounded Rate** | **100%** | **100%** | 100% reliability with guardrails |

## 3. Key Findings & Trade-Offs
1. **Routing Rationale**:
   - **Primary Backend (Llama 3.1 / Fast Tier)** serves standard queries with ultra-low latency (162ms) and lowest cost ($0.001550 per 30 requests).
   - **Secondary Backend (Gemini Flash Tier)** offers superior context handling and higher resilience when primary encounters timeout or rate limiting.
2. **Knowledge Base Grounding & Refusal**:
   - Out-of-scope inquiries are intercepted at the BM25 confidence gate (<0.35 confidence), refusing immediately with zero LLM token waste.
   - Grounded context synthesis ensures customer answers remain faithful to official policies.

*Generated automatically by `scripts/eval.ts` on 2026-11-12T02:50:31.351Z*
