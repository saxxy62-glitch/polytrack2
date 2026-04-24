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
import type { WalletStats } from "@shared/schema";

// ── helpers ──────────────────────────────────────────────────────────────────
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

// ── Momentum badge ────────────────────────────────────────────────────────────
// Shows 30d PNL and a "hot/cold" indicator relative to all-time
function MomentumCell({
  pnl30d,
  pnlAll,
}: {
  pnl30d: number | null | undefined;
  pnlAll: number | null | undefined;
}) {
  if (pnl30d == null) {
    return <span className="text-muted-foreground font-mono text-xs">—</span>;
  }

  const p30 = pnl30d ?? 0;
  const pAll = pnlAll ?? 0;

  // Ratio: how much of all-time PNL came in the last 30 days
  // >25% = hot, <5% = living on old wins, negative = drawdown
  const ratio = pAll !== 0 ? p30 / Math.abs(pAll) : 0;

  let badge = "";
  let badgeClass = "";
  if (p30 < 0) {
    badge = "▼ drawdown";
    badgeClass = "bg-red/10 text-red border-red/20";
  } else if (ratio >= 0.25) {
    badge = "🔥 hot";
    badgeClass = "bg-green/10 text-green border-green/20";
  } else if (ratio >= 0.05) {
    badge = "active";
    badgeClass = "bg-cyan/10 text-cyan border-cyan/20";
  } else {
    badge = "old wins";
    badgeClass = "bg-surface-3 text-muted-foreground border-border";
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <span className={p30 >= 0 ? "text-green font-mono text-xs" : "text-red font-mono text-xs"}>
        {p30 >= 0 ? "+" : ""}{fmtK(p30)}
      </span>
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${badgeClass}`}>
        {badge}
      </span>
    </div>
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
function TopPnlChart({ wallets }: { wallets: WalletStats[] }) {
  const data = wallets.slice(0, 15).map(w => ({
    name: w.pseudonym || w.address.slice(0, 6) + "…",
    pnl: w.totalPnl ?? 0,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 32, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={v => fmtK(v).replace("$", "")} />
        <Tooltip
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          formatter={(v: number) => [fmtK(v), "PNL"]}
        />
        <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? "hsl(var(--green))" : "hsl(var(--red))"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EvScatter({ wallets }: { wallets: WalletStats[] }) {
  const data = wallets.map(w => ({
    ev: Math.round((w.avgEv ?? 0) * 100) / 100,
    winRate: Math.round((w.winRate ?? 0) * 100),
    name: w.pseudonym || w.address.slice(0, 8),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="ev" name="Avg EV" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
          label={{ value: "Avg EV", position: "insideBottom", offset: -2, fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
        <YAxis dataKey="winRate" name="Win Rate %" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
          label={{ value: "Win%", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          formatter={(v, name) => [name === "winRate" ? `${v}%` : v, name === "winRate" ? "Win Rate" : "Avg EV"]}
        />
        <Scatter data={data} fill="hsl(var(--cyan))" fillOpacity={0.7} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function CategoryPie({ wallets }: { wallets: WalletStats[] }) {
  const counts: Record<string, number> = {};
  wallets.forEach(w => {
    try {
      const cats = JSON.parse(w.markets ?? "[]") as string[];
      cats.forEach(c => { counts[c] = (counts[c] ?? 0) + 1; });
    } catch {}
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

// ── Wallet table row ──────────────────────────────────────────────────────────
function WalletRow({
  wallet, rank, selected, onSelect, pnl30d,
}: {
  wallet: WalletStats; rank: number; selected: boolean; onSelect: () => void; pnl30d: number | null;
}) {
  const categories: string[] = (() => { try { return JSON.parse(wallet.markets ?? "[]"); } catch { return []; } })();

  return (
    <tr
      onClick={onSelect}
      data-testid={`row-wallet-${wallet.address}`}
      className={`border-b border-border cursor-pointer transition-colors duration-100 ${selected ? "bg-surface-3" : "hover:bg-surface-2"}`}
    >
      <td className="px-3 py-2.5 text-center">
        <span className={`font-mono text-sm ${rank <= 3 ? "text-yellow font-semibold" : "text-muted-foreground"}`}>
          {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <Link
            href={`/wallet/${wallet.address}`}
            onClick={e => e.stopPropagation()}
            className="text-sm font-medium text-foreground hover:text-cyan transition-colors"
          >
            {wallet.pseudonym || wallet.name || wallet.address.slice(0, 10) + "…"}
          </Link>
          <span className="text-[10px] font-mono text-muted-foreground">{wallet.address.slice(0, 8)}…{wallet.address.slice(-4)}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <PnlSpan val={wallet.totalPnl} />
      </td>
      {/* 30d PNL vs All-time column */}
      <td className="px-3 py-2.5 text-right">
        <MomentumCell pnl30d={pnl30d} pnlAll={wallet.totalPnl} />
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
function FiltersBar({
  sort, setSort,
  minWinRate, setMinWinRate,
  minEv, setMinEv,
  minTrades, setMinTrades,
  timePeriod, setTimePeriod,
  apiCategory, setApiCategory,
  search, setSearch,
}: any) {
  const apiCategories = [
    { label: "All Markets", value: "OVERALL" },
    { label: "Politics", value: "POLITICS" },
    { label: "Sports", value: "SPORTS" },
    { label: "Crypto", value: "CRYPTO" },
    { label: "Finance", value: "FINANCE" },
    { label: "Culture", value: "CULTURE" },
    { label: "Economics", value: "ECONOMICS" },
    { label: "Tech", value: "TECH" },
    { label: "Weather", value: "WEATHER" },
  ];

  return (
    <div className="flex flex-wrap gap-3 items-center p-3 bg-surface-1 border border-border rounded-lg mb-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Period</span>
        <Select value={timePeriod} onValueChange={setTimePeriod}>
          <SelectTrigger data-testid="select-period" className="h-7 w-24 text-xs bg-surface-2 border-border">
            <SelectValue />
          </SelectTrigger>
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
          <SelectTrigger data-testid="select-api-category" className="h-7 w-32 text-xs bg-surface-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            {apiCategories.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Sort by</span>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger data-testid="select-sort" className="h-7 w-32 text-xs bg-surface-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="pnl">PNL</SelectItem>
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
          <Slider
            data-testid="slider-winrate"
            min={0} max={100} step={5}
            value={[minWinRate * 100]}
            onValueChange={([v]: number[]) => setMinWinRate(v / 100)}
            className="cursor-pointer"
          />
        </div>
        <span className="text-xs font-mono text-cyan w-8">{(minWinRate * 100).toFixed(0)}%</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Min EV</span>
        <div className="w-24">
          <Slider
            data-testid="slider-ev"
            min={0} max={50} step={1}
            value={[minEv]}
            onValueChange={([v]: number[]) => setMinEv(v)}
            className="cursor-pointer"
          />
        </div>
        <span className="text-xs font-mono text-cyan w-6">{minEv}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Min Trades</span>
        <Input
          data-testid="input-min-trades"
          type="number" value={minTrades}
          onChange={e => setMinTrades(parseInt(e.target.value) || 0)}
          className="h-7 w-16 text-xs bg-surface-2 border-border font-mono"
          min={0}
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <Input
          data-testid="input-search"
          placeholder="Search wallet..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-7 w-40 text-xs bg-surface-2 border-border"
        />
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
  const [minWinRate, setMinWinRate] = useState(0);
  const [minEv, setMinEv] = useState(0);
  const [minTrades, setMinTrades] = useState(0);
  const [timePeriod, setTimePeriod] = useState("MONTH");
  const [apiCategory, setApiCategory] = useState("OVERALL");
  const [search, setSearch] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["/api/status"],
    refetchInterval: 3000,
  });

  // Primary leaderboard (respects current period/category filters)
  const primaryKey = `/api/leaderboard?limit=100&timePeriod=${timePeriod}&orderBy=${sort === "volume" ? "VOL" : "PNL"}&category=${apiCategory}`;
  const { data: leaderboard, isLoading } = useQuery<any[]>({
    queryKey: [primaryKey],
    refetchInterval: 60000,
  });

  // Always fetch MONTH leaderboard in parallel to get 30d PNL for every wallet
  // (if timePeriod is already MONTH we reuse the same data)
  const monthKey = `/api/leaderboard?limit=100&timePeriod=MONTH&orderBy=PNL&category=${apiCategory}`;
  const { data: monthLeaderboard } = useQuery<any[]>({
    queryKey: [monthKey],
    refetchInterval: 60000,
    // skip if we're already on MONTH — same data
    enabled: timePeriod !== "MONTH",
  });

  // Build a map: address -> 30d pnl
  const monthPnlMap = new Map<string, number>();
  const monthSource = timePeriod === "MONTH" ? leaderboard : monthLeaderboard;
  (monthSource ?? []).forEach((e: any) => {
    if (e.proxyWallet) monthPnlMap.set(e.proxyWallet.toLowerCase(), e.pnl ?? 0);
  });

  // Merge leaderboard with cached wallet details (for winRate, markets etc.)
  const { data: cachedWallets } = useQuery<WalletStats[]>({
    queryKey: ["/api/wallets?sort=pnl&limit=100"],
    refetchInterval: 60000,
  });
  const cachedMap = new Map<string, WalletStats>();
  (cachedWallets ?? []).forEach(w => cachedMap.set(w.address.toLowerCase(), w));

  // Build merged display list
  const displayList: Array<any & { pnl30d: number | null }> = (leaderboard ?? []).map(e => {
    const addr = (e.proxyWallet ?? "").toLowerCase();
    const cached = cachedMap.get(addr);
    return {
      // Leaderboard fields (authoritative PNL/vol for current period)
      address: e.proxyWallet,
      pseudonym: e.userName || cached?.pseudonym || "",
      name: e.userName || cached?.name || "",
      profileImage: e.profileImage || cached?.profileImage || "",
      totalPnl: e.pnl,
      totalVolume: e.vol,
      // Supplemental from cache
      winRate: cached?.winRate ?? null,
      totalTrades: cached?.totalTrades ?? null,
      avgEv: cached?.avgEv ?? null,
      markets: cached?.markets ?? "[]",
      // 30d PNL from month leaderboard
      pnl30d: monthPnlMap.has(addr) ? (monthPnlMap.get(addr) ?? null) : null,
    };
  });

  // Apply local filters
  const filtered = displayList.filter(w => {
    if (minWinRate > 0 && (w.winRate ?? 0) < minWinRate) return false;
    if (minEv > 0 && (w.avgEv ?? 0) < minEv) return false;
    if (minTrades > 0 && (w.totalTrades ?? 0) < minTrades) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!w.address.toLowerCase().includes(q) &&
          !(w.pseudonym ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const { data: globalStats } = useQuery<any>({
    queryKey: ["/api/stats"],
    refetchInterval: 30000,
  });

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-6">
      <BootstrapBanner status={status} />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Wallets Tracked" value={(globalStats?.totalWallets ?? (status as any)?.walletCount ?? 0).toLocaleString()} sub="Active traders" accent />
        <KpiCard label="Total Volume" value={fmtK(globalStats?.totalVolume)} sub="Across all wallets" />
        <KpiCard label="Avg Win Rate" value={fmtPct(globalStats?.avgWinRate)} sub="Top wallets" />
        <KpiCard label="Trades Loaded" value={(globalStats?.totalTrades ?? 0).toLocaleString()} sub="Official Polymarket PNL" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="gradient-border rounded-lg p-4 md:col-span-1">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Top 15 by PNL</h3>
          {isLoading ? <Skeleton className="h-[220px] bg-surface-2" /> : <TopPnlChart wallets={filtered as any} />}
        </div>
        <div className="gradient-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">EV vs Win Rate</h3>
          {isLoading ? <Skeleton className="h-[220px] bg-surface-2" /> : <EvScatter wallets={filtered as any} />}
        </div>
        <div className="gradient-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Market Categories</h3>
          {isLoading ? <Skeleton className="h-[220px] bg-surface-2" /> : <CategoryPie wallets={filtered as any} />}
        </div>
      </div>

      {/* Filters */}
      <FiltersBar
        sort={sort} setSort={setSort}
        minWinRate={minWinRate} setMinWinRate={setMinWinRate}
        minEv={minEv} setMinEv={setMinEv}
        minTrades={minTrades} setMinTrades={setMinTrades}
        timePeriod={timePeriod} setTimePeriod={setTimePeriod}
        apiCategory={apiCategory} setApiCategory={setApiCategory}
        search={search} setSearch={setSearch}
      />

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
                {["#", "Wallet", "PNL", "30d PNL / Form", "Win Rate", "Trades", "Avg EV", "Volume", "Markets"].map(h => (
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
                      {Array.from({ length: 9 }).map((_, j) => (
                        <td key={j} className="px-3 py-2.5"><Skeleton className="h-4 bg-surface-2 rounded" /></td>
                      ))}
                    </tr>
                  ))
                : filtered.map((w, i) => (
                    <WalletRow
                      key={w.address}
                      wallet={w as any}
                      rank={i + 1}
                      selected={selectedWallet === w.address}
                      onSelect={() => setSelectedWallet(selectedWallet === w.address ? null : w.address)}
                      pnl30d={w.pnl30d}
                    />
                  ))
              }
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground text-sm">
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
