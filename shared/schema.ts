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
  markets: text("markets").default("[]"), // JSON array of market categories
  topMarkets: text("top_markets").default("[]"), // JSON array of top markets
  lastUpdated: integer("last_updated").default(0),
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

export const insertWalletStatsSchema = createInsertSchema(walletStats).omit({ lastUpdated: true });
export const insertLiveTradeSchema = createInsertSchema(liveTrades).omit({ id: true });
export const insertPnlHistorySchema = createInsertSchema(pnlHistory).omit({ id: true });

export type WalletStats = typeof walletStats.$inferSelect;
export type LiveTrade = typeof liveTrades.$inferSelect;
export type PnlHistory = typeof pnlHistory.$inferSelect;
export type InsertWalletStats = z.infer<typeof insertWalletStatsSchema>;
export type InsertLiveTrade = z.infer<typeof insertLiveTradeSchema>;
