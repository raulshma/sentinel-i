import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TRACKING_PARAM_KEYS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "spm",
  "yclid",
  "msclkid",
  "cmpid",
  "campaign",
  "source",
]);

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const HOST_VALIDATION_CACHE_TTL_MS = 10 * 60 * 1_000;

const hostValidationCache = new Map<
  string,
  {
    expiresAt: number;
    result: HostValidationResult;
  }
>();

export type ArticleUrlSafetyFailureReason =
  | "invalid_url"
  | "unsupported_scheme"
  | "contains_credentials"
  | "host_not_allowlisted"
  | "host_is_local"
  | "ip_is_private"
  | "dns_resolution_failed"
  | "dns_resolves_private_ip"
  | "too_many_redirects";

interface HostValidationResult {
  ok: boolean;
  reason?: "dns_resolution_failed" | "dns_resolves_private_ip";
  message?: string;
}

interface ParsedArticleUrl {
  ok: boolean;
  url?: URL;
  reason?: "invalid_url" | "unsupported_scheme" | "contains_credentials";
  message?: string;
}

export interface ArticleUrlSafetyResult {
  ok: boolean;
  canonicalUrl: string | null;
  reason?: ArticleUrlSafetyFailureReason;
  message?: string;
}

export interface ValidateArticleUrlSafetyOptions {
  allowlistHosts?: string[];
  checkDns?: boolean;
}

export interface SafeArticleFetchOptions {
  allowlistHosts?: string[];
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
}

export class UnsafeArticleUrlError extends Error {
  constructor(
    message: string,
    public readonly reason: ArticleUrlSafetyFailureReason,
    public readonly url: string,
  ) {
    super(message);
    this.name = "UnsafeArticleUrlError";
  }
}

export const isUnsafeArticleUrlError = (
  error: unknown,
): error is UnsafeArticleUrlError => error instanceof UnsafeArticleUrlError;

const normalizeHostname = (hostname: string): string => {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
};

const normalizePathname = (pathname: string): string => {
  const squashed = pathname.replace(/\/{2,}/g, "/");

  if (squashed.length <= 1) {
    return "/";
  }

  return squashed.replace(/\/+$/, "");
};

const shouldDropQueryParam = (key: string): boolean => {
  const normalizedKey = key.toLowerCase();

  if (normalizedKey.startsWith("utm_")) {
    return true;
  }

  return TRACKING_PARAM_KEYS.has(normalizedKey);
};

const canonicalizeUrlObject = (source: URL): string => {
  const normalized = new URL(source.toString());

  normalized.hash = "";
  normalized.username = "";
  normalized.password = "";
  normalized.hostname = normalizeHostname(normalized.hostname);

  if (
    (normalized.protocol === "http:" && normalized.port === "80") ||
    (normalized.protocol === "https:" && normalized.port === "443")
  ) {
    normalized.port = "";
  }

  normalized.pathname = normalizePathname(normalized.pathname);

  const retainedEntries: Array<[string, string]> = [];

  for (const [key, value] of normalized.searchParams.entries()) {
    if (shouldDropQueryParam(key)) {
      continue;
    }

    retainedEntries.push([key, value]);
  }

  retainedEntries.sort((left, right) => {
    const keyCompare = left[0].localeCompare(right[0], undefined, {
      sensitivity: "base",
    });

    if (keyCompare !== 0) {
      return keyCompare;
    }

    return left[1].localeCompare(right[1], undefined, {
      sensitivity: "base",
    });
  });

  normalized.search = "";

  for (const [key, value] of retainedEntries) {
    normalized.searchParams.append(key, value);
  }

  return normalized.toString();
};

const parseArticleUrl = (rawUrl: string): ParsedArticleUrl => {
  const candidate = rawUrl.trim();

  if (candidate.length === 0) {
    return {
      ok: false,
      reason: "invalid_url",
      message: "URL is empty",
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      reason: "invalid_url",
      message: "URL could not be parsed",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: "unsupported_scheme",
      message: "Only HTTP and HTTPS URLs are allowed",
    };
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return {
      ok: false,
      reason: "contains_credentials",
      message: "URLs with embedded credentials are not allowed",
    };
  }

  return { ok: true, url: parsed };
};

const parseIpv4Octets = (address: string): number[] | null => {
  const parts = address.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number(part));

  if (
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }

  return octets;
};

const isPrivateIpv4 = (address: string): boolean => {
  const octets = parseIpv4Octets(address);

  if (!octets) {
    return true;
  }

  const first = octets[0];
  const second = octets[1];

  if (first == null || second == null) {
    return true;
  }

  if (first === 0 || first === 10 || first === 127) {
    return true;
  }

  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }

  if (first === 169 && second === 254) {
    return true;
  }

  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  if (first === 192 && second === 168) {
    return true;
  }

  if (first === 198 && (second === 18 || second === 19)) {
    return true;
  }

  if (first >= 224) {
    return true;
  }

  return false;
};

const isPrivateIpv6 = (address: string): boolean => {
  const normalized =
    address.toLowerCase().split("%")[0] ?? address.toLowerCase();

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);

    if (isIP(mappedIpv4) === 4) {
      return isPrivateIpv4(mappedIpv4);
    }
  }

  if (/^f[cd]/.test(normalized)) {
    return true;
  }

  if (/^fe[89ab]/.test(normalized)) {
    return true;
  }

  if (normalized.startsWith("ff")) {
    return true;
  }

  return false;
};

const isPrivateIpAddress = (address: string): boolean => {
  const family = isIP(address);

  if (family === 4) {
    return isPrivateIpv4(address);
  }

  if (family === 6) {
    return isPrivateIpv6(address);
  }

  return true;
};

const isLocalHostname = (hostname: string): boolean => {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
};

const isHostnameAllowlisted = (
  hostname: string,
  allowlistHosts: string[],
): boolean => {
  if (allowlistHosts.length === 0) {
    return true;
  }

  return allowlistHosts.some((allowedHost) => {
    return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
  });
};

const validateHostnameResolution = async (
  hostname: string,
): Promise<HostValidationResult> => {
  const cached = hostValidationCache.get(hostname);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  let result: HostValidationResult;

  try {
    const addresses = await lookup(hostname, {
      all: true,
      verbatim: true,
    });

    if (addresses.length === 0) {
      result = {
        ok: false,
        reason: "dns_resolution_failed",
        message: `Host ${hostname} did not resolve`,
      };
    } else {
      const blockedAddress = addresses.find((entry) =>
        isPrivateIpAddress(entry.address),
      );

      if (blockedAddress) {
        result = {
          ok: false,
          reason: "dns_resolves_private_ip",
          message: `Host ${hostname} resolves to blocked address ${blockedAddress.address}`,
        };
      } else {
        result = { ok: true };
      }
    }
  } catch {
    result = {
      ok: false,
      reason: "dns_resolution_failed",
      message: `DNS resolution failed for host ${hostname}`,
    };
  }

  hostValidationCache.set(hostname, {
    expiresAt: Date.now() + HOST_VALIDATION_CACHE_TTL_MS,
    result,
  });

  return result;
};

export const parseArticleFetchHostAllowlist = (
  value: string | undefined,
): string[] => {
  if (!value) {
    return [];
  }

  const hosts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      try {
        return normalizeHostname(new URL(entry).hostname);
      } catch {
        return normalizeHostname(entry.replace(/^\*\./, ""));
      }
    })
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(hosts));
};

export const canonicalizeArticleUrl = (rawUrl: string): string | null => {
  const parsed = parseArticleUrl(rawUrl);

  if (!parsed.ok || !parsed.url) {
    return null;
  }

  return canonicalizeUrlObject(parsed.url);
};

export const validateArticleUrlSafety = async (
  rawUrl: string,
  options: ValidateArticleUrlSafetyOptions = {},
): Promise<ArticleUrlSafetyResult> => {
  const parsed = parseArticleUrl(rawUrl);

  if (!parsed.ok || !parsed.url) {
    return {
      ok: false,
      canonicalUrl: null,
      reason: parsed.reason ?? "invalid_url",
      message: parsed.message ?? "URL could not be validated",
    };
  }

  const canonicalUrl = canonicalizeUrlObject(parsed.url);
  const canonical = new URL(canonicalUrl);
  const hostname = normalizeHostname(canonical.hostname);
  const allowlistHosts = options.allowlistHosts ?? [];

  if (!isHostnameAllowlisted(hostname, allowlistHosts)) {
    return {
      ok: false,
      canonicalUrl,
      reason: "host_not_allowlisted",
      message: `Host ${hostname} is not in the allowed host list`,
    };
  }

  if (isLocalHostname(hostname)) {
    return {
      ok: false,
      canonicalUrl,
      reason: "host_is_local",
      message: `Host ${hostname} points to a local network destination`,
    };
  }

  const hostFamily = isIP(hostname);

  if (hostFamily > 0 && isPrivateIpAddress(hostname)) {
    return {
      ok: false,
      canonicalUrl,
      reason: "ip_is_private",
      message: `Host ${hostname} is a private or non-routable IP`,
    };
  }

  if (hostFamily === 0 && options.checkDns !== false) {
    const dnsValidation = await validateHostnameResolution(hostname);

    if (!dnsValidation.ok) {
      return {
        ok: false,
        canonicalUrl,
        reason: dnsValidation.reason,
        message: dnsValidation.message,
      };
    }
  }

  return {
    ok: true,
    canonicalUrl,
  };
};

export const fetchWithSafeArticleRedirects = async (
  rawUrl: string,
  init: RequestInit,
  options: SafeArticleFetchOptions = {},
): Promise<Response> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? 5;
  const allowlistHosts = options.allowlistHosts ?? [];

  let currentUrl = rawUrl;
  let redirectsFollowed = 0;

  while (true) {
    const safety = await validateArticleUrlSafety(currentUrl, {
      allowlistHosts,
      checkDns: true,
    });

    if (!safety.ok || !safety.canonicalUrl) {
      throw new UnsafeArticleUrlError(
        safety.message ?? "Unsafe article URL",
        safety.reason ?? "invalid_url",
        currentUrl,
      );
    }

    const response = await fetchImpl(safety.canonicalUrl, {
      ...init,
      redirect: "manual",
    });

    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("location");

    if (!location) {
      return response;
    }

    if (redirectsFollowed >= maxRedirects) {
      throw new UnsafeArticleUrlError(
        `Article redirect chain exceeded ${maxRedirects} hops`,
        "too_many_redirects",
        safety.canonicalUrl,
      );
    }

    try {
      currentUrl = new URL(location, safety.canonicalUrl).toString();
    } catch {
      throw new UnsafeArticleUrlError(
        "Redirect target URL is invalid",
        "invalid_url",
        location,
      );
    }

    redirectsFollowed += 1;
  }
};
