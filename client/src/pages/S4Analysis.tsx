import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { ArrowLeft, Trophy, TrendingUp, Shield, ChevronDown, ChevronRight } from "lucide-react";

const fmtK = (n: number) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n/1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const pct  = (n: number | null | undefined) => n == null ? "—" : `${(n * 100).toFixed(0)}%`;
const c    = (n: number | null | undefined) => n == null ? "—" : `¢${(n * 100).toFixed(0)}`;
const days = (n: number | null | undefined) => n == null ? "—" : `${n.toFixed(0)}d`;

const PRICE_COLORS: Record<string, string> = {
  under0_35:    "#6b7280",
  p0_35_to_0_50:"#3b82f6",
  p0_50_to_0_65:"#8b5cf6",
  p0_65_to_0_80:"#f59e0b",
  p0_80_to_0_95:"#f97316",
  p0_95_plus:   "#dc2626",
};
const PRICE_LABELS: Record<string, string> = {
  under0_35:    "<¢35",
  p0_35_to_0_50:"¢35–50",
  p0_50_to_0_65:"¢50–65",
  p0_65_to_0_80:"¢65–80",
  p0_80_to_0_95:"¢80–95",
  p0_95_plus:   "¢95+",
};

function SeriesRow({ s }: { s: any }) {
  return (
    <tr className="border-b border-border/30 hover:bg-surface-2/50 text-xs">
      <td className="px-3 py-1.5 font-mono text-muted-foreground max-w-[160px] truncate" title={s.sampleMarketTitle}>
        {s.seriesLabel}
      </td>
      <td className="px-3 py-1.5 font-mono">{s.outcomesTraded}</td>
      <td className="px-3 py-1.5 font-mono">{s.marketsTraded}</td>
      <td className="px-3 py-1.5 font-mono">{fmtK(s.grossNotional)}</td>
      <td className="px-3 py-1.5 font-mono text-blue">{c(s.avgBuyPrice)}</td>
      <td className="px-3 py-1.5 font-mono" style={{ color: `hsl(${Math.round(s.hedgeRatio*120)},70%,55%)` }}>
        {pct(s.hedgeRatio)}
      </td>
      <td className="px-3 py-1.5 font-mono text-muted-foreground">{days(s.medianDaysToResolution)}</td>
    </tr>
  );
}

function WalletRow({ w }: { w: any }) {
  const [expanded, setExpanded] = useState(false);
  const isStrong = w.strongS4Candidate;
  return (
    <>
      <tr
        className={`border-b border-border/50 hover:bg-surface-2 transition-colors cursor-pointer ${isStrong ? "bg-yellow/5" : ""}`}
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-3 py-2 w-5">
          {w.topSeries?.length > 0
            ? (expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />)
            : null}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            {isStrong && <span className="text-yellow text-[10px] font-bold">★</span>}
            <Link href={`/wallet/${w.address}`} className="text-cyan hover:text-cyan/80 font-medium text-xs"
              onClick={e => e.stopPropagation()}>
              {w.name || w.address?.slice(0, 10)}
            </Link>
          </div>
        </td>
        <td className="px-3 py-2 font-mono text-xs text-green">{fmtK(w.totalPnl ?? 0)}</td>
        <td className="px-3 py-2 font-mono text-xs text-blue">{c(w.avgSportsBuyPrice)}</td>
        <td className="px-3 py-2 font-mono text-xs">{fmtK(w.avgSportsTradeSize)}</td>
        <td className="px-3 py-2 font-mono text-xs">{w.seriesCount}</td>
        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[140px] truncate" title={w.topSeriesLabel ?? ""}>
          {w.topSeriesLabel ?? "—"}
        </td>
        <td className="px-3 py-2 font-mono text-xs">{w.topSeriesOutcomeCount}</td>
        <td className="px-3 py-2 font-mono text-xs font-semibold"
          style={{ color: `hsl(${Math.round((w.topSeriesHedgeRatio ?? 0)*120)},70%,55%)` }}>
          {pct(w.topSeriesHedgeRatio)}
        </td>
        <td className="px-3 py-2 font-mono text-xs">{fmtK(w.topSeriesGrossNotional)}</td>
        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{days(w.topSeriesMedianDaysToResolution)}</td>
      </tr>
      {expanded && w.topSeries?.length > 0 && (
        <tr className="border-b border-border/30">
          <td colSpan={11} className="px-6 py-2 bg-surface-2/30">
            <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">Top Series Drilldown</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30">
                  {["Series","Outcomes","Markets","Gross $","Avg Buy","Hedge%","Median Days"].map(h => (
                    <th key={h} className="text-left px-3 py-1 text-muted-foreground font-medium text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {w.topSeries.map((s: any) => <SeriesRow key={s.seriesKey} s={s} />)}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

export default function S4Analysis() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/s4-analysis"],
    refetchInterval: 120_000,
  });

  const wallets = data?.s4Wallets  ?? [];
  const summary = data?.summary    ?? {};

  // Aggregate price buckets
  const globalPrice: Record<string, number> = {
    under0_35: 0, p0_35_to_0_50: 0, p0_50_to_0_65: 0,
    p0_65_to_0_80: 0, p0_80_to_0_95: 0, p0_95_plus: 0,
  };
  wallets.forEach((w: any) =>
    Object.entries(w.priceBuckets ?? {}).forEach(([k, v]) => {
      globalPrice[k] = (globalPrice[k] ?? 0) + (v as number);
    })
  );
  const priceData = Object.entries(globalPrice).map(([key, count]) => ({
    price: PRICE_LABELS[key] ?? key, count, key,
  }));

  // Hedge ratio distribution
  const hedgeBuckets = [
    { label: "0–25%",  count: wallets.filter((w: any) => (w.topSeriesHedgeRatio ?? 0) < 0.25).length },
    { label: "25–50%", count: wallets.filter((w: any) => (w.topSeriesHedgeRatio ?? 0) >= 0.25 && (w.topSeriesHedgeRatio ?? 0) < 0.50).length },
    { label: "50–75%", count: wallets.filter((w: any) => (w.topSeriesHedgeRatio ?? 0) >= 0.50 && (w.topSeriesHedgeRatio ?? 0) < 0.75).length },
    { label: "75–100%",count: wallets.filter((w: any) => (w.topSeriesHedgeRatio ?? 0) >= 0.75).length },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow" />
            S4 — Seasonal Sports Series-Hedge Detector
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Семантический hedge ratio · series key нормализация · strongS4 = hedge≥75% + outcomes≥2 + size≥$10K
          </p>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "S4 Candidates",       value: String(summary.s4Candidates       ?? "—"), icon: <Trophy className="w-4 h-4 text-yellow" /> },
          { label: "Strong S4 ★",         value: String(summary.strongS4Candidates ?? "—"), icon: <Shield className="w-4 h-4 text-green" /> },
          { label: "Avg Series Hedge",     value: summary.avgHedgeRatio   != null ? pct(summary.avgHedgeRatio)   : "—", icon: <Shield className="w-4 h-4 text-blue" /> },
          { label: "Avg Sports Buy Price", value: summary.avgSportsBuyPrice != null ? c(summary.avgSportsBuyPrice) : "—", icon: <TrendingUp className="w-4 h-4 text-muted-foreground" /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="bg-surface-1 border border-border rounded-lg p-4 flex items-center gap-3">
            {icon}
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-xl font-semibold font-mono text-foreground">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-1">Цена входа на спортивных рынках</h2>
          <p className="text-xs text-muted-foreground mb-3">S4 ядро: покупки по ¢35–¢65 задолго до разрешения</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={priceData}>
              <XAxis dataKey="price" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => [`${v} трейдов`]} />
              <Bar dataKey="count" radius={[4,4,0,0]}>
                {priceData.map(e => <Cell key={e.key} fill={PRICE_COLORS[e.key] ?? "#6b7280"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-1">Top-Series Hedge Ratio</h2>
          <p className="text-xs text-muted-foreground mb-3">75–100% = confirmed series hedge (S4 strongCandidate)</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={hedgeBuckets}>
              <XAxis dataKey="label" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => [`${v} кошельков`]} />
              <Bar dataKey="count" fill="var(--color-blue)" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Main table */}
      <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-medium">S4 Кошельки · нажми строку для drilldown серий</h2>
          <span className="text-xs text-muted-foreground">★ = strongS4Candidate</span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Загрузка...</div>
        ) : wallets.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Нет S4 кошельков в текущей базе</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-surface-2">
                <tr>
                  <th className="w-5 px-3 py-2" />
                  {["Кошелёк","PnL","Avg Buy","Avg Size","Серий","Top Series","Outcomes","Hedge%","Gross $","Median Days"].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wallets.map((w: any) => <WalletRow key={w.address} w={w} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 p-4 bg-blue/5 border border-blue/20 rounded-lg">
        <p className="text-xs text-muted-foreground">
          <span className="text-blue font-semibold">S4 Логика:</span>{" "}
          Кошелёк покупает YES нескольких взаимоисключающих исходов одной серии (напр. EPL winner).
          seriesHedgeRatio = 1 − |buyNotional − sellNotional| / grossNotional.
          strongS4: hedge≥75% + outcomes≥2 + avgBuy ¢30–¢70 + avgSize≥$10K + concentration≥40%.
          Нажми строку чтобы увидеть drilldown по сериям.
        </p>
      </div>
    </div>
  );
}
