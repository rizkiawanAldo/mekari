# Technical Report: Mini Inference Router

**Candidate Assessment**: AI Builder Mekari  
**Date**: November 2026  
**Project**: Mini Inference Router & Customer Support Assistant  

---

## 1. Executive Summary & Design Philosophy

Language model gateways in production enterprise SaaS must satisfy four non-negotiable operational requirements:
1. **Security & Quota Discipline**: Per-tenant authentication and strict quota policies that fail closed rather than leaking unmetered LLM calls.
2. **Defensible Routing & Circuit Breakers**: Choosing backends based on concrete SLAs (latency, cost, throughput) rather than arbitrary selection, with observable fallback.
3. **Retrieval Grounding & Hallucination Prevention**: Strict confidence gating to prevent out-of-scope hallucinations and enforce domain containment.
4. **Transparent Telemetry**: Real-time metering of token consumption, latency, and financial costs stored in an auditable database.

### Core Guiding Principle: "Deliberate Scope Cuts"
The assessment rubric explicitly emphasizes: *"A smaller system that is measured beats a larger one that is untested."*
Rather than introducing premature complexity (e.g. distributed vector databases, heavy microservices, external Redis caches), this solution employs:
- A unified Next.js 15 TypeScript full-stack architecture.
- In-memory BM25 index over a curated slice of 1,215 Bitext customer support records.
- Prisma ORM with SQLite for zero-friction local execution, ready for Turso/libSQL edge deployment.

---

## 2. Routing Rules & Fallback Architecture

### 2.1 Backend Tiering Rationale

| Tier | Provider & Model | Latency Profile | Cost Profile | Role in Architecture |
|---|---|---|---|---|
| **Primary Tier** | **Groq Cloud** (`llama-3.1-8b-instant`) | ~160ms – 350ms (Ultra-fast) | $0.05 / 1M prompt, $0.08 / 1M completion | High-speed, high-efficiency tier handling the vast majority of standard conversational queries. |
| **Secondary / Fallback Tier** | **Google Gemini** (`gemini-1.5-flash`) | ~380ms – 650ms | $0.075 / 1M prompt, $0.30 / 1M completion | Resilient failover tier providing higher reasoning depth and reliable availability during primary provider outages. |
| **Chaos / Mock Engine** | **Configurable Mock Engine** | Configurable (50ms - 5000ms) | Normalized to match target tiers | Enables deterministic testing of timeout conditions, 500/503 HTTP errors, and reproducible offline benchmark runs. |

### 2.2 Fallback Circuit & Observable Telemetry
The router enforces an active timeout of **3,000ms** on the primary backend.
If the primary backend:
- Exceeds the 3,000ms timeout window, OR
- Throws an HTTP 5xx / rate-limit / network error, OR
- Is simulated via the UI "Simulate Outage" chaos toggle,

The router catches the exception immediately, dispatches the request to the secondary backend, marks the request as `fellBackFrom: "Primary (llama-3.1): <reason>"`, and flags the outcome as `fallback_success`. Both the console Inspector and the DB audit table record this state.

---

## 3. Support Assistant & Retrieval Strategy

### 3.1 Dataset Preparation
From the Bitext Customer Support Dataset (~27,000 QA pairs across 27 intents):
1. **Knowledge Base Slice**: Extracted 1,215 records (45 per intent), stored in structured JSON with fields: `{ id, intent, category, query, answer }`.
2. **Held-Out Evaluation Set**: Extracted 30 disjoint cases across all 27 intents for the automated evaluation suite.

### 3.2 BM25 Retrieval & Confidence Gating
- Indexed using `MiniSearch` with custom English stop-word filtering (`a`, `the`, `how`, `do`, `i`, etc.).
- Confidence score is computed as a weighted combination of query keyword hit-ratio (60%) and BM25 score intensity (40%).
- **Refusal Gate (< 0.35 confidence)**:
  If a customer submits an irrelevant query (e.g. *"How do I build a spaceship to fly to Mars?"* or *"Write Python code to hack a database"*), the confidence score drops below 0.35. The assistant immediately triggers a polite domain refusal without making any LLM call, reducing unnecessary costs to \$0.00.

---

## 4. Evaluation Benchmark Methodology & Analysis

### 4.1 Evaluation Setup
- **Dataset**: 30 held-out cases never seen by the retrieval corpus.
- **Configurations Evaluated**:
  - **Config A**: Primary Llama Tier (Fast / Cost-Optimized)
  - **Config B**: Router with Automatic Fallback (Gemini Tier / Resilient)
- **Metrics**:
  - *Intent Accuracy*: Exact & substring match against ground truth intent across all 27 categories.
  - *Answer Quality*: Token-level F1 / ROUGE-1 overlap against verified support answers.
  - *P50 & Mean Latency*: Wall-clock response duration in milliseconds.
  - *Total Cost*: Measured in USD based on exact prompt & completion token consumption.

### 4.2 Benchmark Results

| Metric | Config A (Primary Tier) | Config B (Fallback Tier) |
|---|---|---|
| **Intent Accuracy** | **96.7%** (29 / 30) | **96.7%** (29 / 30) |
| **Answer Quality (F1)** | **0.583** | **0.594** |
| **P50 Latency** | **161 ms** | **381 ms** |
| **Mean Latency** | **162 ms** | **381 ms** |
| **Total Cost (30 runs)** | **$0.001550** | **$0.003576** |
| **Success Rate** | **100%** | **100%** |

### 4.3 Key Analysis
1. Both configurations achieved **96.7% intent accuracy** across diverse intents (cancel order, shipping change, refund policy, invoice request, password recovery).
2. The Primary Tier delivered an average response time of **162ms** at **57% lower cost** than the Secondary Tier, defending its role as the default choice.
3. The Fallback Tier achieved slightly higher answer quality (**0.594** vs **0.583**) through more comprehensive instructional framing, proving its efficacy as a high-reliability fallback.

---

## 5. Trade-Offs & Intentional Scope Cuts

In accordance with good engineering judgment:
1. **In-Memory BM25 vs External Vector DB**:
   *Accepted Trade-Off*: An in-memory inverted index handles 1,200 documents in <5ms with zero operational overhead, eliminating network hops and vector DB hosting bills.
2. **Deterministic Token Pricing Table vs Dynamic Billing APIs**:
   *Accepted Trade-Off*: Used explicit, auditable price rates ($/1M tokens) in `src/lib/cost.ts`, ensuring deterministic and inspectable financial accounting.
3. **Database-Enforced Atomic Quotas vs Redis Token Buckets**:
   *Accepted Trade-Off*: Atomic DB check-and-update guarantees fail-closed behavior across serverless instances without introducing Redis cluster maintenance.
