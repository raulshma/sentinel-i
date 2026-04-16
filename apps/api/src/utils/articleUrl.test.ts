import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UnsafeArticleUrlError,
  canonicalizeArticleUrl,
  fetchWithSafeArticleRedirects,
  parseArticleFetchHostAllowlist,
  validateArticleUrlSafety,
} from "./articleUrl.js";

const resolveRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
};

void describe("canonicalizeArticleUrl", () => {
  void it("normalizes host/path and removes tracking params", () => {
    const canonical = canonicalizeArticleUrl(
      " HTTPS://Example.com//news///item/?utm_source=abc&b=2&a=1#section ",
    );

    assert.equal(canonical, "https://example.com/news/item?a=1&b=2");
  });

  void it("removes default ports and tracking-only query strings", () => {
    const canonical = canonicalizeArticleUrl(
      "http://Example.com:80/path/?ref=homepage&utm_medium=email",
    );

    assert.equal(canonical, "http://example.com/path");
  });

  void it("returns null for unsupported schemes", () => {
    const canonical = canonicalizeArticleUrl("ftp://example.com/news");

    assert.equal(canonical, null);
  });
});

void describe("parseArticleFetchHostAllowlist", () => {
  void it("normalizes and deduplicates host entries", () => {
    const hosts = parseArticleFetchHostAllowlist(
      "example.com, *.news.example.com, https://api.gov.in/path, example.com, HTTP://WWW.TEST.COM",
    );

    assert.deepEqual(hosts, [
      "example.com",
      "news.example.com",
      "api.gov.in",
      "www.test.com",
    ]);
  });
});

void describe("validateArticleUrlSafety", () => {
  void it("rejects invalid and unsafe URLs with explicit reasons", async () => {
    const invalid = await validateArticleUrlSafety("not-a-url");
    assert.equal(invalid.ok, false);
    assert.equal(invalid.reason, "invalid_url");

    const unsupported = await validateArticleUrlSafety("ftp://example.com/a");
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.reason, "unsupported_scheme");

    const withCredentials = await validateArticleUrlSafety(
      "https://user:pass@example.com/private",
    );
    assert.equal(withCredentials.ok, false);
    assert.equal(withCredentials.reason, "contains_credentials");

    const localhost = await validateArticleUrlSafety("http://localhost:8080");
    assert.equal(localhost.ok, false);
    assert.equal(localhost.reason, "host_is_local");

    const privateIp = await validateArticleUrlSafety("http://192.168.1.5/path");
    assert.equal(privateIp.ok, false);
    assert.equal(privateIp.reason, "ip_is_private");
  });

  void it("enforces host allowlist before DNS resolution", async () => {
    const disallowed = await validateArticleUrlSafety(
      "https://news.example.com/article?x=1",
      {
        allowlistHosts: ["trusted.org"],
        checkDns: false,
      },
    );

    assert.equal(disallowed.ok, false);
    assert.equal(disallowed.reason, "host_not_allowlisted");

    const allowed = await validateArticleUrlSafety(
      "https://news.example.com/article?b=2&a=1&utm_source=feed",
      {
        allowlistHosts: ["example.com"],
        checkDns: false,
      },
    );

    assert.equal(allowed.ok, true);
    assert.equal(
      allowed.canonicalUrl,
      "https://news.example.com/article?a=1&b=2",
    );
  });
});

void describe("fetchWithSafeArticleRedirects", () => {
  void it("follows safe redirects and returns terminal response", async () => {
    const requestedUrls: string[] = [];

    const fetchImpl: typeof fetch = (input, init) => {
      const url = resolveRequestUrl(input);
      requestedUrls.push(url);

      assert.equal(init?.redirect, "manual");

      if (requestedUrls.length === 1) {
        return Promise.resolve(
          new Response("", {
            status: 302,
            headers: {
              location: "/next?b=2&utm_source=rss&a=1",
            },
          }),
        );
      }

      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    const result = await fetchWithSafeArticleRedirects(
      "https://93.184.216.34/article?utm_source=start",
      { method: "GET" },
      { fetchImpl },
    );

    assert.equal(result.status, 200);
    assert.deepEqual(requestedUrls, [
      "https://93.184.216.34/article",
      "https://93.184.216.34/next?a=1&b=2",
    ]);
  });

  void it("rejects redirect chains that exceed maxRedirects", async () => {
    const fetchImpl: typeof fetch = () => {
      return Promise.resolve(
        new Response("", {
          status: 302,
          headers: { location: "/again" },
        }),
      );
    };

    await assert.rejects(
      fetchWithSafeArticleRedirects(
        "https://93.184.216.34/article",
        { method: "GET" },
        { fetchImpl, maxRedirects: 1 },
      ),
      (error: unknown) => {
        assert.ok(error instanceof UnsafeArticleUrlError);
        assert.equal(error.reason, "too_many_redirects");
        return true;
      },
    );
  });

  void it("rejects redirect targets that resolve to blocked destinations", async () => {
    let calls = 0;

    const fetchImpl: typeof fetch = () => {
      calls += 1;

      return Promise.resolve(
        new Response("", {
          status: 302,
          headers: { location: "http://localhost/internal" },
        }),
      );
    };

    await assert.rejects(
      fetchWithSafeArticleRedirects(
        "https://93.184.216.34/article",
        { method: "GET" },
        { fetchImpl },
      ),
      (error: unknown) => {
        assert.ok(error instanceof UnsafeArticleUrlError);
        assert.equal(error.reason, "host_is_local");
        return true;
      },
    );

    assert.equal(calls, 1);
  });
});
