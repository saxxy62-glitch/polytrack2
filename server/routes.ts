import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
import {
  fetchLeaderboard,
  fetchLatestTrades,
  fetchWalletTrades,
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
    const recentTrades = storage.getTopWalletTrades(address, 50);

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
}
