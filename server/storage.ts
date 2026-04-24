// Cross-platform storage using JSON file (no native modules needed)
import fs from "fs";
import path from "path";
import type { WalletStats, LiveTrade, PnlHistory, Signal, InsertWalletStats, InsertLiveTrade } from "@shared/schema";

const DB_FILE = path.join(process.cwd(), "polymarket-data.json");

interface DB {
  wallets: Record<string, WalletStats>;
  trades: LiveTrade[];
  pnlHistory: Record<string, PnlHistory[]>;
  tradeIdCounter: number;
  // wallet -> set of conditionIds already seen (for "new position" detection)
  walletMarkets: Record<string, string[]>;
  // wallet -> conditionId -> cumulative USDC size
  walletMarketSizes: Record<string, Record<string, number>>;
  // wallet -> conditionId -> trade count
  walletMarketCounts: Record<string, Record<string, number>>;
  // Signal alerts
  signals: Signal[];
  signalIdCounter: number;
}

function loadDb(): DB {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      return {
        walletMarkets: {},
        walletMarketSizes: {},
        walletMarketCounts: {},
        signals: [],
        signalIdCounter: 0,
        ...raw,
      };
    }
  } catch {}
  return {
    wallets: {}, trades: [], pnlHistory: {}, tradeIdCounter: 0,
    walletMarkets: {}, walletMarketSizes: {}, walletMarketCounts: {},
    signals: [], signalIdCounter: 0,
  };
}

function saveDb(db: DB) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db), "utf8");
  } catch (e) {
    console.error("saveDb error:", e);
  }
}

let db = loadDb();
setInterval(() => saveDb(db), 30000);

export interface IStorage {
  getTopWallets(limit: number, sortBy: string): WalletStats[];
  getWallet(address: string): WalletStats | undefined;
  upsertWallet(data: InsertWalletStats): WalletStats;
  getAllWallets(): WalletStats[];
  getLatestTrades(limit: number): LiveTrade[];
  insertTrade(trade: InsertLiveTrade): LiveTrade;
  getTopWalletTrades(address: string, limit: number): LiveTrade[];
  getTradeCount(): number;
  getPnlHistory(address: string): PnlHistory[];
  insertPnlPoint(point: { address: string; timestamp: number; cumulativePnl: number; tradeCount: number }): void;
  clearPnlHistory(address: string): void;
  // Signal methods
  isNewMarketForWallet(address: string, conditionId: string): boolean;
  recordWalletMarket(address: string, conditionId: string, size: number): { totalSize: number; tradeCount: number };
  // Seed historical markets from bootstrap — marks conditionIds as "already seen"
  // so they are NOT flagged as new entries when detected in the live feed
  seedWalletMarkets(address: string, conditionIds: string[]): void;
  insertSignal(signal: Omit<Signal, "id">): Signal;
  getSignals(limit: number): Signal[];
  getSignalCount(): number;
}

export const storage: IStorage = {
  getTopWallets(limit, sortBy) {
    const wallets = Object.values(db.wallets);
    const key = sortBy === "win_rate" ? "winRate"
      : sortBy === "trade_count" ? "totalTrades"
      : sortBy === "volume" ? "totalVolume"
      : sortBy === "ev" ? "avgEv"
      : "totalPnl";
    return wallets.sort((a, b) => ((b as any)[key] ?? 0) - ((a as any)[key] ?? 0)).slice(0, limit);
  },

  getWallet(address) { return db.wallets[address]; },

  upsertWallet(data) {
    db.wallets[data.address] = { ...data, lastUpdated: Date.now() } as WalletStats;
    return db.wallets[data.address];
  },

  getAllWallets() { return Object.values(db.wallets); },

  getLatestTrades(limit) {
    return [...db.trades].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, limit);
  },

  insertTrade(trade) {
    const id = ++db.tradeIdCounter;
    const record: LiveTrade = { id, ...trade } as LiveTrade;
    db.trades.unshift(record);
    if (db.trades.length > 500) db.trades = db.trades.slice(0, 500);
    return record;
  },

  getTopWalletTrades(address, limit) {
    return db.trades.filter(t => t.proxyWallet === address).slice(0, limit);
  },

  getTradeCount() { return db.trades.length; },

  getPnlHistory(address) { return db.pnlHistory[address] ?? []; },

  insertPnlPoint(point) {
    if (!db.pnlHistory[point.address]) db.pnlHistory[point.address] = [];
    db.pnlHistory[point.address].push({
      id: Date.now(), address: point.address,
      timestamp: point.timestamp, cumulativePnl: point.cumulativePnl, tradeCount: point.tradeCount,
    });
  },

  clearPnlHistory(address) { db.pnlHistory[address] = []; },

  // ── Signal methods ──────────────────────────────────────────────────────────

  seedWalletMarkets(address, conditionIds) {
    // Bulk-initialise the "seen" set from historical trade data loaded at bootstrap.
    // We only mark them as seen — we do NOT touch size/count accumulators so that
    // any future trade on the same market will be correctly classified as
    // "accumulating" (not "new") and use the real live-feed running totals.
    if (!db.walletMarkets[address]) db.walletMarkets[address] = [];
    const seen = new Set(db.walletMarkets[address]);
    for (const cid of conditionIds) {
      if (cid && !seen.has(cid)) {
        db.walletMarkets[address].push(cid);
        seen.add(cid);
      }
    }
    // Cap to last 2000 entries (vs 500 before — history can be large)
    if (db.walletMarkets[address].length > 2000) {
      db.walletMarkets[address] = db.walletMarkets[address].slice(-2000);
    }
  },

  isNewMarketForWallet(address, conditionId) {
    const seen = db.walletMarkets[address] ?? [];
    return !seen.includes(conditionId);
  },

  recordWalletMarket(address, conditionId, size) {
    // Track seen markets
    if (!db.walletMarkets[address]) db.walletMarkets[address] = [];
    if (!db.walletMarkets[address].includes(conditionId)) {
      db.walletMarkets[address].push(conditionId);
    }
    // Keep only last 500 markets per wallet to avoid unbounded growth
    if (db.walletMarkets[address].length > 500) {
      db.walletMarkets[address] = db.walletMarkets[address].slice(-500);
    }
    // Track cumulative size
    if (!db.walletMarketSizes[address]) db.walletMarketSizes[address] = {};
    db.walletMarketSizes[address][conditionId] = (db.walletMarketSizes[address][conditionId] ?? 0) + size;
    // Track trade count
    if (!db.walletMarketCounts[address]) db.walletMarketCounts[address] = {};
    db.walletMarketCounts[address][conditionId] = (db.walletMarketCounts[address][conditionId] ?? 0) + 1;

    return {
      totalSize: db.walletMarketSizes[address][conditionId],
      tradeCount: db.walletMarketCounts[address][conditionId],
    };
  },

  insertSignal(signal) {
    const id = ++db.signalIdCounter;
    const record: Signal = { id, ...signal } as Signal;
    db.signals.unshift(record);
    // Keep last 200 signals
    if (db.signals.length > 200) db.signals = db.signals.slice(0, 200);
    return record;
  },

  getSignals(limit) {
    return db.signals.slice(0, limit);
  },

  getSignalCount() { return db.signals.length; },
};
