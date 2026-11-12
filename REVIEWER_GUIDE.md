# Reviewer Guide

A claim-by-claim map from the assessment criteria to the code that implements them and the fastest way to see each one working. Line numbers refer to the current `main`.

## 0. Fastest path (5 minutes)

```bash
cd mekari-router
npm install            # postinstall runs `prisma generate`
npm run db:seed        # 4 tenants -> local SQLite (or Turso, if TURSO_DATABASE_URL is set)
npm run dev            # http://localhost:3000
```

No provider keys are required: without them each tier is served by the mock engine at the same latency/price profile, so every behaviour below is still demonstrable. Set `GROQ_API_KEY`, `GEMINI_API_KEY` or `DEEPSEEK_API_KEY` to have real models serve real requests.

```bash
npm run check          # tsc --noEmit && eslint
npm run eval           # 30 held-out cases -> prints table, regenerates EVAL_REPORT.md
```

## 1. Assessment criteria → code → demo

| Criterion | Where it lives | How to see it in 30 seconds |
|---|---|---|
| **Auth: per-tenant API key** | `src/lib/gateway/auth.ts:21` — accepts `x-api-key` or `Authorization: Bearer` | `curl -X POST localhost:3000/api/chat -H "Content-Type: application/json" -d "{\"query\":\"hi\"}"` → `401 Missing API Key` |
| **Auth: unknown key rejected** | `auth.ts:32` (`if (!tenant)` branch) | same call with `-H "x-api-key: nope"` → `401 Unauthorized: Invalid API key provided` |
| **Quota fails closed (429)** | `auth.ts:45` — `usedRequests >= quotaRequests` blocks *before* any backend call and writes a `quota_exceeded` audit row | In the UI, select tenant **Exhausted Quota Sandbox** (`mekari_exhausted_key_003`) and send a message |
| **Quota not burned by invalid input** | `src/app/api/chat/route.ts` — body parsed and validated before `consumeQuota()` | Send `{"query": ""}` → `400`; the Usage tab shows `usedRequests` unchanged |
| **Retrieval over the KB slice** | `src/lib/assistant/kb.ts` (MiniSearch + stop-word filter) over `data/knowledge_base.json` | Any support question → Inspector shows **Retrieved Docs** with per-document scores |
| **Confidence signal + refusal** | `src/lib/assistant/service.ts:26` — `CONFIDENCE_REFUSAL_THRESHOLD = 0.35`, checked before routing | Click preset **"Out of Scope (Refusal test)"** → refusal, `Outcome: refused`, cost `$0`, no model call |
| **Unusable model output handled** | `service.ts` — strict JSON parse, markdown-fence stripping, empty-answer fallback to the top retrieved passage | Covered by code; also the reason a malformed model reply cannot reach the user as `""` |
| **Primary timeout 3,500 ms** | `src/lib/router.ts:26` | Inspector `latencyMs` on a fallback run includes the failed primary attempt |
| **Fallback + observability** | `src/lib/router.ts:75-112` — `catch (primaryError)`, then Gemini/DeepSeek, sets `fellBackFrom` and a readable `routingReason` | Toggle **"Simulate Primary Outage"**, send a query → `Outcome: fallback_success`, Inspector shows the recorded reason |
| **Emergency floor** | `router.ts:114` — `callMockModel(..., "mock-emergency-fallback")` | Third tier, reached only when both credentialed providers fail; keeps the endpoint off the 5xx path |
| **Routing rules are justified, not arbitrary** | `router.ts:64` — Groq primary unless only a DeepSeek key is configured; direct backends short-circuit at the top of `routeRequest` | `TECHNICAL_REPORT.md` §2.1, plus `EVAL_REPORT.md` §2 for the cost/latency delta that justifies the ordering |
| **Cost accuracy** | `src/lib/cost.ts` — per-1M-token table, every routed model priced (including `mock-emergency-fallback`), 7-decimal rounding | Inspector `costUsd`; Usage tab `totalCostUsd` per tenant |
| **Metering in a database** | `src/lib/gateway/metering.ts` — one `Request` row per call: model, tokens, cost, latency, outcome, intent, confidence, retrieved docs, query, answer snippet | Usage & Quotas tab → **Recent Metered Request Audit Log** |
| **Streaming** | `src/app/api/chat/route.ts:98,125,127` — `event: token` → `event: meta` → `event: done` | DevTools → Network → `chat` → Response; the UI streams word by word |
| **Evaluation** | `scripts/eval.ts` + `data/eval_held_out.json` (30 cases disjoint from the index) | `npm run eval`; results in `EVAL_REPORT.md` |
| **Serverless-ready persistence** | `src/lib/prisma.ts:15` — libSQL driver adapter when `TURSO_DATABASE_URL` is set, local SQLite otherwise | The deployed instance works with no writable filesystem |

## 2. Reproducing the two headline numbers

- **Intent accuracy 96.7%** — `scripts/eval.ts` compares `res.intent` against the held-out `intent` with an exact-or-substring match. 29/30 in every configuration.
- **Fallback really fires** — `EVAL_REPORT.md` §4: Config C forces the primary to fail on all 30 requests; the run reports `30/30` served by the fallback at 100% success, and records the reason string. Configs A and B route directly, so they report `0/30` — the report says so instead of implying otherwise.

## 3. Extension points

| What you want | Where to add |
|---|---|
| New backend / model | implement `ProviderCallParams → ProviderResult` in `src/lib/providers/`, wire it in `src/lib/router.ts`, add its price to `MODEL_PRICING` in `src/lib/cost.ts`, add the name to `RoutingOptions.preferredBackend` and `BackendPreference` in `src/app/page.tsx` |
| Different routing policy | `routeRequest` in `src/lib/router.ts` — single decision point |
| Different knowledge base | replace `data/knowledge_base.json`; `scripts/eval.ts` reads its cases from `data/eval_held_out.json` |
| Schema change | edit `prisma/schema.prisma`, generate SQL with `prisma migrate diff`, apply with `npm run db:migrate:turso` |

## 4. Known limitations

1. **Quota check and increment are two statements** (`auth.ts:45` then `auth.ts:82`). Fail-closed is guaranteed; atomicity is not — two concurrent requests from a tenant exactly one request below its limit can both be admitted. Documented in `TECHNICAL_REPORT.md` §5.
2. **Config B is a direct route to the fallback tier**, not a routed-fallback run; it measures that tier's quality and cost. Failover frequency is measured by Config C.
3. **Refusal turns meter estimated token counts at `$0.00`**, so refusals appear in the audit trail without inflating spend.
4. **`prisma/dev.db` is git-ignored** — a fresh clone must run `npm run db:seed`. On Vercel the file does not exist and the libSQL adapter is mandatory.
5. **No unit tests** — verification is `npm run check` plus the evaluation script. This is the first thing to add.
