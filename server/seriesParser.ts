// ─── S4 Series Key Parser — deterministic rule-based ─────────────────────────
// No ML. Pure regex + lookup tables.

export type MarketType = "winner" | "playoffs" | "placement" | "match" | "spread" | "totals" | "award" | "other";

export type SeriesParse = {
  seriesKey: string | null;   // e.g. "epl_2025_26_winner"
  seriesLabel: string | null; // e.g. "EPL 2025/26 Winner"
  marketType: MarketType;
  subject: string | null;     // team / player
  competition: string | null; // normalized competition id
  season: string | null;      // "2025_26" or "2026"
};

// ── Competition lookup ────────────────────────────────────────────────────────
// Maps lowercase fragments → normalized id
const COMP_MAP: Array<[RegExp, string, "football" | "nhl" | "nba" | "nfl" | "award" | "other"]> = [
  [/english premier league|premier league\b(?! de| esp)/i, "epl",            "football"],
  [/champions league|ucl\b/i,                              "ucl",            "football"],
  [/europa league|uel\b/i,                                 "uel",            "football"],
  [/laliga|la liga/i,                                      "laliga",         "football"],
  [/serie a\b/i,                                           "serie_a",        "football"],
  [/bundesliga/i,                                          "bundesliga",     "football"],
  [/ligue 1/i,                                             "ligue_1",        "football"],
  [/eredivisie/i,                                          "eredivisie",     "football"],
  [/stanley cup/i,                                         "nhl_stanley_cup","nhl"],
  [/nhl playoffs/i,                                        "nhl_playoffs",   "nhl"],
  [/eastern conference.*nhl|nhl.*eastern conference/i,     "nhl_east",       "nhl"],
  [/western conference.*nhl|nhl.*western conference/i,     "nhl_west",       "nhl"],
  [/eastern conference/i,                                  "nba_east",       "nba"],
  [/western conference/i,                                  "nba_west",       "nba"],
  [/nba finals/i,                                          "nba_finals",     "nba"],
  [/nba championship/i,                                    "nba_championship","nba"],
  [/super bowl/i,                                          "nfl_super_bowl", "nfl"],
  [/nfl championship/i,                                    "nfl_championship","nfl"],
  [/ballon d['']or|ballon dor/i,                           "ballon_dor",     "award"],
  [/golden boot/i,                                         "golden_boot",    "award"],
  [/world cup/i,                                           "wc",             "football"],
  [/euro 20\d{2}/i,                                        "euros",          "football"],
  [/copa america/i,                                        "copa_america",   "football"],
];

// ── Season extractor ──────────────────────────────────────────────────────────
function extractSeason(text: string): string | null {
  // 2025-26 or 2025–26 or 2025/26
  const m2 = text.match(/20(\d{2})[–\-\/]20(\d{2})/);
  if (m2) return `20${m2[1]}_20${m2[2]}`;
  const m3 = text.match(/20(\d{2})[–\-\/](\d{2})\b/);
  if (m3) return `20${m3[1]}_${m3[2]}`;
  const m1 = text.match(/\b(20\d{2})\b/);
  if (m1) return m1[1];
  return null;
}

// ── Competition matcher ───────────────────────────────────────────────────────
function matchCompetition(text: string): { id: string; sport: string } | null {
  for (const [re, id, sport] of COMP_MAP) {
    if (re.test(text)) return { id, sport };
  }
  return null;
}

// ── Slug helper ───────────────────────────────────────────────────────────────
function slug(s: string): string {
  return s.toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

// ── EXCLUSION filter ──────────────────────────────────────────────────────────
// Spread, totals, game-level props → exclude from S4 series grouping
const EXCLUDE_RE = [
  /\bspread\b/i,
  /\bo\/u\b/i,
  /over\/under/i,
  /\bgame \d+ winner/i,
  /\bmoneyline\b/i,
  /[-–]\d+\.?\d*\s*\)/,   // e.g. Ducks (-1.5)
  /\bq[1-4] winner\b/i,
];

export function isExcludedFromS4(title: string): boolean {
  return EXCLUDE_RE.some(re => re.test(title));
}

// ── Main parser ───────────────────────────────────────────────────────────────
export function parseSeriesKey(title: string): SeriesParse {
  const NULL_RESULT: SeriesParse = {
    seriesKey: null, seriesLabel: null,
    marketType: "other", subject: null, competition: null, season: null,
  };

  if (!title) return NULL_RESULT;
  if (isExcludedFromS4(title)) return { ...NULL_RESULT, marketType: "other" };

  const season = extractSeason(title);
  const comp   = matchCompetition(title);

  // ── 1. Winner / season futures ─────────────────────────────────────────────
  // "Will <subject> win <competition tail>?"
  const winMatch = title.match(/^Will (.+?) win (?:the )?(.+?)[\?\.]*$/i);
  if (winMatch) {
    const subject  = winMatch[1].trim();
    const tail     = winMatch[2].trim();
    const compInfo = comp ?? matchCompetition(tail);

    if (compInfo) {
      const s = season ?? "cur";
      const key   = `${compInfo.id}_${s}_winner`;
      const label = `${compInfo.id.toUpperCase().replace(/_/g," ")} ${s.replace(/_/g,"/")} Winner`;
      return { seriesKey: key, seriesLabel: label, marketType: "winner", subject, competition: compInfo.id, season: s };
    }

    // No known competition — use slugified tail as key
    const tailSlug = slug(tail);
    const s = season ?? "cur";
    const key = `${tailSlug}_${s}_winner`.slice(0, 60);
    return { seriesKey: key, seriesLabel: `${tail} ${s} Winner`, marketType: "winner", subject, competition: null, season: s };
  }

  // ── 2. Playoffs / make the X ───────────────────────────────────────────────
  // "Will <subject> make the <competition>?"
  const makeMatch = title.match(/^Will (.+?) make the (.+?)[\?\.]*$/i);
  if (makeMatch) {
    const subject  = makeMatch[1].trim();
    const tail     = makeMatch[2].trim();
    const compInfo = comp ?? matchCompetition(tail);
    const s = season ?? "cur";

    if (compInfo) {
      const key   = `${compInfo.id}_${s}_make`;
      const label = `${compInfo.id.toUpperCase().replace(/_/g," ")} ${s} Qualify`;
      return { seriesKey: key, seriesLabel: label, marketType: "playoffs", subject, competition: compInfo.id, season: s };
    }
    const key = `${slug(tail)}_${s}_make`.slice(0, 60);
    return { seriesKey: key, seriesLabel: `${tail} ${s} Qualify`, marketType: "playoffs", subject, competition: null, season: s };
  }

  // ── 3. Seed / placement ────────────────────────────────────────────────────
  // "Will <subject> finish as the #1 seed in <competition>?"
  // "Will <subject> finish 1st/2nd/top-N in <competition>?"
  const seedMatch = title.match(/^Will (.+?) (?:finish|place|end) (?:as (?:the )?)?(?:#\d+|(?:top[- ]?\d+|\d+(?:st|nd|rd|th))? ?(?:seed|place|in))\b.*?(?:in|of) (?:the )?(.+?)[\?\.]*$/i);
  if (seedMatch) {
    const subject  = seedMatch[1].trim();
    const tail     = seedMatch[2].trim();
    const compInfo = comp ?? matchCompetition(tail);
    const s = season ?? "cur";
    const placeToken = title.match(/#(\d+)|(\d+)(?:st|nd|rd|th)|top[- ]?(\d+)/i);
    const place = placeToken ? (placeToken[1] ?? placeToken[2] ?? placeToken[3]) : "x";

    if (compInfo) {
      const key   = `${compInfo.id}_${s}_place_${place}`;
      const label = `${compInfo.id.toUpperCase().replace(/_/g," ")} ${s} Place #${place}`;
      return { seriesKey: key, seriesLabel: label, marketType: "placement", subject, competition: compInfo.id, season: s };
    }
    const key = `${slug(tail)}_${s}_place_${place}`.slice(0, 60);
    return { seriesKey: key, seriesLabel: `${tail} ${s} Place #${place}`, marketType: "placement", subject, competition: null, season: s };
  }

  // ── 4. Award ───────────────────────────────────────────────────────────────
  // "Will <subject> win the 2026 Ballon d'Or?"  — caught by winMatch above
  // But handle standalone award without "Will":
  if (comp?.id === "ballon_dor" || comp?.id === "golden_boot") {
    const s = season ?? "cur";
    const key   = `${comp.id}_${s}_winner`;
    const label = `${comp.id.replace(/_/g," ").toUpperCase()} ${s} Winner`;
    return { seriesKey: key, seriesLabel: label, marketType: "award", subject: null, competition: comp.id, season: s };
  }

  // ── 5. Match winner — <TeamA> vs[.] <TeamB> ───────────────────────────────
  const vsMatch = title.match(/^(.+?)\s+vs\.?\s+(.+?)(?:\s*[-–]\s*.+)?$/i);
  if (vsMatch) {
    const teamA = slug(vsMatch[1].trim());
    const teamB = slug(vsMatch[2].trim());
    const s = season ?? "cur";
    const key = `match_${teamA}_vs_${teamB}_${s}`.slice(0, 64);
    return {
      seriesKey: key, seriesLabel: `${vsMatch[1]} vs ${vsMatch[2]}`,
      marketType: "match", subject: null, competition: comp?.id ?? null, season: s,
    };
  }

  // ── 6. Fallback: if we at least know the competition ──────────────────────
  if (comp) {
    const s = season ?? "cur";
    const key   = `${comp.id}_${s}_other`;
    const label = `${comp.id.toUpperCase().replace(/_/g," ")} ${s}`;
    return { seriesKey: key, seriesLabel: label, marketType: "other", subject: null, competition: comp.id, season: s };
  }

  return NULL_RESULT;
}
