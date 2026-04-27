import type { Express } from "express";
import { parseSeriesKey, isExcludedFromS4 } from "./seriesParser";
import { Server } from "http";
import { storage } from "./storage";
import {
  fetchLeaderboard,
  fetchLatestTrades,
  fetchWalletTrades,
  enrichTradesWithEndDate,
  estimateEndDateFromTitle,
  estimateEndDateForSports,
  fetchClosedPositionsForChart,
  buildWalletFromLeaderboard,
  aggregateWalletOnDemand,
  type TimePeriod,
  type OrderBy,
  type Category,
  type RawTrade,
} from "./polymarket";

// ─── State ────────────────────────────────────────────────────────────────────
let isBootstrapping = false;
let bootstrapDone = false;
let bootstrapProgress = 0;
let bootstrapTotal = 0;
let lastLiveUpdate = 0;
let topWalletSet = new Set<string>();
const seenTxHashes = new Set<string>(); // dedup for signal detection

// ─── Signal detection thresholds ─────────────────────────────────────────────
const SIGNAL_MIN_EV = 0.03;         // wallet ROI (pnl/vol) must be >= this
                                     // Note: avgEv = pnl/vol (ROI), not Kelly EV.
                                     // 0.03 = 3% ROI — includes active traders like elkmonkey.
                                     // 0.30 = 30% ROI — only pure arb bots, too restrictive.
const SIGNAL_MIN_TRADE_USDC = 1_000; // minimum single trade size in USDC
const SIGNAL_ACCUM_USDC = 1_000;     // minimum cumulative size to emit on trades 2–3
const SIGNAL_MAX_TRADE_COUNT = 3;    // stop emitting after 3rd trade (position formed)
const SIGNAL_PRICE_MIN = 0.05;       // 5¢ floor: captures weather-bot entries (buy YES at 5¢ on temperature buckets)
const SIGNAL_PRICE_MAX = 0.90;       // exclude near-certain YES
//
// Detection logic:
//   Trade 1 (isNew):  size >= $1K → always emit — early entry signal
//   Trade 2–3:        cumulative size >= $1K → emit — confirms accumulation
//   Trade 4+:         silent — position already formed, signal would be late
//
// Rationale: a single $1K trade can be a probe; three trades on the same
// market totalling $1K+ is a clear accumulation pattern. Upper bound of 3
// prevents noise from bots that trade the same market hundreds of times.

function detectSignal(trade: RawTrade) {
  const addr = trade.proxyWallet;
  const wallet = storage.getWallet(addr);

  // Only watch wallets we know (from leaderboard) with good EV
  if (!wallet) return;
  if ((wallet.avgEv ?? 0) < SIGNAL_MIN_EV) return;

  // Only BUY side — accumulation, not profit-taking
  if (trade.side !== "BUY") return;

  // Single trade must be at least $1K (filters out dust / fee tests)
  const sizeUsdc = (trade.size ?? 0) * (trade.price ?? 0);
  if (sizeUsdc < SIGNAL_MIN_TRADE_USDC) return;

  // Price filter — not near-expiry or already decided
  const price = trade.price ?? 0;
  if (price < SIGNAL_PRICE_MIN || price > SIGNAL_PRICE_MAX) return;

  const conditionId = trade.conditionId ?? trade.slug ?? trade.title ?? "";
  if (!conditionId) return;

  const isNew = storage.isNewMarketForWallet(addr, conditionId);
  const { totalSize, tradeCount } = storage.recordWalletMarket(addr, conditionId, sizeUsdc);

  // Determine whether to emit:
  //   - Trade 1 (isNew): always emit if size >= $1K (caught above)
  //   - Trades 2–3: emit if cumulative total >= $1K (confirms intent)
  //   - Trade 4+: skip — too late, position already accumulating for a while
  if (tradeCount > SIGNAL_MAX_TRADE_COUNT) return;
  if (!isNew && totalSize < SIGNAL_ACCUM_USDC) return; // trades 2–3 but total still tiny

  storage.insertSignal({
    proxyWallet: addr,
    walletName: wallet.pseudonym || wallet.name || addr.slice(0, 10),
    conditionId,
    marketTitle: trade.title ?? "",
    outcome: trade.outcome ?? "",
    price,
    size: sizeUsdc,
    totalSize,
    tradeCount,
    isNew: isNew ? 1 : 0,
    walletEv: wallet.avgEv ?? 0,
    slug: trade.slug ?? "",
    detectedAt: Date.now(),
    transactionHash: trade.transactionHash ?? "",
  });

  const tag = isNew ? "ENTRY" : `ACCUM #${tradeCount}`;
  console.log(`[Signal] ${wallet.pseudonym || addr.slice(0,8)} → "${trade.title?.slice(0,40)}" @${price.toFixed(2)} $${sizeUsdc.toFixed(0)} total=$${totalSize.toFixed(0)} (${tag})`);
}

// ─── Process a single wallet from leaderboard entry ───────────────────────────
async function processLeaderboardWallet(
  entry: Awaited<ReturnType<typeof fetchLeaderboard>>[number]
): Promise<void> {
  const address = entry.proxyWallet;
  if (!address) return;

  try {
    // Fetch trades (for trade count, categories, profile image)
    // Closed positions only for PNL curve chart — NOT for total PNL
    const [trades, closedPositions] = await Promise.all([
      fetchWalletTrades(address, 500),
      fetchClosedPositionsForChart(address),
    ]);

    const agg = buildWalletFromLeaderboard(entry, trades, closedPositions);

    storage.upsertWallet({
      address: agg.address,
      pseudonym: agg.pseudonym,
      name: agg.name,
      profileImage: agg.profileImage,
      totalTrades: agg.totalTrades,
      buyTrades: agg.buyTrades,
      sellTrades: agg.sellTrades,
      totalVolume: agg.totalVolume,
      totalPnl: agg.totalPnl,
      winRate: agg.winRate,
      avgEv: agg.avgEv,
      winCount: agg.winCount,
      lossCount: agg.lossCount,
      markets: JSON.stringify(agg.markets),
      topMarkets: JSON.stringify(agg.topMarkets),
      lastTradeTimestamp: agg.lastTradeTimestamp,
      trades30d: agg.trades30d,
      avgBuyPrice: agg.avgBuyPrice ?? 0,
      avgTradeSize: agg.avgTradeSize ?? 0,
      avgWeatherRatio: agg.avgWeatherRatio ?? 0,
      avgUpDownRatio: agg.avgUpDownRatio ?? 0,
      cryptoUpDownBuyPrice: agg.cryptoUpDownBuyPrice ?? 0,
      proximityBuckets: JSON.stringify(agg.proximityBuckets ?? {}),
    });

    // Store PNL curve points
    storage.clearPnlHistory(address);
    agg.pnlCurve.forEach(pt => {
      storage.insertPnlPoint({
        address,
        timestamp: pt.timestamp,
        cumulativePnl: pt.cumPnl,
        tradeCount: pt.tradeCount,
      });
    });

    // ── Seed walletMarkets with full trade history ──────────────────────────
    // This prevents false "First Entry" signals after server restarts.
    // We use ALL 500 fetched trades (not just topMarkets) so every conditionId
    // the wallet has ever traded is marked as "already seen" before the live
    // feed starts. recordWalletMarket() handles the live running totals.
    // Collect conditionIds from both trades AND closed positions — closed positions
    // cover markets not in the last 500 trades (e.g. older positions sorted by PNL).
    const historicalConditionIds = [
      ...trades.map(t => t.conditionId),
      ...closedPositions.map(p => p.conditionId),
    ].filter(Boolean);
    storage.seedWalletMarkets(address, historicalConditionIds);
    console.log(`[Bootstrap] Seeded ${new Set(historicalConditionIds).size} unique markets for ${address.slice(0, 8)} (from ${trades.length} trades + ${closedPositions.length} closed pos)`);

    // Store recent trades for live feed
    const seen = new Set<string>();
    for (const t of trades.slice(0, 50)) {
      if (!seen.has(t.transactionHash)) {
        seen.add(t.transactionHash);
        try {
          storage.insertTrade({
            proxyWallet: t.proxyWallet,
            side: t.side,
            size: t.size,
            price: t.price,
            timestamp: t.timestamp,
            title: t.title,
            outcome: t.outcome,
            slug: t.slug,
            name: t.name,
            pseudonym: t.pseudonym,
            transactionHash: t.transactionHash,
            isTopWallet: 1,
          });
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error(`processLeaderboardWallet error for ${address}:`, e);
  }
}

// ─── Bootstrap — load top wallets from official leaderboard ───────────────────
//
// Two-phase approach:
//   Phase 1 (dashboard): top-50 ALL/PNL/OVERALL — fully processed with trade
//                        history, PNL curve, etc. These appear in the Dashboard table.
//   Phase 2 (signals):   ~150 additional wallets from 5 more leaderboard slices,
//                        processed in background after dashboard is ready.
//                        These are signal-monitor-only: stored in storage so
//                        detectSignal() can look them up, but NOT shown on Dashboard
//                        (Dashboard caps at top-50 by default).
//
// Why multiple slices instead of limit=200?
//   Polymarket API hard-caps leaderboard at 50 records regardless of limit param.
//   Slicing across periods/categories gives ~200 unique wallets total.
//   Chosen slices ordered by marginal new-wallet yield (measured empirically):
//     ALL/PNL/OVERALL (+50), ALL/VOL/OVERALL (+35), MONTH/PNL/OVERALL (+34),
//     MONTH/VOL/OVERALL (+26), ALL/PNL/CRYPTO (+40), MONTH/PNL/POLITICS (+39)
//   ≈ 224 unique wallets — well above the 200 target.

const SIGNAL_LEADERBOARD_SLICES: Array<[TimePeriod, OrderBy, Category]> = [
  ["ALL",   "VOL", "OVERALL"],
  ["MONTH", "PNL", "OVERALL"],
  ["MONTH", "VOL", "OVERALL"],
  ["ALL",   "PNL", "CRYPTO"],
  ["MONTH", "PNL", "POLITICS"],
  // Weather specialists: automatedAItradingbot (#8 ALL), ColdMath (#2 MONTH), WeatherTraderBot (#12 ALL)
  ["ALL",   "PNL", "WEATHER"],
  ["MONTH", "PNL", "WEATHER"],
];

async function bootstrap() {
  if (isBootstrapping || bootstrapDone) return;
  isBootstrapping = true;
  console.log("[Bootstrap] Fetching official Polymarket leaderboard...");

  try {
    // Phase 1: top-50 ALL/PNL — these go into the Dashboard table
    const leaderboard = await fetchLeaderboard(50, "ALL", "PNL", "OVERALL");
    console.log(`[Bootstrap] Got ${leaderboard.length} dashboard entries`);

    if (leaderboard.length === 0) {
      console.log("[Bootstrap] Leaderboard empty, falling back to live trades...");
      await bootstrapFromLiveTrades();
      return;
    }

    bootstrapTotal = leaderboard.length;
    bootstrapProgress = 0;

    // Seed live feed
    try {
      const liveTrades = await fetchLatestTrades(200);
      storeLiveTrades(liveTrades, new Set());
    } catch (_) {}

    // Process Phase 1 wallets in batches of 5
    const batchSize = 5;
    for (let i = 0; i < leaderboard.length; i += batchSize) {
      const batch = leaderboard.slice(i, i + batchSize);
      await Promise.all(batch.map(entry => processLeaderboardWallet(entry)));
      bootstrapProgress += batch.length;
      console.log(`[Bootstrap] Phase 1 progress: ${bootstrapProgress}/${bootstrapTotal}`);
    }

    leaderboard.forEach(e => topWalletSet.add(e.proxyWallet));
    bootstrapDone = true;
    console.log("[Bootstrap] Phase 1 done — dashboard ready.");

    // Phase 2: additional slices for Signals monitoring (runs in background,
    // dashboard is already usable while this loads)
    bootstrapSignalWatchers().catch(e =>
      console.error("[Bootstrap] Phase 2 error:", e)
    );

  } catch (e) {
    console.error("[Bootstrap] Error:", e);
  } finally {
    isBootstrapping = false;
  }
}

// Phase 2: load ~150 extra wallets from additional leaderboard slices.
// These are stored in storage (for detectSignal lookups) but never shown
// in the Dashboard table — getTopWallets() always sorts by PNL so they
// naturally fall below the top-50 cutoff in the frontend.
async function bootstrapSignalWatchers() {
  console.log("[Signals] Starting Phase 2 — loading extended watcher pool...");

  // Collect leaderboard entries from all extra slices, dedup by address
  const extraEntries = new Map<string, Awaited<ReturnType<typeof fetchLeaderboard>>[number]>();

  // Fetch all slices in parallel
  const sliceResults = await Promise.allSettled(
    SIGNAL_LEADERBOARD_SLICES.map(([period, order, cat]) =>
      fetchLeaderboard(50, period, order, cat)
    )
  );

  for (const result of sliceResults) {
    if (result.status !== "fulfilled") continue;
    for (const entry of result.value) {
      if (!entry.proxyWallet) continue;
      // Skip wallets already loaded in Phase 1 (already in storage + topWalletSet)
      if (topWalletSet.has(entry.proxyWallet)) continue;
      // Keep the entry with higher PNL if seen in multiple slices
      const existing = extraEntries.get(entry.proxyWallet);
      if (!existing || entry.pnl > existing.pnl) {
        extraEntries.set(entry.proxyWallet, entry);
      }
    }
  }

  const entries = [...extraEntries.values()];
  console.log(`[Signals] Phase 2: ${entries.length} additional wallets to load`);

  // Process in batches of 5 — same as Phase 1 but lower priority
  const batchSize = 5;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    await Promise.all(batch.map(entry => processLeaderboardWallet(entry)));
    // Mark as signal watchers in topWalletSet so live feed highlights them
    batch.forEach(e => topWalletSet.add(e.proxyWallet));
    console.log(`[Signals] Phase 2 progress: ${Math.min(i + batchSize, entries.length)}/${entries.length}`);
    // Small pause between batches to avoid hammering the API
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[Signals] Phase 2 done — monitoring ${topWalletSet.size} wallets total for accumulation signals.`);
}

// Fallback bootstrap from live trades when leaderboard is unreachable
async function bootstrapFromLiveTrades() {
  try {
    const recentTrades = await fetchLatestTrades(1000);
    storeLiveTrades(recentTrades.slice(0, 200), new Set());

    const walletVolume = new Map<string, { volume: number; trades: RawTrade[] }>();
    recentTrades.forEach(t => {
      const prev = walletVolume.get(t.proxyWallet) ?? { volume: 0, trades: [] };
      walletVolume.set(t.proxyWallet, {
        volume: prev.volume + t.size * t.price,
        trades: [...prev.trades, t],
      });
    });

    const candidates = [...walletVolume.entries()]
      .sort((a, b) => b[1].volume - a[1].volume)
      .slice(0, 50)
      .map(([addr]) => addr);

    bootstrapTotal = candidates.length;
    bootstrapProgress = 0;

    const batchSize = 5;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async addr => {
          const agg = await aggregateWalletOnDemand(addr);
          if (!agg) return;
          storage.upsertWallet({
            address: agg.address,
            pseudonym: agg.pseudonym,
            name: agg.name,
            profileImage: agg.profileImage,
            totalTrades: agg.totalTrades,
            buyTrades: agg.buyTrades,
            sellTrades: agg.sellTrades,
            totalVolume: agg.totalVolume,
            totalPnl: agg.totalPnl,
            winRate: agg.winRate,
            avgEv: agg.avgEv,
            winCount: agg.winCount,
            lossCount: agg.lossCount,
            markets: JSON.stringify(agg.markets),
            topMarkets: JSON.stringify(agg.topMarkets),
            lastTradeTimestamp: agg.lastTradeTimestamp,
            trades30d: agg.trades30d,
      avgBuyPrice: agg.avgBuyPrice ?? 0,
      avgTradeSize: agg.avgTradeSize ?? 0,
      avgWeatherRatio: agg.avgWeatherRatio ?? 0,
      avgUpDownRatio: agg.avgUpDownRatio ?? 0,
      cryptoUpDownBuyPrice: agg.cryptoUpDownBuyPrice ?? 0,
      proximityBuckets: JSON.stringify(agg.proximityBuckets ?? {}),
          });
          storage.clearPnlHistory(addr);
          agg.pnlCurve.forEach(pt =>
            storage.insertPnlPoint({
              address: addr,
              timestamp: pt.timestamp,
              cumulativePnl: pt.cumPnl,
              tradeCount: pt.tradeCount,
            })
          );
        })
      );
      bootstrapProgress += batch.length;
    }

    bootstrapDone = true;
    console.log("[Bootstrap] Fallback done.");
  } catch (e) {
    console.error("[Bootstrap] Fallback error:", e);
  } finally {
    isBootstrapping = false;
  }
}

function storeLiveTrades(trades: RawTrade[], seen: Set<string>) {
  for (const t of trades) {
    const hash = t.transactionHash || `${t.proxyWallet}-${t.timestamp}-${t.size}`;
    if (!seen.has(hash)) {
      seen.add(hash);
      try {
        storage.insertTrade({
          proxyWallet: t.proxyWallet,
          side: t.side,
          size: t.size,
          price: t.price,
          timestamp: t.timestamp,
          title: t.title,
          outcome: t.outcome,
          slug: t.slug,
          name: t.name,
          pseudonym: t.pseudonym,
          transactionHash: hash,
          isTopWallet: topWalletSet.has(t.proxyWallet) ? 1 : 0,
        });
      } catch (_) {}
      // Run signal detection on every new trade
      if (!seenTxHashes.has(hash)) {
        seenTxHashes.add(hash);
        if (seenTxHashes.size > 10_000) {
          // Prune oldest entries to avoid unbounded growth
          const arr = [...seenTxHashes];
          arr.slice(0, 5_000).forEach(h => seenTxHashes.delete(h));
        }
        try { detectSignal(t); } catch (_) {}
      }
    }
  }
}

// ─── Live feed polling ────────────────────────────────────────────────────────
async function updateLiveFeed() {
  const now = Date.now();
  if (now - lastLiveUpdate < 8000) return;
  lastLiveUpdate = now;

  try {
    const trades = await fetchLatestTrades(50);
    storeLiveTrades(trades, new Set());
  } catch (e) {
    console.error("updateLiveFeed error:", e);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
export function registerRoutes(httpServer: Server, app: Express) {
  // Start bootstrap in background
  setTimeout(() => bootstrap(), 500);

  // Periodic live feed update
  setInterval(() => updateLiveFeed(), 10000);

  // GET /api/status
  app.get("/api/status", (_req, res) => {
    const allWallets = storage.getAllWallets();
    // High-EV watchers: wallets in the signal pool that actually pass EV threshold
    const highEvWatcherCount = allWallets.filter(
      w => topWalletSet.has(w.address) && (w.avgEv ?? 0) >= SIGNAL_MIN_EV
    ).length;
    res.json({
      bootstrapDone,
      isBootstrapping,
      bootstrapProgress,
      bootstrapTotal,
      walletCount: allWallets.length,
      signalWatcherCount: topWalletSet.size,   // total pool (Phase 1 + Phase 2)
      highEvWatcherCount,                       // subset with EV >= 0.3 (real signal candidates)
      tradeCount: storage.getTradeCount(),
    });
  });

  // GET /api/wallets?sort=pnl&limit=50&minEv=0&minWinRate=0&category=&timePeriod=ALL&orderBy=PNL
  app.get("/api/wallets", async (req, res) => {
    const sort = (req.query.sort as string) || "pnl";
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const minEv = parseFloat(req.query.minEv as string) || 0;
    const minWinRate = parseFloat(req.query.minWinRate as string) || 0;
    const category = (req.query.category as string) || "";
    const minTrades = parseInt(req.query.minTrades as string) || 0;
    const timePeriod = ((req.query.timePeriod as string) || "ALL").toUpperCase() as TimePeriod;
    const orderBy = ((req.query.orderBy as string) || "PNL").toUpperCase() as OrderBy;
    const apiCategory = ((req.query.apiCategory as string) || "OVERALL").toUpperCase() as Category;

    // If non-default time/category/orderBy filters requested, fetch fresh from leaderboard
    const needsFreshFetch =
      timePeriod !== "ALL" || apiCategory !== "OVERALL" || orderBy !== "PNL";

    if (needsFreshFetch) {
      try {
        const lb = await fetchLeaderboard(limit, timePeriod, orderBy, apiCategory);
        const results = lb.map(entry => {
          const cached = storage.getWallet(entry.proxyWallet);
          return {
            address: entry.proxyWallet,
            pseudonym: entry.userName || cached?.pseudonym || "",
            name: entry.userName || cached?.name || "",
            profileImage: entry.profileImage || cached?.profileImage || "",
            totalTrades: cached?.totalTrades ?? 0,
            buyTrades: cached?.buyTrades ?? 0,
            sellTrades: cached?.sellTrades ?? 0,
            totalVolume: entry.vol,
            totalPnl: entry.pnl,
            winRate: cached?.winRate ?? 0,
            avgEv: cached?.avgEv ?? (entry.vol > 0 ? entry.pnl / entry.vol : 0),
            winCount: cached?.winCount ?? 0,
            lossCount: cached?.lossCount ?? 0,
            markets: cached?.markets ?? "[]",
            topMarkets: cached?.topMarkets ?? "[]",
            lastTradeTimestamp: cached?.lastTradeTimestamp ?? 0,
            trades30d: cached?.trades30d ?? 0,
            avgBuyPrice: cached?.avgBuyPrice ?? 0,
            avgTradeSize: cached?.avgTradeSize ?? 0,
            avgWeatherRatio: cached?.avgWeatherRatio ?? 0,
            avgUpDownRatio: cached?.avgUpDownRatio ?? 0,
            rank: entry.rank,
          };
        });
        return res.json(results.slice(0, limit));
      } catch (e) {
        console.error("Fresh leaderboard fetch error:", e);
        // Fall through to cached data
      }
    }

    let wallets = storage.getTopWallets(200, sort);

    if (minEv > 0) wallets = wallets.filter(w => (w.avgEv ?? 0) >= minEv);
    if (minWinRate > 0) wallets = wallets.filter(w => (w.winRate ?? 0) >= minWinRate);
    if (minTrades > 0) wallets = wallets.filter(w => (w.totalTrades ?? 0) >= minTrades);
    if (category) {
      wallets = wallets.filter(w => {
        try {
          const cats = JSON.parse(w.markets ?? "[]") as string[];
          return cats.some(c => c.toLowerCase() === category.toLowerCase());
        } catch { return false; }
      });
    }

    res.json(wallets.slice(0, limit));
  });

  // GET /api/wallets/:address
  app.get("/api/wallets/:address", async (req, res) => {
    const { address } = req.params;
    let wallet = storage.getWallet(address);

    if (!wallet) {
      // On-demand lookup for addresses not in leaderboard
      const agg = await aggregateWalletOnDemand(address);
      if (agg) {
        storage.upsertWallet({
          address: agg.address,
          pseudonym: agg.pseudonym,
          name: agg.name,
          profileImage: agg.profileImage,
          totalTrades: agg.totalTrades,
          buyTrades: agg.buyTrades,
          sellTrades: agg.sellTrades,
          totalVolume: agg.totalVolume,
          totalPnl: agg.totalPnl,
          winRate: agg.winRate,
          avgEv: agg.avgEv,
          winCount: agg.winCount,
          lossCount: agg.lossCount,
          markets: JSON.stringify(agg.markets),
          topMarkets: JSON.stringify(agg.topMarkets),
          lastTradeTimestamp: agg.lastTradeTimestamp,
          trades30d: agg.trades30d,
      avgBuyPrice: agg.avgBuyPrice ?? 0,
      avgTradeSize: agg.avgTradeSize ?? 0,
      avgWeatherRatio: agg.avgWeatherRatio ?? 0,
      avgUpDownRatio: agg.avgUpDownRatio ?? 0,
      cryptoUpDownBuyPrice: agg.cryptoUpDownBuyPrice ?? 0,
      proximityBuckets: JSON.stringify(agg.proximityBuckets ?? {}),
        });
        storage.clearPnlHistory(address);
        agg.pnlCurve.forEach(pt =>
          storage.insertPnlPoint({
            address,
            timestamp: pt.timestamp,
            cumulativePnl: pt.cumPnl,
            tradeCount: pt.tradeCount,
          })
        );
        wallet = storage.getWallet(address);
      }
    }

    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const pnlHistory = storage.getPnlHistory(address);
    let recentTrades = storage.getTopWalletTrades(address, 50);

    // If no trades in storage (wallet not seen in live feed yet), fetch from API
    if (recentTrades.length === 0) {
      try {
        const apiTrades = await fetchWalletTrades(address, 50);
        recentTrades = apiTrades.map(t => ({
          id: t.transactionHash || `${t.timestamp}-${t.asset}`,
          proxyWallet: address,
          side: t.side,
          asset: t.asset,
          conditionId: t.conditionId,
          size: t.size,
          price: t.price,
          timestamp: t.timestamp,
          title: t.title,
          slug: t.slug,
          outcome: t.outcome,
          name: t.name,
          pseudonym: t.pseudonym,
        }));
      } catch (e) {
        console.error("Failed to fetch trades from API:", e);
      }
    }

    res.json({ ...wallet, pnlHistory, recentTrades });
  });

  // GET /api/pnl/:address
  app.get("/api/pnl/:address", (req, res) => {
    const { address } = req.params;
    const history = storage.getPnlHistory(address);
    res.json(history);
  });

  // GET /api/live?limit=100
  app.get("/api/live", (_req, res) => {
    const trades = storage.getLatestTrades(100);
    res.json(trades);
  });

  // GET /api/stats — global dashboard stats
  app.get("/api/stats", (_req, res) => {
    const wallets = storage.getAllWallets();
    const totalVolume = wallets.reduce((s, w) => s + (w.totalVolume ?? 0), 0);
    const avgWinRate =
      wallets.length > 0
        ? wallets.reduce((s, w) => s + (w.winRate ?? 0), 0) / wallets.length
        : 0;
    const totalTrades = wallets.reduce((s, w) => s + (w.totalTrades ?? 0), 0);

    res.json({
      totalWallets: wallets.length,
      totalVolume,
      avgWinRate,
      totalTrades,
      lastUpdate: Date.now(),
    });
  });

  // POST /api/refresh/:address — force refresh from leaderboard
  app.post("/api/refresh/:address", async (req, res) => {
    const { address } = req.params;

    // First try to find in leaderboard
    try {
      const lb = await fetchLeaderboard(500, "ALL", "PNL", "OVERALL");
      const entry = lb.find(e => e.proxyWallet.toLowerCase() === address.toLowerCase());
      if (entry) {
        await processLeaderboardWallet(entry);
        const wallet = storage.getWallet(address);
        return res.json(wallet ?? { error: "Not found after refresh" });
      }
    } catch (_) {}

    // Fallback to on-demand aggregation
    const agg = await aggregateWalletOnDemand(address);
    if (agg) {
      storage.upsertWallet({
        address: agg.address,
        pseudonym: agg.pseudonym,
        name: agg.name,
        profileImage: agg.profileImage,
        totalTrades: agg.totalTrades,
        buyTrades: agg.buyTrades,
        sellTrades: agg.sellTrades,
        totalVolume: agg.totalVolume,
        totalPnl: agg.totalPnl,
        winRate: agg.winRate,
        avgEv: agg.avgEv,
        winCount: agg.winCount,
        lossCount: agg.lossCount,
        markets: JSON.stringify(agg.markets),
        topMarkets: JSON.stringify(agg.topMarkets),
        lastTradeTimestamp: agg.lastTradeTimestamp,
        trades30d: agg.trades30d,
      avgBuyPrice: agg.avgBuyPrice ?? 0,
      avgTradeSize: agg.avgTradeSize ?? 0,
      avgWeatherRatio: agg.avgWeatherRatio ?? 0,
      avgUpDownRatio: agg.avgUpDownRatio ?? 0,
      cryptoUpDownBuyPrice: agg.cryptoUpDownBuyPrice ?? 0,
      proximityBuckets: JSON.stringify(agg.proximityBuckets ?? {}),
      });
    }

    const wallet = storage.getWallet(address);
    res.json(wallet ?? { error: "Not found" });
  });

  // GET /api/signals?limit=50&onlyNew=true&minEv=0.3&minSize=10000
  app.get("/api/signals", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const onlyNew = req.query.onlyNew === "true";
    const minEv = parseFloat(req.query.minEv as string) || 0;
    const minSize = parseFloat(req.query.minSize as string) || 0;

    let sigs = storage.getSignals(200);
    if (onlyNew) sigs = sigs.filter(s => s.isNew === 1);
    if (minEv > 0) sigs = sigs.filter(s => (s.walletEv ?? 0) >= minEv);
    if (minSize > 0) sigs = sigs.filter(s => (s.size ?? 0) >= minSize);

    res.json(sigs.slice(0, limit));
  });

  // GET /api/signals/count
  app.get("/api/signals/count", (_req, res) => {
    res.json({ count: storage.getSignalCount() });
  });

  // GET /api/leaderboard — proxy to official leaderboard (no caching)
  app.get("/api/leaderboard", async (req, res) => {
    const timePeriod = ((req.query.timePeriod as string) || "ALL").toUpperCase() as TimePeriod;
    const orderBy = ((req.query.orderBy as string) || "PNL").toUpperCase() as OrderBy;
    const category = ((req.query.category as string) || "OVERALL").toUpperCase() as Category;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    try {
      const data = await fetchLeaderboard(limit, timePeriod, orderBy, category);
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: "Leaderboard fetch failed", details: String(e) });
    }
  });

  // ─── S3 Sports Near-Expiry Analysis ─────────────────────────────────────────
  app.get("/api/sports-nearexpiry", async (_req, res) => {
    try {
      const allWallets = storage.getAllWallets();
      const sportsArbers = allWallets.filter(w => {
        const markets: string[] = (() => { try { return JSON.parse(w.markets ?? "[]"); } catch { return []; } })();
        return markets.includes("Sports") && (w.avgBuyPrice ?? 0) > 0.70 && (w.winRate ?? 0) > 0.75 && (w.trades30d ?? 0) > 0;
      });
      const sportKeywords = ["vs.", " vs ", "game", "match", "series", "playoffs",
        "nba", "nfl", "mlb", "nhl", "soccer", "tennis", "ufc", "mma",
        "basketball", "football", "baseball", "hockey"];
      const results = await Promise.all(
        sportsArbers.slice(0, 12).map(async (wallet) => {
          try {
            const trades = await fetchWalletTrades(wallet.address, 200);
            const nearExpiryTrades = trades.filter(t => {
              const title = (t.title ?? "").toLowerCase();
              return t.side === "BUY" && (t.price ?? 0) > 0.93
                && sportKeywords.some(kw => title.includes(kw));
            });
            const buckets: Record<string, number> = { "0.93-0.95": 0, "0.95-0.97": 0, "0.97-0.99": 0, "0.99+": 0 };
            let totalVolume = 0;
            nearExpiryTrades.forEach(t => {
              const p = t.price ?? 0;
              totalVolume += (t.size ?? 0) * p;
              if (p >= 0.99) buckets["0.99+"]++;
              else if (p >= 0.97) buckets["0.97-0.99"]++;
              else if (p >= 0.95) buckets["0.95-0.97"]++;
              else buckets["0.93-0.95"]++;
            });
            return {
              address: wallet.address, name: wallet.pseudonym || wallet.name,
              winRate: wallet.winRate, avgBuyPrice: wallet.avgBuyPrice,
              totalPnl: wallet.totalPnl, trades30d: wallet.trades30d,
              avgTradeSize: wallet.avgTradeSize,
              nearExpiryCount: nearExpiryTrades.length, nearExpiryVolume: totalVolume,
              priceBuckets: buckets,
              sampleTrades: nearExpiryTrades.slice(0, 5).map(t => ({
                title: t.title, price: t.price, size: t.size,
                timestamp: t.timestamp, outcome: t.outcome,
              })),
            };
          } catch { return null; }
        })
      );
      const filtered = results.filter(Boolean);
      res.json({
        sportsArbers: filtered.sort((a: any, b: any) => b.nearExpiryCount - a.nearExpiryCount),
        summary: {
          totalWalletsScanned: sportsArbers.length,
          walletsWithNearExpiry: filtered.filter((r: any) => r.nearExpiryCount > 0).length,
        }
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });


  // ─── S2 Crypto Up/Down Scalper Analysis ──────────────────────────────────────
  app.get("/api/s2-analysis", async (_req, res) => {
    try {
      const allWallets = storage.getAllWallets();
      // Filter: either avgUpDownRatio already computed (>25%) OR has Crypto markets
      // We re-derive ratio from live trades below, so wide filter is OK — scoring happens inside
      const s2Candidates = allWallets.filter(w => {
        const markets: string[] = (() => { try { return JSON.parse(w.markets ?? "[]"); } catch { return []; } })();
        const hasCrypto = markets.includes("Crypto") || (w.avgUpDownRatio ?? 0) > 0.10;
        return hasCrypto && (w.winRate ?? 0) > 0.60 && (w.totalTrades ?? 0) > 0;
      });
      // We'll recompute upDownRatio from actual trades and filter post-hoc
      const s2Wallets = s2Candidates;

      const results = await Promise.all(
        s2Wallets.slice(0, 15).map(async (wallet) => {
          try {
            const rawTrades = await fetchWalletTrades(wallet.address, 300);
            // Enrich with endDate from gamma market API (cached)
            const enriched = await enrichTradesWithEndDate(rawTrades);
            // Apply title-based heuristic for remaining unknown endDates
            const trades = enriched.map(t => {
              if (t.endDate) return t;
              // For sports season futures → season-aware end-date estimator
              const sportsEnd = estimateEndDateForSports(t.title ?? "", t.timestamp ?? 0);
              if (sportsEnd) return { ...t, endDate: sportsEnd };
              // Fallback for Up/Down short-horizon markets
              const shortEnd = estimateEndDateFromTitle(t.title ?? "", t.timestamp ?? 0);
              return { ...t, endDate: shortEnd ?? undefined };
            });
            const isUpDown = (title: string) => {
              const t = title.toLowerCase();
              return t.includes("up or down") || t.includes("up 5") || t.includes("up 1") ||
                     t.includes("down 5") || t.includes("down 1") ||
                     (t.includes("btc") && t.includes("%")) ||
                     (t.includes("eth") && t.includes("%")) ||
                     (t.includes("sol") && t.includes("%"));
            };
            const upDownTrades = trades.filter(t => isUpDown(t.title ?? ""));
            const upDownBuys   = upDownTrades.filter(t => t.side === "BUY");
            const upDownSells  = upDownTrades.filter(t => t.side === "SELL");

            // price bucket distribution for BUY trades on Up/Down markets
            const priceBuckets: Record<string, number> = {
              "under0.50": 0, "0.50-0.80": 0, "0.80-0.90": 0,
              "0.90-0.95": 0, "0.95-0.99": 0, "0.99+": 0,
            };
            upDownBuys.forEach(t => {
              const p = t.price ?? 0;
              if      (p < 0.50) priceBuckets["under0.50"]++;
              else if (p < 0.80) priceBuckets["0.50-0.80"]++;
              else if (p < 0.90) priceBuckets["0.80-0.90"]++;
              else if (p < 0.95) priceBuckets["0.90-0.95"]++;
              else if (p < 0.99) priceBuckets["0.95-0.99"]++;
              else               priceBuckets["0.99+"]++;
            });

            // proximity buckets from endDate
            const getExpiry = (t: RawTrade): number | null => {
              const raw = (t as any).endDate || (t as any).fpmm?.endDate;
              if (!raw) return null;
              const ts = new Date(raw).getTime();
              return isNaN(ts) ? null : ts / 1000;
            };
            const proxBuckets = { under1h: 0, under6h: 0, under24h: 0, over24h: 0, unknown: 0 };
            upDownBuys.forEach(t => {
              const expiry = getExpiry(t);
              if (!expiry) { proxBuckets.unknown++; return; }
              const secs = expiry - (t.timestamp ?? 0);
              if      (secs < 3600)  proxBuckets.under1h++;
              else if (secs < 21600) proxBuckets.under6h++;
              else if (secs < 86400) proxBuckets.under24h++;
              else                   proxBuckets.over24h++;
            });

            const avgUpDownBuyPrice = upDownBuys.length > 0
              ? upDownBuys.reduce((s, t) => s + (t.price ?? 0), 0) / upDownBuys.length : 0;

            // Post-filter 1: real Up/Down ratio
            const realUpDownRatio = upDownTrades.length / Math.max(1, trades.length);
            if (realUpDownRatio < 0.20 && upDownTrades.length < 5) return null;

            // Post-filter 2: near-expiry S2 specialist screening
            // Must have EITHER high-price buys (¢95+) OR confirmed proximity signals
            const nearExpiryBuys  = (priceBuckets["0.95-0.99"] ?? 0) + (priceBuckets["0.99+"] ?? 0);
            const knownProxTotal  = proxBuckets.under1h + proxBuckets.under6h + proxBuckets.under24h + proxBuckets.over24h;
            const proxUnknownPct  = knownProxTotal + proxBuckets.unknown > 0
              ? proxBuckets.unknown / (knownProxTotal + proxBuckets.unknown) : 1;
            const under6hPct      = knownProxTotal > 0
              ? (proxBuckets.under1h + proxBuckets.under6h) / knownProxTotal : 0;

            // S2 score: combination of near-expiry price signal + proximity signal
            // Weighted: 60% price bucket signal, 40% proximity signal
            const priceSignal = upDownBuys.length > 0 ? nearExpiryBuys / upDownBuys.length : 0;
            const proxSignal  = proxUnknownPct < 0.8 ? under6hPct : priceSignal; // fallback to price if mostly unknown
            const s2Score     = priceSignal * 0.6 + proxSignal * 0.4;

            // Must have at least some near-expiry signal to qualify as S2 specialist
            // (relaxed: ≥1 high-price buy OR s2Score > 0 with sufficient Up/Down trades)
            const isS2Specialist = nearExpiryBuys >= 1 || (s2Score > 0.05 && upDownBuys.length >= 3);
            if (!isS2Specialist) return null;

            return {
              address: wallet.address,
              name: wallet.pseudonym || wallet.name,
              realUpDownRatio,
              s2Score,
              nearExpiryBuys,
              under6hPct,
              proxUnknownPct,
              winRate: wallet.winRate,
              totalPnl: wallet.totalPnl,
              trades30d: wallet.trades30d,
              avgUpDownRatio: wallet.avgUpDownRatio,
              avgBuyPrice: wallet.avgBuyPrice,
              upDownTradeCount: upDownTrades.length,
              upDownBuyCount: upDownBuys.length,
              upDownSellCount: upDownSells.length,
              avgUpDownBuyPrice,
              priceBuckets,
              proximityBuckets: proxBuckets,
            };
          } catch { return null; }
        })
      );

      const filtered = results.filter(Boolean);
      res.json({
        s2Wallets: filtered.sort((a: any, b: any) => b.avgUpDownRatio - a.avgUpDownRatio),
        summary: {
          totalScanned: s2Wallets.length,
          withUpDownTrades: filtered.filter((r: any) => r.upDownTradeCount > 0).length,
          avgUpDownBuyPrice: filtered.length
            ? filtered.reduce((s: number, r: any) => s + r.avgUpDownBuyPrice, 0) / filtered.length
            : 0,
        }
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });


  // ─── S4 Seasonal Sports Arb — Series Hedge Detector ────────────────────────────
  app.get("/api/s4-analysis", async (_req, res) => {
    try {
      const allWallets = storage.getAllWallets();

      // Pre-filter: Sports markets, mid-price, decent WR
      const s4Candidates = allWallets.filter(w => {
        const markets: string[] = (() => { try { return JSON.parse(w.markets ?? "[]"); } catch { return []; } })();
        const hasSports = markets.includes("Sports");
        const midPrice  = (w.avgBuyPrice ?? 0) >= 0.25 && (w.avgBuyPrice ?? 0) <= 0.78;
        return hasSports && midPrice && (w.winRate ?? 0) > 0.60 && (w.totalTrades ?? 0) > 0;
      });

      // ── Series key normalizer ────────────────────────────────────────────────────
      // Series key parsing → see server/seriesParser.ts (deterministic rule-based)


      // ── Main per-wallet analysis ─────────────────────────────────────────────────
      const results = await Promise.all(
        s4Candidates.slice(0, 25).map(async (wallet) => {
          try {
            const trades = await fetchWalletTrades(wallet.address, 500);

            const sportsTrades = trades.filter(t => {
              if (isExcludedFromS4(t.title ?? "")) return false;
              const tl = (t.title ?? "").toLowerCase();
              return tl.includes("win") || tl.includes("champion") || tl.includes("premier") ||
                     tl.includes("nba") || tl.includes("nfl") || tl.includes("super bowl") ||
                     tl.includes("serie a") || tl.includes("laliga") || tl.includes("la liga") ||
                     tl.includes("bundesliga") || tl.includes("ucl") || tl.includes("world cup") ||
                     tl.includes("champions league") || tl.includes("stanley cup") ||
                     tl.includes("ballon") || tl.includes("playoffs") || tl.includes("make the");
            });

            if (sportsTrades.length < 3) return null;

            const sportsBuys  = sportsTrades.filter(t => t.side === "BUY");
            const sportsSells = sportsTrades.filter(t => t.side === "SELL");

            // Avg prices
            const avgSportsBuyPrice  = sportsBuys.length
              ? sportsBuys.reduce((s, t) => s + (t.price ?? 0), 0) / sportsBuys.length : null;
            const avgSportsSellPrice = sportsSells.length
              ? sportsSells.reduce((s, t) => s + (t.price ?? 0), 0) / sportsSells.length : null;
            const avgSportsTradeSize = sportsTrades.length
              ? sportsTrades.reduce((s, t) => s + (t.size ?? 0), 0) / sportsTrades.length : null;

            // Price buckets
            const priceBuckets = {
              under0_35: 0, p0_35_to_0_50: 0, p0_50_to_0_65: 0,
              p0_65_to_0_80: 0, p0_80_to_0_95: 0, p0_95_plus: 0,
            };
            sportsBuys.forEach(t => {
              const p = t.price ?? 0;
              if      (p < 0.35) priceBuckets.under0_35++;
              else if (p < 0.50) priceBuckets.p0_35_to_0_50++;
              else if (p < 0.65) priceBuckets.p0_50_to_0_65++;
              else if (p < 0.80) priceBuckets.p0_65_to_0_80++;
              else if (p < 0.95) priceBuckets.p0_80_to_0_95++;
              else               priceBuckets.p0_95_plus++;
            });

            // Top markets by volume
            const marketVol = new Map<string, { title: string; vol: number; count: number }>();
            sportsTrades.forEach(t => {
              const prev = marketVol.get(t.conditionId) ?? { title: t.title ?? "", vol: 0, count: 0 };
              marketVol.set(t.conditionId, {
                title: t.title ?? prev.title,
                vol: prev.vol + (t.size ?? 0),
                count: prev.count + 1,
              });
            });
            const topMarkets = [...marketVol.values()].sort((a, b) => b.vol - a.vol).slice(0, 5);

            // ── Series grouping ──────────────────────────────────────────────────────
            type SeriesEntry = {
              seriesKey: string;
              seriesLabel: string;
              outcomes: Set<string>;       // normalized outcome strings
              conditionIds: Set<string>;
              buyTrades: number; sellTrades: number;
              buyNotional: number; sellNotional: number;
              buyPriceSum: number; sellPriceSum: number;
              timestamps: number[];
              endDates: number[];          // unix seconds
              sampleSlugs: Set<string>;
              sampleTitle: string;
            };

            const seriesMap = new Map<string, SeriesEntry>();

            sportsTrades.forEach(t => {
              const parsed = parseSeriesKey(t.title ?? "");
              if (parsed.marketType === "match" || (parsed.marketType === "other" && !parsed.competition)) return;
              const key = parsed.seriesKey ?? ("other_" + (t.title ?? "").slice(0, 30).replace(/\s+/g, "_"));
              if (!seriesMap.has(key)) {
                seriesMap.set(key, {
                  seriesKey: key,
                  seriesLabel: parsed.seriesLabel ?? key,
                  outcomes: new Set(),
                  conditionIds: new Set(),
                  buyTrades: 0, sellTrades: 0,
                  buyNotional: 0, sellNotional: 0,
                  buyPriceSum: 0, sellPriceSum: 0,
                  timestamps: [],
                  endDates: [],
                  endTsData: [] as Array<{ ts: number; source: string; confidence: string }>,
                  notionals: [] as number[],
                  sampleSlugs: new Set(),
                  sampleTitle: t.title ?? "",
                });
              }
              const s = seriesMap.get(key)!;
              const outcomeToken = parsed.subject
                ? parsed.subject.toLowerCase().slice(0, 40)
                : (t.title ?? "").replace(/will /i, "").replace(/win the .*/i, "")
                    .replace(/make the .*/i, "").replace(/finish .*/i, "")
                    .trim().toLowerCase().slice(0, 40);
              s.outcomes.add(outcomeToken);
              s.conditionIds.add(t.conditionId);
              if (t.side === "BUY") {
                s.buyTrades++;
                s.buyNotional  += (t.size ?? 0);
                s.buyPriceSum  += (t.price ?? 0);
              } else {
                s.sellTrades++;
                s.sellNotional  += (t.size ?? 0);
                s.sellPriceSum  += (t.price ?? 0);
              }
              const tradeTsUnix = t.timestamp ?? 0;
              s.timestamps.push(tradeTsUnix);
              let endTs: number | null = null;
              let endSrc = "unknown", endConf = "low";
              if (t.endDate) {
                endTs = Math.floor(new Date(t.endDate).getTime() / 1000);
                endSrc = "trade_payload"; endConf = "high";
              } else if ((t as any).gameStartTime) {
                endTs = Math.floor(new Date((t as any).gameStartTime).getTime() / 1000);
                endSrc = "gamma_market"; endConf = "medium";
              } else {
                const tdm = (t.title ?? "").match(/\b(\d{4}-\d{2}-\d{2})\b/);
                if (tdm) { endTs = Math.floor(new Date(tdm[1]).getTime() / 1000); endSrc = "title_parse"; endConf = "low"; }
              }
              if (!endTs) {
                const est = estimateEndDateForSports(t.title ?? "", tradeTsUnix);
                if (est) { endTs = Math.floor(new Date(est).getTime() / 1000); endSrc = "series_estimate"; endConf = "low"; }
              }
              if (endTs) {
                s.endDates.push(endTs);
                s.endTsData.push({ ts: endTs, source: endSrc, confidence: endConf });
                s.notionals.push(t.size ?? 0);
              }
              if (t.slug) s.sampleSlugs.add(t.slug);
            });

            // Build S4SeriesRow[]
            const seriesRows = [...seriesMap.values()].map(s => {
              const grossNotional = s.buyNotional + s.sellNotional;
              const netDir        = Math.abs(s.buyNotional - s.sellNotional);
              const hedgeRatio    = grossNotional > 0 ? 1 - netDir / grossNotional : 0;
              const avgBuyPrice   = s.buyTrades  > 0 ? s.buyPriceSum  / s.buyTrades  : null;
              const avgSellPrice  = s.sellTrades > 0 ? s.sellPriceSum / s.sellTrades : null;
              const avgTradeSize  = (s.buyTrades + s.sellTrades) > 0
                ? grossNotional / (s.buyTrades + s.sellTrades) : null;
              const firstTradeTs  = s.timestamps.length ? Math.min(...s.timestamps) : null;
              const lastTradeTs   = s.timestamps.length ? Math.max(...s.timestamps) : null;

              // ── Time enrichment ──────────────────────────────────────────
              const medianOf = (arr: number[]) => {
                if (!arr.length) return null;
                const sorted = [...arr].sort((a,b)=>a-b);
                return sorted[Math.floor(sorted.length/2)];
              };
              const pctOf = (arr: number[], p: number) => {
                if (!arr.length) return null;
                const sorted = [...arr].sort((a,b)=>a-b);
                return sorted[Math.floor(sorted.length*p)];
              };

              const daysAll: number[] = [], daysHigh: number[] = [];
              let capitalDays = 0, capitalDaysHighConf = 0;
              s.endTsData.forEach((e, i) => {
                const d = (e.ts - (s.timestamps[i] ?? 0)) / 86400;
                if (d <= 0 || d > 3650) return;
                const n = s.notionals[i] ?? 0;
                daysAll.push(d);
                capitalDays += n * d;
                if (e.confidence !== "low") { daysHigh.push(d); capitalDaysHighConf += n * d; }
              });

              const weightedMedianDaysToResolution = (() => {
                const pairs = s.endTsData
                  .map((e,i) => ({ d:(e.ts-(s.timestamps[i]??0))/86400, w:s.notionals[i]??0 }))
                  .filter(p=>p.d>0&&p.d<3650).sort((a,b)=>a.d-b.d);
                const tw = pairs.reduce((s,p)=>s+p.w,0);
                if (!tw) return null;
                let cum=0; for (const p of pairs){cum+=p.w;if(cum>=tw/2)return p.d;} return null;
              })();

              const rb = { under1d:0,d1_to_7:0,d7_to_30:0,d30_to_90:0,over90d:0,
                           unknown: Math.max(0,s.timestamps.length-daysAll.length) };
              for (const d of daysAll) {
                if (d<1) rb.under1d++; else if(d<7) rb.d1_to_7++;
                else if(d<30) rb.d7_to_30++; else if(d<90) rb.d30_to_90++; else rb.over90d++;
              }
              const res = daysAll.length||1;
              const nearExpiryTradeShare   = rb.under1d/res;
              const shortHorizonTradeShare = (rb.under1d+rb.d1_to_7)/res;
              const longHorizonTradeShare  = (rb.d30_to_90+rb.over90d)/res;

              return {
                seriesKey: s.seriesKey,
                seriesLabel: s.seriesLabel,
                sampleMarketTitle: s.sampleTitle,
                outcomesTraded: s.outcomes.size,
                marketsTraded: s.conditionIds.size,
                buyTrades: s.buyTrades,
                sellTrades: s.sellTrades,
                buyNotional: s.buyNotional,
                sellNotional: s.sellNotional,
                grossNotional,
                netDirectionalExposure: netDir,
                hedgeRatio,
                avgBuyPrice,
                avgSellPrice,
                avgTradeSize,
                firstTradeTs,
                lastTradeTs,
                medianDaysToResolution:         medianOf(daysAll),
                medianDaysToResolutionHighConf: medianOf(daysHigh),
                p25DaysToResolution:            pctOf(daysAll,0.25),
                p75DaysToResolution:            pctOf(daysAll,0.75),
                weightedMedianDaysToResolution,
                nearExpiryTradeShare,
                shortHorizonTradeShare,
                longHorizonTradeShare,
                capitalDays: capitalDays||null,
                capitalDaysHighConf: capitalDaysHighConf||null,
                resolutionBuckets: rb,
                sampleSlugs: [...s.sampleSlugs].slice(0,3),
              };
            }).sort((a, b) => b.grossNotional - a.grossNotional);

            const totalGrossNotional = seriesRows.reduce((s, r) => s + r.grossNotional, 0);

            // Wallet-level series metrics
            const seriesCount = seriesRows.length;
            const avgSeriesOutcomeCount = seriesCount > 0
              ? seriesRows.reduce((s, r) => s + r.outcomesTraded, 0) / seriesCount : 0;
            const maxSeriesConcentration = totalGrossNotional > 0 && seriesRows.length > 0
              ? seriesRows[0].grossNotional / totalGrossNotional : 0;

            // Weighted seriesHedgeRatio
            const seriesHedgeRatio = totalGrossNotional > 0
              ? seriesRows.reduce((s, r) => s + r.hedgeRatio * r.grossNotional, 0) / totalGrossNotional : 0;

            const topSeries    = seriesRows[0] ?? null;
            const top3Series   = seriesRows.slice(0, 3);

            // strongS4Candidate
            // ── Wallet-level time aggregates ──────────────────────────
            const walletCapitalDays    = seriesRows.reduce((s,r)=>s+(r.capitalDays??0),0)||null;
            const walletCapDaysHigh    = seriesRows.reduce((s,r)=>s+(r.capitalDaysHighConf??0),0)||null;
            const globalBuckets = {under1d:0,d1_to_7:0,d7_to_30:0,d30_to_90:0,over90d:0,unknown:0};
            for (const r of seriesRows) {
              const b = r.resolutionBuckets;
              globalBuckets.under1d+=b.under1d; globalBuckets.d1_to_7+=b.d1_to_7;
              globalBuckets.d7_to_30+=b.d7_to_30; globalBuckets.d30_to_90+=b.d30_to_90;
              globalBuckets.over90d+=b.over90d; globalBuckets.unknown+=b.unknown;
            }
            const totalRes = globalBuckets.under1d+globalBuckets.d1_to_7+globalBuckets.d7_to_30+
              globalBuckets.d30_to_90+globalBuckets.over90d||1;
            const walletNearExpiry = globalBuckets.under1d/totalRes;
            const walletShortH     = (globalBuckets.under1d+globalBuckets.d1_to_7)/totalRes;
            const walletLongH      = (globalBuckets.d30_to_90+globalBuckets.over90d)/totalRes;
            const pnlPerCapitalDay = walletCapitalDays&&(wallet.totalPnl??0)
              ? (wallet.totalPnl??0)/walletCapitalDays : null;
            // Wallet median: median of per-series medians
            const seriesMeds = seriesRows.map(r=>r.medianDaysToResolution).filter((d):d is number=>d!=null);
            seriesMeds.sort((a,b)=>a-b);
            const walletMedianDays = seriesMeds.length ? seriesMeds[Math.floor(seriesMeds.length/2)] : null;
            // Wallet weighted median: weight by grossNotional
            const wPairs = seriesRows.filter(r=>r.weightedMedianDaysToResolution!=null)
              .map(r=>({d:r.weightedMedianDaysToResolution!,w:r.grossNotional}))
              .sort((a,b)=>a.d-b.d);
            const wTot = wPairs.reduce((s,p)=>s+p.w,0);
            let walletWeightedMedianDays: number|null = null;
            if (wTot){let cum=0;for(const p of wPairs){cum+=p.w;if(cum>=wTot/2){walletWeightedMedianDays=p.d;break;}}}

            // ── S4 scoring: detector + ranker ────────────────────────
            // Helper fns (block-scoped)
            const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
            const logNorm = (x: number, maxLog = 6) =>
              clamp01(Math.log10(Math.max(1, x)) / maxLog);

            // Raw inputs
            const _hedgeRatio   = topSeries?.hedgeRatio       ?? 0;
            const _outcomeCount = topSeries?.outcomesTraded    ?? 0;
            const _grossNotional= topSeries?.grossNotional     ?? 0;

            // Score components (0–1 each)
            const _hedgeScore   = clamp01(_hedgeRatio / 0.75);
            const _outcomeScore = clamp01((_outcomeCount - 1) / 4);
            const _concScore    = clamp01(maxSeriesConcentration / 0.80);
            const _sizeScore    = logNorm(_grossNotional);
            const _actScore     = clamp01(sportsTrades.length / 50);

            const _horizonLong  = walletWeightedMedianDays == null
              ? 0 : clamp01(walletWeightedMedianDays / 90);
            const _horizonShort = walletWeightedMedianDays == null
              ? 0 : clamp01((7 - walletWeightedMedianDays) / 7);

            const _priceSupport = avgSportsBuyPrice == null ? 0
              : (avgSportsBuyPrice >= 0.25 && avgSportsBuyPrice <= 0.70) ? 1
              : (avgSportsBuyPrice >= 0.15 && avgSportsBuyPrice <= 0.80) ? 0.5
              : 0;

            // Long score
            const s4LongScore = 100 * (
              0.28 * _hedgeScore       +
              0.16 * _outcomeScore     +
              0.16 * _concScore        +
              0.14 * _sizeScore        +
              0.10 * _actScore         +
              0.10 * _horizonLong      +
              0.06 * walletLongH
            );

            // Short score
            const s4ShortScore = 100 * (
              0.30 * _hedgeScore       +
              0.15 * _outcomeScore     +
              0.12 * _concScore        +
              0.12 * _sizeScore        +
              0.08 * _actScore         +
              0.13 * _horizonShort     +
              0.05 * walletShortH      +
              0.05 * _priceSupport
            );

            const s4Score   = Math.max(s4LongScore, s4ShortScore);
            const s4Subtype = s4LongScore >= s4ShortScore ? "long" : "short";

            // Soft detector gate
            const strongS4Candidate =
              sportsTrades.length >= 5 &&
              _outcomeCount >= 2 &&
              maxSeriesConcentration >= 0.40 &&
              (
                _hedgeRatio          >= 0.25 ||
                seriesHedgeRatio     >= 0.15 ||
                walletLongH          >= 0.70
              );

            // Subtypes
            const strongS4Long  = strongS4Candidate && s4Subtype === "long"  && s4LongScore  >= 55;
            const strongS4Short = strongS4Candidate && s4Subtype === "short" && s4ShortScore >= 60;

            // Post-filter: must have ≥1 series with ≥2 outcomes OR seriesHedgeRatio > 0.3
            const hasHedge = seriesRows.some(r => r.outcomesTraded >= 2 || r.hedgeRatio > 0.30);
            if (!hasHedge && !strongS4Candidate) return null;

            return {
              address: wallet.address,
              name: wallet.pseudonym || wallet.name,
              winRate: wallet.winRate,
              totalPnl: wallet.totalPnl,
              totalTrades: wallet.totalTrades,
              trades30d: wallet.trades30d,
              sportsTradeCount: sportsTrades.length,
              sportsBuyCount: sportsBuys.length,
              sportsSellCount: sportsSells.length,
              avgSportsBuyPrice,
              avgSportsSellPrice,
              avgSportsTradeSize,
              seriesCount,
              avgSeriesOutcomeCount,
              maxSeriesConcentration,
              topSeriesKey:                   topSeries?.seriesKey ?? null,
              topSeriesLabel:                 topSeries?.seriesLabel ?? null,
              topSeriesOutcomeCount:          topSeries?.outcomesTraded ?? 0,
              topSeriesGrossNotional:         topSeries?.grossNotional ?? 0,
              topSeriesHedgeRatio:            topSeries?.hedgeRatio ?? 0,
              topSeriesMedianDaysToResolution:  topSeries?.medianDaysToResolution ?? null,
              topSeriesWeightedMedianDays:      topSeries?.weightedMedianDaysToResolution ?? null,
              topSeriesP25Days:                 topSeries?.p25DaysToResolution ?? null,
              topSeriesP75Days:                 topSeries?.p75DaysToResolution ?? null,
              topSeriesNearExpiry:              topSeries?.nearExpiryTradeShare ?? null,
              topSeriesShortHorizon:            topSeries?.shortHorizonTradeShare ?? null,
              topSeriesLongHorizon:             topSeries?.longHorizonTradeShare ?? null,
              topSeriesResolutionBuckets:       topSeries?.resolutionBuckets ?? null,

              medianDaysToResolution:           walletMedianDays,
              weightedMedianDaysToResolution:   walletWeightedMedianDays,
              nearExpiryTradeShare:             walletNearExpiry,
              shortHorizonTradeShare:           walletShortH,
              longHorizonTradeShare:            walletLongH,
              capitalDays:                      walletCapitalDays,
              capitalDaysHighConf:              walletCapDaysHigh,
              pnlPerCapitalDay,
              resolutionBuckets:                globalBuckets,

              seriesHedgeRatio,
              s4Score:        Math.round(s4Score),
              s4LongScore:    Math.round(s4LongScore),
              s4ShortScore:   Math.round(s4ShortScore),
              s4Subtype,
              strongS4Candidate,
              strongS4Short,
              strongS4Long,
              priceBuckets,
              topMarkets,
              topSeries: top3Series,
            };
          } catch { return null; }
        })
      );

      const filtered = results.filter(Boolean) as any[];
      const sorted   = filtered.sort((a, b) => b.topSeriesGrossNotional - a.topSeriesGrossNotional);
      const s4Count  = sorted.filter(w => w.strongS4Candidate || w.seriesHedgeRatio >= 0.50).length;
      const strongCount = sorted.filter(w => w.strongS4Candidate).length;

      res.json({
        s4Wallets: sorted,
        summary: {
          totalScanned:       s4Candidates.length,
          withSportsTrades:   filtered.length,
          s4Candidates:       s4Count,
          strongS4Candidates: strongCount,
          avgHedgeRatio:      filtered.length
            ? filtered.reduce((s, r) => s + r.seriesHedgeRatio, 0) / filtered.length : 0,
          avgSportsBuyPrice:  filtered.length
            ? filtered.reduce((s, r) => s + (r.avgSportsBuyPrice ?? 0), 0) / filtered.length : null,
          avgSportsTradeSize: filtered.length
            ? filtered.reduce((s, r) => s + (r.avgSportsTradeSize ?? 0), 0) / filtered.length : null,
        },
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });


}

