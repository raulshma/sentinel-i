export interface CrawlLikePayload {
  content?: unknown;
  text?: unknown;
  markdown?: unknown;
  data?: {
    content?: unknown;
    text?: unknown;
    markdown?: unknown;
  };
}

export const DEFAULT_SENTINEL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";

export const normalizeWhitespace = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

export const stripHtmlToText = (html: string): string => {
  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");

  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");

  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  return normalizeWhitespace(decoded);
};

export const extractBestArticleText = (
  payload: CrawlLikePayload,
  maxLength: number,
): string | null => {
  const candidates: unknown[] = [
    payload.content,
    payload.text,
    payload.markdown,
    payload.data?.content,
    payload.data?.text,
    payload.data?.markdown,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const cleaned = stripHtmlToText(candidate);

    if (cleaned.length > 0) {
      return cleaned.slice(0, maxLength);
    }
  }

  return null;
};
