import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ScatterChart, Scatter, ZAxis, Legend,
} from "recharts";
import { ArrowLeft, Trophy, Shield, TrendingUp, Clock, ChevronDown, ChevronRight } from "lucide-react";

// ── Formatters ─────────────────────────────────────────────────────────────
const fmtK = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n/1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const pct  = (n: number | null | undefined) => n == null ? "—" : `${(n*100).toFixed(0)}%`;
const c    = (n: number | null | undefined) => n == null ? "—" : `¢${(n*100).toFixed(0)}`;
const days = (n: number | null | undefined) => n == null ? "—" : `${n.toFixed(0)}d`;
const hclr = (r: number) => `hsl(${Math.round(r*120)},65%,52%)`;

const BUCKET_COLORS: Record<string, string> = {
  under1d:  "#dc2626", d1_to_7: "#f97316", d7_to_30: "#eab308",
  d30_to_90:"#22c55e", over90d: "#3b82f6", unknown:  "#6b7280",
};
const BUCKET_LABELS: Record<string, string> = {
  under1d:"<1d", d1_to_7:"1–7d", d7_to_30:"7–30d", d30_to_90:"30–90d", over90d:">90d", unknown:"?"
};

// ── Series drilldown row ───────────────────────────────────────────────────
function SeriesRow({ s }: { s: any }) {
  return (
    <tr className="border-b border-border/30 hover:bg-surface-2/40 text-xs">
      <td className="px-3 py-1.5 text-muted-foreground max-w-[140px] truncate" title={s.sampleMarketTitle}>{s.seriesLabel}</td>
      <td className="px-3 py-1.5 font-mono">{s.outcomesTraded}</td>
      <td className="px-3 py-1.5 font-mono">{fmtK(s.grossNotional)}</td>
      <td className="px-3 py-1.5 font-mono" style={{color:hclr(s.hedgeRatio)}}>{pct(s.hedgeRatio)}</td>
      <td className="px-3 py-1.5 font-mono text-blue">{c(s.avgBuyPrice)}</td>
      <td className="px-3 py-1.5 font-mono">{days(s.medianDaysToResolution)}</td>
      <td className="px-3 py-1.5 font-mono">{days(s.weightedMedianDaysToResolution)}</td>
      <td className="px-3 py-1.5 font-mono text-orange">{pct(s.nearExpiryTradeShare)}</td>
      <td className="px-3 py-1.5 font-mono text-blue">{pct(s.longHorizonTradeShare)}</td>
    </tr>
  );
}

// ── Wallet row ─────────────────────────────────────────────────────────────
function WalletRow({ w }: { w: any }) {
  const [open, setOpen] = useState(false);
  const isStrong = w.strongS4Candidate;
  const subtype  = w.strongS4Short ? "⚡Short" : w.strongS4Long ? "📅Long" : null;

  return (
    <>
      <tr
        className={`border-b border-border/50 hover:bg-surface-2 transition-colors cursor-pointer ${isStrong?"bg-yellow/5":""}`}
        onClick={() => setOpen(o=>!o)}
      >
        <td className="px-2 py-2 w-5">
          {w.topSeries?.length>0 ? (open
            ? <ChevronDown className="w-3 h-3 text-muted-foreground"/>
            : <ChevronRight className="w-3 h-3 text-muted-foreground"/>) : null}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            {isStrong && <span className="text-yellow text-[10px] font-bold">★</span>}
            {w.s4Score!=null&&<span className="text-[9px] px-1 rounded bg-surface-offset font-mono text-muted-foreground">{w.s4Score}</span>}
            {subtype  && <span className={`text-[9px] px-1 rounded font-medium ${w.strongS4Long?"bg-blue/10 text-blue":w.strongS4Short?"bg-orange/10 text-orange":"bg-surface-offset text-muted-foreground"}`}>{subtype}</span>}
            <Link href={`/wallet/${w.address}`} className="text-cyan hover:text-cyan/80 font-medium text-xs"
              onClick={e=>e.stopPropagation()}>
              {w.name||w.address?.slice(0,10)}
            </Link>
          </div>
        </td>
        <td className="px-3 py-2 font-mono text-xs text-green">{fmtK(w.totalPnl)}</td>
        <td className="px-3 py-2 font-mono text-xs text-blue">{c(w.avgSportsBuyPrice)}</td>
        <td className="px-3 py-2 font-mono text-xs">{fmtK(w.avgSportsTradeSize)}</td>
        <td className="px-3 py-2 font-mono text-xs">{w.seriesCount}</td>
        <td className="px-3 py-2 text-xs text-muted-foreground max-w-[120px] truncate" title={w.topSeriesLabel??""}>{w.topSeriesLabel??"—"}</td>
        <td className="px-3 py-2 font-mono text-xs">{w.topSeriesOutcomeCount}</td>
        <td className="px-3 py-2 font-mono text-xs font-semibold" style={{color:hclr(w.topSeriesHedgeRatio??0)}}>{pct(w.topSeriesHedgeRatio)}</td>
        {/* Time + capital columns */}
        <td className="px-3 py-2 font-mono text-xs">
          {w.weightedMedianDaysToResolution != null
            ? <span className="text-blue">{w.weightedMedianDaysToResolution.toFixed(0)}d</span>
            : <span className="text-[10px] text-muted-foreground italic">no endDate</span>}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-orange">
          {w.nearExpiryTradeShare != null ? pct(w.nearExpiryTradeShare)
            : <span className="text-[10px] text-muted-foreground italic">—</span>}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-blue">
          {w.longHorizonTradeShare != null ? pct(w.longHorizonTradeShare)
            : <span className="text-[10px] text-muted-foreground italic">—</span>}
        </td>
        <td className="px-3 py-2 font-mono text-xs">
          {(() => {
            const val = w.sportsPnlPerCapitalDay ?? w.pnlPerCapitalDay;
            const mixed = w.sportsTradeShare != null && w.sportsTradeShare < 0.50;
            if (val == null) return <span className="text-[10px] text-muted-foreground italic">no endDate</span>;
            return (
              <span className="flex items-center gap-1">
                <span className={val > 0 ? "text-green" : "text-red-400"}>${val.toFixed(3)}</span>
                {mixed && (
                  <span
                    title={`Sports trades = ${w.sportsTradeShare!=null?Math.round(w.sportsTradeShare*100):"?"}% of total (<50%) — notionalShare proxy may be off by 5-10×`}
                    className="text-[9px] text-orange cursor-help">⚠</span>
                )}
              </span>
            );
          })()}
        </td>
        <td className="px-3 py-2 font-mono text-xs">
          {w.s4Score != null ? (
            <span className={`px-1.5 py-0.5 rounded font-bold ${
              w.s4Score>=70?"bg-green/15 text-green":w.s4Score>=50?"bg-yellow/15 text-yellow":w.s4Score>=30?"bg-orange/15 text-orange":"bg-surface-offset text-muted-foreground"
            }`}>{w.s4Score}</span>
          ) : "—"}
        </td>
      </tr>
      {open && w.topSeries?.length>0 && (
        <tr className="border-b border-border/20">
          <td colSpan={13} className="px-6 py-2 bg-surface-2/30">
            <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">Series Drilldown</p>
            <table className="w-full">
              <thead><tr className="border-b border-border/30">
                {["Series","Outcomes","Gross $","Hedge%","Avg Buy","Median Days","W.Med Days","Near-exp%","Long%"].map(h=>(
                  <th key={h} className="text-left px-3 py-1 text-muted-foreground font-medium text-[10px]">{h}</th>
                ))}
              </tr></thead>
              <tbody>{w.topSeries.map((s:any)=><SeriesRow key={s.seriesKey} s={s}/>)}</tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function S4Analysis() {
  const { data, isLoading } = useQuery<any>({ queryKey:["/api/s4-analysis"], refetchInterval:120_000 });
  const [sortBy, setSortBy] = useState<"s4Score"|"pnlCapDay">("s4Score");
  const wallets = [...(data?.s4Wallets ?? [])].sort((a:any, b:any) => {
    if (sortBy === "pnlCapDay") {
      const av = a.sportsPnlPerCapitalDay ?? a.pnlPerCapitalDay ?? -Infinity;
      const bv = b.sportsPnlPerCapitalDay ?? b.pnlPerCapitalDay ?? -Infinity;
      return bv - av;
    }
    return (b.s4Score ?? 0) - (a.s4Score ?? 0);
  });
  const summary  = data?.summary   ?? {};

  // Resolution buckets stacked bar (top 8 wallets)
  const stackData = wallets.slice(0,8).map((w:any) => ({
    name: w.name?.slice(0,10)||w.address?.slice(0,8),
    under1d:  w.resolutionBuckets?.under1d  ?? 0,
    d1_to_7:  w.resolutionBuckets?.d1_to_7  ?? 0,
    d7_to_30: w.resolutionBuckets?.d7_to_30 ?? 0,
    d30_to_90:w.resolutionBuckets?.d30_to_90?? 0,
    over90d:  w.resolutionBuckets?.over90d  ?? 0,
  }));

  // Archetype labels for top 3 strongS4Long wallets
  const archetypes = ["Seasonal Book", "Cross-Outcome Hedge", "Baseline S4Long"];
  const strongLong = wallets.filter((w:any) => w.strongS4Long).slice(0, 3);

  // Scatter: hedgeRatio vs weightedMedianDays
  const scatterData = wallets
    .filter((w:any)=>w.weightedMedianDaysToResolution!=null && w.topSeriesHedgeRatio!=null)
    .map((w:any)=>({
      x: Math.round(w.weightedMedianDaysToResolution),
      y: Math.round((w.topSeriesHedgeRatio??0)*100),
      z: Math.max(4, Math.min(30, (w.topSeriesGrossNotional??0)/10000)),
      name: w.name||w.address?.slice(0,8),
      strong: w.strongS4Candidate,
    }));

  // Global price buckets
  const PRICE_COLORS: Record<string,string> = {
    under0_35:"#6b7280",p0_35_to_0_50:"#3b82f6",p0_50_to_0_65:"#8b5cf6",
    p0_65_to_0_80:"#f59e0b",p0_80_to_0_95:"#f97316",p0_95_plus:"#dc2626"
  };
  const PRICE_LABELS: Record<string,string> = {
    under0_35:"<¢35",p0_35_to_0_50:"¢35–50",p0_50_to_0_65:"¢50–65",
    p0_65_to_0_80:"¢65–80",p0_80_to_0_95:"¢80–95",p0_95_plus:"¢95+"
  };
  const globalPrice: Record<string,number> = {
    under0_35:0,p0_35_to_0_50:0,p0_50_to_0_65:0,p0_65_to_0_80:0,p0_80_to_0_95:0,p0_95_plus:0
  };
  wallets.forEach((w:any)=>Object.entries(w.priceBuckets??{}).forEach(([k,v])=>{globalPrice[k]=(globalPrice[k]??0)+(v as number);}));
  const priceData = Object.entries(globalPrice).map(([key,count])=>({price:PRICE_LABELS[key]??key,count,key}));

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4"/></Link>
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow"/>
            S4 — Series-Hedge Detector
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cross-outcome sports arb · semantic hedge ratio · time horizon classification
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          {label:"S4 Candidates",       val:String(summary.s4Candidates??0),      icon:<Trophy className="w-4 h-4 text-yellow"/>},
          {label:"Strong S4 ★",
          val:`${summary.strongS4Candidates??0} (${wallets.filter((w:any)=>w.strongS4Long).length}L / ${wallets.filter((w:any)=>w.strongS4Short).length}S)`,
          icon:<Shield className="w-4 h-4 text-green"/>},
          {label:"Avg Series Hedge",     val:pct(summary.avgHedgeRatio),            icon:<Shield className="w-4 h-4 text-blue"/>},
          {label:"Avg Sports Buy Price", val:c(summary.avgSportsBuyPrice),          icon:<TrendingUp className="w-4 h-4 text-muted-foreground"/>},
        ].map(({label,val,icon})=>(
          <div key={label} className="bg-surface-1 border border-border rounded-lg p-4 flex items-center gap-3">
            {icon}
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-xl font-semibold font-mono">{val}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Top S4Long Candidates — Comparative Cards ─────────────── */}
      {strongLong.length > 0 && (
        <div className="mb-5">
          <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue"/>
            Top S4Long Candidates — Capital Efficiency
          </h2>
          <div className="grid gap-4" style={{gridTemplateColumns:`repeat(${Math.min(strongLong.length,3)},1fr)`}}>
            {strongLong.map((w:any, i:number) => {
              const annualizedRoic = w.sportsPnlPerCapitalDay != null ? w.sportsPnlPerCapitalDay * 365 : (w.pnlPerCapitalDay != null ? w.pnlPerCapitalDay * 365 : null);
              const archetype = archetypes[i] ?? "S4Long";
              const seriesWMed = w.topSeriesWeightedMedianDays;
              return (
                <div key={w.address} className="bg-surface-1 border border-border rounded-lg p-4 relative overflow-hidden">
                  {/* Archetype badge */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-blue px-2 py-0.5 bg-blue/10 rounded-full">
                      {archetype}
                    </span>
                    <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                      w.s4Score>=75?"bg-green/15 text-green":w.s4Score>=60?"bg-yellow/15 text-yellow":"bg-orange/15 text-orange"
                    }`}>score {w.s4Score}</span>
                  </div>

                  {/* Wallet name */}
                  <Link href={`/wallet/${w.address}`}
                    className="text-cyan hover:text-cyan/80 font-semibold text-sm block mb-3 truncate">
                    {w.name || w.address?.slice(0,14)}
                  </Link>

                  {/* 7 key metrics */}
                  <div className="space-y-2">
                    {[
                      { label: "Top Series Hedge",      val: w.topSeriesHedgeRatio   != null ? `${(w.topSeriesHedgeRatio*100).toFixed(0)}%`  : "—", color: w.topSeriesHedgeRatio>=0.5?"text-green":"text-yellow" },
                      { label: "Top Series Notional",   val: w.topSeriesGrossNotional!= null ? fmtK(w.topSeriesGrossNotional)                : "—", color: "" },
                      { label: "W.Med Days (series)",   val: seriesWMed              != null ? `${seriesWMed.toFixed(0)}d`                   : "—", color: "text-blue" },
                      { label: "W.Med Days (wallet)",   val: w.weightedMedianDaysToResolution != null ? `${w.weightedMedianDaysToResolution.toFixed(0)}d` : "—", color: "text-muted-foreground" },
                      { label: "Capital-Days",          val: w.capitalDays           != null ? fmtK(w.capitalDays)                           : "—", color: "" },
                      { label: "Sports PnL (est.)",            val: w.sportsPnl             != null ? fmtK(w.sportsPnl)                              : "—", color: (w.sportsPnl??0)>0?"text-green":"text-red-400" },
                      { label: "Sports PnL/cap·d (est.)",      val: w.sportsPnlPerCapitalDay!= null ? `$${w.sportsPnlPerCapitalDay.toFixed(4)}`      : "no endDate", color: (w.sportsPnlPerCapitalDay??0)>0?"text-green":"text-red-400" },
                      { label: "Annualized ROIC proxy", val: annualizedRoic          != null ? `${(annualizedRoic*100).toFixed(1)}%/yr`      : "—", color: annualizedRoic!=null&&annualizedRoic>0?"text-green font-bold":"text-muted-foreground" },
                    ].map(({label,val,color})=>(
                      <div key={label} className="flex justify-between items-baseline">
                        <span className="text-[11px] text-muted-foreground">{label}</span>
                        <span className={`text-xs font-mono ${color}`}>{val}</span>
                      </div>
                    ))}
                  </div>

                  {/* Horizon bar */}
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <p className="text-[10px] text-muted-foreground mb-1.5">Horizon profile</p>
                    <div className="flex h-2 rounded-full overflow-hidden gap-px">
                      {w.resolutionBuckets && Object.entries(BUCKET_COLORS).filter(([k])=>k!=="unknown").map(([k,clr])=>{
                        const n = w.resolutionBuckets[k]??0;
                        const total = Object.entries(w.resolutionBuckets).filter(([kk])=>kk!=="unknown").reduce((s:number,[,v])=>s+(v as number),0)||1;
                        return n>0 ? <div key={k} style={{width:`${(n/total)*100}%`,background:clr}} title={`${BUCKET_LABELS[k]}: ${n}`}/> : null;
                      })}
                    </div>
                    <div className="flex justify-between mt-1 text-[9px] text-muted-foreground">
                      <span className="text-red-400">&lt;1d {w.resolutionBuckets?.under1d??0}</span>
                      <span className="text-yellow-400">1–7d {w.resolutionBuckets?.d1_to_7??0}</span>
                      <span className="text-blue-400">30–90d {w.resolutionBuckets?.d30_to_90??0}</span>
                      <span className="text-blue-300">&gt;90d {w.resolutionBuckets?.over90d??0}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Interpretation note */}
          <p className="text-[11px] text-muted-foreground mt-2">
            <span className="text-foreground font-medium">Sports PnL/cap·d</span> = sportsPnl ÷ Σ(sportsNotional × days) &nbsp;·&nbsp;
            Numerator and denominator from the same S4 universe — fixes the totalPnl/sportsCapDays mismatch. &nbsp;·&nbsp;
            <span className="text-foreground font-medium">Annualized</span> = sportsPnlPerCapDay × 365 (dimensionless rate, 1/day × 365). &nbsp;·&nbsp;
            <span className="text-orange">⚠</span> = sportsTradeShare &lt;50% — notionalShare proxy; assumes uniform PnL/notional ratio across categories, may be off 5-10× for low-sports-share wallets.
          </p>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {/* Price buckets */}
        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-1">Entry Price Distribution</h2>
          <p className="text-xs text-muted-foreground mb-3">S4 core: ¢35–¢65 mid-price entries</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={priceData}>
              <XAxis dataKey="price" tick={{fontSize:9}}/>
              <YAxis tick={{fontSize:9}}/>
              <Tooltip formatter={(v:number)=>[`${v} trades`]}/>
              <Bar dataKey="count" radius={[4,4,0,0]}>
                {priceData.map(e=><Cell key={e.key} fill={PRICE_COLORS[e.key]??"#6b7280"}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Stacked resolution buckets */}
        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-1">Horizon Profile (top 8)</h2>
          <p className="text-xs text-muted-foreground mb-2">Stacked trades by days-to-resolution at entry</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={stackData}>
              <XAxis dataKey="name" tick={{fontSize:8}}/>
              <YAxis tick={{fontSize:9}}/>
              <Tooltip/>
              {Object.keys(BUCKET_LABELS).filter(k=>k!=="unknown").map(k=>(
                <Bar key={k} dataKey={k} stackId="a" fill={BUCKET_COLORS[k]} name={BUCKET_LABELS[k]}/>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Scatter: hedge ratio vs weighted median days */}
        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium mb-1">Hedge% vs Horizon</h2>
          <p className="text-xs text-muted-foreground mb-2">Bubble size = gross notional · top-right = S4 core zone</p>
          <ResponsiveContainer width="100%" height={140}>
            <ScatterChart>
              <XAxis dataKey="x" name="W.Med Days" tick={{fontSize:9}} label={{value:"days",position:"insideBottomRight",offset:-5,fontSize:9}}/>
              <YAxis dataKey="y" name="Hedge%" tick={{fontSize:9}} label={{value:"%",angle:-90,position:"insideLeft",fontSize:9}}/>
              <ZAxis dataKey="z" range={[30,300]}/>
              <Tooltip cursor={{strokeDasharray:"3 3"}}
                content={({payload})=>{
                  if(!payload?.length) return null;
                  const d=payload[0].payload;
                  return <div className="bg-surface-2 border border-border rounded p-2 text-xs">
                    <p className="font-medium">{d.name}</p>
                    <p>Hedge: {d.y}% · Days: {d.x}</p>
                    {d.strong&&<p className="text-yellow">★ strongS4</p>}
                  </div>;
                }}
              />
              <Scatter data={scatterData} fill="#4f98a3"
                shape={(props:any)=>{
                  const {cx,cy,r,payload}=props;
                  return <circle cx={cx} cy={cy} r={r||5}
                    fill={payload.strong?"#eab308":"#4f98a3"} fillOpacity={0.75} stroke="none"/>;
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Main table */}
      <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground"/>
            S4 Wallets · click row for series drilldown
          </h2>
          <div className="flex gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"/>&lt;1d near-expiry</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"/>≥30d long-horizon</span>
            <span>★ = strongS4</span>
          </div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : wallets.length===0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">No S4 wallets found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-surface-2">
                <tr>
                  <th className="w-5 px-2 py-2"/>
                  {["Wallet","PnL","Avg Buy","Avg Size","Series","Top Series","Outcomes","Hedge%",
                    "W.Med d","Near%","Long%"].map(h=>(
                    <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">
                    <button onClick={()=>setSortBy("pnlCapDay")}
                      className={`flex items-center gap-1 transition-colors ${sortBy==="pnlCapDay"?"text-green":"text-muted-foreground hover:text-foreground"}`}>
                      PnL/cap·d {sortBy==="pnlCapDay"&&"↓"}
                    </button>
                  </th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">
                    <button onClick={()=>setSortBy("s4Score")}
                      className={`flex items-center gap-1 transition-colors ${sortBy==="s4Score"?"text-blue":"text-muted-foreground hover:text-foreground"}`}>
                      Score {sortBy==="s4Score"&&"↓"}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>{wallets.map((w:any)=><WalletRow key={w.address} w={w}/>)}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* Interpretation legend */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="p-3 bg-surface-1 border border-border rounded-lg text-xs text-muted-foreground">
          <p className="font-semibold text-foreground mb-1">Horizon × Hedge interpretation</p>
          <p><span className="text-red-400">High hedge + Near-exp%↑</span> — настоящий event-arb (редко)</p>
          <p><span className="text-orange-400">High hedge + Short%↑</span> — short-horizon sports arb</p>
          <p><span className="text-blue-400">High hedge + Long%↑</span> — seasonal capital-heavy portfolio hedge</p>
          <p><span className="text-muted-foreground">Low hedge + Long%↑</span> — directional bettor, не S4</p>
        </div>
        <div className="p-3 bg-surface-1 border border-border rounded-lg text-xs text-muted-foreground">
          <p className="font-semibold text-foreground mb-1">strongS4 subtypes</p>
          <p><span className="text-yellow">★ ⚡Short</span> — hedge≥75% + shortHorizon≥50%</p>
          <p><span className="text-yellow">★ 📅Long</span> — hedge≥75% + longHorizon≥50%</p>
          <p><span className="text-muted-foreground">PnL/cap-d</span> — прокси ROIC: PnL ÷ Σ(notional × days)</p>
          <p><span className="text-muted-foreground">W.Med d</span> — notional-weighted median days to resolution</p>
        </div>
      </div>
    </div>
  );
}
