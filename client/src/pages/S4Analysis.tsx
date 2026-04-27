import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { ArrowLeft, Trophy, TrendingUp, Shield } from "lucide-react";

const fmtK = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n/1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const c   = (n: number) => `¢${(n * 100).toFixed(0)}`;

const PRICE_COLORS: Record<string, string> = {
  "under0.35": "#6b7280",
  "0.35-0.50": "#3b82f6",
  "0.50-0.65": "#8b5cf6",
  "0.65-0.80": "#f59e0b",
  "0.80-0.95": "#f97316",
  "0.95+":     "#dc2626",
};

export default function S4Analysis() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/s4-analysis"],
    refetchInterval: 120_000,
  });

  const wallets  = data?.s4Wallets ?? [];
  const summary  = data?.summary   ?? {};

  // Aggregate price buckets across all S4 wallets
  const globalPrice: Record<string, number> = {
    "under0.35": 0, "0.35-0.50": 0, "0.50-0.65": 0,
    "0.65-0.80": 0, "0.80-0.95": 0, "0.95+": 0,
  };
  wallets.forEach((w: any) =>
    Object.entries(w.priceBuckets ?? {}).forEach(([k, v]) => {
      globalPrice[k] = (globalPrice[k] ?? 0) + (v as number);
    })
  );
  const priceData = Object.entries(globalPrice).map(([price, count]) => ({ price, count }));

  // Hedge ratio distribution
  const hedgeBuckets = [
    { label: "0–25%",  count: wallets.filter((w: any) => w.hedgeRatio < 0.25).length },
    { label: "25–50%", count: wallets.filter((w: any) => w.hedgeRatio >= 0.25 && w.hedgeRatio < 0.50).length },
    { label: "50–75%", count: wallets.filter((w: any) => w.hedgeRatio >= 0.50 && w.hedgeRatio < 0.75).length },
    { label: "75–100%",count: wallets.filter((w: any) => w.hedgeRatio >= 0.75).length },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow" />
            S4 — Seasonal Sports Arb Analysis
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Сезонный спортивный арбитраж · вход ¢35–¢72 · хеджирование YES/NO · крупный капитал
          </p>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "S4 кошельков",        value: String(summary.withSportsTrades ?? "—"),                                      icon: <Trophy className="w-4 h-4 text-yellow" /> },
          { label: "Avg Hedge Ratio",      value: summary.avgHedgeRatio != null ? pct(summary.avgHedgeRatio) : "—",            icon: <Shield className="w-4 h-4 text-blue" /> },
          { label: "Avg Sports Buy Price", value: summary.avgSportsBuyPrice != null ? c(summary.avgSportsBuyPrice) : "—",      icon: <TrendingUp className="w-4 h-4 text-green" /> },
          { label: "Кандидатов отсканировано", value: String(summary.totalScanned ?? "—"),                                     icon: <TrendingUp className="w-4 h-4 text-muted-foreground" /> },
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
          <h2 className="text-sm font-medium text-foreground mb-1">Цена входа на спортивных рынках</h2>
          <p className="text-xs text-muted-foreground mb-3">
            S4 ядро: покупки по ¢35–¢65 задолго до финала сезона
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

        <div className="bg-surface-1 border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-foreground mb-1">Hedge Ratio распределение</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Доля рынков где трейдер купил И продал — признак хеджирования YES+NO
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={hedgeBuckets}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`${v} кошельков`]} />
              <Bar dataKey="count" fill="var(--color-blue)" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">S4 Кошельки — детальная таблица</h2>
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
                  {["Кошелёк","WR","PnL","Sports трейды","Avg Buy¢","Avg Sell¢","Avg Size","Hedge%","Рынков","Топ рынок"].map(h => (
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
                    <td className="px-3 py-2 font-mono">{w.sportsBuyCount ?? 0}B / {w.sportsSellCount ?? 0}S</td>
                    <td className="px-3 py-2 font-mono text-blue">{c(w.avgSportsBuyPrice ?? 0)}</td>
                    <td className="px-3 py-2 font-mono text-orange">{c(w.avgSportsSellPrice ?? 0)}</td>
                    <td className="px-3 py-2 font-mono">{fmtK(w.avgSportsTradeSize ?? 0)}</td>
                    <td className="px-3 py-2 font-mono text-yellow font-semibold">{pct(w.hedgeRatio ?? 0)}</td>
                    <td className="px-3 py-2 font-mono">{w.totalMarkets ?? 0}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">
                      {w.topMarkets?.[0]?.title?.slice(0, 40) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 p-4 bg-blue/5 border border-blue/20 rounded-lg">
        <p className="text-xs text-muted-foreground">
          <span className="text-blue font-semibold">S4 Логика:</span>{" "}
          Покупает YES команды A по ¢40 + хеджирует SELL YES команды B по ¢60.
          Итого вход: ¢40 + ¢40 = ¢80. Выплата: $1.00. Маржа ¢20.
          Hedge Ratio {">"} 50% = подтверждённый хедж. Avg Buy ¢35–¢55 = типичный вход до старта сезона.
        </p>
      </div>
    </div>
  );
}
