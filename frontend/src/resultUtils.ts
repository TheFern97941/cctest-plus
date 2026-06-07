import type { CheckState, ExtractedMetrics, MetricTone, ResultSummary, Task, TokenAuditRow, TokenAuditSummary } from './types';

export function parseRaw(raw?: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function buildResultSummary(task: Task, raw: unknown): ResultSummary {
  const object = asRecord(raw);
  const metrics = asRecord(object?.metrics);
  const scores = asRecord(object?.scores);
  const scoreRows = [
    { key: 'tag_check', label: '标签检测', value: numberValue(scores?.tag_check), max: 10 },
    { key: 'structure', label: '结构检测', value: numberValue(scores?.structure), max: 20 },
    { key: 'behavior', label: '行为检测', value: numberValue(scores?.behavior), max: 30 },
    { key: 'signature_proto', label: '协议签名', value: numberValue(scores?.signature_proto), max: 30 },
    { key: 'multimodal', label: '多模态', value: numberValue(scores?.multimodal), max: 10 }
  ];

  return {
    verdict: stringValue(object?.verdictKey) || task.verdict || '-',
    score: numberOrUndefined(object?.total) ?? task.score ?? undefined,
    stepName: stringValue(object?.stepName) || task.status,
    checkTokenUsage: booleanOrUndefined(object?.checkTokenUsage) ?? task.check_token_usage,
    expectedModel: stringValue(object?.expectedModel) || task.model,
    responseModel: stringValue(object?.responseModel) || '-',
    streamChannel: stringValue(object?.streamChannel) || '-',
    nonStreamChannel: stringValue(object?.nonStreamChannel) || '-',
    tokenAudit: object?.tokenAudit,
    tokenAuditError: stringValue(object?.tokenAuditError),
    metrics: {
      latencyMs: numberOrUndefined(metrics?.latencyMs),
      ttfbMs: numberOrUndefined(metrics?.ttfbMs),
      tokensPerSec: numberOrUndefined(metrics?.tokensPerSec),
      inputTokens: numberOrUndefined(metrics?.inputTokens),
      outputTokens: numberOrUndefined(metrics?.outputTokens)
    },
    scoreRows
  };
}

export function extractMetrics(raw: unknown): ExtractedMetrics {
  const values = flattenValues(raw);
  const numberFor = (...patterns: string[]) => {
    for (const [key, value] of values) {
      if (typeof value === 'number' && patterns.some((pattern) => key.toLowerCase().includes(pattern))) {
        return value;
      }
    }
    return undefined;
  };
  return {
    usage: {
      input: numberFor('input_tokens', 'inputtokens', 'input token'),
      output: numberFor('output_tokens', 'outputtokens', 'output token'),
      cacheRead: numberFor('cache_read', 'cacheread', 'cache read'),
      cacheCreate: numberFor('cache_creation', 'cachecreate', 'cache create', 'cache_creation_input_tokens')
    },
    auditRows: []
  };
}

export function extractTokenAudit(raw: unknown): TokenAuditSummary {
  const object = asRecord(raw);
  const audit = asRecord(object?.tokenAudit);
  const rows = Array.isArray(audit?.rows)
    ? audit.rows.map(parseTokenAuditRow).filter((row): row is TokenAuditRow => row !== null)
    : [];

  return {
    rows,
    totalCost: numberOrUndefined(audit?.totalCost),
    baselineTotalCost: numberOrUndefined(audit?.baselineTotalCost),
    overallRatio: numberOrUndefined(audit?.overallRatio),
    cacheHitRate: numberOrUndefined(audit?.cacheHitRate),
    anomalies: Array.isArray(audit?.anomalies) ? audit.anomalies.filter((item): item is string => typeof item === 'string') : []
  };
}

export function usageChartData(metrics: ExtractedMetrics) {
  return [
    { name: '输入', value: metrics.usage?.input ?? 0, color: '#60a5fa' },
    { name: '输出', value: metrics.usage?.output ?? 0, color: '#34d399' },
    { name: '缓存读取', value: metrics.usage?.cacheRead ?? 0, color: '#a78bfa' },
    { name: '缓存创建', value: metrics.usage?.cacheCreate ?? 0, color: '#f59e0b' }
  ];
}

export function cacheUsageRate(raw: unknown) {
  const values = flattenValues(raw);
  for (const [key, value] of values) {
    const normalized = key.toLowerCase();
    if (
      typeof value === 'number' &&
      (normalized.includes('cachehitrate') ||
        normalized.includes('cache_hit_rate') ||
        normalized.includes('cacheusagerate') ||
        normalized.includes('cache_usage_rate') ||
        normalized.includes('cache_rate'))
    ) {
      return value <= 1 ? value * 100 : value;
    }
  }

  const metrics = extractMetrics(raw);
  const input = metrics.usage?.input ?? 0;
  const output = metrics.usage?.output ?? 0;
  const cacheRead = metrics.usage?.cacheRead ?? 0;
  const cacheCreate = metrics.usage?.cacheCreate ?? 0;
  const total = input + output + cacheRead + cacheCreate;
  if (total <= 0) {
    return undefined;
  }
  return (cacheRead / total) * 100;
}

export function buildChecks(task: Task, raw: unknown, summary: ResultSummary) {
  const statusState = task.status === 'succeeded' ? 'pass' : task.status === 'partial_failed' ? 'warning' : finalStatusesForChecks.has(task.status) ? 'fail' : 'unknown';
  const hasUsage = usageChartData(extractMetrics(raw)).some((item) => item.value > 0);
  return [
    { label: '总体判定', state: statusState, value: verdictLabel(summary.verdict || task.status) },
    { label: 'Token 用量审计', state: summary.checkTokenUsage ? (hasUsage ? 'pass' : 'warning') : 'unknown', value: summary.checkTokenUsage ? (hasUsage ? '已返回' : '未返回') : '未开启' },
    { label: '目标 API Key', state: task.failure_type === 'target_api_key_error' ? 'fail' : 'unknown', value: task.failure_type === 'target_api_key_error' ? '异常' : '待判定' },
    { label: 'CCTest 调用', state: task.failure_type === 'cctest_key_error' || task.failure_type === 'cctest_quota_error' ? 'fail' : 'pass', value: failureLabel(task.failure_type) }
  ] as { label: string; state: CheckState; value: string }[];
}

export function formatScore(score?: number | null) {
  if (score === undefined || score === null) return '-';
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

export function formatMs(value?: number) {
  if (value === undefined) return '-';
  return `${Math.round(value)} ms`;
}

export function formatNumber(value?: number, suffix = '') {
  if (value === undefined) return '-';
  return `${Number.isInteger(value) ? value.toLocaleString('zh-CN') : value.toFixed(1)}${suffix}`;
}

export function formatCurrency(value?: number) {
  if (value === undefined) return '-';
  return `$${value.toFixed(4)}`;
}

export function formatTooltipValue(value?: number, suffix = '') {
  if (value === undefined) return '-';
  if (suffix) {
    return `${value.toFixed(2)}${suffix}`;
  }
  if (Math.abs(value) < 1 && value !== 0) {
    return value.toFixed(4);
  }
  return Number.isInteger(value) ? value.toLocaleString('zh-CN') : value.toFixed(2);
}

export function formatPercent(value?: number) {
  if (value === undefined) return '-';
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function compactNumber(value: number) {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(1)}万`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}k`;
  }
  return String(value);
}

export function ratioColor(value: number) {
  if (value >= 2) return '#ef4444';
  if (value > 1.2) return '#f59e0b';
  return '#34d399';
}

export function cacheTone(value?: number): MetricTone {
  if (value === undefined) return 'neutral';
  if (value >= 80) return 'good';
  if (value >= 50) return 'warn';
  if (value > 0) return 'high';
  return 'neutral';
}

export function ratioTone(value?: number): MetricTone {
  if (value === undefined) return 'neutral';
  if (value <= 1.2) return 'good';
  if (value <= 1.6) return 'warn';
  if (value <= 2) return 'high';
  return 'bad';
}

export function latencyTone(value?: number): MetricTone {
  if (value === undefined) return 'neutral';
  if (value <= 3000) return 'good';
  if (value <= 7000) return 'warn';
  if (value <= 10000) return 'high';
  return 'bad';
}

export function speedTone(value?: number): MetricTone {
  if (value === undefined) return 'neutral';
  if (value >= 8) return 'good';
  if (value >= 3) return 'warn';
  if (value > 0) return 'high';
  return 'bad';
}

export function channelTone(value: string): MetricTone {
  if (value === 'anthropic') return 'good';
  if (value === '-' || !value) return 'neutral';
  return 'info';
}

export function verdictTone(verdict: string): MetricTone {
  if (verdict === 'official') return 'good';
  if (verdict === 'official_flawed' || verdict === 'unofficial') return 'warn';
  if (verdict === 'reversed' || verdict === 'not_claude') return 'bad';
  return 'neutral';
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function verdictClass(verdict: string) {
  if (verdict === 'official') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
  }
  if (verdict === 'official_flawed' || verdict === 'unofficial') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
  }
  if (verdict === 'reversed' || verdict === 'not_claude') {
    return 'border-red-500/25 bg-red-500/10 text-red-300';
  }
  return 'border-white/15 bg-white/5 text-white/50';
}

export function verdictLabel(verdict: string) {
  const labels: Record<string, string> = {
    official: '官方直连',
    official_flawed: '官方有瑕疵',
    unofficial: '非官方渠道',
    reversed: '疑似逆向',
    not_claude: '非 Claude',
    succeeded: '成功',
    partial_failed: '部分异常',
    failed: '失败',
    timeout: '超时',
    polling: '检测中',
    submitted: '已提交',
    pending: '待提交'
  };
  return labels[verdict] ?? verdict ?? '-';
}

export function stepLabel(step: string) {
  const labels: Record<string, string> = {
    init: '初始化',
    submit: '提交检测',
    tag_check: '标签检测',
    structure: '结构检测',
    behavior: '行为检测',
    signature_proto: '协议签名检测',
    multimodal: '多模态检测',
    evaluate: '结果评估',
    done: '已完成'
  };
  return labels[step] ?? step;
}

export function channelLabel(channel: string) {
  const labels: Record<string, string> = {
    anthropic: 'Anthropic 官方',
    vertex: 'Vertex',
    bedrock: 'Bedrock'
  };
  return labels[channel] ?? channel;
}

export function failureLabel(failureType: string) {
  const labels: Record<string, string> = {
    none: '正常',
    cctest_key_error: 'CCTest Key 异常',
    target_api_key_error: '目标 API Key 异常',
    cctest_quota_error: 'CCTest 额度不足',
    submit_failed: '提交失败',
    poll_failed: '轮询失败',
    timeout: '超时',
    missing_usage_audit: '缺少 Token 用量审计',
    malformed_result: '结果格式异常',
    unknown: '未知异常'
  };
  return labels[failureType] ?? failureType;
}

export function formatTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function compact(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

export function prettyRaw(raw?: string | null) {
  if (!raw) return '暂无 raw result';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function parseTokenAuditRow(value: unknown): TokenAuditRow | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }
  return {
    round: numberValue(row.round),
    inputTokens: numberValue(row.input_tokens),
    outputTokens: numberValue(row.output_tokens),
    cacheCreationInputTokens: numberValue(row.cache_creation_input_tokens),
    cacheReadInputTokens: numberValue(row.cache_read_input_tokens),
    cost: numberValue(row.cost),
    baselineCost: numberValue(row.baseline_cost),
    ratio: numberValue(row.ratio)
  };
}

function flattenValues(raw: unknown, prefix = ''): [string, unknown][] {
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item, index) => flattenValues(item, `${prefix}.${index}`));
  }
  return Object.entries(raw as Record<string, unknown>).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return [[next, value] as [string, unknown], ...flattenValues(value, next)];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown) {
  return typeof value === 'number' ? value : 0;
}

function numberOrUndefined(value: unknown) {
  return typeof value === 'number' ? value : undefined;
}

function booleanOrUndefined(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

const finalStatusesForChecks = new Set(['succeeded', 'partial_failed', 'failed', 'timeout']);
