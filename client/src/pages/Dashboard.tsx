import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { WalletStats } from "@shared/schema";

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number | null | undefined, decimals = 2) =>
  n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const fmtK = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtPct = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(1)}%`;

function timeAgo(ts: number | null | undefined): string {
  if (!ts || ts === 0) return "—";
  const secs = Math.floor(Date.now() / 1000) - ts;
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function isRecent(ts: number | null | undefined, days = 7): boolean {
  if (!ts || ts === 0) return false;
  return (Math.floor(Date.now() / 1000) - ts) < days * 86400;
}

function PnlSpan({ val }: { val: number | null | undefined }) {
  const v = val ?? 0;
  return <span className={v >= 0 ? "text-green font-mono" : "text-red font-mono"}>{v >= 0 ? "+" : ""}{fmt(v)}</span>;
}

function CategoryBadge({ cat }: { cat: string }) {
  const colors: Record<string, string> = {
    Crypto: "bg-yellow/10 text-yellow border-yellow/20",
    Politics: "bg-purple/10 text-purple border-purple/20",
    Sports: "bg-cyan/10 text-cyan border-cyan/20",
    Economics: "bg-green/10 text-green border-green/20",
    Tech: "bg-blue-400/10 text-blue-400 border-blue-400/20",
    Weather: "bg-sky-400/10 text-sky-400 border-sky-400/20",
    Other: "bg-surface-3 text-muted-foreground border-border",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors[cat] ?? colors.Other}`}>
      {cat}
    </span>
  );
}

// ── Momentum cell: 30d PNL + badge ────────────────────────────────────────────
function MomentumCell({ pnl30d, pnlAll }: { pnl30d: number | null; pnlAll: number | null | undefined }) {
  if (pnl30d == null) return <span className="text-muted-foreground font-mono text-xs">—</span>;
  const ratio = (pnlAll && pnlAll !== 0) ? pnl30d / Math.abs(pnlAll) : 0;
  let badge = ""; let cls = "";
  if (pnl30d < 0)       { badge = "▼ drawdown"; cls = "bg-red/10 text-red border-red/20"; }
  else if (ratio >= 0.25) { badge = "🔥 hot";     cls = "bg-green/10 text-green border-green/20"; }
  else if (ratio >= 0.05) { badge = "active";     cls = "bg-cyan/10 text-cyan border-cyan/20"; }
  else                   { badge = "old wins";    cls = "bg-surface-3 text-muted-foreground border-border"; }

  return (
    <div className="flex flex-col items-end gap-1">
      <span className={pnl30d >= 0 ? "text-green font-mono text-xs" : "text-red font-mono text-xs"}>
        {pnl30d >= 0 ? "+" : ""}{fmtK(pnl30d)}
      </span>
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>{badge}</span>
    </div>
  );
}

// ── Last trade cell ───────────────────────────────────────────────────────────
function LastTradeCell({ ts }: { ts: number | null | undefined }) {
  const recent = isRecent(ts, 7);
  return (
    <span className={`font-mono text-xs ${recent ? "text-green" : "text-muted-foreground"}`}>
      {timeAgo(ts)}
      {recent && <span className="ml-1 text-[9px] text-green/70">●</span>}
    </span>
  );
}

// ── Near-expiry arb flag ───────────────────────────────────────────────
// Classic arb: WR>95% + avg entry >0.90 (kch123, sports arb)
// OR scalper arb: avg entry >0.85 + tiny ROI <2% (Sharky-type, crypto Up/Down)
function NearExpiryArbBadge({ winRate, avgBuyPrice, avgEv }: {
  winRate: number | null | undefined;
  avgBuyPrice: number | null | undefined;
  avgEv: number | null | undefined;
}) {
  const classicArb = (winRate ?? 0) > 0.95 && (avgBuyPrice ?? 0) > 0.90;
  const scalperArb = (avgBuyPrice ?? 0) > 0.85 && (avgEv ?? 1) < 0.02;
  if (!classicArb && !scalperArb) return null;
  const reason = classicArb
    ? `WR ${((winRate ?? 0) * 100).toFixed(0)}% + avg entry ¢${((avgBuyPrice ?? 0) * 100).toFixed(0)}`
    : `avg entry ¢${((avgBuyPrice ?? 0) * 100).toFixed(0)} + ROI ${((avgEv ?? 0) * 100).toFixed(1)}%`;
  return (
    <span
      title={`${reason} — near-expiry arbitrage, not predictive edge`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-orange/10 text-orange border-orange/30 ml-1 cursor-help"
    >
      ⚠️ near-expiry arb
    </span>
  );
}

// ── Crypto scalper flag — >60% Up/Down intraday trades + avgBuyPrice >0.90 ─────────
// Sharky-type bots: scan BTC/ETH/SOL 1h price markets, buy near-certain outcome
function CryptoScalperBadge({ avgUpDownRatio, avgBuyPrice }: {
  avgUpDownRatio: number | null | undefined;
  avgBuyPrice: number | null | undefined;
}) {
  const isScalper = (avgUpDownRatio ?? 0) > 0.60 && (avgBuyPrice ?? 0) > 0.90;
  if (!isScalper) return null;
  return (
    <span
      title={`${((avgUpDownRatio ?? 0) * 100).toFixed(0)}% of trades on Up/Down crypto markets @ avg ¢${((avgBuyPrice ?? 0) * 100).toFixed(0)} — intraday crypto scalper bot`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-red/10 text-red border-red/20 ml-1 cursor-help"
    >
      🤖 crypto scalper
    </span>
  );
}

// ── Weather bot flag — >50% trades on weather/temperature markets ──────────────
// automatedaitradingbot-type: buys YES at 5¢ on temperature buckets using met forecasts
// Reproducible edge, but strategy is domain-specific (needs weather data pipeline)
function WeatherBotBadge({ avgWeatherRatio }: { avgWeatherRatio: number | null | undefined }) {
  const isWeather = (avgWeatherRatio ?? 0) > 0.50;
  if (!isWeather) return null;
  return (
    <span
      title={`${((avgWeatherRatio ?? 0) * 100).toFixed(0)}% of trades on weather/temperature markets — weather-data bot (reproducible edge, requires met pipeline)`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-cyan/10 text-cyan border-cyan/20 ml-1 cursor-help"
    >
      🌤️ weather bot
    </span>
  );
}

// ── Whale flag — avg trade >$10K + >50 trades ────────────────────────────────
// High-volume players like elkmonkey: large trades AND many of them.
function WhaleBadge({ avgTradeSize, totalTrades }: { avgTradeSize: number | null | undefined; totalTrades: number | null | undefined }) {
  const isWhale = (avgTradeSize ?? 0) > 10_000 && (totalTrades ?? 0) > 50;
  if (!isWhale) return null;
  return (
    <span
      title={`Avg trade $${Math.round(avgTradeSize ?? 0).toLocaleString()} × ${(totalTrades ?? 0).toLocaleString()} trades — high-volume whale`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-cyan/10 text-cyan border-cyan/30 ml-1 cursor-help"
    >
      🐋 whale
    </span>
  );
}

// ── Low-liquidity sniper flag — avg trade >$500 + <20 total trades ───────────────
// These wallets place large concentrated bets on thinly traded markets.
// High PNL may be survivorship bias; hard to replicate at scale.
function LowLiqSniperBadge({ avgTradeSize, totalTrades }: { avgTradeSize: number | null | undefined; totalTrades: number | null | undefined }) {
  const isSniper = (avgTradeSize ?? 0) > 500 && (totalTrades ?? 999) < 20;
  if (!isSniper) return null;
  return (
    <span
      title={`Avg trade $${Math.round(avgTradeSize ?? 0).toLocaleString()} × ${totalTrades ?? 0} trades — concentrated low-liquidity bets; hard to copy at scale`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-purple/10 text-purple border-purple/30 ml-1 cursor-help"
    >
      🎯 low-liq sniper
    </span>
  );
}

// ── "Copyable" badge — composite filter indicator ─────────────────────────────
function CopyableBadge({ lastTs, avgEv }: { lastTs: number | null | undefined; avgEv: number | null | undefined }) {
  const ok = isRecent(lastTs, 7) && (avgEv ?? 0) >= 0.03;
  if (!ok) return null;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-yellow/10 text-yellow border-yellow/30 ml-1">
      ✓ copyable
    </span>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`gradient-border rounded-lg p-4 ${accent ? "glow-green" : ""}`}>
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-semibold font-mono text-foreground">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────
function TopPnlChart({ wallets }: { wallets: any[] }) {
  const data = wallets.slice(0, 15).map(w => ({
    name: w.pseudonym || w.address?.slice(0, 6) + "…",
    pnl: w.totalPnl ?? 0,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 32, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={v => fmtK(v).replace("$", "")} />
        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [fmtK(v), "PNL"]} />
        <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? "hsl(var(--green))" : "hsl(var(--red))"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EvScatter({ wallets }: { wallets: any[] }) {
  const data = wallets.map(w => ({
    ev: Math.round((w.avgEv ?? 0) * 100) / 100,
    winRate: Math.round((w.winRate ?? 0) * 100),
    name: w.pseudonym || w.address?.slice(0, 8),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="ev" name="Avg EV" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
          label={{ value: "Avg EV", position: "insideBottom", offset: -2, fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
        <YAxis dataKey="winRate" name="Win Rate %" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
          label={{ value: "Win%", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          formatter={(v, name) => [name === "winRate" ? `${v}%` : v, name === "winRate" ? "Win Rate" : "Avg EV"]} />
        <Scatter data={data} fill="hsl(var(--cyan))" fillOpacity={0.7} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function CategoryPie({ wallets }: { wallets: any[] }) {
  const counts: Record<string, number> = {};
  wallets.forEach(w => {
    try { (JSON.parse(w.markets ?? "[]") as string[]).forEach(c => { counts[c] = (counts[c] ?? 0) + 1; }); } catch {}
  });
  const data = Object.entries(counts).map(([name, value]) => ({ name, value }));
  const COLORS = ["hsl(var(--yellow))", "hsl(var(--purple))", "hsl(var(--cyan))", "hsl(var(--green))", "hsl(var(--red))", "hsl(var(--muted-foreground))"];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Wallet row ────────────────────────────────────────────────────────────────
function WalletRow({ wallet, rank, selected, onSelect, pnl30d }: {
  wallet: any; rank: number; selected: boolean; onSelect: () => void; pnl30d: number | null;
}) {
  const categories: string[] = (() => { try { return JSON.parse(wallet.markets ?? "[]"); } catch { return []; } })();
  return (
    <tr onClick={onSelect} data-testid={`row-wallet-${wallet.address}`}
      className={`border-b border-border cursor-pointer transition-colors duration-100 ${selected ? "bg-surface-3" : "hover:bg-surface-2"}`}>
      <td className="px-3 py-2.5 text-center">
        <span className={`font-mono text-sm ${rank <= 3 ? "text-yellow font-semibold" : "text-muted-foreground"}`}>
          {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1 flex-wrap">
            <Link href={`/wallet/${wallet.address}`} onClick={e => e.stopPropagation()}
              className="text-sm font-medium text-foreground hover:text-cyan transition-colors">
              {wallet.pseudonym || wallet.name || wallet.address?.slice(0, 10) + "…"}
            </Link>
            <CopyableBadge lastTs={wallet.lastTradeTimestamp} avgEv={wallet.avgEv} />
            <WeatherBotBadge avgWeatherRatio={wallet.avgWeatherRatio} />
            <NearExpiryArbBadge winRate={wallet.winRate} avgBuyPrice={wallet.avgBuyPrice} avgEv={wallet.avgEv} />
            <CryptoScalperBadge avgUpDownRatio={wallet.avgUpDownRatio} avgBuyPrice={wallet.avgBuyPrice} />
            <LowLiqSniperBadge avgTradeSize={wallet.avgTradeSize} totalTrades={wallet.totalTrades} />
            <WhaleBadge avgTradeSize={wallet.avgTradeSize} totalTrades={wallet.totalTrades} />
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">{wallet.address?.slice(0, 8)}…{wallet.address?.slice(-4)}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right"><PnlSpan val={wallet.totalPnl} /></td>
      <td className="px-3 py-2.5 text-right">
        <MomentumCell pnl30d={pnl30d} pnlAll={wallet.totalPnl} />
      </td>
      {/* 30d trade count */}
      <td className="px-3 py-2.5 text-right">
        <span className={`font-mono text-xs ${(wallet.trades30d ?? 0) > 0 ? "text-foreground" : "text-muted-foreground"}`}>
          {wallet.trades30d ?? "—"}
        </span>
      </td>
      {/* Last trade */}
      <td className="px-3 py-2.5 text-right">
        <LastTradeCell ts={wallet.lastTradeTimestamp} />
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className={`font-mono text-sm ${(wallet.winRate ?? 0) >= 0.55 ? "text-green" : (wallet.winRate ?? 0) >= 0.45 ? "text-foreground" : "text-red"}`}>
          {fmtPct(wallet.winRate)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="font-mono text-sm text-foreground">{(wallet.totalTrades ?? 0).toLocaleString()}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="font-mono text-sm text-cyan">{fmt(wallet.avgEv, 1)}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="font-mono text-sm text-muted-foreground">{fmtK(wallet.totalVolume)}</span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1 flex-wrap">
          {categories.slice(0, 2).map(c => <CategoryBadge key={c} cat={c} />)}
        </div>
      </td>
    </tr>
  );
}

// ── Filters bar ───────────────────────────────────────────────────────────────
function FiltersBar({ sort, setSort, minWinRate, setMinWinRate, minEv, setMinEv,
  minTrades, setMinTrades, timePeriod, setTimePeriod, apiCategory, setApiCategory,
  search, setSearch, onlyHot, setOnlyHot, onlyCopyable, setOnlyCopyable, sort30d, setSort30d }: any) {

  const apiCategories = [
    { label: "All Markets", value: "OVERALL" }, { label: "Politics", value: "POLITICS" },
    { label: "Sports", value: "SPORTS" }, { label: "Crypto", value: "CRYPTO" },
    { label: "Finance", value: "FINANCE" }, { label: "Culture", value: "CULTURE" },
    { label: "Economics", value: "ECONOMICS" }, { label: "Tech", value: "TECH" },
    { label: "Weather", value: "WEATHER" },
  ];

  return (
    <div className="flex flex-wrap gap-3 items-center p-3 bg-surface-1 border border-border rounded-lg mb-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Period</span>
        <Select value={timePeriod} onValueChange={setTimePeriod}>
          <SelectTrigger data-testid="select-period" className="h-7 w-24 text-xs bg-surface-2 border-border"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="ALL">All Time</SelectItem>
            <SelectItem value="MONTH">Month</SelectItem>
            <SelectItem value="WEEK">Week</SelectItem>
            <SelectItem value="DAY">Day</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Category</span>
        <Select value={apiCategory} onValueChange={setApiCategory}>
          <SelectTrigger data-testid="select-api-category" className="h-7 w-32 text-xs bg-surface-2 border-border"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            {apiCategories.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Sort by</span>
        <Select value={sort} onValueChange={(v) => { setSort(v); if (v === "pnl30d") setSort30d(true); else setSort30d(false); }}>
          <SelectTrigger data-testid="select-sort" className="h-7 w-36 text-xs bg-surface-2 border-border"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="pnl">All-time PNL</SelectItem>
            <SelectItem value="pnl30d">30d PNL ↑</SelectItem>
            <SelectItem value="win_rate">Win Rate</SelectItem>
            <SelectItem value="trade_count">Trade Count</SelectItem>
            <SelectItem value="volume">Volume</SelectItem>
            <SelectItem value="ev">Avg EV</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Min Win%</span>
        <div className="w-24">
          <Slider data-testid="slider-winrate" min={0} max={100} step={5}
            value={[minWinRate * 100]} onValueChange={([v]: number[]) => setMinWinRate(v / 100)} className="cursor-pointer" />
        </div>
        <span className="text-xs font-mono text-cyan w-8">{(minWinRate * 100).toFixed(0)}%</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Min EV</span>
        <div className="w-24">
          <Slider data-testid="slider-ev" min={0} max={50} step={1}
            value={[minEv]} onValueChange={([v]: number[]) => setMinEv(v)} className="cursor-pointer" />
        </div>
        <span className="text-xs font-mono text-cyan w-6">{minEv}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Min Trades</span>
        <Input data-testid="input-min-trades" type="number" value={minTrades}
          onChange={e => setMinTrades(parseInt(e.target.value) || 0)}
          className="h-7 w-16 text-xs bg-surface-2 border-border font-mono" min={0} />
      </div>

      {/* Quick filter toggles */}
      <div className="flex items-center gap-1.5">
        <Switch data-testid="toggle-hot" id="hot-toggle" checked={onlyHot} onCheckedChange={setOnlyHot} className="scale-75" />
        <Label htmlFor="hot-toggle" className="text-xs cursor-pointer whitespace-nowrap">🔥 Hot only</Label>
      </div>

      <div className="flex items-center gap-1.5">
        <Switch data-testid="toggle-copyable" id="copyable-toggle" checked={onlyCopyable} onCheckedChange={setOnlyCopyable} className="scale-75" />
        <Label htmlFor="copyable-toggle" className="text-xs cursor-pointer whitespace-nowrap text-yellow">✓ Copyable</Label>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <Input data-testid="input-search" placeholder="Search wallet..." value={search}
          onChange={e => setSearch(e.target.value)} className="h-7 w-40 text-xs bg-surface-2 border-border" />
      </div>
    </div>
  );
}

// ── Bootstrap progress ────────────────────────────────────────────────────────
function BootstrapBanner({ status }: { status: any }) {
  if (!status || status.bootstrapDone) return null;
  const pct = status.bootstrapTotal > 0 ? (status.bootstrapProgress / status.bootstrapTotal) * 100 : 5;
  return (
    <div className="mb-4 p-3 bg-surface-1 border border-yellow/30 rounded-lg flex items-center gap-3">
      <div className="w-1.5 h-1.5 rounded-full bg-yellow animate-pulse-live" />
      <div className="flex-1">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-yellow font-medium">Loading official Polymarket leaderboard data...</span>
          <span className="text-muted-foreground font-mono">{status.bootstrapProgress}/{status.bootstrapTotal}</span>
        </div>
        <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
          <div className="h-full bg-yellow rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [sort, setSort] = useState("pnl");
  const [sort30d, setSort30d] = useState(false);
  const [minWinRate, setMinWinRate] = useState(0);
  const [minEv, setMinEv] = useState(0);
  const [minTrades, setMinTrades] = useState(0);
  const [timePeriod, setTimePeriod] = useState("MONTH");
  const [apiCategory, setApiCategory] = useState("OVERALL");
  const [search, setSearch] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [onlyHot, setOnlyHot] = useState(false);
  const [onlyCopyable, setOnlyCopyable] = useState(false);

  const { data: status } = useQuery({ queryKey: ["/api/status"], refetchInterval: 3000 });

  // Primary leaderboard for current period/category
  const primaryKey = `/api/leaderboard?limit=100&timePeriod=${timePeriod}&orderBy=${sort === "volume" ? "VOL" : "PNL"}&category=${apiCategory}`;
  const { data: leaderboard, isLoading } = useQuery<any[]>({ queryKey: [primaryKey], refetchInterval: 60000 });

  // Always fetch MONTH leaderboard for 30d PNL column
  const monthKey = `/api/leaderboard?limit=100&timePeriod=MONTH&orderBy=PNL&category=${apiCategory}`;
  const { data: monthLeaderboard } = useQuery<any[]>({
    queryKey: [monthKey], refetchInterval: 60000,
    enabled: timePeriod !== "MONTH",
  });

  const monthPnlMap = new Map<string, number>();
  const monthSource = timePeriod === "MONTH" ? leaderboard : monthLeaderboard;
  (monthSource ?? []).forEach((e: any) => {
    if (e.proxyWallet) monthPnlMap.set(e.proxyWallet.toLowerCase(), e.pnl ?? 0);
  });

  // Cached wallet data (for winRate, trades, lastTrade, trades30d)
  const { data: cachedWallets } = useQuery<WalletStats[]>({
    queryKey: ["/api/wallets?sort=pnl&limit=100"], refetchInterval: 60000,
  });
  const cachedMap = new Map<string, WalletStats>();
  (cachedWallets ?? []).forEach(w => cachedMap.set(w.address.toLowerCase(), w));

  // Build merged display list
  const displayList = (leaderboard ?? []).map(e => {
    const addr = (e.proxyWallet ?? "").toLowerCase();
    const cached = cachedMap.get(addr);
    const pnl30d = monthPnlMap.has(addr) ? (monthPnlMap.get(addr) ?? null) : null;
    return {
      address: e.proxyWallet,
      pseudonym: e.userName || cached?.pseudonym || "",
      name: e.userName || cached?.name || "",
      profileImage: e.profileImage || cached?.profileImage || "",
      totalPnl: e.pnl,
      totalVolume: e.vol,
      winRate: cached?.winRate ?? null,
      totalTrades: cached?.totalTrades ?? null,
      avgEv: cached?.avgEv ?? null,
      markets: cached?.markets ?? "[]",
      lastTradeTimestamp: cached?.lastTradeTimestamp ?? null,
      trades30d: cached?.trades30d ?? null,
      pnl30d,
    };
  });

  // Momentum helper for filter
  function getMomentum(w: typeof displayList[0]): "hot" | "active" | "old" | "drawdown" {
    const p30 = w.pnl30d ?? 0;
    const pAll = w.totalPnl ?? 0;
    const ratio = pAll !== 0 ? p30 / Math.abs(pAll) : 0;
    if (p30 < 0) return "drawdown";
    if (ratio >= 0.25) return "hot";
    if (ratio >= 0.05) return "active";
    return "old";
  }

  // Apply filters
  let filtered = displayList.filter(w => {
    if (minWinRate > 0 && (w.winRate ?? 0) < minWinRate) return false;
    if (minEv > 0 && (w.avgEv ?? 0) < minEv) return false;
    if (minTrades > 0 && (w.totalTrades ?? 0) < minTrades) return false;
    if (onlyHot && getMomentum(w) !== "hot") return false;
    if (onlyCopyable && !(isRecent(w.lastTradeTimestamp, 7) && (w.avgEv ?? 0) >= 0.03)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!w.address.toLowerCase().includes(q) && !(w.pseudonym ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sort by 30d PNL if selected
  if (sort30d) {
    filtered = [...filtered].sort((a, b) => (b.pnl30d ?? -Infinity) - (a.pnl30d ?? -Infinity));
  }

  const { data: globalStats } = useQuery<any>({ queryKey: ["/api/stats"], refetchInterval: 30000 });

  // Count copyable wallets for banner
  const copyableCount = displayList.filter(w => isRecent(w.lastTradeTimestamp, 7) && (w.avgEv ?? 0) >= 0.03).length;

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-6">
      <BootstrapBanner status={status} />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Wallets Tracked" value={(globalStats?.totalWallets ?? (status as any)?.walletCount ?? 0).toLocaleString()} sub="Active traders" accent />
        <KpiCard label="Total Volume" value={fmtK(globalStats?.totalVolume)} sub="Across all wallets" />
        <KpiCard label="Avg Win Rate" value={fmtPct(globalStats?.avgWinRate)} sub="Top wallets" />
        <KpiCard label="Copyable Now" value={String(copyableCount)} sub="Last 7d active + EV ≥ 0.03" accent={copyableCount > 0} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="gradient-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Top 15 by PNL</h3>
          {isLoading ? <Skeleton className="h-[220px] bg-surface-2" /> : <TopPnlChart wallets={filtered} />}
        </div>
        <div className="gradient-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">EV vs Win Rate</h3>
          {isLoading ? <Skeleton className="h-[220px] bg-surface-2" /> : <EvScatter wallets={filtered} />}
        </div>
        <div className="gradient-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Market Categories</h3>
          {isLoading ? <Skeleton className="h-[220px] bg-surface-2" /> : <CategoryPie wallets={filtered} />}
        </div>
      </div>

      {/* Filters */}
      <FiltersBar
        sort={sort} setSort={setSort}
        sort30d={sort30d} setSort30d={setSort30d}
        minWinRate={minWinRate} setMinWinRate={setMinWinRate}
        minEv={minEv} setMinEv={setMinEv}
        minTrades={minTrades} setMinTrades={setMinTrades}
        timePeriod={timePeriod} setTimePeriod={setTimePeriod}
        apiCategory={apiCategory} setApiCategory={setApiCategory}
        search={search} setSearch={setSearch}
        onlyHot={onlyHot} setOnlyHot={setOnlyHot}
        onlyCopyable={onlyCopyable} setOnlyCopyable={setOnlyCopyable}
      />

      {/* Copyable callout */}
      {onlyCopyable && (
        <div className="mb-4 p-3 bg-yellow/5 border border-yellow/20 rounded-lg text-xs text-yellow/80">
          <span className="font-semibold text-yellow">✓ Copyable filter active</span>
          {" "}— показаны кошельки с последней сделкой ≤ 7 дней назад и Avg EV ≥ 0.03
        </div>
      )}

      {/* Table */}
      <div className="gradient-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Top Wallets</h2>
          <span className="text-xs text-muted-foreground font-mono">{filtered.length} results</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-wallets">
            <thead>
              <tr className="border-b border-border">
                {["#", "Wallet", "All-time PNL", "30d PNL / Form", "30d Trades", "Last Trade", "Win Rate", "Trades", "Avg EV", "Volume", "Markets"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider text-left first:text-center">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      {Array.from({ length: 11 }).map((_, j) => (
                        <td key={j} className="px-3 py-2.5"><Skeleton className="h-4 bg-surface-2 rounded" /></td>
                      ))}
                    </tr>
                  ))
                : filtered.map((w, i) => (
                    <WalletRow key={w.address} wallet={w} rank={i + 1}
                      selected={selectedWallet === w.address}
                      onSelect={() => setSelectedWallet(selectedWallet === w.address ? null : w.address)}
                      pnl30d={w.pnl30d} />
                  ))
              }
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    {(status as any)?.bootstrapDone === false
                      ? "Loading wallet data… this may take a minute."
                      : "No wallets match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
