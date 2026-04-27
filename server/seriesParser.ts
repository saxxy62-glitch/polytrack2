// ─── S4 Series Key Parser v2 — deterministic rule-based ─────────────────────
// Fixes: (1) season-vs-match disambiguation in winner pattern
//        (2) explicit placement regex branches
//        (3) award dictionary
//        (4) subject normalization (strip FC/CF/AFC etc.)
//        (5) competition tail always resolved through COMP_MAP, never raw string

export type MarketType = "winner" | "playoffs" | "placement" | "match" | "spread" | "totals" | "award" | "other";

export type SeriesParse = {
  seriesKey:    string | null;
  seriesLabel:  string | null;
  marketType:   MarketType;
  subject:      string | null;   // normalized team / player
  competition:  string | null;   // competition id
  season:       string | null;   // "2025_26" | "2026" | null
};

// ── Competition lookup ────────────────────────────────────────────────────────
type Sport = "football" | "nhl" | "nba" | "nfl" | "award" | "other";
const COMP_MAP: Array<[RegExp, string, Sport]> = [
  [/english premier league|premier league\b(?! de| esp)/i, "epl",             "football"],
  [/champions league|ucl\b/i,                              "ucl",             "football"],
  [/europa league\b|uel\b/i,                               "uel",             "football"],
  [/laliga|la liga/i,                                      "laliga",          "football"],
  [/\bserie a\b/i,                                         "serie_a",         "football"],
  [/\bbundesliga\b/i,                                      "bundesliga",      "football"],
  [/\bligue 1\b/i,                                         "ligue_1",         "football"],
  [/\beredivisie\b/i,                                      "eredivisie",      "football"],
  [/stanley cup/i,                                         "nhl_stanley_cup", "nhl"],
  [/nhl playoffs/i,                                        "nhl_playoffs",    "nhl"],
  [/eastern conference.*nhl|nhl.*eastern/i,                "nhl_east",        "nhl"],
  [/western conference.*nhl|nhl.*western/i,                "nhl_west",        "nhl"],
  [/eastern conference/i,                                  "nba_east",        "nba"],
  [/western conference/i,                                  "nba_west",        "nba"],
  [/nba finals/i,                                          "nba_finals",      "nba"],
  [/nba championship/i,                                    "nba_championship","nba"],
  [/super bowl/i,                                          "nfl_super_bowl",  "nfl"],
  [/nfl championship/i,                                    "nfl_championship","nfl"],
  [/world cup/i,                                           "wc",              "football"],
  [/\beuro 20\d{2}\b/i,                                    "euros",           "football"],
  [/copa america/i,                                        "copa_america",    "football"],
];

// ── Award dictionary (explicit, no catch-all) ─────────────────────────────────
const AWARD_MAP: Array<[RegExp, string]> = [
  [/ballon d['']or|ballon dor/i,      "ballon_dor"],
  [/\bgolden boot\b/i,                "golden_boot"],
  [/\bnba mvp\b|\bmvp award\b/i,      "nba_mvp"],
  [/\bnfl mvp\b/i,                    "nfl_mvp"],
  [/\bcy young\b/i,                   "cy_young"],
  [/coach of the year/i,              "coach_of_year"],
  [/rookie of the year/i,             "rookie_of_year"],
  [/\bdpoy\b|defensive player of/i,   "dpoy"],
  [/\bfifa best\b/i,                  "fifa_best"],
  [/\bpfa players. player\b/i,        "pfa_poty"],
  [/\bpremier league player of/i,     "epl_poty"],
];

// ── Subject normalization ─────────────────────────────────────────────────────
// Strips common suffixes so "Arsenal" == "Arsenal FC" == "AFC Arsenal"
const TEAM_STRIP_RE = /\b(fc|af c|afc|cf|sc|ac|bv b|bsc|fk|sk|hc|nhl|nba|nfl|the)\b\.?/gi;
function normalizeSubject(s: string): string {
  return s.replace(TEAM_STRIP_RE, "").replace(/\s{2,}/g, " ").trim().toLowerCase();
}

// ── Season extractor ──────────────────────────────────────────────────────────
function extractSeason(text: string): string | null {
  // 2025-26 / 2025–26 / 2025/26
  const m2 = text.match(/20(\d{2})[–\-\/]20(\d{2})/);
  if (m2) return `20${m2[1]}_20${m2[2]}`;
  const m3 = text.match(/20(\d{2})[–\-\/](\d{2})\b/);
  if (m3) return `20${m3[1]}_${m3[2]}`;
  const m1 = text.match(/\b(20\d{2})\b/);
  if (m1) return m1[1];
  return null;
}

// ── Competition matcher ───────────────────────────────────────────────────────
function matchComp(text: string): { id: string; sport: Sport } | null {
  for (const [re, id, sport] of COMP_MAP) {
    if (re.test(text)) return { id, sport };
  }
  return null;
}

// ── Award matcher ─────────────────────────────────────────────────────────────
function matchAward(text: string): string | null {
  for (const [re, id] of AWARD_MAP) {
    if (re.test(text)) return id;
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

// ── Exclusion filter ──────────────────────────────────────────────────────────
const EXCLUDE_RE: RegExp[] = [
  /\bspread\b/i,
  /\bo\/u\b/i,
  /over\/under/i,
  /\bgame \d+\s+winner/i,
  /\bmoneyline\b/i,
  /\(\s*[+-]\d+\.?\d*\s*\)/,      // handicap lines like (-1.5) or (+3)
  /\bq[1-4]\s+winner\b/i,
  /\bhalf\s+winner\b/i,
  /\b1st half\b|\b2nd half\b/i,
  /\bcorrect score\b/i,
  /\bboth teams to score\b/i,
];

export function isExcludedFromS4(title: string): boolean {
  return EXCLUDE_RE.some(re => re.test(title));
}

// ── Single-match date detector ────────────────────────────────────────────────
// "Will Arsenal FC win on 2026-03-01?" — tail contains specific date → match, not series
const MATCH_DATE_RE = /\bon \d{4}-\d{2}-\d{2}\b|\bon [A-Z][a-z]+ \d{1,2}(st|nd|rd|th)?\b/;
// Explicit vs. matchup pattern
const VS_RE = /\bvs\.?\s/i;

function isMatchTail(tail: string): boolean {
  if (MATCH_DATE_RE.test(tail)) return true;
  if (VS_RE.test(tail)) return true;
  // Very short tail with no known competition and contains a date-like token
  if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(tail)) return true;
  return false;
}

// ── Placement branch helper ───────────────────────────────────────────────────
// Returns { placeLabel } if title matches a placement pattern, else null
function parsePlacement(title: string): { subject: string; placeLabel: string; tail: string } | null {
  const patterns: Array<[RegExp, string]> = [
    [/^Will (.+?) finish(?:\s+as)?\s+(?:the\s+)?#(\d+)\s+seed\s+in\s+(?:the\s+)?(.+?)[\?\.]*$/i,  "#$2"],
    [/^Will (.+?) finish(?:\s+as)?\s+(?:the\s+)?#(\d+)\s+in\s+(?:the\s+)?(.+?)[\?\.]*$/i,          "#$2"],
    [/^Will (.+?) finish\s+(\d+)(?:st|nd|rd|th)\s+(?:in\s+)?(?:the\s+)?(.+?)[\?\.]*$/i,            "#$2"],
    [/^Will (.+?) place\s+(\d+)(?:st|nd|rd|th)\s+(?:for\s+|in\s+)?(?:the\s+)?(.+?)[\?\.]*$/i,      "#$2"],
    [/^Will (.+?) finish\s+in\s+(?:the\s+)?top[- ]?(\d+)\s+(?:of\s+|in\s+)?(?:the\s+)?(.+?)[\?\.]*$/i, "top$2"],
    [/^Will (.+?) finish\s+(?:as\s+)?(?:the\s+)?top[- ]?(\d+)\s+in\s+(?:the\s+)?(.+?)[\?\.]*$/i,  "top$2"],
  ];
  for (const [re, placeTemplate] of patterns) {
    const m = title.match(re);
    if (m) {
      const placeLabel = placeTemplate.replace("$2", m[2]);
      return { subject: m[1].trim(), placeLabel, tail: m[3].trim() };
    }
  }
  return null;
}

// ── MAIN PARSER ───────────────────────────────────────────────────────────────
export function parseSeriesKey(title: string): SeriesParse {
  const NULL: SeriesParse = {
    seriesKey: null, seriesLabel: null,
    marketType: "other", subject: null, competition: null, season: null,
  };

  if (!title?.trim()) return NULL;
  if (isExcludedFromS4(title))  return { ...NULL, marketType: "other" };

  const season  = extractSeason(title);
  const s       = season ?? "cur";

  // ── 1. Explicit VS matchup (before winner parser to avoid confusion) ────────
  if (VS_RE.test(title)) {
    return { ...NULL, marketType: "match" };
  }

  // ── 2. Award check (before generic winner, uses dictionary) ───────────────
  const awardId = matchAward(title);
  if (awardId) {
    const key   = `${awardId}_${s}_winner`;
    const label = `${awardId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())} ${s} Winner`;
    // subject = whoever is in "Will X win/receive ..."
    const subjM = title.match(/^Will (.+?) (?:win|receive|take)/i);
    return {
      seriesKey: key, seriesLabel: label,
      marketType: "award",
      subject:    subjM ? normalizeSubject(subjM[1]) : null,
      competition: awardId, season: s,
    };
  }

  // ── 3. Placement branches (explicit, before winner to avoid bleed) ────────
  const placement = parsePlacement(title);
  if (placement) {
    const comp = matchComp(placement.tail);
    if (comp) {
      const place = placement.placeLabel.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const key   = `${comp.id}_${s}_place_${place}`;
      const label = `${comp.id.toUpperCase().replace(/_/g," ")} ${s} Place ${placement.placeLabel}`;
      return {
        seriesKey: key, seriesLabel: label,
        marketType: "placement",
        subject: normalizeSubject(placement.subject), competition: comp.id, season: s,
      };
    }
    // Unknown competition in placement
    const tailKey = slug(placement.tail);
    const place   = placement.placeLabel.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    return {
      seriesKey: `${tailKey}_${s}_place_${place}`.slice(0, 60),
      seriesLabel: `${placement.tail} ${s} Place ${placement.placeLabel}`,
      marketType: "placement",
      subject: normalizeSubject(placement.subject), competition: null, season: s,
    };
  }

  // ── 4. Playoffs / make the X ──────────────────────────────────────────────
  const makeM = title.match(/^Will (.+?) make (?:the )?(.+?)[\?\.]*$/i);
  if (makeM) {
    const subject = normalizeSubject(makeM[1]);
    const tail    = makeM[2].trim();
    const comp    = matchComp(tail);
    if (comp) {
      const key   = `${comp.id}_${s}_make`;
      const label = `${comp.id.toUpperCase().replace(/_/g," ")} ${s} Qualify`;
      return { seriesKey: key, seriesLabel: label, marketType: "playoffs", subject, competition: comp.id, season: s };
    }
    // No known competition
    return { seriesKey: `${slug(tail)}_${s}_make`.slice(0,60), seriesLabel: `${tail} ${s} Qualify`,
             marketType: "playoffs", subject, competition: null, season: s };
  }

  // ── 5. Winner / season futures ─────────────────────────────────────────────
  // "Will <subject> win <tail>?"
  const winM = title.match(/^Will (.+?) win (?:the )?(.+?)[\?\.]*$/i);
  if (winM) {
    const subject = normalizeSubject(winM[1]);
    const tail    = winM[2].trim();

    // CRITICAL: if tail looks like a single-match date → treat as match
    if (isMatchTail(tail)) {
      return { ...NULL, marketType: "match", subject };
    }

    const comp = matchComp(tail);
    if (comp) {
      const key   = `${comp.id}_${s}_winner`;
      const label = `${comp.id.toUpperCase().replace(/_/g," ")} ${s} Winner`;
      return { seriesKey: key, seriesLabel: label, marketType: "winner", subject, competition: comp.id, season: s };
    }

    // No known competition in tail — build key from slugified tail
    // but only if tail looks like a tournament (not a date or short phrase)
    if (tail.length > 6 && !/^\d/.test(tail)) {
      const key = `${slug(tail)}_${s}_winner`.slice(0, 60);
      return { seriesKey: key, seriesLabel: `${tail} ${s} Winner`,
               marketType: "winner", subject, competition: null, season: s };
    }

    // Fallback to match
    return { ...NULL, marketType: "match", subject };
  }

  // ── 6. Fallback: competition known but no verb pattern ────────────────────
  const comp = matchComp(title);
  if (comp) {
    return {
      seriesKey: `${comp.id}_${s}_other`, seriesLabel: `${comp.id.toUpperCase().replace(/_/g," ")} ${s}`,
      marketType: "other", subject: null, competition: comp.id, season: s,
    };
  }

  return NULL;
}
