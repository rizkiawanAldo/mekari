# Submission — Mini Inference Router

Mekari AI Builder Technical Assessment · one-day scope.

| Deliverable | Link |
|---|---|
| **Repository** | https://github.com/rizkiawanAldo/mekari |
| **Deployed app** | `TODO: paste the Vercel URL here` |
| **Video demo (54 s)** | [`demo/demo.mp4`](./demo/demo.mp4) — script in [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) |
| **Technical report** | [`TECHNICAL_REPORT.md`](./TECHNICAL_REPORT.md) |
| **Evaluation report** | [`EVAL_REPORT.md`](./EVAL_REPORT.md) |
| **Reviewer guide** | [`REVIEWER_GUIDE.md`](./REVIEWER_GUIDE.md) (claim → file → 30-second demo) |

---

## What this is

A shared LLM gateway with one capability on top: a customer support assistant that answers from a Bitext knowledge-base slice and returns the detected intent.

- **Gateway** — streaming `POST /api/chat`, per-tenant API key auth, per-tenant quota that fails closed (HTTP 429) and writes an audit row, per-request metering (model, tokens, latency, estimated cost, outcome) persisted in the database.
- **Routing** — three credentialed backends (Groq Llama 3.1, Gemini 1.5 Flash, DeepSeek) plus a deterministic mock engine; primary → secondary → emergency-mock fallback with the decision recorded on the request and shown in the UI.
- **Assistant** — BM25 retrieval over 1,215 entries, confidence gate at 0.35 that refuses instead of guessing, grounded prompt, tolerant parsing of unusable model output.
- **Console** — Playground with token streaming and a live Inspector (model, fallback reason, retrieved docs, intent, tokens, latency, cost), plus a Usage & Quotas view per tenant.
- **Evaluation** — 30 held-out cases; intent accuracy, token-F1 answer quality, P50/mean latency, cost; three configs including a forced-failover run.

## Evidence that the rubric items are real

| Rubric item | Number / artefact |
|---|---|
| Correct request path | `REVIEWER_GUIDE.md` §1 — 401 without a key, 400 on bad body without burning quota, 429 on the exhausted tenant |
| Routing + fallback observable | `EVAL_REPORT.md` §4 — **30/30 requests served by fallback at 100% success** when the primary is forced to fail |
| Measurement | `EVAL_REPORT.md` §2 — intent accuracy **96.7%**, answer F1 **0.583 / 0.594**, P50 **161 / 381 ms**, cost **$0.001550 / $0.003576** per 30 requests |
| Exception handling | per-case `try/catch` in `scripts/eval.ts`; provider timeouts; unusable-output fallback in `src/lib/assistant/service.ts` |
| Judgement | `TECHNICAL_REPORT.md` §5–§6 — deliberate cuts and the one race condition left in |

## Run it in 60 seconds

```bash
cd mekari-router
npm install
npm run db:seed      # 4 tenants; local SQLite unless TURSO_DATABASE_URL is set
npm run dev          # http://localhost:3000
```

```bash
npm run check        # tsc --noEmit + eslint
npm run eval         # regenerates EVAL_REPORT.md
```

Provider keys are optional. Without them every tier is served by the mock engine (same latency/cost shape), so all behaviours above remain demonstrable; set `GROQ_API_KEY` / `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` to have real models serve real requests — the Inspector's **Model** line then shows the provider's model name instead of a `mock-*` one.
