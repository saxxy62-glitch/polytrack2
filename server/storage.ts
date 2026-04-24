// Cross-platform storage using JSON file (no native modules needed)
import fs from "fs";
import path from "path";
import type { WalletStats, LiveTrade, PnlHistory, InsertWalletStats, InsertLiveTrade } from "@shared/schema";

const DB_FILE = path.join(process.cwd(), "polymarket-data.json");

interface DB {
  wallets: Record<string, WalletStats>;
  trades: LiveTrade[];
  pnlHistory: Record<string, PnlHistory[]>;
  tradeIdCounter: number;
}

function loadDb(): DB {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    }
  } catch {}
  return { wallets: {}, trades: [], pnlHistory: {}, tradeIdCounter: 0 };
}

function saveDb(db: DB) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db), "utf8");
  } catch (e) {
    console.error("saveDb error:", e);
  }
}

let db = loadDb();

// Auto-save every 30s
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
}

export const storage: IStorage = {
  getTopWallets(limit: number, sortBy: string) {
    const wallets = Object.values(db.wallets);
    const key = sortBy === "win_rate" ? "winRate"
      : sortBy === "trade_count" ? "totalTrades"
      : sortBy === "volume" ? "totalVolume"
      : sortBy === "ev" ? "avgEv"
      : "totalPnl";
    return wallets
      .sort((a, b) => ((b as any)[key] ?? 0) - ((a as any)[key] ?? 0))
      .slice(0, limit);
  },

  getWallet(address: string) {
    return db.wallets[address];
  },

  upsertWallet(data: InsertWalletStats) {
    const now = Date.now();
    db.wallets[data.address] = { ...data, lastUpdated: now } as WalletStats;
    return db.wallets[data.address];
  },

  getAllWallets() {
    return Object.values(db.wallets);
  },

  getLatestTrades(limit: number) {
    return [...db.trades]
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, limit);
  },

  insertTrade(trade: InsertLiveTrade) {
    const id = ++db.tradeIdCounter;
    const record: LiveTrade = { id, ...trade } as LiveTrade;
    db.trades.unshift(record);
    // Keep only last 500 trades in memory
    if (db.trades.length > 500) db.trades = db.trades.slice(0, 500);
    return record;
  },

  getTopWalletTrades(address: string, limit: number) {
    return db.trades
      .filter(t => t.proxyWallet === address)
      .slice(0, limit);
  },

  getTradeCount() {
    return db.trades.length;
  },

  getPnlHistory(address: string) {
    return db.pnlHistory[address] ?? [];
  },

  insertPnlPoint(point) {
    if (!db.pnlHistory[point.address]) db.pnlHistory[point.address] = [];
    db.pnlHistory[point.address].push({
      id: Date.now(),
      address: point.address,
      timestamp: point.timestamp,
      cumulativePnl: point.cumulativePnl,
      tradeCount: point.tradeCount,
    });
  },

  clearPnlHistory(address: string) {
    db.pnlHistory[address] = [];
  },
};
