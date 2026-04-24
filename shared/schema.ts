import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Cached wallet stats (aggregated from Polymarket API)
export const walletStats = sqliteTable("wallet_stats", {
  address: text("address").primaryKey(),
  pseudonym: text("pseudonym"),
  name: text("name"),
  profileImage: text("profile_image"),
  totalTrades: integer("total_trades").default(0),
  buyTrades: integer("buy_trades").default(0),
  sellTrades: integer("sell_trades").default(0),
  totalVolume: real("total_volume").default(0),
  totalPnl: real("total_pnl").default(0),
  winRate: real("win_rate").default(0),
  avgEv: real("avg_ev").default(0),
  winCount: integer("win_count").default(0),
  lossCount: integer("loss_count").default(0),
  markets: text("markets").default("[]"),       // JSON array of market categories
  topMarkets: text("top_markets").default("[]"), // JSON array of top markets
  lastUpdated: integer("last_updated").default(0),
  // New fields
  lastTradeTimestamp: integer("last_trade_timestamp").default(0), // unix seconds of most recent trade
  trades30d: integer("trades_30d").default(0),  // trade count in last 30 days
  avgBuyPrice: real("avg_buy_price").default(0), // volume-weighted avg BUY price; >0.90 + WR>95% = near-expiry arb
});

// Recent live trades for real-time feed
export const liveTrades = sqliteTable("live_trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  proxyWallet: text("proxy_wallet"),
  side: text("side"),
  size: real("size"),
  price: real("price"),
  timestamp: integer("timestamp"),
  title: text("title"),
  outcome: text("outcome"),
  slug: text("slug"),
  name: text("name"),
  pseudonym: text("pseudonym"),
  transactionHash: text("transaction_hash"),
  isTopWallet: integer("is_top_wallet").default(0),
});

// PNL history points for profit curves
export const pnlHistory = sqliteTable("pnl_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  address: text("address"),
  timestamp: integer("timestamp"),
  cumulativePnl: real("cumulative_pnl"),
  tradeCount: integer("trade_count"),
});

// Signal alerts — накопление smart money
export const signals = sqliteTable("signals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  proxyWallet: text("proxy_wallet"),
  walletName: text("wallet_name"),
  conditionId: text("condition_id"),
  marketTitle: text("market_title"),
  outcome: text("outcome"),
  price: real("price"),           // entry price (0-1)
  size: real("size"),             // USDC size
  totalSize: real("total_size"),  // cumulative size on this market
  tradeCount: integer("trade_count").default(1), // trades on this market so far
  isNew: integer("is_new").default(1),   // 1 = first time this wallet trades this market
  walletEv: real("wallet_ev"),
  slug: text("slug"),
  detectedAt: integer("detected_at"),  // unix ms
  transactionHash: text("transaction_hash"),
});

export const insertSignalSchema = createInsertSchema(signals).omit({ id: true });
export type Signal = typeof signals.$inferSelect;
export type InsertSignal = z.infer<typeof insertSignalSchema>;

export const insertWalletStatsSchema = createInsertSchema(walletStats).omit({ lastUpdated: true });
export const insertLiveTradeSchema = createInsertSchema(liveTrades).omit({ id: true });
export const insertPnlHistorySchema = createInsertSchema(pnlHistory).omit({ id: true });

export type WalletStats = typeof walletStats.$inferSelect;
export type LiveTrade = typeof liveTrades.$inferSelect;
export type PnlHistory = typeof pnlHistory.$inferSelect;
export type InsertWalletStats = z.infer<typeof insertWalletStatsSchema>;
export type InsertLiveTrade = z.infer<typeof insertLiveTradeSchema>;
