import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";

// ── helpers ───────────────────────────────────────────────────────────────────
const fmtK = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

function timeAgo(ms: number | null | undefined): string {
  if (!ms) return "—";
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function StrengthBar({ totalSize }: { totalSize: number }) {
  // Visual bar: $10K = min, $100K+ = full
  const pct = Math.min(100, ((totalSize - 10_000) / 90_000) * 100);
  const color = pct >= 66 ? "bg-green" : pct >= 33 ? "bg-yellow" : "bg-cyan";
  return (
    <div className="w-24 h-1.5 bg-surface-3 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.max(8, pct)}%` }} />
    </div>
  );
}

function SignalTypeBadge({ isNew, tradeCount }: { isNew: number | null; tradeCount: number | null }) {
  if (isNew === 1) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border bg-yellow/10 text-yellow border-yellow/30">
        🆕 First Entry
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border bg-cyan/10 text-cyan border-cyan/30">
      📈 Accumulating #{tradeCount}
    </span>
  );
}

function PriceBadge({ price }: { price: number | null }) {
  if (price == null) return null;
  const pct = Math.round(price * 100);
  // Colour by distance from 50: green=near50, yellow=moderate, red=extreme
  const cls = Math.abs(pct - 50) < 15
    ? "bg-green/10 text-green border-green/20"
    : Math.abs(pct - 50) < 35
    ? "bg-yellow/10 text-yellow border-yellow/20"
    : "bg-red/10 text-red border-red/20";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono border ${cls}`}>
      {pct}¢
    </span>
  );
}

interface Signal {
  id: number;
  proxyWallet: string | null;
  walletName: string | null;
  conditionId: string | null;
  marketTitle: string | null;
  outcome: string | null;
  price: number | null;
  size: number | null;
  totalSize: number | null;
  tradeCount: number | null;
  isNew: number | null;
  walletEv: number | null;
  slug: string | null;
  detectedAt: number | null;
  transactionHash: string | null;
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptySignals({ bootstrapDone }: { bootstrapDone: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="text-4xl">🎯</div>
      <h3 className="text-sm font-semibold text-foreground">
        {bootstrapDone ? "Ожидаем сигналы..." : "Загрузка данных..."}
      </h3>
      <p className="text-xs text-muted-foreground max-w-sm">
        {bootstrapDone
          ? "Система мониторит Live Feed в реальном времени. Сигнал = первый вход от $1K, или накопление (до 3 сделок суммарно > $1K) на рынке 5–95¢."
          : "Дождитесь загрузки лидерборда — после этого детектор начнёт работу автоматически."}
      </p>
      <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
        <span className="px-2 py-1 rounded bg-surface-2 border border-border">EV ≥ 0.3</span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-border">Сделка ≥ $1K</span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-border">≤ 3 сделки на рынке</span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-border">Цена 5–95¢</span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-border">Только BUY</span>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Signals() {
  const [onlyNew, setOnlyNew] = useState(false);
  const [minEv, setMinEv] = useState(0.3);
  const [minSize, setMinSize] = useState(1_000);

  const { data: status } = useQuery<any>({ queryKey: ["/api/status"], refetchInterval: 3000 });

  const sigKey = `/api/signals?limit=100&onlyNew=${onlyNew}&minEv=${minEv}&minSize=${minSize}`;
  const { data: signals, isLoading } = useQuery<Signal[]>({
    queryKey: [sigKey],
    refetchInterval: 15000, // refresh every 15s
  });

  const bootstrapDone = (status as any)?.bootstrapDone ?? false;
  const watcherCount = (status as any)?.signalWatcherCount ?? 0;
  const highEvCount = (status as any)?.highEvWatcherCount ?? 0;
  const signalList = signals ?? [];

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-lg font-bold text-foreground">Smart Money Signals</h1>
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green/10 border border-green/20 text-[11px] text-green font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse-live" />
            Live · 15s
          </span>
          {signalList.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-surface-2 border border-border text-[11px] text-muted-foreground font-mono">
              {signalList.length} signals
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Детектор накопления позиций.{" "}
          Сигнал = кошелёк с EV ≥ 0.3 открывает позицию ≥ $10K на рынке с ценой 5–95¢.
        </p>
        {watcherCount > 0 && (
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs px-2 py-0.5 rounded bg-surface-2 border border-border font-mono text-muted-foreground">
              Пул: <span className="text-foreground">{watcherCount}</span> кошельков
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-cyan/10 border border-cyan/20 font-mono text-cyan">
              EV ≥ 0.3: <span className="font-bold">{highEvCount}</span> кандидатов
            </span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center p-3 bg-surface-1 border border-border rounded-lg mb-6">
        <div className="flex items-center gap-1.5">
          <Switch id="only-new" checked={onlyNew} onCheckedChange={setOnlyNew} className="scale-75" />
          <Label htmlFor="only-new" className="text-xs cursor-pointer whitespace-nowrap">
            🆕 Только первый вход
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Мин. EV кошелька</span>
          <div className="w-28">
            <Slider min={0} max={100} step={5}
              value={[minEv * 100]}
              onValueChange={([v]: number[]) => setMinEv(v / 100)}
              className="cursor-pointer" />
          </div>
          <span className="text-xs font-mono text-cyan w-8">{(minEv * 100).toFixed(0)}%</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Мин. размер</span>
          <div className="w-28">
            <Slider min={0} max={20_000} step={500}
              value={[minSize]}
              onValueChange={([v]: number[]) => setMinSize(v)}
              className="cursor-pointer" />
          </div>
          <span className="text-xs font-mono text-cyan w-16">{fmtK(minSize)}</span>
        </div>

        <div className="ml-auto text-xs text-muted-foreground">
          Обновление каждые 15 сек
        </div>
      </div>

      {/* Signal cards */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 bg-surface-2 rounded-lg" />
          ))}
        </div>
      ) : signalList.length === 0 ? (
        <div className="gradient-border rounded-lg">
          <EmptySignals bootstrapDone={bootstrapDone} />
        </div>
      ) : (
        <div className="space-y-2">
          {signalList.map(sig => (
            <div key={sig.id} data-testid={`signal-${sig.id}`}
              className={`gradient-border rounded-lg p-4 transition-colors ${sig.isNew === 1 ? "border-yellow/20" : "border-border"}`}>
              <div className="flex flex-col md:flex-row md:items-start gap-3">
                {/* Left: wallet + market */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <SignalTypeBadge isNew={sig.isNew} tradeCount={sig.tradeCount} />
                    <Link
                      href={`/wallet/${sig.proxyWallet}`}
                      className="text-sm font-semibold text-cyan hover:underline"
                    >
                      {sig.walletName || sig.proxyWallet?.slice(0, 10) + "…"}
                    </Link>
                    <span className="text-xs text-muted-foreground font-mono">
                      EV {((sig.walletEv ?? 0) * 100).toFixed(0)}%
                    </span>
                    <span className="text-xs text-muted-foreground">{timeAgo(sig.detectedAt)}</span>
                  </div>
                  <p className="text-sm text-foreground font-medium leading-snug mb-1 truncate">
                    {sig.marketTitle || "Unknown market"}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      Outcome: <span className="text-foreground font-medium">{sig.outcome || "—"}</span>
                    </span>
                    <PriceBadge price={sig.price} />
                    {sig.slug && (
                      <a
                        href={`https://polymarket.com/event/${sig.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-muted-foreground hover:text-cyan underline"
                      >
                        Открыть на Polymarket ↗
                      </a>
                    )}
                  </div>
                </div>

                {/* Right: size metrics */}
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <div className="text-right">
                    <span className="text-lg font-bold font-mono text-green">
                      {fmtK(sig.size)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">эта сделка</span>
                  </div>
                  {(sig.tradeCount ?? 0) > 1 && (
                    <div className="text-right">
                      <span className="text-sm font-mono text-foreground">{fmtK(sig.totalSize)}</span>
                      <span className="text-xs text-muted-foreground ml-1">накоплено</span>
                    </div>
                  )}
                  <StrengthBar totalSize={sig.totalSize ?? 0} />
                  <span className="text-[10px] text-muted-foreground">
                    {sig.tradeCount === 1 ? "1 сделка" : `${sig.tradeCount} сделок`}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* How it works */}
      <div className="mt-8 p-4 bg-surface-1 border border-border rounded-lg">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Как работает детектор</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { icon: "👁", title: "Мониторинг", desc: "Каждые 15 сек проверяем Live Feed Polymarket — все новые сделки" },
            { icon: "🔍", title: "Фильтрация", desc: `Оставляем только кошельки из пула ${watcherCount || 230}+ с историческим EV ≥ 0.3 (${highEvCount || "?"} кандидатов)` },
            { icon: "📐", title: "Условия", desc: "BUY ≥ $1K, цена 5–95¢, не более 3 сделок на рынке (раннее = лучше)" },
            { icon: "🚨", title: "Сигнал", desc: "Алерт появляется мгновенно с размером, ценой и ссылкой на рынок" },
          ].map(s => (
            <div key={s.title} className="flex gap-2">
              <span className="text-lg shrink-0">{s.icon}</span>
              <div>
                <p className="text-xs font-semibold text-foreground mb-0.5">{s.title}</p>
                <p className="text-[11px] text-muted-foreground">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
