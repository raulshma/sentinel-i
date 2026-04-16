import { useEffect } from "react";
import { MapPin, Sparkles, X } from "lucide-react";

import type { ArticleAddedEvent } from "../hooks/useMapData";
import { CATEGORY_COLORS } from "../types/map";

const TOAST_LIFETIME_MS = 5_000;

export type ArticleToastItem = ArticleAddedEvent & {
  toastId: string;
};

interface ArticleToastStackProps {
  toasts: ArticleToastItem[];
  onDismiss: (toastId: string) => void;
}

function formatPublishedAt(publishedAt: string): string {
  const publishedMs = Date.parse(publishedAt);
  if (Number.isNaN(publishedMs)) return "just now";

  const deltaMs = Date.now() - publishedMs;
  if (deltaMs < 60_000) return "just now";

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ArticleToastCard({
  toast,
  onDismiss,
}: {
  toast: ArticleToastItem;
  onDismiss: (toastId: string) => void;
}) {
  useEffect(() => {
    const timeout = setTimeout(() => {
      onDismiss(toast.toastId);
    }, TOAST_LIFETIME_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [toast.toastId, onDismiss]);

  return (
    <article
      className="pointer-events-auto glass-panel animate-in fade-in-0 slide-in-from-right-3 w-full rounded-xl border border-emerald-300/20 bg-slate-900/85 px-3 py-2.5"
      role="status"
      aria-live="polite"
      aria-label={`New article: ${toast.headline}`}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] uppercase tracking-wider text-emerald-300">
          <Sparkles className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">New article added</span>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.toastId)}
          className="rounded-md p-0.5 text-slate-400 transition-smooth hover:bg-white/10 hover:text-white"
          aria-label="Dismiss new article notification"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <p className="line-clamp-2 text-[13px] font-medium leading-snug text-white">
        {toast.headline}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-300">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: CATEGORY_COLORS[toast.category] }}
            aria-hidden="true"
          />
          {toast.category}
        </span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          {toast.location}
        </span>
        <span className="text-slate-400">
          {formatPublishedAt(toast.publishedAt)}
        </span>
      </div>
    </article>
  );
}

export function ArticleToastStack({
  toasts,
  onDismiss,
}: ArticleToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute bottom-3 right-3 z-20 flex w-[min(92vw,360px)] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <ArticleToastCard
          key={toast.toastId}
          toast={toast}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
