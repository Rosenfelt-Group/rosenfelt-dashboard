"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { MercuryAccount } from "@/app/api/mercury/accounts/route";
import { MercuryTransaction } from "@/app/api/mercury/transactions/route";

type FilterType = "all" | "income" | "expense";

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function MercuryPanel() {
  const [accounts, setAccounts] = useState<MercuryAccount[]>([]);
  const [acctLoading, setAcctLoading] = useState(true);
  const [acctError, setAcctError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<MercuryTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");

  const loadAccounts = useCallback(async () => {
    setAcctLoading(true);
    setAcctError(null);
    try {
      const d = await fetch("/api/mercury/accounts").then(r => r.json());
      if (d.error) { setAcctError(d.error); setAccounts([]); }
      else setAccounts(d.accounts ?? []);
    } catch {
      setAcctError("Failed to load Mercury accounts");
    } finally {
      setAcctLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    setTxLoading(true);
    setTxError(null);
    try {
      const d = await fetch("/api/mercury/transactions").then(r => r.json());
      if (d.error) { setTxError(d.error); setTransactions([]); }
      else setTransactions(d.transactions ?? []);
    } catch {
      setTxError("Failed to load Mercury transactions");
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.allSettled([loadAccounts(), loadTransactions()]);
  }, [loadAccounts, loadTransactions]);

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const visibleTx = transactions.filter(t => filter === "all" ? true : t.type === filter);

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <div className="min-w-0 max-w-4xl">

        <p className="text-sm font-medium text-brand-black mb-2">Mercury Balances</p>
        {acctLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            {[1, 2, 3].map(i => <div key={i} className="card animate-pulse h-20" />)}
          </div>
        ) : acctError || accounts.length === 0 ? (
          <div className="card mb-5 text-center py-6">
            <p className="text-sm text-brand-muted">{acctError ?? "No Mercury accounts found."}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <div className="card text-center py-4">
              <p className="text-xl font-semibold text-brand-black">{fmtMoney(totalBalance)}</p>
              <p className="text-[10px] text-brand-muted uppercase tracking-wide mt-1">Total Balance</p>
            </div>
            {accounts.map(a => (
              <div key={a.id} className="card text-center py-4">
                <p className="text-xl font-semibold text-brand-black">{fmtMoney(a.balance)}</p>
                <p className="text-[10px] text-brand-muted uppercase tracking-wide mt-1">{a.name}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-brand-black">Recent Transactions</p>
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

        {txLoading ? (
          <div className="card animate-pulse h-48" />
        ) : txError ? (
          <div className="card text-center py-8">
            <p className="text-sm text-brand-muted">{txError}</p>
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
    </div>
  );
}
