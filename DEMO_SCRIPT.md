# Video demo script (≈3 minutes)

Record against the **deployed URL**, not `localhost`, so the viewer sees it live. 1080p, browser at 100% zoom, no tabs of `.env` or the dashboard with secrets visible.

Prepare before recording:
- Tenant selector on **Mekari Customer Support** (`mekari_live_key_001`, 250 requests).
- "Simulate Primary Outage" **OFF**, Backend Preference **auto**.
- At least one real provider key set on the deployment, so the Model line shows a real model name rather than `mock-*`.

Have the terminal open with `npm run eval` already completed, scrolled to the comparison table.

---

### 0:00 – 0:20 · What it is

**On screen:** the Playground, header and the right-hand Inspector.

**Say:**
> "This is a shared LLM gateway — one chat endpoint that authenticates tenants, enforces quota, picks a model backend, records what each request cost, and falls back when a backend fails. On top of it, a support assistant over a 1,215-entry slice of the Bitext dataset."

### 0:20 – 1:05 · Streaming + full observability

**Do:** click the preset chip **"Order Cancellation"** (or type *"I want to cancel my order #1234"*), press Send.

**Say while it streams:**
> "The answer streams token by token over SSE. The Inspector on the right updates from the final `meta` event: which model served it, whether fallback fired, the retrieved knowledge-base entries with their scores, the detected intent and confidence, token counts, latency, and the estimated cost in USD."

**Point at:** Model, Intent, Retrieved Docs, Tokens, Latency, Cost, Remaining Quota.

### 1:05 – 1:35 · Fallback (the important one)

**Do:** toggle **"Simulate Primary Outage: ON"**, send any query.

**Say:**
> "I've made the primary backend fail. The router catches the error, records the reason, and serves the request from the secondary tier. Outcome becomes `fallback_success`, and the Inspector shows exactly what failed and why — that string is also stored on the request row, so the decision is auditable after the fact."

**Point at:** `Outcome: fallback_success`, the fallback reason line, `Model`.

**Then:** toggle it back **OFF**.

### 1:35 – 1:55 · Refusing instead of guessing

**Do:** click the preset **"Out of Scope (Refusal test)"** (*"How do I build a spaceship to fly to Mars?"*).

**Say:**
> "Retrieval confidence comes back below 0.35, so the assistant refuses before any model call. That's the hallucination guardrail — no tokens spent, cost zero, and the refusal is still metered so the conversation is auditable."

### 1:55 – 2:15 · Quota fails closed

**Do:** switch the Tenant selector to **Exhausted Quota Sandbox** (`mekari_exhausted_key_003`), send a query.

**Say:**
> "This tenant is at its limit. The gateway rejects with HTTP 429 before touching any backend or burning quota — it fails closed, and the rejection is written as a `quota_exceeded` row."

**Then:** switch back to **Mekari Customer Support**.

### 2:15 – 2:40 · Usage view

**Do:** click the **Usage & Quotas** tab.

**Say:**
> "Per tenant: requests used versus quota, remaining quota, spend, blocked count, and a recent metered request log with model, latency, cost, and outcome. The 429 I just triggered is in there."

**Point at:** the exhausted tenant row showing `Quota Exhausted (429)`.

### 2:40 – 2:55 · Evaluation

**Do:** switch to the terminal showing `npm run eval` output / open `EVAL_REPORT.md`.

**Say:**
> "Thirty held-out cases, disjoint from the index. Fast tier: 96.7% intent accuracy at 161ms P50 and $0.0015 per 30 requests. Gemini tier: same accuracy, 381ms, 2.3× the cost — which is why it's the fallback and not the default. A third run forces the primary to fail on every request: 30 of 30 served by the fallback at 100% success."

### 2:55 – 3:10 · What I cut, and why

**Say:**
> "Deliberate cuts: in-memory BM25 instead of a vector database, a hard-coded price table instead of a billing API, and no distributed cache — so the quota check and increment are two statements, which means two concurrent requests from a tenant one request below its limit can both be admitted. That's documented in the report rather than hidden. I also didn't build multi-turn conversation memory or per-key rate limiting."

---

## If a provider is unavailable during the recording

Say it plainly and move on — the mock engine is a first-class backend, not a fallback for a broken demo:

> "No live provider key in this environment, so the tiers are served by the deterministic mock engine at the same latency and price profile. Same code path, same routing, same metering — the Model line just shows `mock-llama-3.1` instead of the provider's model."
