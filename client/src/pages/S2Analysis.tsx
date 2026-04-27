import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ScatterChart, Scatter, ZAxis, Legend,
} from "recharts";
import { ArrowLeft, TrendingUp, Zap, Target } from "lucide-react";

const fmtK = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n/1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

const PRICE_COLORS: Record<string, string> = {
  "under0.50": "#6b7280", "0.50-0.80": "#f59e0b", "0.80-0.90": "#f97316",
  "0.90-0.95": "#ef4444", "0.95-0.99": "#dc2626", "0.99+": "#991b1b",
};
const PROX_COLORS: Record<string, string> = {
  under1h: "#dc2626", under6h: "#f97316", under24h: "#f59e0b",
  over24h: "#6b7280", unknown: "#374151",
};

export default function S2Analysis() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/s2-analysis"],
    refetchInterval: 120_000,
  });

  const wallets = data?.s2Wallets ?? [];
  const summary = data?.summary ?? {};

  // Aggregate price buckets across all wallets
  const globalPrice: Record<string, number> = {
    "under0.50": 0, "0.50-0.80": 0, "0.80-0.90": 0,
    "0.90-0.95": 0, "0.95-0.99": 0, "0.99+": 0,
  };
  const globalProx = { under1h: 0, under6h: 0, under24h: 0, over24h: 0, unknown: 0 };
  wallets.forEach((w: any) => {
    Object.entries(w.priceBuckets ?? {}).forEach(([k, v]) => { globalPrice[k] = (globalPrice[k] ?? 0) + (v as number); });
    Object.entries(w.proximityBuckets ?? {}).forEach(([k, v]) => { (globalProx as any)[k] = ((globalProx as any)[k] ?? 0) + (v as number); });
  });
  const priceData = Object.entries(globalPrice).map(([price, count]) => ({ price, count }));
  const proxData  = Object.entries(globalProx).map(([bucket, count]) => ({ bucket, count }));

  // Scatter data: x=avgUpDownRatio, y=avgUpDownBuyPrice, z=upDownBuyCount
  const scatterData = wallets.map((w: any) => ({
    x: Math.round((w.avgUpDownRatio ?? 0) * 100),
    y: Math.round((w.avgUpDownBuyPrice ?? 0) * 100),
    z: w.upDownBuyCount ?? 1,
    name: w.name || w.address?.slice(0, 10),
  }));

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow" />
            S2 — Crypto Up/Down Scalper Analysis
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Кошельки торгующие BTC/ETH/SOL Up-or-Down рынками · реальный ratio &gt; 20% · endDate via Gamma API
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "S2 кошельков найдено",    value: String(summary.totalScanned ?? "—"),           icon: <Target className="w-4 h-4 text-yellow" /> },
          { label: "С Up/Down трейдами",       value: String(summary.withUpDownTrades ?? "—"),       icon: <TrendingUp className="w-4 h-4 text-green" /> },
          { label: "Avg Up/Down buy price",    value: summary.avgUpDownBuyPrice ? `¢${(summary.avgUpDownBuyPrice*100).toFixed(0)}` : "—", icon: <Zap className="w-4 h-4 text-orange" /> },
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

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Price bucket distribution */}
        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-foreground mb-1">Цена входа на Up/Down рынках</h2>
          <p className="text-xs text-muted-foreground mb-3">
            S2 ядро: покупки по $0.95–0.99 прямо перед экспирацией
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={priceData}>
              <XAxis dataKey="price" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${v} трейдов`]} />
              <Bar dataKey="count" radius={[4,4,0,0]}>
                {priceData.map(e => <Cell key={e.price} fill={PRICE_COLORS[e.price] ?? "#6b7280"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Proximity buckets */}
        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-foreground mb-1">Proximity-to-Expiry (BUY трейды)</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Ключевой S2 сигнал: доля покупок в последний час перед закрытием
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={proxData}>
              <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${v} трейдов`]} />
              <Bar dataKey="count" radius={[4,4,0,0]}>
                {proxData.map(e => <Cell key={e.bucket} fill={PROX_COLORS[e.bucket] ?? "#6b7280"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Scatter: upDownRatio vs avgBuyPrice */}
      <div className="bg-surface-1 border border-border rounded-lg p-4 mb-6">
        <h2 className="text-sm font-medium text-foreground mb-1">
          Up/Down Ratio vs Avg Buy Price — кластер S2 ботов
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Правый верхний угол (высокий ratio + высокая цена) = классический near-expiry скальпер
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <ScatterChart>
            <XAxis dataKey="x" name="Up/Down Ratio %" unit="%" tick={{ fontSize: 10 }} label={{ value: "Up/Down Ratio %", position: "insideBottom", offset: -2, fontSize: 10 }} />
            <YAxis dataKey="y" name="Avg Buy Price ¢" unit="¢" tick={{ fontSize: 10 }} label={{ value: "Avg Buy Price ¢", angle: -90, position: "insideLeft", fontSize: 10 }} />
            <ZAxis dataKey="z" range={[40, 400]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-surface-2 border border-border rounded p-2 text-xs">
                  <p className="font-medium text-foreground">{d.name}</p>
                  <p className="text-muted-foreground">Up/Down ratio: {d.x}%</p>
                  <p className="text-muted-foreground">Avg buy price: ¢{d.y}</p>
                  <p className="text-muted-foreground">Buy trades: {d.z}</p>
                </div>
              );
            }} />
            <Scatter data={scatterData} fill="var(--color-primary)" fillOpacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">S2 Кошельки — детальная таблица</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Загрузка данных...</div>
        ) : wallets.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Нет S2 кошельков в текущей базе</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-surface-2">
                <tr>
                  {["Кошелёк","WR","PnL","UpDown%","UpDown трейды","Avg Buy¢","$0.95-0.99","$0.99+","<1h%","<6h%","unknown%"].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wallets.map((w: any) => (
                  <tr key={w.address} className="border-b border-border/50 hover:bg-surface-2 transition-colors">
                    <td className="px-3 py-2">
                      <Link href={`/wallet/${w.address}`} className="text-cyan hover:text-cyan/80 font-medium">
                        {w.name || w.address?.slice(0,10)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-green">{pct(w.winRate ?? 0)}</td>
                    <td className="px-3 py-2 font-mono text-green">{fmtK(w.totalPnl ?? 0)}</td>
                    <td className="px-3 py-2 font-mono text-yellow font-semibold">{pct(w.realUpDownRatio ?? w.avgUpDownRatio ?? 0)}</td>
                    <td className="px-3 py-2 font-mono">{w.upDownBuyCount ?? 0}B / {w.upDownSellCount ?? 0}S</td>
                    <td className="px-3 py-2 font-mono">¢{((w.avgUpDownBuyPrice ?? 0)*100).toFixed(0)}</td>
                    <td className="px-3 py-2 font-mono">{w.priceBuckets?.["0.95-0.99"] ?? 0}</td>
                    <td className="px-3 py-2 font-mono text-red">{w.priceBuckets?.["0.99+"] ?? 0}</td>
                    <td className="px-3 py-2 font-mono text-red">{pct((w.proximityBuckets?.under1h ?? 0) / Math.max(1, w.upDownBuyCount))}</td>
                    <td className="px-3 py-2 font-mono text-orange">{pct((w.proximityBuckets?.under6h ?? 0) / Math.max(1, w.upDownBuyCount))}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{pct((w.proximityBuckets?.unknown ?? 0) / Math.max(1, w.upDownBuyCount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 p-4 bg-yellow/5 border border-yellow/20 rounded-lg">
        <p className="text-xs text-muted-foreground">
          <span className="text-yellow font-semibold">⏳ Первая загрузка ~15–30 сек</span>{" "}— идёт обогащение trades через Gamma API (endDate кэшируется).
          {" "}<span className="text-yellow font-semibold">S2 Feasibility:</span>{" "}
          Если &lt;1h% высокий + avg buy ¢95+ — near-expiry скальпинг подтверждён.
          Если unknown% высокий — endDate подтягивается через Gamma API + title heuristic.
        </p>
      </div>
    </div>
  );
}
