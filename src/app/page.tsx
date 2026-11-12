"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Bot,
  User,
  ShieldCheck,
  AlertTriangle,
  Zap,
  RotateCcw,
  ExternalLink,
  Cpu,
  Layers,
  Coins,
  Clock,
  Database,
  Building,
  CheckCircle,
  XCircle,
  BarChart3,
  MessageSquare,
  RefreshCw,
} from "lucide-react";

interface RetrievedDoc {
  id: string;
  intent: string;
  category: string;
  query: string;
  answer: string;
  score: number;
}

interface MessageMeta {
  model: string;
  fellBackFrom?: string | null;
  routingReason?: string;
  latencyMs: number;
  costUsd: number;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  outcome: string;
  intent?: string;
  confidence?: number;
  retrievedDocs?: RetrievedDoc[];
  remainingQuota?: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta?: MessageMeta;
}

interface TenantStat {
  id: string;
  name: string;
  apiKey: string;
  quotaRequests: number;
  usedRequests: number;
  remainingQuota: number;
  totalCostUsd: number;
  totalTokens: number;
  totalRequestsLogged: number;
  successfulRequests: number;
  blockedRequests: number;
}

interface AuditLog {
  id: string;
  model: string;
  fallbackFrom?: string | null;
  latencyMs: number;
  costUsd: number;
  outcome: string;
  intent?: string | null;
  confidence?: number | null;
  userQuery?: string | null;
  createdAt: string;
  tenant: {
    name: string;
  };
}

const PRESET_QUERIES = [
  { label: "Order Cancellation", query: "I would like to cancel my order please." },
  { label: "Check Refund Policy", query: "What is your refund policy for returned items?" },
  { label: "Track Delivery", query: "Where is my package and how long will delivery take?" },
  { label: "Out of Scope (Refusal test)", query: "How do I build a spaceship to fly to Mars?" },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<"chat" | "usage">("chat");
  const [tenants, setTenants] = useState<TenantStat[]>([]);
  const [selectedTenantKey, setSelectedTenantKey] = useState<string>("mekari_live_key_001");
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);

  // Playground state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I am your Mekari Customer Support Assistant, powered by the Mini Inference Router. Ask me any question regarding orders, invoices, shipping, or refunds.",
    },
  ]);
  const [inputQuery, setInputQuery] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [preferredBackend, setPreferredBackend] = useState<"auto" | "groq" | "gemini" | "mock">("auto");
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [activeMeta, setActiveMeta] = useState<MessageMeta | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchUsageData = async () => {
    setIsLoadingUsage(true);
    try {
      const res = await fetch("/api/usage");
      if (res.ok) {
        const data = await res.json();
        setTenants(data.tenants || []);
        setRecentLogs(data.recentRequests || []);
        if (data.tenants && data.tenants.length > 0 && !selectedTenantKey) {
          setSelectedTenantKey(data.tenants[0].apiKey);
        }
      }
    } catch (err) {
      console.error("Error loading usage:", err);
    } finally {
      setIsLoadingUsage(false);
    }
  };

  useEffect(() => {
    fetchUsageData();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const handleSendMessage = async (queryText?: string) => {
    const textToSend = (queryText || inputQuery).trim();
    if (!textToSend || isStreaming) return;

    setInputQuery("");

    const userMsgId = `user_${Date.now()}`;
    const botMsgId = `bot_${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: textToSend },
      { id: botMsgId, role: "assistant", content: "" },
    ]);

    setIsStreaming(true);
    setActiveMeta(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": selectedTenantKey,
        },
        body: JSON.stringify({
          query: textToSend,
          stream: true,
          preferredBackend,
          simulatePrimaryFailure: simulateFailure,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: "Unknown error" }));
        const errMsg = errJson.error || `Error ${res.status}: ${res.statusText}`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsgId
              ? {
                  ...m,
                  content: `⚠️ [Gateway Error] ${errMsg}`,
                  meta: {
                    model: "gateway-error",
                    latencyMs: 5,
                    costUsd: 0,
                    tokens: { prompt: 0, completion: 0, total: 0 },
                    outcome: res.status === 429 ? "quota_exceeded" : "error",
                  },
                }
              : m
          )
        );
        fetchUsageData();
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let accumulatedText = "";

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("event: token")) {
              const dataLine = trimmed.split("\n").find((l) => l.startsWith("data: "));
              if (dataLine) {
                try {
                  const parsed = JSON.parse(dataLine.replace("data: ", ""));
                  accumulatedText += parsed.text;
                  setMessages((prev) =>
                    prev.map((m) => (m.id === botMsgId ? { ...m, content: accumulatedText } : m))
                  );
                } catch {
                  // ignore
                }
              }
            } else if (trimmed.startsWith("event: meta")) {
              const dataLine = trimmed.split("\n").find((l) => l.startsWith("data: "));
              if (dataLine) {
                try {
                  const meta: MessageMeta = JSON.parse(dataLine.replace("data: ", ""));
                  setActiveMeta(meta);
                  setMessages((prev) =>
                    prev.map((m) => (m.id === botMsgId ? { ...m, meta } : m))
                  );
                } catch {
                  // ignore
                }
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      console.error("Chat error:", err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMsgId
            ? { ...m, content: `Connection error: ${err instanceof Error ? err.message : String(err)}` }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      fetchUsageData();
    }
  };

  const handleResetQuota = async (tenantId: string) => {
    try {
      await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_quota", tenantId }),
      });
      fetchUsageData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleTopup = async (tenantId: string) => {
    try {
      await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "topup", tenantId, amount: 50 }),
      });
      fetchUsageData();
    } catch (err) {
      console.error(err);
    }
  };

  const currentTenant = tenants.find((t) => t.apiKey === selectedTenantKey);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20">
            M
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-white tracking-tight">Mini Inference Router</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                Mekari AI Builder
              </span>
            </div>
            <p className="text-xs text-slate-400">Multi-tenant Gateway & Support Assistant</p>
          </div>
        </div>

        {/* Global Controls & Tenant Selector */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-xs">
            <Building className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">Tenant:</span>
            <select
              value={selectedTenantKey}
              onChange={(e) => setSelectedTenantKey(e.target.value)}
              className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.apiKey} className="bg-slate-900 text-slate-100">
                  {t.name} ({t.remainingQuota} left)
                </option>
              ))}
            </select>
          </div>

          {/* Fallback Simulator Toggle */}
          <button
            onClick={() => setSimulateFailure((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              simulateFailure
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
            }`}
            title="Forces Primary Backend (Groq/Llama) to fail, proving the Secondary Fallback circuit in real time"
          >
            <AlertTriangle className={`w-3.5 h-3.5 ${simulateFailure ? "text-amber-400" : ""}`} />
            <span>Simulate Primary Outage: <strong>{simulateFailure ? "ON" : "OFF"}</strong></span>
          </button>

          {/* Navigation Tabs */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === "chat" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Playground
            </button>
            <button
              onClick={() => {
                setActiveTab("usage");
                fetchUsageData();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === "usage" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Usage & Quotas
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      {activeTab === "chat" ? (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Chat Column */}
          <div className="flex-1 flex flex-col h-[calc(100vh-65px)] border-r border-slate-800">
            {/* Top Toolbar / Preset Chips */}
            <div className="px-6 py-2.5 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between gap-4 overflow-x-auto text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 shrink-0">Try Query:</span>
                {PRESET_QUERIES.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendMessage(p.query)}
                    disabled={isStreaming}
                    className="px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/50 whitespace-nowrap transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-slate-400">Backend Preference:</span>
                <select
                  value={preferredBackend}
                  onChange={(e) => setPreferredBackend(e.target.value as any)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-slate-300 text-xs focus:outline-none"
                >
                  <option value="auto">Auto Router (Primary + Fallback)</option>
                  <option value="groq">Force Groq (Llama 3.1)</option>
                  <option value="gemini">Force Gemini (1.5 Flash)</option>
                  <option value="mock">Force Mock Backend</option>
                </select>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex gap-3 max-w-3xl ${m.role === "user" ? "ml-auto flex-row-reverse" : ""}`}
                >
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold ${
                      m.role === "user"
                        ? "bg-slate-700 text-slate-200"
                        : "bg-indigo-600/90 text-white shadow-sm"
                    }`}
                  >
                    {m.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>

                  <div className={`space-y-1.5 ${m.role === "user" ? "items-end text-right" : ""}`}>
                    <div
                      className={`p-3.5 rounded-2xl text-sm leading-relaxed ${
                        m.role === "user"
                          ? "bg-indigo-600 text-white rounded-br-none"
                          : "bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none shadow-sm"
                      }`}
                    >
                      {m.content ? (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      ) : (
                        <div className="flex items-center gap-1.5 py-1 text-slate-400 text-xs">
                          <span className="h-1.5 w-1.5 bg-indigo-400 rounded-full animate-pulse" />
                          <span className="h-1.5 w-1.5 bg-indigo-400 rounded-full animate-pulse delay-150" />
                          <span className="h-1.5 w-1.5 bg-indigo-400 rounded-full animate-pulse delay-300" />
                          <span>Routing & streaming response...</span>
                        </div>
                      )}
                    </div>

                    {/* Inline metadata pill */}
                    {m.meta && (
                      <div
                        onClick={() => setActiveMeta(m.meta!)}
                        className="cursor-pointer inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] bg-slate-900/90 border border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-all"
                      >
                        <span className="flex items-center gap-1 text-indigo-400 font-medium">
                          <Cpu className="w-3 h-3" />
                          {m.meta.model}
                        </span>
                        <span>•</span>
                        {m.meta.fellBackFrom ? (
                          <span className="text-amber-400 font-medium flex items-center gap-0.5">
                            <AlertTriangle className="w-3 h-3" /> Fallback Triggered
                          </span>
                        ) : (
                          <span className="text-emerald-400 font-medium">Normal Route</span>
                        )}
                        <span>•</span>
                        <span>{m.meta.latencyMs}ms</span>
                        <span>•</span>
                        <span>${m.meta.costUsd.toFixed(6)}</span>
                        {m.meta.intent && (
                          <>
                            <span>•</span>
                            <span className="text-purple-400">{m.meta.intent}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Form */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/30">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2 max-w-4xl mx-auto"
              >
                <input
                  type="text"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  placeholder="Ask customer support about an order, refund, delivery, or cancellation..."
                  disabled={isStreaming}
                  className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                />
                <button
                  type="submit"
                  disabled={isStreaming || !inputQuery.trim()}
                  className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white text-sm font-medium flex items-center gap-2 shadow-md shadow-indigo-600/20 transition-all"
                >
                  <Send className="w-4 h-4" />
                  <span>Send</span>
                </button>
              </form>
              <div className="flex items-center justify-between text-[11px] text-slate-500 max-w-4xl mx-auto mt-2 px-1">
                <span>Active Tenant: {currentTenant?.name || "None"} (API Key: {selectedTenantKey})</span>
                <span>Remaining Quota: {currentTenant ? `${currentTenant.remainingQuota} / ${currentTenant.quotaRequests}` : "0"}</span>
              </div>
            </div>
          </div>

          {/* Right Column: Live Router & Telemetry Inspector */}
          <div className="w-full lg:w-96 h-[calc(100vh-65px)] overflow-y-auto bg-slate-900/60 p-5 space-y-5 border-l border-slate-800/80">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-slate-200">Gateway Inspector</h2>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                Real-Time
              </span>
            </div>

            {activeMeta ? (
              <div className="space-y-4 text-xs">
                {/* Routing & Provider Card */}
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Model Backend:</span>
                    <span className="font-semibold text-indigo-400 px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">
                      {activeMeta.model}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Outcome:</span>
                    <span
                      className={`font-semibold px-2 py-0.5 rounded ${
                        activeMeta.outcome === "fallback_success"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : activeMeta.outcome === "refused"
                          ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                          : activeMeta.outcome === "quota_exceeded"
                          ? "bg-red-500/10 text-red-400 border border-red-500/20"
                          : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      }`}
                    >
                      {activeMeta.outcome}
                    </span>
                  </div>

                  {activeMeta.fellBackFrom && (
                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1">
                      <div className="flex items-center gap-1 font-semibold text-[11px]">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Fallback Triggered
                      </div>
                      <p className="text-[11px] leading-tight text-amber-200/90">
                        {activeMeta.fellBackFrom}
                      </p>
                    </div>
                  )}

                  {activeMeta.routingReason && (
                    <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                      <span className="text-slate-500 font-medium">Rationale: </span>
                      {activeMeta.routingReason}
                    </div>
                  )}
                </div>

                {/* Metering Card (Latency, Tokens, Cost) */}
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                  <div className="text-slate-300 font-medium flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Telemetry & Metering</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase">Latency</div>
                      <div className="text-base font-bold text-slate-200">{activeMeta.latencyMs} ms</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                      <div className="text-[10px] text-slate-500 uppercase">Estimated Cost</div>
                      <div className="text-base font-bold text-emerald-400">
                        ${activeMeta.costUsd.toFixed(6)}
                      </div>
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1 text-[11px]">
                    <div className="flex justify-between text-slate-400">
                      <span>Prompt Tokens:</span>
                      <span className="text-slate-200 font-mono">{activeMeta.tokens.prompt}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Completion Tokens:</span>
                      <span className="text-slate-200 font-mono">{activeMeta.tokens.completion}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-slate-300 border-t border-slate-800/80 pt-1">
                      <span>Total Tokens:</span>
                      <span className="font-mono text-indigo-400">{activeMeta.tokens.total}</span>
                    </div>
                  </div>
                </div>

                {/* Support Assistant Guardrail & Intent Card */}
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                  <div className="text-slate-300 font-medium flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                      <span>Support Assistant Guardrail</span>
                    </div>
                    {activeMeta.confidence !== undefined && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          activeMeta.confidence >= 0.5 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {(activeMeta.confidence * 100).toFixed(0)}% Confidence
                      </span>
                    )}
                  </div>

                  {activeMeta.intent && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Detected Intent:</span>
                      <span className="font-semibold text-purple-300 font-mono bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                        {activeMeta.intent}
                      </span>
                    </div>
                  )}

                  {activeMeta.confidence !== undefined && (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            activeMeta.confidence >= 0.5 ? "bg-emerald-400" : "bg-red-400"
                          }`}
                          style={{ width: `${Math.min(100, Math.max(5, activeMeta.confidence * 100))}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Refusal Gate (&lt; 35%)</span>
                        <span>High Confidence (&gt; 70%)</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Retrieved Knowledge Base Passages */}
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                  <div className="text-slate-300 font-medium flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Retrieved KB Passages</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {activeMeta.retrievedDocs?.length || 0} matched
                    </span>
                  </div>

                  {activeMeta.retrievedDocs && activeMeta.retrievedDocs.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {activeMeta.retrievedDocs.map((doc, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-1 text-[11px]"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-cyan-300">
                              #{idx + 1} {doc.intent}
                            </span>
                            <span className="text-slate-500 text-[10px] font-mono">
                              BM25: {doc.score.toFixed(1)}
                            </span>
                          </div>
                          <p className="text-slate-400 italic">&ldquo;{doc.query}&rdquo;</p>
                          <p className="text-slate-300 text-[10px] line-clamp-2 border-t border-slate-800/60 pt-1">
                            {doc.answer}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-500 text-[11px] italic">No relevant documents found.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-16 px-4 space-y-3">
                <Layers className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400 font-medium">Awaiting Request</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Send a message to view live model routing, fallback decisions, tokens, latency, cost, and retrieved knowledge base entries.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Usage & Tenant View */
        <div className="flex-1 p-8 max-w-7xl mx-auto w-full space-y-8 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Tenant Usage & Quotas</h2>
              <p className="text-xs text-slate-400 mt-1">
                Real-time per-tenant consumption, fail-closed quota enforcement, and metered cost tracking.
              </p>
            </div>
            <button
              onClick={fetchUsageData}
              disabled={isLoadingUsage}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingUsage ? "animate-spin" : ""}`} />
              Refresh Stats
            </button>
          </div>

          {/* Aggregate KPI Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400 font-medium">Total Requests Logged</span>
              <div className="text-2xl font-bold text-white">
                {tenants.reduce((acc, t) => acc + t.totalRequestsLogged, 0)}
              </div>
              <span className="text-[11px] text-emerald-400">Across all active tenants</span>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400 font-medium">Total Metered Cost</span>
              <div className="text-2xl font-bold text-emerald-400">
                ${tenants.reduce((acc, t) => acc + t.totalCostUsd, 0).toFixed(5)}
              </div>
              <span className="text-[11px] text-slate-500">Calculated from prompt + completion</span>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400 font-medium">Total Tokens Consumed</span>
              <div className="text-2xl font-bold text-indigo-400 font-mono">
                {tenants.reduce((acc, t) => acc + t.totalTokens, 0).toLocaleString()}
              </div>
              <span className="text-[11px] text-slate-500">Processed by router backends</span>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400 font-medium">Blocked (Quota Exceeded)</span>
              <div className="text-2xl font-bold text-amber-400">
                {tenants.reduce((acc, t) => acc + t.blockedRequests, 0)}
              </div>
              <span className="text-[11px] text-amber-500/80">Fails closed (HTTP 429)</span>
            </div>
          </div>

          {/* Tenant Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-900/80 font-semibold text-sm text-slate-200">
              Registered Tenants & Quota Policy
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="px-5 py-3">Tenant Name</th>
                    <th className="px-5 py-3">API Key</th>
                    <th className="px-5 py-3">Quota Usage</th>
                    <th className="px-5 py-3">Remaining</th>
                    <th className="px-5 py-3">Incurred Cost</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {tenants.map((t) => {
                    const usagePercent = Math.min(100, Math.round((t.usedRequests / t.quotaRequests) * 100));
                    const isExhausted = t.remainingQuota <= 0;

                    return (
                      <tr key={t.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-3.5 font-medium text-slate-200">{t.name}</td>
                        <td className="px-5 py-3.5 font-mono text-slate-400">{t.apiKey}</td>
                        <td className="px-5 py-3.5">
                          <div className="space-y-1 w-36">
                            <div className="flex justify-between text-[11px]">
                              <span>{t.usedRequests} used</span>
                              <span className="text-slate-500">/ {t.quotaRequests}</span>
                            </div>
                            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  isExhausted ? "bg-red-500" : usagePercent > 80 ? "bg-amber-400" : "bg-indigo-500"
                                }`}
                                style={{ width: `${usagePercent}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-semibold">
                          <span className={isExhausted ? "text-red-400" : "text-emerald-400"}>
                            {t.remainingQuota} requests
                          </span>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-slate-300">${t.totalCostUsd.toFixed(6)}</td>
                        <td className="px-5 py-3.5">
                          {isExhausted ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-medium text-[10px]">
                              <XCircle className="w-3 h-3" /> Quota Exhausted (429)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium text-[10px]">
                              <CheckCircle className="w-3 h-3" /> Active
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right space-x-2">
                          <button
                            onClick={() => handleResetQuota(t.id)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                            title="Reset consumed requests to 0"
                          >
                            Reset
                          </button>
                          <button
                            onClick={() => handleTopup(t.id)}
                            className="px-2.5 py-1 rounded bg-indigo-600/80 hover:bg-indigo-600 text-white transition-colors"
                            title="Add +50 quota"
                          >
                            +50 Top-up
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-900/80 font-semibold text-sm text-slate-200">
              Recent Metered Request Audit Log
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="px-5 py-3">Timestamp</th>
                    <th className="px-5 py-3">Tenant</th>
                    <th className="px-5 py-3">Model</th>
                    <th className="px-5 py-3">Query Snippet</th>
                    <th className="px-5 py-3">Intent</th>
                    <th className="px-5 py-3">Latency</th>
                    <th className="px-5 py-3">Cost</th>
                    <th className="px-5 py-3">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {recentLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-5 py-3 text-slate-400 font-mono">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="px-5 py-3 font-medium text-slate-300">{log.tenant.name}</td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-indigo-400">{log.model}</span>
                        {log.fallbackFrom && (
                          <span className="block text-[10px] text-amber-400">
                            (fallback from {log.fallbackFrom.split(":")[0]})
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 max-w-xs truncate text-slate-300">
                        {log.userQuery || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {log.intent ? (
                          <span className="font-mono text-purple-400">{log.intent}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono text-slate-300">{log.latencyMs} ms</td>
                      <td className="px-5 py-3 font-mono text-emerald-400">${log.costUsd.toFixed(6)}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`font-semibold px-2 py-0.5 rounded text-[10px] ${
                            log.outcome === "fallback_success"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : log.outcome === "quota_exceeded"
                              ? "bg-red-500/10 text-red-400 border border-red-500/20"
                              : log.outcome === "refused"
                              ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          }`}
                        >
                          {log.outcome}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {recentLogs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-500">
                        No requests recorded yet. Try sending a message in the Playground!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
