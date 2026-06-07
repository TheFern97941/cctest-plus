export type Model = {
  id: string;
  label: string;
};

export type Task = {
  id: number;
  remark: string;
  url: string;
  target_api_key_masked: string;
  model: string;
  check_token_usage: boolean;
  cctest_task_id?: string | null;
  status: TaskStatus;
  verdict?: string | null;
  score?: number | null;
  failure_type: string;
  error_message?: string | null;
  raw_result_json?: string | null;
  created_at: string;
  submitted_at?: string | null;
  last_polled_at?: string | null;
  completed_at?: string | null;
  timeout_at: string;
};

export type TaskStatus = 'pending' | 'submitted' | 'polling' | 'succeeded' | 'partial_failed' | 'failed' | 'timeout';

export type TaskListResponse = {
  items: Task[];
  total: number;
  page: number;
  page_size: number;
};

export type Health = {
  ok: boolean;
  cctest_configured: boolean;
  poll_interval_secs: number;
};

export type ExtractedMetrics = {
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheCreate?: number;
  };
  auditRows: Record<string, unknown>[];
};

export type TokenAuditRow = {
  round: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cost: number;
  baselineCost: number;
  ratio: number;
};

export type TokenAuditSummary = {
  rows: TokenAuditRow[];
  totalCost?: number;
  baselineTotalCost?: number;
  overallRatio?: number;
  cacheHitRate?: number;
  anomalies: string[];
};

export type ResultSummary = {
  verdict: string;
  score?: number;
  stepName: string;
  checkTokenUsage: boolean;
  expectedModel: string;
  responseModel: string;
  streamChannel: string;
  nonStreamChannel: string;
  tokenAudit: unknown;
  tokenAuditError: string;
  metrics: {
    latencyMs?: number;
    ttfbMs?: number;
    tokensPerSec?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  scoreRows: { key: string; label: string; value: number; max: number }[];
};

export type CheckState = 'pass' | 'fail' | 'warning' | 'unknown';
export type MetricTone = 'good' | 'warn' | 'high' | 'bad' | 'info' | 'neutral';

export const finalStatuses = new Set<TaskStatus>(['succeeded', 'partial_failed', 'failed', 'timeout']);
