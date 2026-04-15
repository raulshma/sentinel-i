export type ProcessingEventType = "start" | "end" | "checkpoint" | "error";

export interface ProcessingTraceContext {
  runId?: string;
  jobId?: string;
  traceId?: string;
  articleId?: string;
  feedUrl?: string;
  attempt?: number;
}
