import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Link } from "wouter";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtK = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
};

const fmtDate = (ts: number) => {
  if (!ts || isNaN(ts)) return "";
  // Handle both Unix seconds and ms
  const ms = ts > 1e10 ? ts : ts * 1000;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-surface-1 border border-border rounded-lg p-3">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-semibold font-mono ${color ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

export default function WalletDetail() {
  const { address } = useParams<{ address: string }>();

  const { data, isLoading } = useQuery<any>({
    queryKey: [`/api/wallets/${address}`],
    enabled: !!address,
    refetchInterval: 60000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/refresh/${address}`).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/wallets/${address}`] }),
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <Skeleton className="h-8 w-48 mb-6 bg-surface-2" />
        <div className="grid grid-cols-4 gap-3 mb-6">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 bg-surface-2 rounded-lg" />)}
        </div>
        <Skeleton className="h-64 bg-surface-2 rounded-lg" />
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm mb-6">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <div className="text-center py-20 text-muted-foreground">Wallet not found or still loading…</div>
      </div>
    );
  }

  const pnlHistory = data.pnlHistory ?? [];
  const recentTrades = data.recentTrades ?? [];
  const topMarkets: any[] = (() => { try { return JSON.parse(data.topMarkets ?? "[]"); } catch { return []; } })();
  const categories: string[] = (() => { try { return JSON.parse(data.markets ?? "[]"); } catch { return []; } })();

  const pnlColor = (data.totalPnl ?? 0) >= 0 ? "text-green" : "text-red";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {data.pseudonym || data.name || "Anonymous"}
            </h1>
            <a
              href={`https://polymarket.com/portfolio/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-cyan transition-colors"
              data-testid="link-polymarket"
            >
              {address}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          data-testid="button-refresh"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="bg-surface-2 border-border hover:bg-surface-3 text-xs h-7"
        >
          <RefreshCw className={`w-3 h-3 mr-1.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatBox label="Total PNL" value={fmtK(data.totalPnl)} color={pnlColor} />
        <StatBox label="Win Rate" value={`${((data.winRate ?? 0) * 100).toFixed(1)}%`}
          color={(data.winRate ?? 0) >= 0.55 ? "text-green" : (data.winRate ?? 0) >= 0.45 ? "text-foreground" : "text-red"} />
        <StatBox label="Total Trades" value={(data.totalTrades ?? 0).toLocaleString()} />
        <StatBox label="Avg EV" value={fmt(data.avgEv, 2)} color="text-cyan" />
        <StatBox label="Volume" value={fmtK(data.totalVolume)} />
        <StatBox label="Wins" value={(data.winCount ?? 0).toLocaleString()} color="text-green" />
        <StatBox label="Losses" value={(data.lossCount ?? 0).toLocaleString()} color="text-red" />
        <StatBox label="Buy/Sell" value={`${data.buyTrades ?? 0}/${data.sellTrades ?? 0}`} />
      </div>

      {/* Category badges */}
      {categories.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-6">
          {categories.map(c => {
            const colors: Record<string, string> = {
              Crypto: "bg-yellow/10 text-yellow border-yellow/20",
              Politics: "bg-purple/10 text-purple border-purple/20",
              Sports: "bg-cyan/10 text-cyan border-cyan/20",
              Economics: "bg-green/10 text-green border-green/20",
              Tech: "bg-blue-400/10 text-blue-400 border-blue-400/20",
            };
            return (
              <span key={c} className={`px-2 py-1 rounded-md text-xs font-medium border ${colors[c] ?? "bg-surface-3 text-muted-foreground border-border"}`}>
                {c}
              </span>
            );
          })}
        </div>
      )}

      {/* PNL Curve */}
      <div className="gradient-border rounded-lg p-4 mb-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Cumulative PNL Curve</h3>
        {pnlHistory.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            No PNL history available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={pnlHistory} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--green))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--green))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="timestamp" tickFormatter={fmtDate}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
              <YAxis tickFormatter={v => fmtK(v).replace("$", "")}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [fmtK(v), "Cum. PNL"]}
                labelFormatter={fmtDate}
              />
              <Area type="monotone" dataKey="cumulativePnl" stroke="hsl(var(--green))"
                fill="url(#pnlGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top markets */}
      {topMarkets.length > 0 && (
        <div className="gradient-border rounded-lg p-4 mb-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Top Markets by Volume</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={topMarkets} layout="vertical" margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
              <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                tickFormatter={v => `$${v.toFixed(0)}`} />
              <YAxis type="category" dataKey="title" width={160}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [fmtK(v), "Volume"]}
              />
              <Bar dataKey="volume" fill="hsl(var(--cyan))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent trades */}
      <div className="gradient-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Recent Trades</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Time", "Market", "Side", "Size", "Price", "Outcome", "Tx"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentTrades.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No trades found</td></tr>
              ) : recentTrades.map((t: any, i: number) => (
                <tr key={i} className="border-b border-border hover:bg-surface-2 transition-colors" data-testid={`row-trade-${i}`}>
                  <td className="px-3 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">
                    {fmtDate(t.timestamp)}
                  </td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-xs text-foreground">
                    {t.title}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold font-mono ${t.side === "BUY" ? "text-green" : "text-red"}`}>
                      {t.side}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-foreground">{fmt(t.size)}</td>
                  <td className="px-3 py-2 text-xs font-mono text-foreground">{fmt(t.price)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{t.outcome}</td>
                  <td className="px-3 py-2">
                    <a href={`https://polygonscan.com/tx/${t.transactionHash}`} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] font-mono text-cyan hover:text-foreground transition-colors">
                      {(t.transactionHash ?? "").slice(0, 8)}…
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
