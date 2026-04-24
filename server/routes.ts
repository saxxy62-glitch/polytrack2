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
async function bootstrap() {
  if (isBootstrapping || bootstrapDone) return;
  isBootstrapping = true;
  console.log("[Bootstrap] Fetching official Polymarket leaderboard...");

  try {
    // Fetch top 100 by PNL (all time) — official Polymarket data
    const leaderboard = await fetchLeaderboard(100, "ALL", "PNL", "OVERALL");
    console.log(`[Bootstrap] Got ${leaderboard.length} entries from leaderboard`);

    if (leaderboard.length === 0) {
      // Fallback: load from recent live trades if leaderboard unavailable
      console.log("[Bootstrap] Leaderboard empty, falling back to live trades...");
      await bootstrapFromLiveTrades();
      return;
    }

    bootstrapTotal = leaderboard.length;
    bootstrapProgress = 0;

    // Store live trades from global feed first (for live feed page)
    try {
      const liveTrades = await fetchLatestTrades(200);
      storeLiveTrades(liveTrades, new Set());
    } catch (_) {}

    // Process wallets in batches of 5
    const batchSize = 5;
    for (let i = 0; i < leaderboard.length; i += batchSize) {
      const batch = leaderboard.slice(i, i + batchSize);
      await Promise.all(batch.map(entry => processLeaderboardWallet(entry)));
      bootstrapProgress += batch.length;
      console.log(`[Bootstrap] Progress: ${bootstrapProgress}/${bootstrapTotal}`);
    }

    // Mark all leaderboard wallets as top wallets for live feed
    leaderboard.forEach(e => topWalletSet.add(e.proxyWallet));
    bootstrapDone = true;
    console.log("[Bootstrap] Done — leaderboard data loaded with official PNL.");
  } catch (e) {
    console.error("[Bootstrap] Error:", e);
  } finally {
    isBootstrapping = false;
  }
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
          isTopWallet: topWalletSet.has(t.proxyWallet) ? 1 : 0,
        });
      } catch (_) {}
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
    res.json({
      bootstrapDone,
      isBootstrapping,
      bootstrapProgress,
      bootstrapTotal,
      walletCount: storage.getAllWallets().length,
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
        const results = lb.map(entry => ({
          address: entry.proxyWallet,
          pseudonym: entry.userName,
          name: entry.userName,
          profileImage: entry.profileImage,
          totalTrades: 0,
          buyTrades: 0,
          sellTrades: 0,
          totalVolume: entry.vol,
          totalPnl: entry.pnl,
          winRate: 0,
          avgEv: entry.vol > 0 ? entry.pnl / entry.vol : 0,
          winCount: 0,
          lossCount: 0,
          markets: "[]",
          topMarkets: "[]",
          rank: entry.rank,
        }));
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
      });
    }

    const wallet = storage.getWallet(address);
    res.json(wallet ?? { error: "Not found" });
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
