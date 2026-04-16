import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import Parser from "rss-parser";

import { agentService } from "../agent/agentService.js";
import { cacheService } from "./cache.service.js";
import { env } from "../config/env.js";
import { rssFeedSources } from "../config/rssFeeds.js";
import { logger } from "../config/logger.js";
import {
  newsRepository,
  NewsRepository,
} from "../repositories/news.repository.js";
import { socketGateway } from "../socket/socketGateway.js";
import type { NewsCategory, CreateLocationInput } from "../types/news.js";
import {
  contentFetchService,
  type FetchArticleContentOutput,
} from "./contentFetch.service.js";
import { geocodeService } from "./geocode.service.js";
import { processingEventBus } from "./processingEventBus.js";
import { canonicalizeArticleUrl } from "../utils/articleUrl.js";
import {
  isOperationTimeoutError,
  withPromiseTimeout,
} from "../utils/withTimeout.js";
import type {
  ProcessingEventType,
  ProcessingTraceContext,
} from "../types/processing.js";

type RssItem = {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  isoDate?: string;
  content?: string;
  contentSnippet?: string;
};

interface HeadlineFingerprint {
  normalized: string;
  tokens: Set<string>;
}

interface NormalizedExtractedLocation {
  locationName: string | null;
  city: string | null;
  state: string | null;
}

export interface RssIngestionSummary {
  feedCount: number;
  entriesSeen: number;
  inserted: number;
  duplicateCount: number;
  nationalCount: number;
  locationCount: number;
  errorCount: number;
  startedAt: string;
  finishedAt: string;
}

export interface IngestionExecutionContext {
  runId?: string;
  jobId?: string;
  attempt?: number;
  triggeredAt?: string;
}

const parser = new Parser<Record<string, never>, RssItem>();

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "on",
  "in",
  "for",
  "to",
  "from",
  "at",
  "with",
  "by",
  "after",
  "before",
  "and",
  "or",
  "vs",
  "is",
  "are",
  "was",
  "were",
  "be",
  "as",
  "that",
  "this",
  "it",
  "its",
  "over",
  "under",
  "new",
  "latest",
  "india",
]);

const CATEGORY_RULES: Array<{
  category: Exclude<NewsCategory, "Uncategorized / National">;
  keywords: string[];
}> = [
  {
    category: "Politics",
    keywords: [
      "election",
      "parliament",
      "chief minister",
      "mp",
      "mla",
      "bjp",
      "congress",
    ],
  },
  {
    category: "Business",
    keywords: [
      "market",
      "stock",
      "economy",
      "inflation",
      "trade",
      "startup",
      "funding",
    ],
  },
  {
    category: "Technology",
    keywords: [
      "ai",
      "software",
      "cyber",
      "digital",
      "startup tech",
      "internet",
      "app",
    ],
  },
  {
    category: "Sports",
    keywords: [
      "cricket",
      "football",
      "hockey",
      "ipl",
      "match",
      "tournament",
      "athlete",
    ],
  },
  {
    category: "Entertainment",
    keywords: [
      "film",
      "movie",
      "actor",
      "actress",
      "bollywood",
      "music",
      "series",
    ],
  },
  {
    category: "Crime",
    keywords: [
      "crime",
      "murder",
      "theft",
      "arrest",
      "police",
      "fraud",
      "assault",
    ],
  },
  {
    category: "Weather",
    keywords: [
      "rain",
      "cyclone",
      "flood",
      "heatwave",
      "weather",
      "temperature",
      "monsoon",
    ],
  },
];

const normalizeText = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

const normalizeHeadline = (value: string): string => {
  return normalizeText(value.toLowerCase().replace(/[^a-z0-9\s]/g, " "));
};

const tokenizeHeadline = (value: string): Set<string> => {
  const tokens = normalizeHeadline(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));

  return new Set(tokens);
};

const createFingerprint = (headline: string): HeadlineFingerprint => {
  return {
    normalized: normalizeHeadline(headline),
    tokens: tokenizeHeadline(headline),
  };
};

const normalizeLocationKey = (value: string): string => {
  return normalizeHeadline(value.replace(/&/g, " and "));
};

interface StateLexiconEntry {
  state: string;
  aliases?: string[];
}

interface CityLexiconEntry {
  city: string;
  state: string;
  aliases?: string[];
}

const STATE_LEXICON: StateLexiconEntry[] = [
  { state: "Andhra Pradesh", aliases: ["Andhra"] },
  { state: "Arunachal Pradesh", aliases: ["Arunachal"] },
  { state: "Assam" },
  { state: "Bihar" },
  { state: "Chhattisgarh", aliases: ["Chattisgarh", "Chhatisgarh"] },
  { state: "Goa" },
  { state: "Gujarat" },
  { state: "Haryana" },
  { state: "Himachal Pradesh", aliases: ["Himachal"] },
  { state: "Jharkhand" },
  { state: "Karnataka" },
  { state: "Kerala" },
  { state: "Madhya Pradesh" },
  { state: "Maharashtra", aliases: ["Maharastra"] },
  { state: "Manipur" },
  { state: "Meghalaya" },
  { state: "Mizoram" },
  { state: "Nagaland" },
  { state: "Odisha", aliases: ["Orissa", "Odisa", "Orrisa"] },
  { state: "Punjab" },
  { state: "Rajasthan" },
  { state: "Sikkim" },
  { state: "Tamil Nadu", aliases: ["Tamilnadu"] },
  { state: "Telangana", aliases: ["Telengana"] },
  { state: "Tripura" },
  { state: "Uttar Pradesh" },
  { state: "Uttarakhand", aliases: ["Uttaranchal", "Uttarakhand"] },
  { state: "West Bengal", aliases: ["Bengal"] },
  {
    state: "Andaman and Nicobar Islands",
    aliases: [
      "Andaman Nicobar",
      "Andaman & Nicobar Islands",
      "Andaman and Nicobar",
    ],
  },
  { state: "Chandigarh" },
  {
    state: "Dadra and Nagar Haveli and Daman and Diu",
    aliases: [
      "Dadra and Nagar Haveli",
      "Daman and Diu",
      "Dadra & Nagar Haveli and Daman & Diu",
      "Dadra Nagar Haveli and Daman Diu",
      "DNHDD",
    ],
  },
  {
    state: "Delhi",
    aliases: [
      "NCT of Delhi",
      "National Capital Territory",
      "NCT Delhi",
      "Delhi NCT",
    ],
  },
  {
    state: "Jammu and Kashmir",
    aliases: [
      "Jammu Kashmir",
      "J and K",
      "J&K",
      "Jammu & Kashmir",
      "J K",
      "Jammu Kashmir UT",
    ],
  },
  { state: "Ladakh" },
  { state: "Lakshadweep", aliases: ["Laccadive", "Laccadives"] },
  { state: "Puducherry", aliases: ["Pondicherry", "Pondichery"] },
];

const CITY_ALIAS_OVERRIDES: CityLexiconEntry[] = [
  { city: "Mumbai", state: "Maharashtra", aliases: ["Bombay"] },
  { city: "Delhi", state: "Delhi" },
  { city: "New Delhi", state: "Delhi" },
  {
    city: "Bengaluru",
    state: "Karnataka",
    aliases: ["Bangalore", "Bengalooru"],
  },
  { city: "Kolkata", state: "West Bengal", aliases: ["Calcutta"] },
  { city: "Chennai", state: "Tamil Nadu", aliases: ["Madras"] },
  { city: "Hyderabad", state: "Telangana" },
  { city: "Pune", state: "Maharashtra", aliases: ["Poona"] },
  { city: "Ahmedabad", state: "Gujarat" },
  { city: "Surat", state: "Gujarat" },
  { city: "Jaipur", state: "Rajasthan" },
  { city: "Lucknow", state: "Uttar Pradesh" },
  { city: "Kanpur", state: "Uttar Pradesh", aliases: ["Cawnpore"] },
  { city: "Nagpur", state: "Maharashtra" },
  { city: "Indore", state: "Madhya Pradesh" },
  { city: "Bhopal", state: "Madhya Pradesh" },
  { city: "Patna", state: "Bihar" },
  { city: "Ranchi", state: "Jharkhand" },
  { city: "Bhubaneswar", state: "Odisha", aliases: ["Bhuvaneshwar"] },
  { city: "Guwahati", state: "Assam", aliases: ["Gauhati"] },
  { city: "Chandigarh", state: "Chandigarh" },
  { city: "Srinagar", state: "Jammu and Kashmir" },
  { city: "Jammu", state: "Jammu and Kashmir", aliases: ["Jummoo"] },
  { city: "Leh", state: "Ladakh" },
  { city: "Noida", state: "Uttar Pradesh" },
  { city: "Gurugram", state: "Haryana", aliases: ["Gurgaon"] },
  { city: "Faridabad", state: "Haryana" },
  { city: "Ghaziabad", state: "Uttar Pradesh" },
  { city: "Kochi", state: "Kerala", aliases: ["Cochin", "Kochin"] },
  {
    city: "Thiruvananthapuram",
    state: "Kerala",
    aliases: ["Trivandrum", "Trivendrum"],
  },
  { city: "Kozhikode", state: "Kerala", aliases: ["Calicut"] },
  { city: "Alappuzha", state: "Kerala", aliases: ["Alleppey"] },
  { city: "Kollam", state: "Kerala", aliases: ["Quilon"] },
  { city: "Kannur", state: "Kerala", aliases: ["Cannanore"] },
  { city: "Thrissur", state: "Kerala", aliases: ["Trichur"] },
  { city: "Palakkad", state: "Kerala", aliases: ["Palghat"] },
  { city: "Coimbatore", state: "Tamil Nadu" },
  { city: "Madurai", state: "Tamil Nadu" },
  {
    city: "Visakhapatnam",
    state: "Andhra Pradesh",
    aliases: ["Vizag", "Waltair", "Vizagapatam"],
  },
  { city: "Vijayawada", state: "Andhra Pradesh", aliases: ["Bezawada"] },
  {
    city: "Rajamahendravaram",
    state: "Andhra Pradesh",
    aliases: ["Rajahmundry", "Rajamundry"],
  },
  { city: "Tirupati", state: "Andhra Pradesh", aliases: ["Tirupathi"] },
  { city: "Mysuru", state: "Karnataka", aliases: ["Mysore"] },
  { city: "Mangaluru", state: "Karnataka", aliases: ["Mangalore"] },
  { city: "Belgaum", state: "Karnataka", aliases: ["Belagavi"] },
  {
    city: "Hubli",
    state: "Karnataka",
    aliases: ["Hubballi", "Hubli Dharwad", "Hubballi Dharwad"],
  },
  { city: "Gulbarga", state: "Karnataka", aliases: ["Kalaburagi"] },
  { city: "Bellary", state: "Karnataka", aliases: ["Ballari"] },
  { city: "Bijapur", state: "Karnataka", aliases: ["Vijayapura"] },
  { city: "Shimoga", state: "Karnataka", aliases: ["Shivamogga"] },
  {
    city: "Chikkamagallooru",
    state: "Karnataka",
    aliases: ["Chikmagalur", "Chikkamagaluru"],
  },
  { city: "Vadodara", state: "Gujarat", aliases: ["Baroda"] },
  { city: "Rajkot", state: "Gujarat" },
  { city: "Jodhpur", state: "Rajasthan" },
  { city: "Amritsar", state: "Punjab" },
  {
    city: "Prayagraj",
    state: "Uttar Pradesh",
    aliases: ["Allahabad", "Ilahabad"],
  },
  {
    city: "Varanasi",
    state: "Uttar Pradesh",
    aliases: ["Banaras", "Benares", "Kashi"],
  },
  {
    city: "Mughalsarai",
    state: "Uttar Pradesh",
    aliases: [
      "Pt Deen Dayal Upadhyaya Nagar",
      "Pandit Deen Dayal Upadhyaya Nagar",
      "Ddu Nagar",
    ],
  },
  { city: "Faizabad", state: "Uttar Pradesh", aliases: ["Ayodhya"] },
  { city: "Agra", state: "Uttar Pradesh" },
  { city: "Jabalpur", state: "Madhya Pradesh", aliases: ["Jubbulpore"] },
  {
    city: "Aurangabad",
    state: "Maharashtra",
    aliases: ["Sambhajinagar", "Chhatrapati Sambhajinagar"],
  },
  {
    city: "Ahmednagar",
    state: "Maharashtra",
    aliases: ["Ahilyanagar", "Ahmadnagar"],
  },
  { city: "Osmanabad", state: "Maharashtra", aliases: ["Dharashiv"] },
  {
    city: "Naya Raipur",
    state: "Chhattisgarh",
    aliases: ["Nava Raipur", "Atal Nagar"],
  },
  {
    city: "Tiruchirappalli",
    state: "Tamil Nadu",
    aliases: ["Trichy", "Tiruchi", "Trichinopoly"],
  },
  { city: "Thanjavur", state: "Tamil Nadu", aliases: ["Tanjore"] },
  { city: "Tuticorin", state: "Tamil Nadu", aliases: ["Thoothukudi"] },
  {
    city: "Ooty",
    state: "Tamil Nadu",
    aliases: ["Udhagamandalam", "Udagamandalam", "Ootacamund"],
  },
  {
    city: "Kanchipuram",
    state: "Tamil Nadu",
    aliases: ["Kancheepuram", "Conjeevaram"],
  },
  { city: "Nagercoil", state: "Tamil Nadu", aliases: ["Nagerkoil"] },
  {
    city: "Puducherry",
    state: "Puducherry",
    aliases: ["Pondicherry", "Pondi"],
  },
  { city: "Siliguri", state: "West Bengal", aliases: ["Shiliguri"] },
];

interface CanonicalCityState {
  city: string;
  state: string;
}

type AliasMatchCandidate =
  | {
      kind: "city";
      aliasKey: string;
      aliasTokens: string[];
      wordCount: number;
      city: string;
      state: string;
      priority: number;
    }
  | {
      kind: "state";
      aliasKey: string;
      aliasTokens: string[];
      wordCount: number;
      state: string;
      priority: number;
    };

const LOCATION_SIGNAL_IGNORE_LIST = new Set([
  "india",
  "indian",
  "bharat",
  "nationwide",
  "national",
  "countrywide",
  "country",
  "global",
  "world",
  "international",
  "overseas",
  "unknown",
  "none",
  "null",
  "na",
  "n a",
]);

const LOCAL_CITIES_CSV_FILE_URL = new URL(
  "../data/india-cities.csv",
  import.meta.url,
);

const STATE_ALIAS_TO_CANONICAL = new Map<string, string>();

const CITY_ALIAS_TO_CANONICAL = new Map<string, CanonicalCityState[]>();
const MATCHES_BY_FIRST_TOKEN = new Map<string, AliasMatchCandidate[]>();
const REGISTERED_MATCH_KEYS = new Set<string>();

const registerAliasMatch = (candidate: AliasMatchCandidate): void => {
  const firstToken = candidate.aliasTokens[0];

  if (!firstToken) {
    return;
  }

  const uniquenessKey =
    candidate.kind === "city"
      ? `${candidate.kind}|${candidate.aliasKey}|${candidate.city}|${candidate.state}`
      : `${candidate.kind}|${candidate.aliasKey}|${candidate.state}`;

  if (REGISTERED_MATCH_KEYS.has(uniquenessKey)) {
    return;
  }

  REGISTERED_MATCH_KEYS.add(uniquenessKey);

  const current = MATCHES_BY_FIRST_TOKEN.get(firstToken);

  if (current) {
    current.push(candidate);
    return;
  }

  MATCHES_BY_FIRST_TOKEN.set(firstToken, [candidate]);
};

const sortIndexedMatches = (): void => {
  for (const candidates of MATCHES_BY_FIRST_TOKEN.values()) {
    candidates.sort((left, right) => {
      if (right.wordCount !== left.wordCount) {
        return right.wordCount - left.wordCount;
      }

      return right.priority - left.priority;
    });
  }
};

const registerStateEntry = (entry: StateLexiconEntry): void => {
  const state = normalizeText(entry.state);

  if (state.length === 0) {
    return;
  }

  const aliases = [state, ...(entry.aliases ?? [])];

  for (const alias of aliases) {
    const aliasKey = normalizeLocationKey(alias);

    if (!aliasKey) {
      continue;
    }

    const aliasTokens = aliasKey.split(" ").filter(Boolean);

    STATE_ALIAS_TO_CANONICAL.set(aliasKey, state);
    registerAliasMatch({
      kind: "state",
      aliasKey,
      aliasTokens,
      wordCount: aliasTokens.length,
      state,
      priority: 1,
    });
  }
};

const registerCityEntry = (entry: CityLexiconEntry): void => {
  const city = normalizeText(entry.city);
  const state = normalizeText(entry.state);

  if (city.length === 0 || state.length === 0) {
    return;
  }

  const aliases = [city, ...(entry.aliases ?? [])];

  for (const alias of aliases) {
    const aliasKey = normalizeLocationKey(alias);

    if (!aliasKey) {
      continue;
    }

    const canonical = { city, state };
    const current = CITY_ALIAS_TO_CANONICAL.get(aliasKey);

    if (current) {
      if (
        !current.some(
          (candidate) =>
            candidate.city === canonical.city &&
            candidate.state === canonical.state,
        )
      ) {
        current.push(canonical);
      }
    } else {
      CITY_ALIAS_TO_CANONICAL.set(aliasKey, [canonical]);
    }

    const aliasTokens = aliasKey.split(" ").filter(Boolean);

    registerAliasMatch({
      kind: "city",
      aliasKey,
      aliasTokens,
      wordCount: aliasTokens.length,
      city,
      state,
      priority: 2,
    });
  }
};

for (const entry of STATE_LEXICON) {
  registerStateEntry(entry);
}

for (const entry of CITY_ALIAS_OVERRIDES) {
  registerCityEntry(entry);
}

sortIndexedMatches();

const matchAliasCandidatesInText = (value: string): AliasMatchCandidate[] => {
  const normalized = normalizeLocationKey(value);

  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(" ").filter(Boolean);

  if (tokens.length === 0) {
    return [];
  }

  const matches: AliasMatchCandidate[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token) {
      continue;
    }

    const candidates = MATCHES_BY_FIRST_TOKEN.get(token);

    if (!candidates) {
      continue;
    }

    let selected: AliasMatchCandidate | null = null;

    for (const candidate of candidates) {
      if (index + candidate.wordCount > tokens.length) {
        continue;
      }

      let isMatch = true;

      for (let offset = 0; offset < candidate.wordCount; offset += 1) {
        if (tokens[index + offset] !== candidate.aliasTokens[offset]) {
          isMatch = false;
          break;
        }
      }

      if (isMatch) {
        selected = candidate;
        break;
      }
    }

    if (!selected) {
      continue;
    }

    matches.push(selected);
    index += selected.wordCount - 1;
  }

  return matches;
};

const resolveCanonicalCityCandidate = (
  cityKey: string,
  preferredState: string | null,
): CanonicalCityState | null => {
  const candidates = CITY_ALIAS_TO_CANONICAL.get(cityKey);

  if (!candidates || candidates.length === 0) {
    return null;
  }

  if (preferredState) {
    const preferredStateKey = normalizeLocationKey(preferredState);

    const stateAligned = candidates.find(
      (candidate) =>
        normalizeLocationKey(candidate.state) === preferredStateKey,
    );

    if (stateAligned) {
      return stateAligned;
    }
  }

  return candidates[0] ?? null;
};

const normalizeLocationField = (
  value: string | null | undefined,
): string | null => {
  if (!value) {
    return null;
  }

  const cleaned = normalizeText(value);
  return cleaned.length > 0 ? cleaned : null;
};

const toTitleCase = (value: string): string => {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word, index) => {
      if (index > 0 && (word === "and" || word === "of")) {
        return word;
      }

      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
};

const isIgnorableLocationSignal = (value: string): boolean => {
  return LOCATION_SIGNAL_IGNORE_LIST.has(normalizeLocationKey(value));
};

const canonicalizeState = (value: string | null): string | null => {
  if (!value || isIgnorableLocationSignal(value)) {
    return null;
  }

  const key = normalizeLocationKey(value);
  const canonical = STATE_ALIAS_TO_CANONICAL.get(key);

  if (canonical) {
    return canonical;
  }

  return toTitleCase(value);
};

const canonicalizeCity = (
  value: string | null,
  preferredState: string | null = null,
): string | null => {
  if (!value || isIgnorableLocationSignal(value)) {
    return null;
  }

  const key = normalizeLocationKey(value);
  const canonical = resolveCanonicalCityCandidate(key, preferredState);

  if (canonical) {
    return canonical.city;
  }

  return toTitleCase(value);
};

const parseCsvRows = (csvText: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = (): void => {
    row.push(cell.trim());
    cell = "";
  };

  const pushRow = (): void => {
    const hasContent = row.some((column) => column.length > 0);

    if (hasContent) {
      rows.push(row);
    }

    row = [];
  };

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];

    if (character === '"') {
      const nextCharacter = csvText[index + 1];

      if (inQuotes && nextCharacter === '"') {
        cell += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      pushCell();
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      pushCell();
      pushRow();

      if (character === "\r" && csvText[index + 1] === "\n") {
        index += 1;
      }

      continue;
    }

    cell += character;
  }

  if (cell.length > 0 || row.length > 0) {
    pushCell();
    pushRow();
  }

  return rows;
};

const parseCitiesCsv = (csvText: string): CityLexiconEntry[] => {
  const rows = parseCsvRows(csvText);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0]?.map((header) => normalizeLocationKey(header)) ?? [];
  const cityIndex = headers.indexOf("city");
  const stateIndex = headers.indexOf("state");

  if (cityIndex < 0 || stateIndex < 0) {
    return [];
  }

  const parsedEntries: CityLexiconEntry[] = [];
  const seen = new Set<string>();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];

    if (!row) {
      continue;
    }

    const cityRaw = normalizeText(row[cityIndex] ?? "");
    const stateRaw = normalizeText(row[stateIndex] ?? "");

    if (cityRaw.length < 2 || stateRaw.length < 2) {
      continue;
    }

    if (isIgnorableLocationSignal(cityRaw)) {
      continue;
    }

    const city = toTitleCase(cityRaw);
    const state = canonicalizeState(stateRaw) ?? toTitleCase(stateRaw);

    const key = `${normalizeLocationKey(city)}|${normalizeLocationKey(state)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    parsedEntries.push({ city, state });
  }

  return parsedEntries;
};

const ensureStateCoverageFromCities = (entries: CityLexiconEntry[]): void => {
  const missingStates = new Set<string>();

  for (const entry of entries) {
    const state = normalizeText(entry.state);

    if (!state) {
      continue;
    }

    const stateKey = normalizeLocationKey(state);

    if (!STATE_ALIAS_TO_CANONICAL.has(stateKey)) {
      missingStates.add(state);
    }
  }

  if (missingStates.size === 0) {
    return;
  }

  for (const state of missingStates) {
    registerStateEntry({ state });
  }

  logger.warn(
    {
      missingStates: Array.from(missingStates).sort((left, right) =>
        left.localeCompare(right),
      ),
    },
    "Detected states in cities CSV missing from static state lexicon; registered dynamically",
  );
};

const loadLocalCitiesCsvLexicon = (): void => {
  try {
    const csvText = readFileSync(LOCAL_CITIES_CSV_FILE_URL, "utf8");
    const localCityEntries = parseCitiesCsv(csvText);

    ensureStateCoverageFromCities(localCityEntries);

    for (const entry of localCityEntries) {
      registerCityEntry(entry);
    }

    sortIndexedMatches();

    logger.info(
      {
        cityEntriesMerged: localCityEntries.length,
        totalAliasCount: CITY_ALIAS_TO_CANONICAL.size,
        sourceFile: LOCAL_CITIES_CSV_FILE_URL.href,
      },
      "Loaded local Indian city lexicon from CSV",
    );
  } catch (error) {
    logger.warn(
      {
        error,
        sourceFile: LOCAL_CITIES_CSV_FILE_URL.href,
      },
      "Failed to load local Indian cities CSV; continuing with state/city overrides",
    );
  }
};

loadLocalCitiesCsvLexicon();

const inferCityAndStateFromLocationName = (
  locationName: string,
): { city: string; state: string } | null => {
  const matches = matchAliasCandidatesInText(locationName);

  for (const match of matches) {
    if (match.kind === "city") {
      return {
        city: match.city,
        state: match.state,
      };
    }
  }

  return null;
};

const inferStateFromCanonicalCity = (city: string): string | null => {
  const key = normalizeLocationKey(city);
  const canonical = resolveCanonicalCityCandidate(key, null);
  return canonical?.state ?? null;
};

const buildLocationIdentityKey = (
  location: NormalizedExtractedLocation,
): string => {
  return [
    location.locationName ? normalizeLocationKey(location.locationName) : "",
    location.city ? normalizeLocationKey(location.city) : "",
    location.state ? normalizeLocationKey(location.state) : "",
  ].join("|");
};

const jaccardSimilarity = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }

  const union = left.size + right.size - overlap;
  return union === 0 ? 0 : overlap / union;
};

const categorizeArticle = (text: string): NewsCategory => {
  const normalized = text.toLowerCase();

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return rule.category;
    }
  }

  return "General";
};

const resolvePublishedAt = (item: RssItem): string => {
  const candidate = item.isoDate ?? item.pubDate;

  if (!candidate) {
    return new Date().toISOString();
  }

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
};

export class RssIngestionService {
  constructor(private readonly repository: NewsRepository = newsRepository) {}

  private log(
    sourceUrl: string,
    headline: string | null,
    stage: Parameters<typeof processingEventBus.emitLog>[0]["stage"],
    message: string,
    status: Parameters<typeof processingEventBus.emitLog>[0]["status"],
    metadata?: Record<string, unknown>,
    context?: ProcessingTraceContext & {
      eventType?: ProcessingEventType;
      durationMs?: number;
    },
  ): void {
    processingEventBus.emitLog({
      runId: context?.runId,
      jobId: context?.jobId,
      traceId: context?.traceId,
      articleId: context?.articleId,
      feedUrl: context?.feedUrl,
      attempt: context?.attempt,
      eventType: context?.eventType,
      durationMs: context?.durationMs,
      sourceUrl,
      headline,
      stage,
      message,
      status,
      metadata,
    });
  }

  private async handleDedupeCheckFailure(
    sourceUrl: string,
    headline: string,
    feedUrl: string,
    itemStartedAt: Date,
    summary: RssIngestionSummary,
    traceContext: ProcessingTraceContext,
    dedupeStartedAtMs: number,
    dependency: "content_hash_db" | "url_cache",
  ): Promise<void> {
    summary.errorCount += 1;

    const dedupeDurationMs = Date.now() - dedupeStartedAtMs;
    const dependencyLabel =
      dependency === "content_hash_db"
        ? "content-hash database lookup"
        : "Valkey URL dedupe cache lookup";
    const failureType =
      dependency === "content_hash_db"
        ? "dedupe_content_hash_check_failed"
        : "dedupe_valkey_cache_check_failed";
    const decisionPath =
      dependency === "content_hash_db"
        ? "Dedupe_Content_Hash_Check_Failed"
        : "Dedupe_Valkey_Cache_Check_Failed";

    this.log(
      sourceUrl,
      headline,
      "deduplication",
      `Deduplication dependency unavailable: ${dependencyLabel}; item deferred for future cycle`,
      "error",
      {
        failureType,
        dependency: dependencyLabel,
      },
      {
        ...traceContext,
        eventType: "error",
        durationMs: dedupeDurationMs,
      },
    );

    await this.repository.recordIngestionRun({
      runId: traceContext.runId,
      jobId: traceContext.jobId,
      traceId: traceContext.traceId,
      feedUrl,
      sourceUrl,
      headline,
      step: "deduplication",
      decisionPath,
      status: "FAILED",
      errorMessage: `Deduplication check failed (${dependencyLabel})`,
      startedAt: itemStartedAt,
      finishedAt: new Date(),
    });
  }

  private normalizeExtractedLocations(
    rawLocations: import("../types/ai.js").NewsExtraction["locations"],
  ): NormalizedExtractedLocation[] {
    const normalizedLocations: NormalizedExtractedLocation[] = [];
    const seen = new Set<string>();

    for (const rawLocation of rawLocations) {
      let locationName = normalizeLocationField(rawLocation.location_name);
      let state = canonicalizeState(normalizeLocationField(rawLocation.state));
      let city = canonicalizeCity(
        normalizeLocationField(rawLocation.city),
        state,
      );

      if (locationName && isIgnorableLocationSignal(locationName)) {
        locationName = null;
      }

      if (!city && locationName) {
        const inferred = inferCityAndStateFromLocationName(locationName);

        if (inferred) {
          city = inferred.city;
          state = state ?? inferred.state;
        }
      }

      if (!state && city) {
        state = inferStateFromCanonicalCity(city);
      }

      if (
        locationName &&
        city &&
        normalizeLocationKey(locationName) === normalizeLocationKey(city)
      ) {
        locationName = null;
      }

      if (
        locationName &&
        !city &&
        state &&
        normalizeLocationKey(locationName) === normalizeLocationKey(state)
      ) {
        locationName = null;
      }

      if (!locationName && !city && !state) {
        continue;
      }

      const normalizedLocation: NormalizedExtractedLocation = {
        locationName,
        city,
        state,
      };

      const identityKey = buildLocationIdentityKey(normalizedLocation);

      if (seen.has(identityKey)) {
        continue;
      }

      seen.add(identityKey);
      normalizedLocations.push(normalizedLocation);
    }

    return normalizedLocations;
  }

  private extractRuleBasedLocationSignals(
    text: string,
  ): NormalizedExtractedLocation[] {
    const matches = matchAliasCandidatesInText(text);
    const detected: NormalizedExtractedLocation[] = [];
    const seen = new Set<string>();

    const addSignal = (signal: NormalizedExtractedLocation): void => {
      const key = buildLocationIdentityKey(signal);

      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      detected.push(signal);
    };

    for (const match of matches) {
      if (match.kind === "city") {
        addSignal({
          locationName: null,
          city: match.city,
          state: match.state,
        });
        continue;
      }

      addSignal({
        locationName: null,
        city: null,
        state: match.state,
      });
    }

    return detected;
  }

  private async geocodeLocations(
    sourceUrl: string,
    headline: string,
    candidates: NormalizedExtractedLocation[],
    traceContext: ProcessingTraceContext,
  ): Promise<{ locations: CreateLocationInput[]; geocodedCount: number }> {
    const locations: CreateLocationInput[] = [];
    let geocodedCount = 0;
    let isPrimary = true;

    for (const candidate of candidates) {
      let latitude: number | null = null;
      let longitude: number | null = null;
      const locationLabel =
        candidate.locationName ?? candidate.city ?? candidate.state;

      if (locationLabel) {
        const geocodeStartedAtMs = Date.now();

        this.log(
          sourceUrl,
          headline,
          "geocoding",
          `Geocoding location: ${locationLabel}`,
          "start",
          undefined,
          { ...traceContext, eventType: "start" },
        );

        const coordinates = await geocodeService.forwardGeocode({
          locationName: candidate.locationName ?? locationLabel,
          city: candidate.city,
          state: candidate.state,
        });

        const geocodeDurationMs = Date.now() - geocodeStartedAtMs;

        if (coordinates) {
          latitude = coordinates.latitude;
          longitude = coordinates.longitude;
          geocodedCount += 1;

          this.log(
            sourceUrl,
            headline,
            "geocoding",
            `Geocoded to ${latitude}, ${longitude}`,
            "success",
            { displayName: coordinates.displayName },
            {
              ...traceContext,
              eventType: "end",
              durationMs: geocodeDurationMs,
            },
          );
        } else {
          this.log(
            sourceUrl,
            headline,
            "geocoding",
            `Geocoding returned no coordinates for: ${locationLabel}`,
            "warn",
            { failureType: "geocode_not_found" },
            {
              ...traceContext,
              eventType: "end",
              durationMs: geocodeDurationMs,
            },
          );
        }
      }

      locations.push({
        locationName: candidate.locationName,
        city: candidate.city,
        state: candidate.state,
        isPrimary,
        latitude,
        longitude,
      });

      isPrimary = false;
    }

    return { locations, geocodedCount };
  }

  async runIngestionCycle(
    executionContext: IngestionExecutionContext = {},
  ): Promise<RssIngestionSummary> {
    const cycleContext: IngestionExecutionContext = {
      runId: executionContext.runId ?? randomUUID(),
      jobId: executionContext.jobId,
      attempt: executionContext.attempt,
      triggeredAt: executionContext.triggeredAt,
    };

    const startedAt = new Date();

    const summary: RssIngestionSummary = {
      feedCount: rssFeedSources.length,
      entriesSeen: 0,
      inserted: 0,
      duplicateCount: 0,
      nationalCount: 0,
      locationCount: 0,
      errorCount: 0,
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
    };

    const recentHeadlines = await this.repository.findRecentHeadlines(24, 600);
    const dedupeFingerprints = recentHeadlines.map((headline) =>
      createFingerprint(headline),
    );

    for (const feedUrl of rssFeedSources) {
      const feedStartedAt = new Date();
      const feedStartedAtMs = Date.now();
      const feedContext: ProcessingTraceContext = {
        runId: cycleContext.runId,
        jobId: cycleContext.jobId,
        attempt: cycleContext.attempt,
        feedUrl,
      };

      this.log(
        feedUrl,
        null,
        "feed_fetch",
        `Fetching RSS feed: ${feedUrl}`,
        "start",
        { triggeredAt: cycleContext.triggeredAt },
        { ...feedContext, eventType: "start" },
      );

      try {
        const parsedFeed = await withPromiseTimeout(
          env.RSS_FEED_FETCH_TIMEOUT_MS,
          () => parser.parseURL(feedUrl),
          `RSS feed fetch timed out after ${env.RSS_FEED_FETCH_TIMEOUT_MS}ms`,
        );

        const feedDurationMs = Date.now() - feedStartedAtMs;

        this.log(
          feedUrl,
          null,
          "feed_fetch",
          `Fetched RSS feed (${parsedFeed.items.length} entries)`,
          "success",
          { itemCount: parsedFeed.items.length },
          { ...feedContext, eventType: "end", durationMs: feedDurationMs },
        );

        this.log(
          feedUrl,
          null,
          "feed_parse",
          `Parsed ${parsedFeed.items.length} entries from feed`,
          "success",
          { itemCount: parsedFeed.items.length },
          {
            ...feedContext,
            eventType: "checkpoint",
            durationMs: feedDurationMs,
          },
        );

        for (const item of parsedFeed.items) {
          summary.entriesSeen += 1;

          await this.processFeedItem(
            item,
            feedUrl,
            new Date(),
            dedupeFingerprints,
            summary,
            cycleContext,
          );
        }
      } catch (error) {
        summary.errorCount += 1;

        const feedDurationMs = Date.now() - feedStartedAtMs;
        const isFeedTimeout = isOperationTimeoutError(error);
        const failureMessage = isFeedTimeout
          ? `RSS feed fetch timed out after ${env.RSS_FEED_FETCH_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : "Unknown feed parse error";

        this.log(
          feedUrl,
          null,
          "feed_fetch",
          isFeedTimeout
            ? failureMessage
            : `Feed parse failed: ${failureMessage}`,
          "error",
          {
            failureType: isFeedTimeout
              ? "feed_fetch_timeout"
              : "feed_parse_failed",
          },
          { ...feedContext, eventType: "error", durationMs: feedDurationMs },
        );

        logger.error(
          { error, feedUrl },
          "RSS feed fetch/parse failed for ingestion cycle",
        );

        await this.repository.recordIngestionRun({
          runId: cycleContext.runId,
          jobId: cycleContext.jobId,
          feedUrl,
          step: isFeedTimeout ? "feed_fetch" : "feed_parse",
          decisionPath: isFeedTimeout
            ? "Feed_Fetch_Timeout"
            : "Feed_Parse_Failed",
          status: "FAILED",
          errorMessage: failureMessage,
          startedAt: feedStartedAt,
          finishedAt: new Date(),
        });
      }
    }

    summary.finishedAt = new Date().toISOString();

    return summary;
  }

  private async processFeedItem(
    item: RssItem,
    feedUrl: string,
    itemStartedAt: Date,
    dedupeFingerprints: HeadlineFingerprint[],
    summary: RssIngestionSummary,
    executionContext: IngestionExecutionContext,
  ): Promise<void> {
    const rawSourceUrl = normalizeText(item.link ?? item.guid ?? "");
    const headline = normalizeText(item.title ?? "");

    if (rawSourceUrl.length === 0 || headline.length === 0) {
      return;
    }

    const traceId = randomUUID();
    const traceContext: ProcessingTraceContext = {
      runId: executionContext.runId,
      jobId: executionContext.jobId,
      traceId,
      feedUrl,
      attempt: executionContext.attempt,
    };

    const sourceUrl = canonicalizeArticleUrl(rawSourceUrl);

    if (!sourceUrl) {
      summary.errorCount += 1;

      this.log(
        rawSourceUrl,
        headline,
        "deduplication",
        "Rejected item: unsupported or invalid article URL",
        "warn",
        { failureType: "source_url_invalid" },
        {
          ...traceContext,
          eventType: "checkpoint",
        },
      );

      await this.repository.recordIngestionRun({
        runId: executionContext.runId,
        jobId: executionContext.jobId,
        traceId,
        feedUrl,
        sourceUrl: rawSourceUrl,
        headline,
        step: "deduplication",
        decisionPath: "Source_Url_Invalid",
        status: "SKIPPED_INVALID",
        errorMessage: "Unsupported or invalid article URL",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    const itemStartedAtMs = Date.now();
    const dedupeStartedAtMs = Date.now();

    const contentHash = NewsRepository.computeContentHash(headline, sourceUrl);

    this.log(
      sourceUrl,
      headline,
      "deduplication",
      "Checking duplicate state",
      "start",
      undefined,
      { ...traceContext, eventType: "start" },
    );

    const contentHashCheck =
      await this.repository.existsByContentHash(contentHash);

    if (contentHashCheck === "check_failed") {
      await this.handleDedupeCheckFailure(
        sourceUrl,
        headline,
        feedUrl,
        itemStartedAt,
        summary,
        traceContext,
        dedupeStartedAtMs,
        "content_hash_db",
      );

      return;
    }

    if (contentHashCheck === "duplicate") {
      summary.duplicateCount += 1;

      const dedupeDurationMs = Date.now() - dedupeStartedAtMs;

      this.log(
        sourceUrl,
        headline,
        "deduplication",
        "Skipped: content hash match in database",
        "warn",
        {
          reason: "content_hash",
          failureType: "dedupe_content_hash",
        },
        { ...traceContext, eventType: "end", durationMs: dedupeDurationMs },
      );

      await this.repository.recordIngestionRun({
        runId: executionContext.runId,
        jobId: executionContext.jobId,
        traceId,
        feedUrl,
        sourceUrl,
        headline,
        step: "deduplication",
        decisionPath: "Dedupe_Content_Hash",
        status: "SKIPPED_DUPLICATE",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    const cacheDuplicateCheck = await cacheService.isDuplicate(sourceUrl);

    if (cacheDuplicateCheck === "check_failed") {
      await this.handleDedupeCheckFailure(
        sourceUrl,
        headline,
        feedUrl,
        itemStartedAt,
        summary,
        traceContext,
        dedupeStartedAtMs,
        "url_cache",
      );

      return;
    }

    if (cacheDuplicateCheck === "duplicate") {
      summary.duplicateCount += 1;

      const dedupeDurationMs = Date.now() - dedupeStartedAtMs;

      this.log(
        sourceUrl,
        headline,
        "deduplication",
        "Skipped: URL already in cache",
        "warn",
        {
          reason: "url_cache",
          failureType: "dedupe_valkey_cache",
        },
        { ...traceContext, eventType: "end", durationMs: dedupeDurationMs },
      );

      await this.repository.recordIngestionRun({
        runId: executionContext.runId,
        jobId: executionContext.jobId,
        traceId,
        feedUrl,
        sourceUrl,
        headline,
        step: "deduplication",
        decisionPath: "Dedupe_Valkey_Cache",
        status: "SKIPPED_DUPLICATE",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    const fingerprint = createFingerprint(headline);

    if (this.isLikelyDuplicate(fingerprint, dedupeFingerprints)) {
      summary.duplicateCount += 1;

      const dedupeDurationMs = Date.now() - dedupeStartedAtMs;

      this.log(
        sourceUrl,
        headline,
        "deduplication",
        "Skipped: similar headline exists",
        "warn",
        {
          reason: "headline_similarity",
          failureType: "dedupe_headline_similarity",
        },
        { ...traceContext, eventType: "end", durationMs: dedupeDurationMs },
      );

      await this.repository.recordIngestionRun({
        runId: executionContext.runId,
        jobId: executionContext.jobId,
        traceId,
        feedUrl,
        sourceUrl,
        headline,
        step: "deduplication",
        decisionPath: "Dedupe_Title_Match",
        status: "SKIPPED_DUPLICATE",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    const rawSummary = normalizeText(
      item.contentSnippet ?? item.content ?? headline,
    );

    const rssFullContent = item.content
      ? normalizeText(
          item.content
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
      : rawSummary;

    try {
      const dedupeDurationMs = Date.now() - dedupeStartedAtMs;

      this.log(
        sourceUrl,
        headline,
        "deduplication",
        "Deduplication passed",
        "success",
        { reason: "accepted" },
        { ...traceContext, eventType: "end", durationMs: dedupeDurationMs },
      );

      const pipelineStartedAtMs = Date.now();

      this.log(
        sourceUrl,
        headline,
        "ai_processing",
        "Starting article processing pipeline",
        "start",
        undefined,
        { ...traceContext, eventType: "start" },
      );

      const agentResult = await agentService.processArticle(
        headline,
        rawSummary,
        sourceUrl,
        rssFullContent,
        traceContext,
      );

      if (agentResult) {
        this.log(
          sourceUrl,
          headline,
          "ai_processing",
          `AI agent extracted: category=${agentResult.extraction.category}, locations=${agentResult.extraction.locations.length}`,
          "success",
          {
            decisionPath: agentResult.audit.decisionPath,
            latencyMs: agentResult.audit.totalLatencyMs,
            locationCount: agentResult.extraction.locations.length,
          },
          {
            ...traceContext,
            eventType: "end",
            durationMs: Date.now() - pipelineStartedAtMs,
          },
        );

        await this.processWithAgentExtraction(
          agentResult.extraction,
          agentResult.audit.decisionPath,
          sourceUrl,
          rawSummary,
          feedUrl,
          itemStartedAt,
          summary,
          dedupeFingerprints,
          fingerprint,
          item,
          traceContext,
          contentHash,
        );
        return;
      }

      this.log(
        sourceUrl,
        headline,
        "ai_processing",
        "AI agent not available, falling back to rule-based extraction",
        "info",
        { reason: "ai_unavailable_or_failed" },
        {
          ...traceContext,
          eventType: "end",
          durationMs: Date.now() - pipelineStartedAtMs,
        },
      );

      await this.processWithRuleBasedExtraction(
        headline,
        rawSummary,
        sourceUrl,
        feedUrl,
        itemStartedAt,
        summary,
        dedupeFingerprints,
        fingerprint,
        item,
        traceContext,
        contentHash,
      );
    } catch (error) {
      summary.errorCount += 1;

      this.log(
        sourceUrl,
        headline,
        "error",
        `Processing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        "error",
        { failureType: "item_processing_failed" },
        {
          ...traceContext,
          eventType: "error",
          durationMs: Date.now() - itemStartedAtMs,
        },
      );

      logger.error({ error, feedUrl, sourceUrl }, "RSS item ingestion failed");

      await this.repository.recordIngestionRun({
        runId: executionContext.runId,
        jobId: executionContext.jobId,
        traceId,
        feedUrl,
        sourceUrl,
        headline,
        step: "item_processing",
        decisionPath: "Item_Processing_Failed",
        status: "FAILED",
        errorMessage:
          error instanceof Error ? error.message : "Unknown processing error",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });
    }
  }

  private async processWithAgentExtraction(
    extraction: import("../types/ai.js").NewsExtraction,
    agentDecisionPath: string,
    sourceUrl: string,
    rawSummary: string,
    feedUrl: string,
    itemStartedAt: Date,
    summary: RssIngestionSummary,
    dedupeFingerprints: HeadlineFingerprint[],
    fingerprint: HeadlineFingerprint,
    item: RssItem,
    traceContext: ProcessingTraceContext,
    contentHash: string,
  ): Promise<void> {
    const normalizedLocations = this.normalizeExtractedLocations(
      extraction.locations,
    );

    if (normalizedLocations.length !== extraction.locations.length) {
      this.log(
        sourceUrl,
        extraction.headline,
        "content_parse",
        `Normalized AI locations: ${normalizedLocations.length}/${extraction.locations.length}`,
        "info",
        {
          extractedLocationCount: extraction.locations.length,
          normalizedLocationCount: normalizedLocations.length,
        },
        {
          ...traceContext,
          eventType: "checkpoint",
        },
      );
    }

    const { locations, geocodedCount } = await this.geocodeLocations(
      sourceUrl,
      extraction.headline,
      normalizedLocations,
      traceContext,
    );

    const hasLocations = normalizedLocations.length > 0;
    const isNational = !hasLocations;

    const locationResolutionPath = hasLocations
      ? geocodedCount > 0
        ? "Geocode_Resolved"
        : "Location_Text_Only"
      : "No_Location_Signal";

    if (hasLocations && geocodedCount === 0) {
      this.log(
        sourceUrl,
        extraction.headline,
        "geocoding",
        "Location signals found but geocoding failed for all; storing text-only locations",
        "warn",
        {
          locationCount: normalizedLocations.length,
          failureType: "geocode_all_failed",
        },
        { ...traceContext, eventType: "checkpoint" },
      );
    }

    const category: NewsCategory = isNational
      ? "Uncategorized / National"
      : extraction.category === "Uncategorized / National"
        ? "General"
        : extraction.category;

    const storageStartedAtMs = Date.now();

    this.log(
      sourceUrl,
      extraction.headline,
      "storage",
      `Storing news item with ${locations.length} location(s) in database (${geocodedCount} geocoded)`,
      "start",
      undefined,
      { ...traceContext, eventType: "start" },
    );

    const result = await this.repository.createNewsItem({
      sourceUrl,
      headline: extraction.headline,
      summary: extraction.summary.length > 0 ? extraction.summary : rawSummary,
      category,
      isNational,
      publishedAt: resolvePublishedAt(item),
      locations,
      contentHash,
    });

    if (result.status === "conflict") {
      summary.duplicateCount += 1;

      const storageDurationMs = Date.now() - storageStartedAtMs;

      this.log(
        sourceUrl,
        extraction.headline,
        "storage",
        "Skipped: insert conflict",
        "warn",
        { failureType: "db_insert_conflict" },
        { ...traceContext, eventType: "end", durationMs: storageDurationMs },
      );

      await this.repository.recordIngestionRun({
        runId: traceContext.runId,
        jobId: traceContext.jobId,
        traceId: traceContext.traceId,
        feedUrl,
        sourceUrl,
        headline: extraction.headline,
        step: "storage",
        decisionPath: `${agentDecisionPath} -> ${locationResolutionPath} -> Insert_Conflict`,
        status: "SKIPPED_CONFLICT",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    if (result.status === "failed") {
      summary.errorCount += 1;

      const storageDurationMs = Date.now() - storageStartedAtMs;

      this.log(
        sourceUrl,
        extraction.headline,
        "storage",
        `Storage failed: ${result.errorMessage}`,
        "error",
        { failureType: "db_insert_failed" },
        {
          ...traceContext,
          eventType: "error",
          durationMs: storageDurationMs,
        },
      );

      await this.repository.recordIngestionRun({
        runId: traceContext.runId,
        jobId: traceContext.jobId,
        traceId: traceContext.traceId,
        feedUrl,
        sourceUrl,
        headline: extraction.headline,
        step: "storage",
        decisionPath: `${agentDecisionPath} -> ${locationResolutionPath} -> Insert_Failed`,
        status: "FAILED",
        errorMessage: result.errorMessage,
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    const locationSummary =
      result.locations.length > 0
        ? ` - ${result.locations.map((l) => l.city ?? l.state ?? l.locationName ?? "unknown").join(", ")}`
        : "";

    const articleTraceContext: ProcessingTraceContext = {
      ...traceContext,
      articleId: result.item.id,
    };

    this.log(
      sourceUrl,
      extraction.headline,
      "storage",
      `Stored news item ${result.item.id} with ${result.locations.length} location(s)`,
      "success",
      { locationCount: result.locations.length },
      {
        ...articleTraceContext,
        eventType: "end",
        durationMs: Date.now() - storageStartedAtMs,
      },
    );

    this.log(
      sourceUrl,
      extraction.headline,
      "complete",
      `Article processed successfully [${category}]${isNational ? " (national)" : locationSummary} (${result.locations.length} location(s))`,
      "success",
      {
        category,
        isNational,
        locationCount: result.locations.length,
      },
      { ...articleTraceContext, eventType: "end" },
    );

    summary.inserted += 1;
    summary.locationCount += result.locations.length;

    if (result.item.isNational) {
      summary.nationalCount += 1;
    }

    dedupeFingerprints.push(fingerprint);
    await cacheService.markProcessed(sourceUrl);
    socketGateway.publishNewsCreated(result.item, result.locations);

    await this.repository.recordIngestionRun({
      runId: traceContext.runId,
      jobId: traceContext.jobId,
      traceId: traceContext.traceId,
      feedUrl,
      sourceUrl,
      headline: extraction.headline,
      newsItemId: result.item.id,
      step: "complete",
      decisionPath: `${agentDecisionPath} -> ${locationResolutionPath}`,
      status: "SUCCESS",
      startedAt: itemStartedAt,
      finishedAt: new Date(),
    });
  }

  private async processWithRuleBasedExtraction(
    headline: string,
    rawSummary: string,
    sourceUrl: string,
    feedUrl: string,
    itemStartedAt: Date,
    summary: RssIngestionSummary,
    dedupeFingerprints: HeadlineFingerprint[],
    fingerprint: HeadlineFingerprint,
    item: RssItem,
    traceContext: ProcessingTraceContext,
    contentHash: string,
  ): Promise<void> {
    let fetchResult: FetchArticleContentOutput = {
      content: rawSummary,
      decisionPath: "RSS_Sufficient",
      strategyUsed: "rss",
    };

    const contentFetchStartedAtMs = Date.now();

    this.log(
      sourceUrl,
      headline,
      "content_fetch",
      `Fetching article content (RSS summary: ${rawSummary.length} chars)`,
      "start",
      undefined,
      { ...traceContext, eventType: "start" },
    );

    fetchResult = await contentFetchService.fetchBestContent(
      sourceUrl,
      rawSummary,
    );

    const contentFetchDurationMs = Date.now() - contentFetchStartedAtMs;
    const contentFetchFailed = fetchResult.strategyUsed === "none";

    this.log(
      sourceUrl,
      headline,
      "content_fetch",
      contentFetchFailed
        ? `Content fetch failed across all strategies; falling back to RSS summary (${fetchResult.content.length} chars)`
        : `Content fetched via ${fetchResult.strategyUsed} (${fetchResult.content.length} chars)`,
      contentFetchFailed ? "warn" : "success",
      {
        strategy: fetchResult.strategyUsed,
        decisionPath: fetchResult.decisionPath,
        ...(contentFetchFailed
          ? {
              failureType: "content_fetch_all_failed",
              fallbackSource: "rss_summary",
            }
          : {}),
      },
      { ...traceContext, eventType: "end", durationMs: contentFetchDurationMs },
    );

    const fullText = normalizeText(`${headline} ${fetchResult.content}`);
    const baseCategory = categorizeArticle(fullText);
    const ruleBasedLocations = this.extractRuleBasedLocationSignals(fullText);

    this.log(
      sourceUrl,
      headline,
      "content_parse",
      `Rule-based location signals detected: ${ruleBasedLocations.length}`,
      ruleBasedLocations.length > 0 ? "info" : "warn",
      { locationSignalCount: ruleBasedLocations.length },
      { ...traceContext, eventType: "checkpoint" },
    );

    const { locations, geocodedCount } = await this.geocodeLocations(
      sourceUrl,
      headline,
      ruleBasedLocations,
      traceContext,
    );

    const hasLocations = ruleBasedLocations.length > 0;
    const isNational = !hasLocations;
    const locationResolutionPath = hasLocations
      ? geocodedCount > 0
        ? "RuleBased_Location_Geocoded"
        : "RuleBased_Location_TextOnly"
      : "RuleBased_No_Location_Signal";

    if (hasLocations && geocodedCount === 0) {
      this.log(
        sourceUrl,
        headline,
        "geocoding",
        "Rule-based location signals found but geocoding failed for all; storing text-only locations",
        "warn",
        {
          locationCount: ruleBasedLocations.length,
          failureType: "rule_based_geocode_all_failed",
        },
        { ...traceContext, eventType: "checkpoint" },
      );
    }

    const category: NewsCategory = isNational
      ? "Uncategorized / National"
      : baseCategory;

    const storageStartedAtMs = Date.now();

    this.log(
      sourceUrl,
      headline,
      "storage",
      `Storing ${isNational ? "national" : "regional"} news item from rule-based fallback (${locations.length} location(s), ${geocodedCount} geocoded)`,
      "start",
      undefined,
      { ...traceContext, eventType: "start" },
    );

    const result = await this.repository.createNewsItem({
      sourceUrl,
      headline,
      summary:
        fetchResult.content.length > 0 ? fetchResult.content : rawSummary,
      category,
      isNational,
      publishedAt: resolvePublishedAt(item),
      locations,
      contentHash,
    });

    if (result.status === "conflict") {
      summary.duplicateCount += 1;

      const storageDurationMs = Date.now() - storageStartedAtMs;

      this.log(
        sourceUrl,
        headline,
        "storage",
        "Skipped: insert conflict",
        "warn",
        { failureType: "db_insert_conflict" },
        { ...traceContext, eventType: "end", durationMs: storageDurationMs },
      );

      await this.repository.recordIngestionRun({
        runId: traceContext.runId,
        jobId: traceContext.jobId,
        traceId: traceContext.traceId,
        feedUrl,
        sourceUrl,
        headline,
        step: "storage",
        decisionPath: `${fetchResult.decisionPath} -> ${locationResolutionPath} -> Insert_Conflict`,
        status: "SKIPPED_CONFLICT",
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    if (result.status === "failed") {
      summary.errorCount += 1;

      const storageDurationMs = Date.now() - storageStartedAtMs;

      this.log(
        sourceUrl,
        headline,
        "storage",
        `Storage failed: ${result.errorMessage}`,
        "error",
        { failureType: "db_insert_failed" },
        {
          ...traceContext,
          eventType: "error",
          durationMs: storageDurationMs,
        },
      );

      await this.repository.recordIngestionRun({
        runId: traceContext.runId,
        jobId: traceContext.jobId,
        traceId: traceContext.traceId,
        feedUrl,
        sourceUrl,
        headline,
        step: "storage",
        decisionPath: `${fetchResult.decisionPath} -> ${locationResolutionPath} -> Insert_Failed`,
        status: "FAILED",
        errorMessage: result.errorMessage,
        startedAt: itemStartedAt,
        finishedAt: new Date(),
      });

      return;
    }

    summary.inserted += 1;
    summary.locationCount += result.locations.length;

    if (result.item.isNational) {
      summary.nationalCount += 1;
    }

    const articleTraceContext: ProcessingTraceContext = {
      ...traceContext,
      articleId: result.item.id,
    };

    this.log(
      sourceUrl,
      headline,
      "storage",
      `Stored ${result.item.isNational ? "national" : "regional"} news item ${result.item.id}`,
      "success",
      { locationCount: result.locations.length },
      {
        ...articleTraceContext,
        eventType: "end",
        durationMs: Date.now() - storageStartedAtMs,
      },
    );

    this.log(
      sourceUrl,
      headline,
      "complete",
      `Article processed successfully [${result.item.category}]${result.item.isNational ? " (national)" : ""} (rule-based fallback)`,
      "success",
      {
        category: result.item.category,
        isNational: result.item.isNational,
        locationCount: result.locations.length,
      },
      { ...articleTraceContext, eventType: "end" },
    );

    dedupeFingerprints.push(fingerprint);
    await cacheService.markProcessed(sourceUrl);
    socketGateway.publishNewsCreated(result.item, result.locations);

    await this.repository.recordIngestionRun({
      runId: traceContext.runId,
      jobId: traceContext.jobId,
      traceId: traceContext.traceId,
      feedUrl,
      sourceUrl,
      headline,
      newsItemId: result.item.id,
      step: "complete",
      decisionPath: `RuleBased_Fallback -> ${fetchResult.decisionPath} -> ${locationResolutionPath}`,
      status: "SUCCESS",
      startedAt: itemStartedAt,
      finishedAt: new Date(),
    });
  }

  private isLikelyDuplicate(
    incoming: HeadlineFingerprint,
    existing: HeadlineFingerprint[],
  ): boolean {
    if (incoming.normalized.length === 0) {
      return false;
    }

    for (const candidate of existing) {
      if (incoming.normalized === candidate.normalized) {
        return true;
      }

      const similarity = jaccardSimilarity(incoming.tokens, candidate.tokens);

      if (similarity >= 0.78) {
        return true;
      }
    }

    return false;
  }
}

export const rssIngestionService = new RssIngestionService();
