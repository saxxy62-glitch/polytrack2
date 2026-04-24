// Polymarket Data API integration
const DATA_API = "https://data-api.polymarket.com";

export interface RawTrade {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  outcome: string;
  outcomeIndex: number;
  name: string;
  pseudonym: string;
  bio: string;
  profileImage: string;
  transactionHash: string;
  icon: string;
  eventSlug: string;
}

export interface ClosedPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  avgPrice: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  title: string;
  slug: string;
  outcome: string;
  endDate: string;
  timestamp: number;
}

// Official leaderboard entry from /v1/leaderboard
export interface LeaderboardEntry {
  rank: number;
  proxyWallet: string;
  userName: string;
  xUsername: string;
  verifiedBadge: boolean;
  vol: number;
  pnl: number;
  profileImage: string;
}

export interface WalletAggregate {
  address: string;
  pseudonym: string;
  name: string;
  profileImage: string;
  totalTrades: number;
  buyTrades: number;
  sellTrades: number;
  totalVolume: number;
  totalPnl: number;
  winRate: number;
  avgEv: number;
  winCount: number;
  lossCount: number;
  markets: string[];
  topMarkets: { title: string; volume: number; count: number }[];
  pnlCurve: { timestamp: number; cumPnl: number; tradeCount: number }[];
  lastTradeTimestamp: number;  // unix seconds
  trades30d: number;           // trades in last 30 days
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "polytrack/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// ─── Leaderboard (official PNL source) ───────────────────────────────────────

export type TimePeriod = "ALL" | "MONTH" | "WEEK" | "DAY";
export type OrderBy = "PNL" | "VOL";
export type Category =
  | "OVERALL"
  | "POLITICS"
  | "SPORTS"
  | "CRYPTO"
  | "FINANCE"
  | "CULTURE"
  | "WEATHER"
  | "ECONOMICS"
  | "TECH";

export async function fetchLeaderboard(
  limit = 100,
  timePeriod: TimePeriod = "ALL",
  orderBy: OrderBy = "PNL",
  category: Category = "OVERALL"
): Promise<LeaderboardEntry[]> {
  try {
    const url = `${DATA_API}/v1/leaderboard?limit=${limit}&timePeriod=${timePeriod}&orderBy=${orderBy}&category=${category}`;
    const data = await fetchJson(url);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("fetchLeaderboard error:", e);
    return [];
  }
}

// ─── Live trades ──────────────────────────────────────────────────────────────

export async function fetchLatestTrades(limit = 500): Promise<RawTrade[]> {
  try {
    const data = await fetchJson(`${DATA_API}/trades?limit=${limit}`);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("fetchLatestTrades error:", e);
    return [];
  }
}

export async function fetchWalletTrades(address: string, limit = 500): Promise<RawTrade[]> {
  try {
    const data = await fetchJson(`${DATA_API}/trades?user=${address}&limit=${limit}`);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error(`fetchWalletTrades error for ${address}:`, e);
    return [];
  }
}

// ─── Closed positions (used ONLY for PNL curve charts) ───────────────────────
// NOTE: API caps at 50 records sorted by biggest wins — NOT used for total PNL

export async function fetchClosedPositionsPage(
  address: string,
  limit = 50,
  offset = 0
): Promise<ClosedPosition[]> {
  try {
    const data = await fetchJson(
      `${DATA_API}/closed-positions?user=${address}&limit=${limit}&offset=${offset}`
    );
    return Array.isArray(data) ? data : (data?.positions ?? []);
  } catch (e) {
    console.error(`fetchClosedPositions error offset=${offset}:`, e);
    return [];
  }
}

// Fetch up to 5 pages of closed positions for PNL curve (250 data points max)
export async function fetchClosedPositionsForChart(address: string): Promise<ClosedPosition[]> {
  const all: ClosedPosition[] = [];
  for (let offset = 0; offset < 250; offset += 50) {
    const batch = await fetchClosedPositionsPage(address, 50, offset);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 50) break;
  }
  return all;
}

// ─── Portfolio value ──────────────────────────────────────────────────────────

export async function fetchPortfolioValue(address: string): Promise<number> {
  try {
    const data = await fetchJson(`${DATA_API}/value?user=${address}`);
    const arr = Array.isArray(data) ? data : [data];
    return arr[0]?.value ?? 0;
  } catch {
    return 0;
  }
}

// ─── Build WalletAggregate from leaderboard entry + supplemental data ─────────

export function buildWalletFromLeaderboard(
  entry: LeaderboardEntry,
  trades: RawTrade[],
  closedPositions: ClosedPosition[]
): WalletAggregate {
  // PNL and volume come DIRECTLY from the official leaderboard — always accurate
  const totalPnl = entry.pnl ?? 0;
  const totalVolume = entry.vol ?? 0;

  // Trade count: use number of trades from the trades feed (actual tx count)
  // closedPositions.length is positions (markets), trades = individual tx
  const totalTrades = trades.length > 0 ? trades.length : closedPositions.length;
  const buyTrades = trades.filter(t => t.side === "BUY").length;
  const sellTrades = trades.filter(t => t.side === "SELL").length;

  // Profile info: leaderboard has userName; trades have pseudonym/name/profileImage
  const pseudonym = entry.userName || trades[0]?.pseudonym || "";
  const name = trades[0]?.name || entry.userName || "";
  const profileImage = entry.profileImage || trades[0]?.profileImage || "";

  // lastTradeTimestamp: newest trade in the recent trades feed
  const now = Math.floor(Date.now() / 1000);
  const cutoff30d = now - 30 * 86400;
  const trades30d = trades.filter(t => (t.timestamp ?? 0) >= cutoff30d).length;
  const lastTradeTimestamp = trades.length > 0
    ? Math.max(...trades.map(t => t.timestamp ?? 0))
    : 0;

  // Win/loss from closed positions (sorted by biggest wins, so partial — for display only)
  let winCount = 0;
  let lossCount = 0;
  let cumPnl = 0;
  const pnlCurve: { timestamp: number; cumPnl: number; tradeCount: number }[] = [];

  // Sort by timestamp for curve
  const sortedClosed = [...closedPositions].sort((a, b) => {
    const ta = a.timestamp ?? new Date(a.endDate ?? 0).getTime() / 1000;
    const tb = b.timestamp ?? new Date(b.endDate ?? 0).getTime() / 1000;
    return ta - tb;
  });

  sortedClosed.forEach((pos, i) => {
    const pnl = pos.realizedPnl ?? 0;
    cumPnl += pnl;
    if (pnl > 0) winCount++;
    else if (pnl < 0) lossCount++;

    const step = Math.max(1, Math.floor(sortedClosed.length / 100));
    if (i % step === 0 || i === sortedClosed.length - 1) {
      const ts = pos.timestamp ?? Math.floor(new Date(pos.endDate ?? 0).getTime() / 1000);
      pnlCurve.push({ timestamp: ts, cumPnl, tradeCount: i + 1 });
    }
  });

  // If no closed positions for chart, create a simple 2-point curve using official PNL
  if (pnlCurve.length === 0 && totalPnl !== 0) {
    const now = Math.floor(Date.now() / 1000);
    pnlCurve.push({ timestamp: now - 86400 * 30, cumPnl: 0, tradeCount: 0 });
    pnlCurve.push({ timestamp: now, cumPnl: totalPnl, tradeCount: totalTrades });
  }

  const winRate = (winCount + lossCount) > 0 ? winCount / (winCount + lossCount) : 0;

  // EV: pnl / volume (return on capital deployed), or from positions if available
  const avgEv = totalVolume > 0 ? totalPnl / totalVolume : 0;

  // Market categories from recent trades
  const categories = new Set<string>();
  const marketMap = new Map<string, { volume: number; count: number }>();

  const allItems = [...trades.slice(0, 200), ...sortedClosed.slice(0, 100)];
  allItems.forEach(item => {
    const title = (item as any).title ?? "";
    if (title) {
      categories.add(extractCategory(title));
      const key = title.slice(0, 60);
      const prev = marketMap.get(key) ?? { volume: 0, count: 0 };
      const vol =
        (item as ClosedPosition).totalBought ??
        ((item as RawTrade).size * (item as RawTrade).price) ??
        0;
      marketMap.set(key, { volume: prev.volume + vol, count: prev.count + 1 });
    }
  });

  const topMarkets = [...marketMap.entries()]
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, 5)
    .map(([title, data]) => ({ title, ...data }));

  return {
    address: entry.proxyWallet,
    pseudonym,
    name,
    profileImage,
    totalTrades,
    buyTrades,
    sellTrades,
    totalVolume,
    totalPnl,
    winRate,
    avgEv,
    winCount,
    lossCount,
    markets: [...categories],
    topMarkets,
    pnlCurve,
    lastTradeTimestamp,
    trades30d,
  };
}

function extractCategory(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("bitcoin") || t.includes("btc") || t.includes("ethereum") || t.includes("eth") || t.includes("crypto")) return "Crypto";
  if (t.includes("trump") || t.includes("biden") || t.includes("election") || t.includes("president") || t.includes("congress") || t.includes("poll")) return "Politics";
  if (t.includes("nba") || t.includes("nfl") || t.includes("nhl") || t.includes("mlb") || t.includes("soccer") || t.includes("football") || t.includes("basketball") || t.includes("tennis") || t.includes("golf") || t.includes(" win on ") || t.includes("fc ") || t.includes(" vs.") || t.includes("championship") || t.includes("league") || t.includes("cup")) return "Sports";
  if (t.includes("fed") || t.includes("rate") || t.includes("gdp") || t.includes("inflation") || t.includes("economy") || t.includes("recession")) return "Economics";
  if (t.includes("ai") || t.includes("gpt") || t.includes("openai") || t.includes("apple") || t.includes("google") || t.includes("microsoft") || t.includes("tech")) return "Tech";
  if (t.includes("weather") || t.includes("temperature") || t.includes("rain") || t.includes("hurricane") || t.includes("celsius")) return "Weather";
  return "Other";
}

// ─── Legacy shim for on-demand wallet lookup (not leaderboard) ────────────────
// Used when a user looks up an address not in the leaderboard

export async function aggregateWalletOnDemand(address: string): Promise<WalletAggregate | null> {
  try {
    const [trades, closedPositions] = await Promise.all([
      fetchWalletTrades(address, 500),
      fetchClosedPositionsForChart(address),
    ]);

    if (trades.length === 0 && closedPositions.length === 0) return null;

    // For on-demand wallets not in leaderboard, use closed positions PNL as best effort
    // The user can compare against Polymarket directly
    let totalPnl = closedPositions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
    const totalVolume = closedPositions.reduce((s, p) => s + (p.totalBought ?? 0), 0);

    const fakeEntry: LeaderboardEntry = {
      rank: 0,
      proxyWallet: address,
      userName: trades[0]?.pseudonym || "",
      xUsername: "",
      verifiedBadge: false,
      vol: totalVolume,
      pnl: totalPnl,
      profileImage: trades[0]?.profileImage || "",
    };

    return buildWalletFromLeaderboard(fakeEntry, trades, closedPositions);
  } catch (e) {
    console.error(`aggregateWalletOnDemand error for ${address}:`, e);
    return null;
  }
}
