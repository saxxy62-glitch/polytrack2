import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ArrowLeft, TrendingUp, Target, Zap } from "lucide-react";

const fmtK = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

const BUCKET_COLORS: Record<string, string> = {
  "0.93-0.95": "#f59e0b",
  "0.95-0.97": "#f97316",
  "0.97-0.99": "#ef4444",
  "0.99+":     "#dc2626",
};
const TTE_COLORS: Record<string, string> = {
  "under30s": "#dc2626",
  "30s_2m":   "#f97316",
  "2m_10m":   "#f59e0b",
  "over10m":  "#22c55e",
  "unknown":  "#6b7280",
};
const TTE_LABELS: Record<string, string> = {
  "under30s": "<30s",
  "30s_2m":   "30s–2m",
  "2m_10m":   "2m–10m",
  "over10m":  ">10m",
  "unknown":  "unknown",
};

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

export default function SportsArb() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/sports-nearexpiry"], // alias: /api/s3-analysis
    refetchInterval: 120_000,
  });
  // Force tab title
  if (typeof document !== "undefined") document.title = "S3 Analysis · Polytrack";
  const [sortBy, setSortBy] = useState<"price99"|"nearExp"|"score">("price99");

  const rawArbers: any[] = data?.sportsArbers ?? [];
  const arbers = [...rawArbers].sort((a, b) => {
    if (sortBy === "price99")  return (b.priceBuckets?.["0.99+"] ?? 0) - (a.priceBuckets?.["0.99+"] ?? 0);
    if (sortBy === "nearExp")  return (b.nearExpiryCount ?? 0) - (a.nearExpiryCount ?? 0);
    return (b.s3Score ?? 0) - (a.s3Score ?? 0);
  });
  const summary = data?.summary ?? {};

  // Global price buckets
  const globalBuckets: Record<string, number> = {
    "0.93-0.95": 0, "0.95-0.97": 0, "0.97-0.99": 0, "0.99+": 0,
  };
  arbers.forEach((w: any) => {
    Object.entries(w.priceBuckets ?? {}).forEach(([k, v]) => {
      globalBuckets[k] = (globalBuckets[k] ?? 0) + (v as number);
    });
  });
  const bucketData = Object.entries(globalBuckets).map(([price, count]) => ({ price, count }));

  // Global TTE buckets
  const globalTTE: Record<string, number> = {
    "under30s": 0, "30s_2m": 0, "2m_10m": 0, "over10m": 0, "unknown": 0,
  };
  arbers.forEach((w: any) => {
    Object.entries(w.tteBuckets ?? {}).forEach(([k, v]) => {
      globalTTE[k] = (globalTTE[k] ?? 0) + (v as number);
    });
  });
  const tteData = Object.entries(globalTTE).map(([tte, count]) => ({ tte, label: TTE_LABELS[tte] ?? tte, count }));

  const totalNearExpiry = arbers.reduce((s: number, w: any) => s + w.nearExpiryCount, 0);
  const totalVolume     = arbers.reduce((s: number, w: any) => s + w.nearExpiryVolume, 0);

  // Median KPIs
  // Normalize: Polymarket prices are 0–1; if stored >1 it's a data artifact
  const medAvgBuy = median(arbers.filter((w: any) => w.avgBuyPrice != null).map((w: any) => w.avgBuyPrice * 100));
  const medNearExp  = median(arbers.filter((w:any) => w.nearExpiryCount != null).map((w:any) => w.nearExpiryCount));

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-orange" />
            S3 Analysis
            <span className="text-xs font-normal text-muted-foreground ml-1">Sports Near-Expiry Arb · Feasibility</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Кошельки покупающие спортивные контракты по $0.93+ перед экспирацией
          </p>
        </div>
      </div>

      {/* KPI row — 5 cards */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: "S3 кошельков",        value: String(summary.walletsWithNearExpiry ?? "—"),  icon: <Zap className="w-4 h-4 text-orange" /> },
          { label: "Near-expiry трейдов", value: totalNearExpiry.toLocaleString(),               icon: <TrendingUp className="w-4 h-4 text-green" /> },
          { label: "Объём near-expiry",   value: fmtK(totalVolume),                              icon: <Target className="w-4 h-4 text-cyan" /> },
          { label: "Median Avg Buy¢",     value: medAvgBuy != null ? `¢${medAvgBuy.toFixed(0)}` : "—", icon: <span className="text-[16px]">📊</span> },
          { label: "Median Near-exp",     value: medNearExp != null ? String(Math.round(medNearExp)) : "—", icon: <Target className="w-4 h-4 text-orange" /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="bg-surface-1 border border-border rounded-lg p-3 flex items-center gap-2">
            {icon}
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider leading-tight">{label}</p>
              <p className="text-lg font-semibold font-mono text-foreground">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Two charts side by side */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-foreground mb-1">Распределение цен входа</h2>
          <p className="text-xs text-muted-foreground mb-3">
            $0.99+ бакет — ядро S3 стратегии
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={bucketData}>
              <XAxis dataKey="price" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${v} трейдов`]} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {bucketData.map((e) => (
                  <Cell key={e.price} fill={BUCKET_COLORS[e.price] ?? "#6b7280"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
            Time-to-Expiry distribution
            <span className="text-[10px] font-normal text-muted-foreground">requires endDate enrichment</span>
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            <span className="text-red-400 font-medium">&lt;30s</span> = нужна коллокация · <span className="text-orange font-medium">30s–2m</span> = VPS достаточно
          </p>
          {tteData.every(e => e.count === 0)
            ? <div className="h-[160px] flex items-center justify-center text-[11px] text-muted-foreground italic">
                Нет endDate данных для near-expiry трейдов — TTE неизвестен
              </div>
            : <ResponsiveContainer width="100%" height={160}>
                <BarChart data={tteData}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => [`${v} трейдов`]} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {tteData.map((e) => (
                      <Cell key={e.tte} fill={TTE_COLORS[e.tte] ?? "#6b7280"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
          }
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">S3 Кошельки</h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Sort:</span>
            {([["price99","$0.99+"],["nearExp","Near-exp"],["score","S3 Score"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setSortBy(k)}
                className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${sortBy===k?"bg-primary text-primary-foreground border-primary":"border-border text-muted-foreground hover:border-primary/50"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Загрузка...</div>
        ) : arbers.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            Нет активных near-expiry кошельков в текущей базе
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-surface-2">
              <tr>
                {["Score","Кошелёк","WR","avgBuy","Near-exp","$0.97-0.99","$0.99+","Sports%","Объём","PnL"].map(h => (
                  <th key={h} className={`text-left px-3 py-2 font-medium whitespace-nowrap
                    ${h==="$0.99+"&&sortBy==="price99"?"text-primary":
                      h==="Near-exp"&&sortBy==="nearExp"?"text-primary":
                      h==="Score"&&sortBy==="score"?"text-primary":"text-muted-foreground"}`}>
                    {h}
                    {((h==="$0.99+"&&sortBy==="price99")||(h==="Near-exp"&&sortBy==="nearExp")||(h==="Score"&&sortBy==="score"))?" ▼":""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {arbers.map((w: any) => (
                <tr key={w.address} className="border-b border-border/50 hover:bg-surface-2 transition-colors">
                  <td className="px-3 py-2 font-mono">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded font-semibold
                      ${(w.s3Score??0)>=70?"bg-green/10 text-green":
                        (w.s3Score??0)>=50?"bg-yellow/10 text-yellow":"bg-surface-offset text-muted-foreground"}`}>
                      {w.s3Score ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/wallet/${w.address}`} className="text-cyan hover:text-cyan/80 font-medium">
                      {w.name || w.address.slice(0, 10)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <span
                      className={`cursor-help ${(w.winRate??0)>=1?"text-green":(w.winRate??0)>=0.8?"text-yellow":"text-orange"}`}
                      title={w.trades30d!=null
                        ? `${Math.round((w.winRate??0)*100)}% WR · est. ${Math.round((w.winRate??0)*(w.trades30d??0))} wins / ${Math.round((1-(w.winRate??0))*(w.trades30d??0))} losses (30d trades)`
                        : `${Math.round((w.winRate??0)*100)}% WR`}>
                      {((w.winRate ?? 0) * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">{((w.avgBuyPrice ?? 0) * 100).toFixed(0)}¢
                  <td className="px-3 py-2 font-mono text-orange font-semibold">{w.nearExpiryCount}</td>
                  <td className="px-3 py-2 font-mono">{w.priceBuckets?.["0.97-0.99"] ?? 0}</td>
                  <td className="px-3 py-2 font-mono text-red-400 font-semibold">{w.priceBuckets?.["0.99+"] ?? 0}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {w.sportsTradeShare != null ? `${Math.round(w.sportsTradeShare * 100)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono">{fmtK(w.nearExpiryVolume)}</td>
                  <td className="px-3 py-2 font-mono text-green">{fmtK(w.totalPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4 p-4 bg-orange/5 border border-orange/20 rounded-lg">
        <p className="text-xs text-muted-foreground">
          <span className="text-orange font-semibold">S3 Score</span> = avgBuyPrice×0.4 + (nearExp/total)×0.4 + WR×0.2 · {" "}
          <span className="text-orange font-semibold">TTE &lt;30s</span> = требуется коллокация · {" "}
          <span className="text-orange font-semibold">30s–2m</span> = достаточно VPS с low-latency · {" "}
          <span className="text-muted-foreground">Sports%</span> = доля спортивных трейдов — отличает чистый S3 от смешанного.
        </p>
      </div>
    </div>
  );
}
