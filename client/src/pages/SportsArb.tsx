import { useQuery } from "@tanstack/react-query";
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

export default function SportsArb() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/sports-nearexpiry"],
    refetchInterval: 120_000,
  });

  const arbers = data?.sportsArbers ?? [];
  const summary = data?.summary ?? {};

  const globalBuckets: Record<string, number> = {
    "0.93-0.95": 0, "0.95-0.97": 0, "0.97-0.99": 0, "0.99+": 0,
  };
  arbers.forEach((w: any) => {
    Object.entries(w.priceBuckets ?? {}).forEach(([k, v]) => {
      globalBuckets[k] = (globalBuckets[k] ?? 0) + (v as number);
    });
  });
  const bucketData = Object.entries(globalBuckets).map(([price, count]) => ({ price, count }));
  const totalNearExpiry = arbers.reduce((s: number, w: any) => s + w.nearExpiryCount, 0);
  const totalVolume = arbers.reduce((s: number, w: any) => s + w.nearExpiryVolume, 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Target className="w-5 h-5 text-orange" />
            Sports Near-Expiry Arb
            <span className="text-xs font-normal text-muted-foreground ml-1">S3 Feasibility</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Кошельки покупающие спортивные контракты по $0.93+ перед экспирацией
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Sports arb кошельков", value: String(summary.walletsWithNearExpiry ?? "—"), icon: <Zap className="w-4 h-4 text-orange" /> },
          { label: "Near-expiry трейдов", value: totalNearExpiry.toLocaleString(), icon: <TrendingUp className="w-4 h-4 text-green" /> },
          { label: "Объём near-expiry", value: fmtK(totalVolume), icon: <Target className="w-4 h-4 text-cyan" /> },
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

      <div className="bg-surface-1 border border-border rounded-lg p-4 mb-6">
        <h2 className="text-sm font-medium text-foreground mb-1">
          Распределение цен входа (near-expiry трейды)
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Для S3 нужен объём в бакете $0.97–0.99. Если там пусто — боты заходят раньше нас.
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={bucketData}>
            <XAxis dataKey="price" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => [`${v} трейдов`]} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {bucketData.map((e) => (
                <Cell key={e.price} fill={BUCKET_COLORS[e.price] ?? "#6b7280"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-surface-1 border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">Sports Near-Expiry Кошельки</h2>
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
                {["Кошелёк", "WR", "avgBuy", "Near-exp трейды", "$0.97-0.99", "$0.99+", "Объём", "PnL"].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {arbers.map((w: any) => (
                <tr key={w.address} className="border-b border-border/50 hover:bg-surface-2 transition-colors">
                  <td className="px-3 py-2">
                    <Link href={`/wallet/${w.address}`} className="text-cyan hover:text-cyan/80 font-medium">
                      {w.name || w.address.slice(0, 10)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-green">{((w.winRate ?? 0) * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2 font-mono">¢{((w.avgBuyPrice ?? 0) * 100).toFixed(0)}</td>
                  <td className="px-3 py-2 font-mono text-orange font-semibold">{w.nearExpiryCount}</td>
                  <td className="px-3 py-2 font-mono">{w.priceBuckets?.["0.97-0.99"] ?? 0}</td>
                  <td className="px-3 py-2 font-mono text-red">{w.priceBuckets?.["0.99+"] ?? 0}</td>
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
          <span className="text-orange font-semibold">S3 Feasibility:</span>{" "}
          Колонка "$0.97–0.99" — целевой бакет стратегии. Высокий count + WR≈100% = ниша подтверждена.
          Следующий вопрос: fill rate при нашем входе.
        </p>
      </div>
    </div>
  );
}
