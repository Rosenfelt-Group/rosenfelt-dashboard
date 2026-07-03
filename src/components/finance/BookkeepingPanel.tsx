"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { KickTransaction } from "@/app/api/kick/transactions/route";
import { parseKickPnL } from "@/lib/parseKickSummary";

type PnL = { income: number; expenses: number; net: number; start: string | null; end: string | null } | null;
type FilterType = "all" | "income" | "expense";
type ChatMessage = { role: "user" | "sam"; content: string };

function parseKickPeriod(summary: string | null | undefined): { start: string | null; end: string | null } {
  if (!summary) return { start: null, end: null };
  const period = summary.match(/\(([^,]+), ([\d-]+)\.\.([\d-]+)\)/);
  return { start: period?.[2] ?? null, end: period?.[3] ?? null };
}

function parseKickBookkeeping(summary: string | null | undefined): PnL {
  const money = parseKickPnL(summary);
  if (!money) return null;
  const { start, end } = parseKickPeriod(summary);
  return { ...money, start, end };
}

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BookkeepingPanel() {
  const [pnl, setPnl] = useState<PnL>(null);
  const [pnlLoading, setPnlLoading] = useState(true);
  const [pnlError, setPnlError] = useState(false);

  const [transactions, setTransactions] = useState<KickTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "sam", content: "Ask me about your finances, request a P&L for a custom date range, or draft an invoice." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages]);

  const loadPnL = useCallback(async () => {
    setPnlLoading(true);
    setPnlError(false);
    try {
      const d = await fetch("/api/kick/status").then(r => r.json());
      setPnl(parseKickBookkeeping(d?.summary));
      if (!d?.connected) setPnlError(true);
    } catch {
      setPnlError(true);
    } finally {
      setPnlLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    setTxLoading(true);
    setTxError(null);
    try {
      const d = await fetch("/api/kick/transactions").then(r => r.json());
      if (d.error) { setTxError(d.error); setTransactions([]); }
      else setTransactions(d.transactions ?? []);
    } catch {
      setTxError("Failed to load transactions");
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.allSettled([loadPnL(), loadTransactions()]);
  }, [loadPnL, loadTransactions]);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setChatLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agent: "sam", chatId: "finance_bookkeeping" }),
      });
      const d = await r.json();
      setMessages(prev => [...prev, { role: "sam", content: d.response ?? d.error ?? "No response" }]);
    } catch {
      setMessages(prev => [...prev, { role: "sam", content: "Failed to reach Sam — try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  const visibleTx = transactions.filter(t =>
    filter === "all" ? true : t.type === filter
  );

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">

        {/* Left: P&L + ledger */}
        <div className="min-w-0">

          {/* P&L strip */}
          {pnlLoading ? (
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[1,2,3].map(i => <div key={i} className="card animate-pulse h-20" />)}
            </div>
          ) : pnlError || !pnl ? (
            <div className="card mb-5 text-center py-6">
              <p className="text-sm text-brand-muted">Kick is offline — ask Sam via chat for P&L data.</p>
            </div>
          ) : (
            <>
              {pnl.start && pnl.end && (
                <p className="text-xs text-brand-muted mb-2">{pnl.start} → {pnl.end}</p>
              )}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: "Income",   value: fmtMoney(pnl.income),   color: "text-green-700" },
                  { label: "Expenses", value: fmtMoney(pnl.expenses), color: "text-brand-black" },
                  { label: "Net",      value: fmtMoney(pnl.net),      color: pnl.net < 0 ? "text-red-700" : "text-green-700" },
                ].map(tile => (
                  <div key={tile.label} className="card text-center py-4">
                    <p className={`text-xl font-semibold ${tile.color}`}>{tile.value}</p>
                    <p className="text-[10px] text-brand-muted uppercase tracking-wide mt-1">{tile.label}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Filter bar */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-brand-black">Transactions</p>
            <div className="flex gap-1">
              {(["all", "income", "expense"] as FilterType[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={clsx(
                    "px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors",
                    filter === f
                      ? "bg-brand-orange text-white"
                      : "text-brand-muted border border-brand-border hover:text-brand-black"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Ledger */}
          {txLoading ? (
            <div className="card animate-pulse h-48" />
          ) : txError ? (
            <div className="card text-center py-8">
              <p className="text-sm text-brand-muted">Sam is offline — ask via chat for transaction data.</p>
            </div>
          ) : visibleTx.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-sm text-brand-muted">No transactions found.</p>
            </div>
          ) : (
            <div className="border border-brand-border rounded-xl overflow-hidden">
              {visibleTx.map((tx, i) => (
                <div
                  key={i}
                  className={clsx(
                    "flex items-center gap-3 px-4 py-3 text-sm border-b border-brand-border last:border-b-0",
                    i % 2 === 0 ? "bg-white" : "bg-brand-offwhite"
                  )}
                >
                  <span className="text-xs text-brand-muted w-20 flex-shrink-0">{tx.date}</span>
                  <span className="flex-1 text-brand-black truncate">{tx.description}</span>
                  <span className="text-[10px] text-brand-muted bg-brand-offwhite border border-brand-border px-2 py-0.5 rounded flex-shrink-0">
                    {tx.category}
                  </span>
                  <span className={clsx(
                    "text-sm font-medium w-20 text-right flex-shrink-0",
                    tx.type === "income" ? "text-green-700" : "text-brand-black"
                  )}>
                    {tx.type === "income" ? "+" : "−"}${tx.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: inline Sam chat */}
        <div className="flex flex-col border border-brand-border rounded-xl overflow-hidden h-[520px] lg:h-auto lg:max-h-[640px]">
          {/* Chat header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-brand-offwhite border-b border-brand-border flex-shrink-0">
            <div className="w-2 h-2 rounded-full bg-brand-orange flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-brand-black">Sam</p>
              <p className="text-[10px] text-brand-muted">Accounting · Legal · HR</p>
            </div>
          </div>

          {/* Messages */}
          <div ref={chatBodyRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((m, i) => (
              <div
                key={i}
                className={clsx(
                  "rounded-xl px-3 py-2 text-xs leading-relaxed max-w-[90%] whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-brand-orange text-white ml-auto"
                    : "bg-brand-offwhite text-brand-black border border-brand-border"
                )}
              >
                {m.content}
              </div>
            ))}
            {chatLoading && (
              <div className="bg-brand-offwhite border border-brand-border rounded-xl px-3 py-2 max-w-[90%]">
                <div className="flex gap-1 items-center h-4">
                  {[0, 150, 300].map(d => (
                    <div
                      key={d}
                      className="w-1.5 h-1.5 rounded-full bg-brand-muted animate-bounce"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex gap-2 p-3 border-t border-brand-border flex-shrink-0">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
              placeholder="Ask Sam about your finances…"
              className="flex-1 border border-brand-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-brand-orange"
            />
            <button
              onClick={sendChat}
              disabled={chatLoading || !chatInput.trim()}
              className="bg-brand-orange text-white rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
