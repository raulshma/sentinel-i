import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

type GeocodeResult = {
  lat: string;
  lon: string;
  display_name: string;
};

interface GeocodeProviderConfig {
  name: string;
  baseUrl: string;
  includeApiKey: boolean;
}

export interface ForwardGeocodeInput {
  locationName: string;
  city?: string | null;
  state?: string | null;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
  displayName: string;
}

const FALLBACK_GEOCODE_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; Sentinel-I/1.0; +https://example.local/sentinel-i)";
const GEOCODE_TIMEOUT_MS = 8_000;
const CACHE_MAX_ENTRIES = 2_000;

const normalizePart = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
};

const normalizeBaseUrl = (baseUrl: string): string => {
  const parsed = new URL(baseUrl);
  return `${parsed.protocol}//${parsed.host}`;
};

const isInIndia = (displayName: string): boolean => {
  return displayName.toLowerCase().includes("india");
};

const withTimeout = async <T>(
  timeoutMs: number,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await execute(controller.signal);
  } finally {
    clearTimeout(timeoutHandle);
  }
};

export class GeocodeService {
  private readonly cache = new Map<string, Coordinates | null>();

  async forwardGeocode(
    input: ForwardGeocodeInput,
  ): Promise<Coordinates | null> {
    const queryCandidates = this.buildQueryCandidates(input);

    if (queryCandidates.length === 0) {
      return null;
    }

    for (const query of queryCandidates) {
      const cacheKey = query.toLowerCase();

      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey) ?? null;

        if (cached) {
          return cached;
        }

        continue;
      }

      const coordinates = await this.resolveCoordinates(query);
      this.remember(cacheKey, coordinates);

      if (coordinates) {
        return coordinates;
      }
    }

    return null;
  }

  private buildQueryCandidates(input: ForwardGeocodeInput): string[] {
    const locationName = normalizePart(input.locationName);
    const city = normalizePart(input.city);
    const state = normalizePart(input.state);

    const candidateParts: Array<Array<string | null>> = [
      [locationName, city, state, "India"],
      [city, state, "India"],
      [locationName, state, "India"],
      [locationName, city, "India"],
      [state, "India"],
    ];

    const candidates: string[] = [];
    const seen = new Set<string>();

    for (const parts of candidateParts) {
      const locationParts = parts
        .filter((part): part is string => Boolean(part))
        .filter((part) => part.toLowerCase() !== "india");

      if (locationParts.length === 0) {
        continue;
      }

      const query = [...locationParts, "India"].join(", ");

      if (!query) {
        continue;
      }

      const key = query.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(query);
    }

    return candidates;
  }

  private getProviders(): GeocodeProviderConfig[] {
    const providers: GeocodeProviderConfig[] = [
      {
        name: "configured_geocode_provider",
        baseUrl: env.GEOCODE_BASE_URL,
        includeApiKey: true,
      },
    ];

    if (
      normalizeBaseUrl(env.GEOCODE_BASE_URL) !==
      normalizeBaseUrl(FALLBACK_GEOCODE_BASE_URL)
    ) {
      providers.push({
        name: "nominatim_fallback",
        baseUrl: FALLBACK_GEOCODE_BASE_URL,
        includeApiKey: false,
      });
    }

    return providers;
  }

  private async resolveCoordinates(query: string): Promise<Coordinates | null> {
    for (const provider of this.getProviders()) {
      const coordinates = await this.fetchFromProvider(provider, query);

      if (coordinates) {
        return coordinates;
      }
    }

    return null;
  }

  private async fetchFromProvider(
    provider: GeocodeProviderConfig,
    query: string,
  ): Promise<Coordinates | null> {
    const endpoint = new URL("/search", provider.baseUrl);
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("countrycodes", "in");
    endpoint.searchParams.set("limit", "3");
    endpoint.searchParams.set("format", "jsonv2");

    if (provider.includeApiKey && env.GEOCODE_API_KEY) {
      endpoint.searchParams.set("api_key", env.GEOCODE_API_KEY);
    }

    try {
      const response = await withTimeout(GEOCODE_TIMEOUT_MS, async (signal) => {
        return fetch(endpoint, {
          headers: {
            Accept: "application/json",
            "User-Agent": DEFAULT_USER_AGENT,
            ...(provider.includeApiKey && env.GEOCODE_API_KEY
              ? { Authorization: `Bearer ${env.GEOCODE_API_KEY}` }
              : {}),
          },
          signal,
        });
      });

      if (!response.ok) {
        logger.warn(
          {
            status: response.status,
            provider: provider.name,
            query,
            endpoint: endpoint.toString(),
          },
          "Geocode provider returned non-success status",
        );
        return null;
      }

      const payload = (await response.json()) as unknown;

      if (!Array.isArray(payload)) {
        return null;
      }

      const topResult = payload.find((entry): entry is GeocodeResult => {
        if (!entry || typeof entry !== "object") {
          return false;
        }

        const casted = entry as Partial<GeocodeResult>;
        if (
          typeof casted.display_name !== "string" ||
          typeof casted.lat !== "string" ||
          typeof casted.lon !== "string"
        ) {
          return false;
        }

        return isInIndia(casted.display_name);
      });

      if (!topResult) {
        return null;
      }

      const latitude = Number(topResult.lat);
      const longitude = Number(topResult.lon);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      return {
        latitude,
        longitude,
        displayName: topResult.display_name,
      };
    } catch (error) {
      logger.warn(
        {
          error,
          provider: provider.name,
          query,
        },
        "Geocode provider request failed",
      );
      return null;
    }
  }

  private remember(cacheKey: string, value: Coordinates | null): void {
    this.cache.set(cacheKey, value);

    if (this.cache.size <= CACHE_MAX_ENTRIES) {
      return;
    }

    const oldestKey = this.cache.keys().next().value;
    if (typeof oldestKey === "string") {
      this.cache.delete(oldestKey);
    }
  }
}

export const geocodeService = new GeocodeService();
