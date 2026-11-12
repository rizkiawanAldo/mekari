# Mini Inference Router & Customer Support Assistant

An intelligent, multi-tenant LLM gateway and customer support assistant engineered for high availability, defensible routing, fail-closed quota enforcement, and observability.

Built for the **Mekari AI Builder Technical Assessment**.

---

## 🚀 Live Demo & Quick Start

- **Framework**: Next.js 15 (App Router, React 19, TypeScript, Tailwind CSS)
- **Database**: Prisma ORM with SQLite (compatible with Turso / libSQL for edge deployment)
- **RAG Engine**: In-memory BM25 with Stop-Word Filtering (`MiniSearch`) over the Bitext Customer Support Dataset
- **Supported Backends**: Groq Cloud (Llama 3.1 8B Instant), Google Gemini 1.5 Flash, and Configurable Mock Backend

### Running Locally

```bash
# 1. Navigate to directory
cd mekari-router

# 2. Install dependencies
npm install

# 3. Seed test tenants and quotas
npx tsx scripts/seed.ts

# 4. (Optional) Configure environment variables in .env
# GROQ_API_KEY=your_groq_key
# GEMINI_API_KEY=your_gemini_key

# 5. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the **Chat Playground** and **Tenant Usage Dashboard**.

---

## ☁️ Deploying to Vercel (Turso / libSQL)

Vercel's filesystem is read-only, so the SQLite file used locally cannot be used in production. Deploy against a hosted [Turso](https://turso.tech) database instead — the app automatically switches to the libSQL driver adapter when `TURSO_DATABASE_URL` is set (see `src/lib/prisma.ts`), and keeps using the local file otherwise.

```bash
# 1. Create the hosted database
turso db create mekari-router

# 2. Grab the URL and an auth token
turso db show mekari-router --url
turso db tokens create mekari-router

# 3. Create the schema (Prisma Migrate does not target Turso directly)
turso db shell mekari-router < prisma/migrations/20261112000000_init/migration.sql

# 4. Seed the four demo tenants into Turso
set TURSO_DATABASE_URL=libsql://<db>-<org>.turso.io
set TURSO_AUTH_TOKEN=<token>
npx tsx scripts/seed.ts
```

Then import the GitHub repo at [vercel.com/new](https://vercel.com/new) and set these environment variables before deploying:

| Variable | Purpose |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://…` URL from step 2 |
| `TURSO_AUTH_TOKEN` | Token from step 2 |
| `GROQ_API_KEY` / `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` | Optional; without keys the mock engine serves responses |

`prisma generate` runs automatically during the Vercel build via the `postinstall` script.

---

## 🔑 Pre-Seeded Tenant API Keys

The SQLite database comes pre-seeded with 4 test tenants:

| Tenant Name | API Key | Quota | Purpose |
|---|---|---|---|
| **Mekari Customer Support** | `mekari_live_key_001` | 250 requests | Primary production demo tenant |
| **Acme Corp (Standard)** | `mekari_acme_key_002` | 50 requests | Standard tier business tenant |
| **Exhausted Quota Sandbox** | `mekari_exhausted_key_003` | 10/10 used | **Tests fail-closed 429 quota enforcement** |
| **Evaluation Benchmark Suite**| `mekari_eval_key_benchmark` | 1000 requests | Dedicated tenant for running automated evaluations |

---

## 📊 Evaluation Benchmark (30 Held-Out Cases)

Run the automated evaluation benchmark anytime:

```bash
npx tsx scripts/eval.ts
```

### Benchmark Results Summary

Evaluated across **30 disjoint held-out cases** across all 27 Bitext customer support intents:

| Metric | Config A: Primary Llama Tier (Fast / Cost) | Config B: Router with Automatic Fallback (Gemini Tier) |
|---|---|---|
| **Intent Accuracy** | **96.7%** (29/30 correct) | **96.7%** (29/30 correct) |
| **Answer Quality (F1/ROUGE)** | **0.583** | **0.594** |
| **P50 Latency** | **161 ms** | **381 ms** |
| **Mean Latency** | **162 ms** | **381 ms** |
| **Total Cost (30 runs)** | **$0.001550** | **$0.003576** |
| **Success Rate** | **100%** | **100%** |

*(Detailed breakdown available in [`EVAL_REPORT.md`](./EVAL_REPORT.md))*

---

## 🏗️ Architecture & Core Components

```
Client (Console Playground / API Consumer)
        │
        │ POST /api/chat (x-api-key, stream=true)
        ▼
┌──────────────────────────────────────────────┐
│                  GATEWAY                     │
│  - Per-tenant API key authentication         │
│  - Atomic fail-closed quota check (429)      │
│  - SSE text streaming + final meta telemetry  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│              SUPPORT ASSISTANT               │
│  - MiniSearch BM25 retrieval over 1,215 KB   │
│  - Confidence scoring (<0.35 safety refusal) │
│  - Grounded context prompt synthesis         │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│              INFERENCE ROUTER                │
│  - Primary: Llama 3.1 (<400ms, $0.05/M)      │
│  - Secondary: Gemini 1.5 Flash (fallback)    │
│  - Timeout detection & circuit breaker       │
│  - Full inspectability: fellBackFrom reason  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│             PRISMA DB METERING               │
│  - Model, latency, prompt/completion tokens  │
│  - Calculated cost ($USD), outcome, intent   │
└──────────────────────────────────────────────┘
```

---

## 🧪 Testing Scenarios & Verification

1. **Streaming Chat**:
   Send any question in the playground (e.g. *"I want to cancel order #1234"*). Observe token-by-token streaming and the live Inspector updating with model, latency, cost, and retrieved passages.
2. **Fail-Closed Quota Check (HTTP 429)**:
   Switch the tenant selector to **"Exhausted Quota Sandbox Tenant"** (`mekari_exhausted_key_003`). The request is immediately rejected with HTTP 429 without invoking backend models, preserving compute budget.
3. **Simulated Backend Outage & Failover**:
   Toggle **"Simulate Primary Outage: ON"** in the top bar. Submit a query and observe:
   - Primary backend fails cleanly.
   - Router automatically fails over to the secondary backend.
   - Inspector displays `Fallback Triggered: Primary (llama-3.1): [Groq 500] Simulated Primary Backend Outage`.
   - Outcome is recorded as `fallback_success`.
4. **Out-of-Scope Refusal (Safety Guardrail)**:
   Click the preset chip **"Out of Scope (Refusal test)"** (*"How do I build a spaceship to fly to Mars?"*).
   The BM25 confidence gate detects low similarity (<0.35) and politely refuses without hallucinating or wasting LLM tokens.
