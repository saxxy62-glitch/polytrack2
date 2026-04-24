import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { LiveTrade } from "@shared/schema";
import { useState, useRef, useEffect } from "react";

const fmtDate = (ts: number) => {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : n.toFixed(d);

function TradeRow({ trade }: { trade: LiveTrade }) {
  const ref = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.background = "hsla(var(--green) / 0.08)";
      setTimeout(() => {
        if (ref.current) ref.current.style.background = "";
      }, 800);
    }
  }, []);

  const usdValue = (trade.size ?? 0) * (trade.price ?? 0);

  return (
    <tr
      ref={ref}
      className={`border-b border-border transition-colors duration-700 ${trade.isTopWallet ? "bg-surface-2" : ""}`}
      data-testid={`row-live-${trade.id}`}
    >
      <td className="px-3 py-2 text-[11px] font-mono text-muted-foreground whitespace-nowrap">
        {fmtDate(trade.timestamp ?? 0)}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {trade.isTopWallet ? (
            <span className="w-1.5 h-1.5 rounded-full bg-yellow flex-shrink-0" title="Top wallet" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-surface-3 flex-shrink-0" />
          )}
          <Link
            href={`/wallet/${trade.proxyWallet}`}
            className="text-xs font-mono text-muted-foreground hover:text-cyan transition-colors truncate max-w-[120px]"
          >
            {trade.pseudonym || (trade.proxyWallet ?? "").slice(0, 8) + "…"}
          </Link>
        </div>
      </td>
      <td className="px-3 py-2 max-w-[240px] truncate text-xs text-foreground">
        {trade.title}
      </td>
      <td className="px-3 py-2">
        <span className={`text-xs font-semibold font-mono ${trade.side === "BUY" ? "text-green" : "text-red"}`}>
          {trade.side}
        </span>
      </td>
      <td className="px-3 py-2 text-xs font-mono text-foreground">{fmt(trade.size)}</td>
      <td className="px-3 py-2 text-xs font-mono text-foreground">{fmt(trade.price)}</td>
      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
        ${usdValue.toFixed(2)}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{trade.outcome}</td>
    </tr>
  );
}

export default function LiveFeed() {
  const [filter, setFilter] = useState<"all" | "top" | "buy" | "sell">("all");

  const { data: trades, isLoading } = useQuery<LiveTrade[]>({
    queryKey: ["/api/live"],
    refetchInterval: 8000,
    refetchIntervalInBackground: true,
  });

  const { data: status } = useQuery<any>({
    queryKey: ["/api/status"],
    refetchInterval: 5000,
  });

  const filtered = (trades ?? []).filter(t => {
    if (filter === "top") return t.isTopWallet === 1;
    if (filter === "buy") return t.side === "BUY";
    if (filter === "sell") return t.side === "SELL";
    return true;
  });

  // Stats
  const buyCount = (trades ?? []).filter(t => t.side === "BUY").length;
  const sellCount = (trades ?? []).filter(t => t.side === "SELL").length;
  const totalVol = (trades ?? []).reduce((s, t) => s + (t.size ?? 0) * (t.price ?? 0), 0);
  const topCount = (trades ?? []).filter(t => t.isTopWallet).length;

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green animate-pulse-live" />
            Live Trade Feed
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Polling Polymarket API every 8s · {(trades ?? []).length} trades loaded
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(["all", "top", "buy", "sell"] as const).map(f => (
            <button
              key={f}
              data-testid={`button-filter-${f}`}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                filter === f
                  ? "bg-surface-3 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-2"
              }`}
            >
              {f === "top" ? "⭐ Top Wallets" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-surface-1 border border-border rounded-lg p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Trades</p>
          <p className="text-lg font-semibold font-mono text-foreground">{(trades ?? []).length}</p>
        </div>
        <div className="bg-surface-1 border border-border rounded-lg p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Buy / Sell</p>
          <p className="text-lg font-semibold font-mono">
            <span className="text-green">{buyCount}</span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-red">{sellCount}</span>
          </p>
        </div>
        <div className="bg-surface-1 border border-border rounded-lg p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Volume</p>
          <p className="text-lg font-semibold font-mono text-foreground">${totalVol.toFixed(0)}</p>
        </div>
        <div className="bg-surface-1 border border-yellow/20 rounded-lg p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Top Wallet Trades</p>
          <p className="text-lg font-semibold font-mono text-yellow">{topCount}</p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow" /> Top wallet trade
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-surface-3" /> Regular wallet
        </span>
        <span className="text-green font-mono">BUY</span>
        <span className="text-red font-mono">SELL</span>
      </div>

      {/* Table */}
      <div className="gradient-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-live-trades">
            <thead>
              <tr className="border-b border-border">
                {["Time", "Wallet", "Market", "Side", "Size", "Price", "USD Value", "Outcome"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 15 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-3 py-2.5"><Skeleton className="h-3.5 bg-surface-2 rounded" /></td>
                      ))}
                    </tr>
                  ))
                : filtered.map(t => <TradeRow key={t.id} trade={t} />)
              }
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    No trades match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground mt-4">
        Auto-refreshes every 8 seconds · Powered by{" "}
        <a href="https://data-api.polymarket.com" target="_blank" rel="noopener noreferrer" className="text-cyan hover:underline">
          Polymarket Data API
        </a>
      </p>
    </div>
  );
}
