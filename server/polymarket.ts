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
  endDate?: string;   // market expiry ISO timestamp from API
  fpmm?: { endDate?: string };
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
  avgBuyPrice: number;         // avg price of BUY trades (0–1); high = near-expiry arb
  avgTradeSize: number;         // avg USDC per trade; small + few trades = low-liq sniper
  avgWeatherRatio: number;      // fraction of markets with weather keywords; >0.5 = weather bot
  avgUpDownRatio: number;       // fraction of trades on "Up or Down" crypto markets; >0.6 = crypto scalper
  cryptoUpDownBuyPrice: number; // avg buy price on Up/Down crypto markets specifically
  proximityBuckets: {           // S2: distribution of BUY trades by time-to-expiry
    under1h: number;            // fraction of buys within 1h of market expiry
    under6h: number;
    under24h: number;
    over24h: number;
    unknown: number;            // trades where endDate not available
  };
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

  // avgBuyPrice: volume-weighted average price of BUY trades
  // Near-expiry arb bots enter at $0.95–0.99, real edge traders span the full range
  const buyTradesList = trades.filter(t => t.side === "BUY" && (t.price ?? 0) > 0);
  const buyPriceWeightedSum = buyTradesList.reduce((s, t) => s + (t.price ?? 0) * (t.size ?? 1), 0);
  const buyVolumeSum = buyTradesList.reduce((s, t) => s + (t.size ?? 1), 0);
  const avgBuyPrice = buyVolumeSum > 0 ? buyPriceWeightedSum / buyVolumeSum : 0;

  // avgTradeSize: avg USDC per trade (size * price for each trade)
  // Low-liq sniper: avgTradeSize > $500 but totalTrades < 20 → concentrated bets on thin markets
  const tradeSizes = trades.map(t => (t.size ?? 0) * (t.price ?? 1));
  const avgTradeSize = tradeSizes.length > 0
    ? tradeSizes.reduce((s, v) => s + v, 0) / tradeSizes.length
    : (totalVolume > 0 && totalTrades > 0 ? totalVolume / totalTrades : 0);

  // avgWeatherRatio: fraction of trade titles containing weather keywords
  // Weather bots (automatedaitradingbot-style) buy YES at 5¢ on exact temperature buckets
  const WEATHER_KEYWORDS = ['temperature', 'weather', 'highest', 'lowest', 'celsius', 'fahrenheit', 'rain', 'high of', 'low of', 'precip'];
  const weatherTrades = trades.filter(t => {
    const title = (t.title ?? '').toLowerCase();
    return WEATHER_KEYWORDS.some(kw => title.includes(kw));
  });
  const avgWeatherRatio = trades.length > 0 ? weatherTrades.length / trades.length : 0;

  // avgUpDownRatio: fraction of trades on "Up or Down" intraday crypto scalp markets
  // Crypto scalper bots (Sharky-style) enter at $0.90-0.99 right before resolution
  const upDownTrades = trades.filter(t => (t.title ?? '').toLowerCase().includes('up or down'));
  const avgUpDownRatio = trades.length > 0 ? upDownTrades.length / trades.length : 0;

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


  // ── S2 features: proximity-to-expiry + crypto up/down buy price ──────────
  const isUpDown = (title: string) => {
    const t = title.toLowerCase();
    return (t.includes("up or down") || t.includes("up 5") || t.includes("up 1") ||
            t.includes("down 5") || t.includes("down 1") || (t.includes("btc") && t.includes("%")) ||
            (t.includes("eth") && t.includes("%")) || (t.includes("sol") && t.includes("%")));
  };
  const buyTradesAll = trades.filter(t => t.side === "BUY");
  const upDownBuys = buyTradesAll.filter(t => isUpDown(t.title ?? ""));
  const cryptoUpDownBuyPrice = upDownBuys.length > 0
    ? upDownBuys.reduce((s, t) => s + (t.price ?? 0), 0) / upDownBuys.length
    : 0;

  // proximity: t.endDate or t.fpmm?.endDate
  const getExpiry = (t: RawTrade): number | null => {
    const raw = t.endDate || t.fpmm?.endDate;
    if (!raw) return null;
    const ts = new Date(raw).getTime();
    return isNaN(ts) ? null : ts / 1000;
  };
  let pb_under1h = 0, pb_under6h = 0, pb_under24h = 0, pb_over24h = 0, pb_unknown = 0;
  buyTradesAll.forEach(t => {
    const expiry = getExpiry(t);
    if (expiry === null) { pb_unknown++; return; }
    const secsLeft = expiry - (t.timestamp ?? 0);
    if (secsLeft < 3600)       pb_under1h++;
    else if (secsLeft < 21600) pb_under6h++;
    else if (secsLeft < 86400) pb_under24h++;
    else                       pb_over24h++;
  });
  const pbTotal = buyTradesAll.length || 1;
  const proximityBuckets = {
    under1h:  pb_under1h  / pbTotal,
    under6h:  pb_under6h  / pbTotal,
    under24h: pb_under24h / pbTotal,
    over24h:  pb_over24h  / pbTotal,
    unknown:  pb_unknown  / pbTotal,
  };

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
    avgBuyPrice,
    avgTradeSize,
    avgWeatherRatio,
    avgUpDownRatio,
    cryptoUpDownBuyPrice,
    proximityBuckets,
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

// ─── Market endDate cache + enrichment ──────────────────────────────────────
// endDate cache by conditionId AND by tokenId (asset)
const endDateCache    = new Map<string, string | null>(); // conditionId → ISO or null
const assetEndDateMap = new Map<string, string | null>(); // tokenId/asset → ISO or null

async function fetchMarketEndDate(conditionId: string, asset?: string): Promise<string | null> {
  // 1. Already cached by conditionId
  if (endDateCache.has(conditionId)) {
    const cached = endDateCache.get(conditionId)!;
    if (cached) return cached;
    // Even if conditionId returned null, try asset below
  }

  // Helper: extract endDate from gamma market array
  const extractEnd = (data: any): string | null => {
    const arr = Array.isArray(data) ? data : (data?.markets ?? []);
    return arr[0]?.endDate ?? arr[0]?.end_date ?? null;
  };

  // 2. Try gamma API by conditionId
  try {
    const data = await fetchJson(
      `https://gamma-api.polymarket.com/markets?conditionId=${conditionId}`
    );
    const endDate = extractEnd(data);
    if (endDate) {
      endDateCache.set(conditionId, endDate);
      return endDate;
    }
  } catch { /* continue */ }

  // 3. Try gamma API by clob_token_id (asset field = token id for Up/Down markets)
  if (asset && asset.length > 10) {
    if (assetEndDateMap.has(asset)) {
      const cached = assetEndDateMap.get(asset)!;
      if (cached) { endDateCache.set(conditionId, cached); return cached; }
    }
    try {
      const data = await fetchJson(
        `https://gamma-api.polymarket.com/markets?clob_token_ids=${asset}`
      );
      const endDate = extractEnd(data);
      assetEndDateMap.set(asset, endDate);
      if (endDate) {
        endDateCache.set(conditionId, endDate);
        return endDate;
      }
    } catch { /* continue */ }
  }

  // 4. Try Polymarket CLOB REST API
  try {
    const data = await fetchJson(
      `https://clob.polymarket.com/markets/${conditionId}`
    );
    const endDate = data?.end_date_iso ?? data?.endDateIso ?? null;
    if (endDate) {
      endDateCache.set(conditionId, endDate);
      return endDate;
    }
  } catch { /* continue */ }

  // 5. Heuristic for Up/Down markets: title contains duration hint
  // e.g. "BTC Up or Down 2% in 1 hour?" → expiry ≈ trade timestamp + 1h
  // We store null but let proximity code use title-based heuristic
  endDateCache.set(conditionId, null);
  return null;
}

export async function enrichTradesWithEndDate(trades: RawTrade[]): Promise<RawTrade[]> {
  // Unique (conditionId, asset) pairs that still need endDate
  const seen = new Map<string, string | undefined>(); // conditionId → asset
  trades.forEach(t => {
    if (!t.endDate && t.conditionId && !endDateCache.get(t.conditionId)) {
      seen.set(t.conditionId, t.asset ?? undefined);
    }
  });

  const CHUNK = 5;
  const pairs = [...seen.entries()];
  for (let i = 0; i < pairs.length; i += CHUNK) {
    await Promise.all(
      pairs.slice(i, i + CHUNK).map(([cid, asset]) => fetchMarketEndDate(cid, asset))
    );
  }

  return trades.map(t => ({
    ...t,
    endDate: t.endDate ?? endDateCache.get(t.conditionId) ?? undefined,
  }));
}

// Title-based expiry heuristic for Up/Down markets where API returns no endDate
// Returns estimated ISO string from trade timestamp + duration parsed from title
export function estimateEndDateFromTitle(title: string, tradeTimestamp: number): string | null {
  const t = title.toLowerCase();
  const msMap: Record<string, number> = {
    "1 minute": 60_000, "5 minutes": 300_000, "10 minutes": 600_000,
    "15 minutes": 900_000, "30 minutes": 1_800_000,
    "1 hour": 3_600_000, "2 hours": 7_200_000, "4 hours": 14_400_000,
    "6 hours": 21_600_000, "12 hours": 43_200_000, "24 hours": 86_400_000,
    "1 day": 86_400_000, "2 days": 172_800_000, "1 week": 604_800_000,
  };
  for (const [label, ms] of Object.entries(msMap)) {
    if (t.includes(label)) {
      return new Date(tradeTimestamp * 1000 + ms).toISOString();
    }
  }
  return null;
}

// ── Sports season end-date estimator ─────────────────────────────────────────
// For season futures (EPL/UCL/NBA etc.) where gamma API returns no endDate,
// derive resolution deadline from competition type and season year.
export function estimateEndDateForSports(title: string, tradeTimestamp: number): string | null {
  const t = title.toLowerCase();
  const now = new Date(tradeTimestamp * 1000);
  const yr  = now.getFullYear();

  // ── Priority 1: Extract specific match date from title ────────────────
  // Patterns: "vs Arsenal - May 3", "| Apr 30", "(April 29)", "on May 5", "Mar 15"
  const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
  const MONTHS_FULL = "january|february|march|april|may|june|july|august|september|october|november|december";
  const monthRe = new RegExp(
    `\\b(${MONTHS_FULL}|${MONTHS})\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"
  );
  const matchDate = t.match(monthRe);
  if (matchDate) {
    const monthNames: Record<string, number> = {
      jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
      january:1, february:2, march:3, april:4, june:6, july:7, august:8,
      september:9, october:10, november:11, december:12
    };
    const mon = matchDate[1] ? monthNames[matchDate[1].slice(0, 3).toLowerCase()] : undefined;
    const day = matchDate[2] ? parseInt(matchDate[2], 10) : 0;
    if (mon && day >= 1 && day <= 31) {
      // Use current year; if date already passed by >30 days, try next year
      const candidate = new Date(Date.UTC(yr, mon - 1, day, 23, 59, 0));
      const tradeTs   = tradeTimestamp * 1000;
      const finalYr   = candidate.getTime() < tradeTs - 30 * 86400000 ? yr + 1 : yr;
      return new Date(Date.UTC(finalYr, mon - 1, day, 23, 59, 0)).toISOString();
    }
  }
  // Numeric date: "4/30", "04-30", "30/4" (day/month EU style)
  const numDate = t.match(/\b(\d{1,2})[\-\/](\d{1,2})\b/);
  if (numDate) {
    const a = numDate[1] ? parseInt(numDate[1], 10) : 0, b2 = numDate[2] ? parseInt(numDate[2], 10) : 0;
    const [mon2, day2] = a > 12 ? [b2, a] : [a, b2];
    if (mon2 >= 1 && mon2 <= 12 && day2 >= 1 && day2 <= 31) {
      const candidate2 = new Date(Date.UTC(yr, mon2 - 1, day2, 23, 59, 0));
      const tradeTs2   = tradeTimestamp * 1000;
      if (Math.abs(candidate2.getTime() - tradeTs2) < 30 * 86400000) {
        return candidate2.toISOString();
      }
    }
  }

  const seasonM = title.match(/20(\d{2})[\u2013\-\/](?:20)?(\d{2})\b/);
  const endYr = seasonM ? parseInt(`20${seasonM[2]}`, 10) : null;

  // ── Sports (season-level fallback) ────────────────────────────────────
  if (/premier league|\bepl\b|la liga|laliga|bundesliga|serie a|champions league|\bucl\b|europa league|\buel\b|ligue 1|eredivisie/i.test(t))
    return new Date(`${endYr ?? yr + 1}-05-25T23:59:00Z`).toISOString();
  if (/stanley cup|nhl playoffs|\bnhl\b/i.test(t))
    return new Date(`${endYr ?? yr}-06-20T23:59:00Z`).toISOString();
  if (/nba finals|nba championship|eastern conference|western conference/i.test(t))
    return new Date(`${endYr ?? yr}-06-20T23:59:00Z`).toISOString();
  if (/\bnba\b/i.test(t))
    return new Date(`${endYr ?? yr}-06-20T23:59:00Z`).toISOString();
  if (/super bowl|nfl championship/i.test(t))
    return new Date(`${endYr ?? yr}-02-15T23:59:00Z`).toISOString();
  if (/\bnfl\b|ncaa football/i.test(t))
    return new Date(`${endYr ?? yr}-02-15T23:59:00Z`).toISOString();
  if (/world cup|euro 20\d{2}/i.test(t))
    return new Date(`${endYr ?? yr}-07-15T23:59:00Z`).toISOString();
  if (/\bmlb\b|world series/i.test(t))
    return new Date(`${endYr ?? yr}-11-01T23:59:00Z`).toISOString();
  if (/\bnfl draft\b/i.test(t))
    return new Date(`${endYr ?? yr}-05-01T23:59:00Z`).toISOString();
  if (/ballon d|golden boot|\bmvp\b|cy young|coach of the year|rookie of the year/i.test(t))
    return new Date(`${endYr ?? yr}-11-01T23:59:00Z`).toISOString();
  if (/\bpga\b|masters tournament|us open golf|british open|the open championship/i.test(t))
    return new Date(`${endYr ?? yr}-07-20T23:59:00Z`).toISOString();
  if (/wimbledon|us open tennis|french open|roland garros|australian open/i.test(t))
    return new Date(`${endYr ?? yr}-09-01T23:59:00Z`).toISOString();
  if (/\bmma\b|\bufc\b/i.test(t))
    return new Date(`${endYr ?? yr}-12-31T23:59:00Z`).toISOString();
  if (/\bformula.?1\b|\bf1\b|grand prix/i.test(t))
    return new Date(`${endYr ?? yr}-12-01T23:59:00Z`).toISOString();

  // ── Awards / Entertainment ────────────────────────────────────────────
  // Academy Awards / Oscars — ceremony typically late Feb / early Mar
  if (/academy award|\boscars?\b|best picture|best director|best actor|best actress/i.test(t))
    return new Date(`${yr}-03-10T23:59:00Z`).toISOString();
  // Grammy Awards — February
  if (/grammy/i.test(t))
    return new Date(`${yr}-02-15T23:59:00Z`).toISOString();
  // Emmy Awards — September
  if (/emmy/i.test(t))
    return new Date(`${yr}-09-25T23:59:00Z`).toISOString();
  // Golden Globes — January
  if (/golden globe/i.test(t))
    return new Date(`${yr}-01-20T23:59:00Z`).toISOString();
  // BAFTA — March
  if (/\bbafta\b/i.test(t))
    return new Date(`${yr}-03-20T23:59:00Z`).toISOString();
  // Tony Awards — June
  if (/\btony award/i.test(t))
    return new Date(`${yr}-06-15T23:59:00Z`).toISOString();
  // Billboard / Music awards — variable, estimate Nov
  if (/billboard|\bamas\b|american music award|vma|\bmtv award/i.test(t))
    return new Date(`${yr}-11-15T23:59:00Z`).toISOString();
  // SAG Awards — February
  if (/sag award|screen actors guild/i.test(t))
    return new Date(`${yr}-02-25T23:59:00Z`).toISOString();
  // Critics Choice — January
  if (/critics.?choice/i.test(t))
    return new Date(`${yr}-01-25T23:59:00Z`).toISOString();
  // Cannes / Venice / Berlin film festivals
  if (/cannes|palme d.?or/i.test(t))
    return new Date(`${yr}-05-30T23:59:00Z`).toISOString();
  if (/venice film|golden lion/i.test(t))
    return new Date(`${yr}-09-10T23:59:00Z`).toISOString();
  if (/berlin film|golden bear/i.test(t))
    return new Date(`${yr}-02-25T23:59:00Z`).toISOString();
  // Nobel Prize — October
  if (/nobel/i.test(t))
    return new Date(`${yr}-10-15T23:59:00Z`).toISOString();
  // Political / Elections — November of election year
  if (/presidential election|us election|midterm election/i.test(t))
    return new Date(`${yr}-11-10T23:59:00Z`).toISOString();
  // General "who will win" type awards markets — estimate Q1 of current year
  if (/who will win|will win the award|award season/i.test(t))
    return new Date(`${yr}-03-31T23:59:00Z`).toISOString();

  return null;
}

