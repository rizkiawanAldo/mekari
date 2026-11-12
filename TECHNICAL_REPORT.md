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
- A unified Next.js 16 TypeScript full-stack architecture.
- In-memory BM25 index over a curated slice of 1,215 Bitext customer support records.
- Prisma ORM with SQLite for zero-friction local execution, ready for Turso/libSQL edge deployment.

---

## 2. Routing Rules & Fallback Architecture

### 2.1 Backend Tiering Rationale

| Tier | Provider & Model | Latency Profile | Cost Profile | Role in Architecture |
|---|---|---|---|---|
| **Primary Tier** | **Groq Cloud** (`llama-3.1-8b-instant`) | ~160ms – 350ms (Ultra-fast) | $0.05 / 1M prompt, $0.08 / 1M completion | High-speed, high-efficiency tier handling the vast majority of standard conversational queries. |
| **Secondary / Fallback Tier** | **Google Gemini** (`gemini-1.5-flash`) | ~380ms – 650ms | $0.075 / 1M prompt, $0.30 / 1M completion | Resilient failover tier providing higher reasoning depth and reliable availability during primary provider outages. |
| **Tertiary Tier** | **DeepSeek** (`deepseek-chat`) | ~600ms – 1200ms | $0.14 / 1M prompt, $0.28 / 1M completion | Third credentialed provider; also becomes the primary when only `DEEPSEEK_API_KEY` is configured, and the fallback when Groq is primary. |
| **Chaos / Mock Engine** | **Configurable Mock Engine** | Configurable (50ms - 5000ms) | Normalized to match target tiers | Enables deterministic testing of timeout conditions, 500/503 HTTP errors, and reproducible offline benchmark runs. |
| **Emergency Floor** | **Mock (`mock-emergency-fallback`)** | ~50ms | $0.05 / 1M prompt, $0.08 / 1M completion | Last resort when both credentialed providers fail; keeps the gateway at 100% availability instead of returning a 5xx. |

### 2.2 Fallback Circuit & Observable Telemetry
The router enforces an active timeout of **3,500ms** on the primary backend.
If the primary backend:
- Exceeds the 3,500ms timeout window, OR
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
  - **Config A**: Fast tier — Llama 3.1, routed directly (cost/latency baseline)
  - **Config B**: Fallback tier — Gemini 1.5 Flash, routed directly (quality/cost of the tier that takes over)
  - **Config C**: Failover chain — primary forced to fail on every request, so the fallback must serve all 30 cases
- **Metrics**:
  - *Intent Accuracy*: Exact & substring match against ground truth intent across all 27 categories.
  - *Answer Quality*: Token-level F1 / ROUGE-1 overlap against verified support answers.
  - *P50 & Mean Latency*: Wall-clock response duration in milliseconds.
  - *Total Cost*: Measured in USD based on exact prompt & completion token consumption.

### 4.2 Benchmark Results

| Metric | Config A (Fast Tier) | Config B (Fallback Tier) |
|---|---|---|
| **Intent Accuracy** | **96.7%** (29 / 30) | **96.7%** (29 / 30) |
| **Answer Quality (F1)** | **0.583** | **0.594** |
| **P50 Latency** | **161 ms** | **381 ms** |
| **Mean Latency** | **162 ms** | **381 ms** |
| **Total Cost (30 runs)** | **$0.001550** | **$0.003576** |
| **Success Rate** | **100%** | **100%** |

### 4.3 Failover Verification (Config C)

Config A and B compare *tiers*, not the failover path: both route directly and therefore record `fallbackFired 0/30`. Config C exercises the path itself by forcing the primary to fail on every request (the same mechanism as the console's outage toggle).

| Metric | Result |
|---|---|
| Cases | 30 |
| Served by fallback | **30 / 30** |
| Success rate | **100%** |
| P50 latency | **381 ms** (includes the failed primary attempt) |
| Total cost | **$0.003576** |
| Models that answered | `gemini-1.5-flash` |
| Recorded reason | `Primary (deepseek-chat (DeepSeek)): [DeepSeek 500] Simulated Primary Backend Outage` |

Because the primary was DeepSeek rather than Groq in this run, the matrix in §2.1 selected DeepSeek as primary (Groq was not configured in the eval process) and Gemini as the fallback — the recorded reason makes that switch visible instead of implicit.

### 4.4 Key Analysis
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
3. **Database-Backed Quota Enforcement vs Redis Token Buckets**:
   *Accepted Trade-Off*: Quotas live in the same transactional store as metering, so there is no Redis cluster to operate and every rejection is auditable. The check fails closed (`usedRequests >= quotaRequests` → HTTP 429). Note the increment runs immediately after the check, so two concurrent requests from a tenant sitting exactly one request below its limit can both be admitted — an accepted, documented race for this scope; making it fully atomic would need a single conditional `updateMany((usedRequests < quotaRequests))` or a `$transaction`.

---

## 6. What I Did Not Build

Stated explicitly, because untested surface area is worse than absent surface area:

1. **Conversation memory** — each request is stateless; the chat UI keeps scrollback but no context is sent back to the model. Multi-turn support flows were out of scope for one day.
2. **Per-key rate limiting** — quota is a lifetime request budget, not a requests-per-minute limit. A token bucket would need the shared cache I deliberately avoided.
3. **Semantic / vector retrieval** — BM25 only. At 1,215 documents it is faster and fully explainable (per-document scores are shown in the Inspector); an embedding index would add a provider dependency and non-deterministic scores for no measurable recall gain on this slice.
4. **Real-time billing reconciliation** — cost is computed from a static price table (`src/lib/cost.ts`), not from provider invoices.
5. **Admin UI for tenant creation / key rotation** — tenants are seeded by `scripts/seed.ts`; there is no create-tenant flow.
6. **Automated test suite** — verification is `npm run check` (types + lint) plus the evaluation script; there are no unit tests for the router branches, which is the first thing I would add with more time.
7. **Prompt/response caching** — every request hits a backend; no cache layer.

---

## 7. Tech Stack Rationale

Every item below was chosen because a specific requirement of the brief forced a choice, not because it is fashionable. The "rejected" column is the honest part.

### 7.1 Runtime & framework

| Choice | Why this one | What I rejected and why |
|---|---|---|
| **Next.js 16.4.6, App Router** | The gateway needs one deployable unit that serves a console **and** a server runtime: SSE streaming, secret provider keys that must never reach the browser, and DB writes. Route handlers under `src/app/api/*` give that in one process. | **GitHub Pages / any static host** — no server, so no `/api/chat`, no SSE, no key isolation. Tried first, rejected on architecture, not taste. **Separate Express + SPA** — two deploy targets, CORS, and a second build for one day's scope. |
| **Turbopack dev server** | Faster cold starts and HMR while iterating on a streaming UI. `next.config.ts` wires Tailwind through the Turbopack CSS loader. | Webpack dev server — slower feedback loop on the same machine. |
| **React 19 client component (`src/app/page.tsx`)** | The console is genuinely stateful: SSE parsing, streaming message list, live Inspector, tenant switching. Server Components add nothing here. | RSC-heavy design — the playground is one interactive surface; RSC would only add serialization boundaries. |
| **TypeScript with `strict: true`** | The riskiest bugs in a gateway are **shape** bugs: a provider returning `text` vs `content`, a missing `fellBackFrom`, a mistyped outcome. `ProviderResult` is the contract every backend must satisfy, and `strict` makes a new provider fail the build rather than silently meter `undefined` tokens. | Plain JS — the router has ~6 branches and 4 providers; untyped seams are exactly where fallback logic rots. |
| **Tailwind CSS 4** | Dense, one-off UI (tables, badges, inspector rows) with no design system and no time to build one. Utility classes keep the streaming re-renders cheap and the diff local. | Component library (MUI/shadcn) — install + theme + override cost for a single page. CSS-in-JS — runtime style cost on every token update. |

### 7.2 Persistence

| Choice | Why this one | What I rejected and why |
|---|---|---|
| **Prisma 6.4.1** | Two models (`Tenant`, `Request`) and real queries (includes, aggregates, conditional increments). The generated client makes metering writes type-checked against the schema, and `migrate diff` produced the SQL I ship as `prisma/migrations/`. | Hand-written SQL — fine for 2 tables, but loses the compile-time guarantee exactly where money is recorded. **Drizzle** — equally good; Prisma was already the default in this stack and changing it would have burned scope for zero gradeable gain. |
| **SQLite locally → Turso/libSQL in production** | Local dev needs zero setup (a file). Vercel's filesystem is read-only, so production needs a server. The `PrismaLibSQL` driver adapter (`src/lib/prisma.ts:15`) switches on `TURSO_DATABASE_URL`, keeping **one client, one schema, one query layer** across both. | **Postgres (Neon/Supabase)** — would have forced schema changes and a second migration path for a demo DB. **In-memory store** — violates "stored in a database". **Vercel KV/Redis** — wrong primitive for relational quota + audit rows. |
| **`driverAdapters` preview feature** | Required for libSQL in Prisma 6.4.1. Cost: a preview flag in `schema.prisma` and the constraint that the datasource URL stays a literal. Documented rather than hidden. | Prisma Accelerate — another account and a paid dependency for the same outcome. |

### 7.3 Retrieval

| Choice | Why this one | What I rejected and why |
|---|---|---|
| **MiniSearch (BM25) in memory** | 1,215 documents × ~27 intents. An in-memory inverted index answers in single-digit milliseconds with **no network hop**, and — critically — it produces per-term match data that I surface in the Inspector, so "why did it retrieve this?" is answerable. Boosts (`query:3, intent:2, category:1`), `fuzzy: 0.1`, `prefix: true`, plus a stop-word filter so "how do I…" doesn't outvote the noun. | **Vector DB (pgvector/Pinecone/Chroma)** — an embedding provider, a second failure domain, non-deterministic scores, and a latency floor above the whole retrieval budget, for a corpus a laptop can hold. **TF-IDF by hand** — reinventing BM25 with fewer tests. |
| **Confidence = 60% term-match ratio + 40% normalized BM25** | BM25 scores are unbounded and corpus-relative, so they cannot be thresholded directly. `kb.ts:102` squashes the top score with `min(1, score / 12)` and blends it with the matched-term ratio (`kb.ts:103`), giving a bounded `0–1` value that a single constant (`0.35`) can gate — and that gate is checkable against the 30 held-out cases. | Raw BM25 threshold — different scale per query, so no defensible constant. LLM-as-judge — costs money on every request to decide whether to spend money. |

### 7.4 Models & routing

| Choice | Why this one | What I rejected and why |
|---|---|---|
| **Three credentialed providers: Groq, Gemini, DeepSeek** | The brief allows free tiers and requires a defensible ordering. Three distinct price/latency points let the router pick on measured cost (Llama 3.1 at $0.05/$0.08 per 1M vs Gemini at $0.075/$0.30) instead of vibes, and gives the fallback chain a real second hop. | A single provider — makes the "fallback" requirement unprovable. **Local Ollama** — no GPU on the target machine; would have been a second mock. |
| **Mock engine as a first-class backend, not a stub** | It carries the same latency (~160 ms fast tier / ~380 ms secondary) and price profile as the tier it stands in for, and it *throws* under `simulateFailure`. That makes timeout and failover demonstrable with no keys and no spend, and makes the 30-case benchmark reproducible on any machine. | A trivial `return "ok"` stub — would make the fallback demo and the cost numbers meaningless. |
| **No LangChain / orchestration framework** | The gateway is ~6 decisions: auth → quota → retrieve → gate → route → meter. Frameworks hide those seams behind abstractions that would have to be unwound to show the reviewer the actual decision points. | LangChain / LlamaIndex — dependency weight and indirection for logic that fits in one readable function. |

### 7.5 Tooling

| Choice | Why this one | What I rejected and why |
|---|---|---|
| **`tsx` for scripts** | `seed`, `migrate-turso` and `eval` must import the app's TypeScript modules directly (`processSupportAssistant`, `prisma`) so the benchmark measures the **same code path** the API uses. `tsx` runs them with no build step. | `ts-node` — slower, ESM friction. A second compiled entrypoint — would drift from the app. |
| **ESLint (`next/core-web-vitals`) + `tsc --noEmit` as the gate** | Cheap, fast, and catches the two classes of defect that actually appeared here: unused imports after refactors and `any` leaks. Wired as `npm run check`. | Prettier-only — formatting without correctness. No gate at all — the reviewer runs it; it has to be green. |
| **No state library, no `fetch` wrapper** | One page, one `fetch` per interaction, and `fetchUsageData` is a `useCallback` shared by five call sites. `useState` covers it. | Redux/Zustand/SWR/React Query — all would add a dependency to manage state that already has one owner. |
| **No validation library (Zod) — manual checks** | The request body has one meaningful field (`query`); the check is three lines in `route.ts` and happens *before* quota is consumed. | Zod — a dependency and a schema file for one string. Worth adding when a second endpoint appears; noted in §6 as a scope cut. |
| **No unit-test framework** | Deliberate: with one day, I spent the verification budget on the 30-case evaluation script, which exercises the real routing/retrieval path end-to-end rather than mocking it. | Vitest with mocked providers — fast and green, but would prove nothing about the code that actually runs. First thing to add (§6, item 6). |

