import { Activity } from 'lucide-react';
import {
  buildChecks,
  buildResultSummary,
  cacheTone,
  cacheUsageRate,
  channelLabel,
  channelTone,
  clamp,
  compact,
  extractMetrics,
  extractTokenAudit,
  formatCurrency,
  formatMs,
  formatNumber,
  formatPercent,
  formatScore,
  formatTime,
  latencyTone,
  parseRaw,
  prettyRaw,
  ratioTone,
  speedTone,
  stepLabel,
  usageChartData,
  verdictClass,
  verdictLabel,
  verdictTone
} from './resultUtils';
import { StatusPill } from './StatusPill';
import type { CheckState, MetricTone, Task, TokenAuditSummary } from './types';

export function TaskDetail({ task }: { task: Task | null }) {
  if (!task) {
    return (
      <aside className="grid min-h-96 place-items-center rounded-lg border border-white/10 bg-white/5 p-6 text-sm text-white/45 backdrop-blur-xl">
        选择一条任务查看结果。
      </aside>
    );
  }

  const raw = parseRaw(task.raw_result_json);
  const summary = buildResultSummary(task, raw);
  const metrics = extractMetrics(raw);
  const tokenAudit = extractTokenAudit(raw);
  const hasUsage = tokenAudit.rows.length > 0 || usageChartData(metrics).some((item) => item.value > 0);
  const cacheRate = tokenAudit.cacheHitRate ?? cacheUsageRate(raw);
  const checks = buildChecks(task, raw, summary);
  const modelMatches = summary.responseModel !== '-' && summary.responseModel === summary.expectedModel;
  const anomalyText = tokenAudit.anomalies.length > 0
    ? tokenAudit.anomalies.join('、')
    : (tokenAudit.overallRatio ?? 0) > 1.2
      ? '成本倍率偏高'
      : '';
  const scoreFullCount = summary.scoreRows.filter((row) => row.value >= row.max).length;
  const hasTaskError = Boolean(task.error_message?.trim());

  return (
    <aside className="flex flex-col rounded-lg border border-white/10 bg-white/5 backdrop-blur-xl">
      <div className="shrink-0 border-b border-white/10 p-3">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/45">
              <Activity className="h-4 w-4 text-blue-300" />
              <span className="rounded-md border border-blue-400/20 bg-blue-500/10 px-1.5 py-0.5 text-blue-200">{task.model}</span>
              <span>{formatTime(task.created_at)}</span>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <StatusPill status={task.status} />
              <div className={`rounded-md border px-2.5 py-1 text-xs ${verdictClass(summary.verdict)}`}>{verdictLabel(summary.verdict)}</div>
              <CheckBadge
                state={summary.checkTokenUsage ? (hasUsage ? 'pass' : 'warning') : 'unknown'}
                value={summary.checkTokenUsage ? (hasUsage ? `缓存 ${formatPercent(cacheRate)}` : '审计等待') : '未审计'}
              />
            </div>
          </div>

          <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)_max-content_max-content] md:items-center">
            <h2 className="min-w-0 truncate text-lg font-semibold text-white" title={task.remark}>{task.remark}</h2>
            <p className="min-w-0 truncate text-sm text-white/45" title={task.url}>{task.url}</p>
            <span
              className={`min-w-0 whitespace-nowrap rounded-md border px-2 py-1 font-mono text-xs ${task.cctest_task_id ? 'border-blue-500/25 bg-blue-500/10 text-blue-200' : 'border-white/10 bg-black/20 text-white/45'}`}
              title={task.cctest_task_id ?? undefined}
            >
              任务ID {task.cctest_task_id ? compact(task.cctest_task_id) : '-'}
            </span>
            <span className="justify-self-start rounded-md border border-white/10 bg-black/20 px-2.5 py-1 font-mono text-xs text-white/45 md:justify-self-end">
              #{task.id}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        <section className="rounded-lg border border-white/10 bg-black/20 p-3">
          {hasTaskError && (
            <TaskErrorBlock errorMessage={task.error_message ?? ''} />
          )}
          <div className="grid gap-3 2xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
            <ScoreHero
              checks={checks}
              score={summary.score}
              scoreFullCount={scoreFullCount}
              scoreRows={summary.scoreRows}
              step={stepLabel(summary.stepName)}
              verdict={summary.verdict}
            />

            <div className="grid content-start gap-3">
              <MetricGroup title="模型与通道">
                <Metric label="期望模型" value={summary.expectedModel} tone="neutral" />
                <Metric label="响应模型" value={summary.responseModel} tone={modelMatches ? 'good' : summary.responseModel === '-' ? 'neutral' : 'bad'} detail={modelMatches ? '匹配' : summary.expectedModel} />
                <Metric label="流式渠道" value={channelLabel(summary.streamChannel)} tone={channelTone(summary.streamChannel)} />
                <Metric label="非流式渠道" value={channelLabel(summary.nonStreamChannel)} tone={summary.nonStreamChannel === '-' ? 'neutral' : channelTone(summary.nonStreamChannel)} />
              </MetricGroup>

              <MetricGroup title="性能">
                <Metric label="延迟" value={formatMs(summary.metrics.latencyMs)} tone={latencyTone(summary.metrics.latencyMs)} />
                <Metric label="TTFB" value={formatMs(summary.metrics.ttfbMs)} tone={latencyTone(summary.metrics.ttfbMs)} />
                <Metric label="输出速度" value={formatNumber(summary.metrics.tokensPerSec, ' tok/s')} tone={speedTone(summary.metrics.tokensPerSec)} />
              </MetricGroup>

              <MetricGroup title="Token 与成本">
                <Metric label="缓存率" value={formatPercent(cacheRate)} tone={cacheTone(cacheRate)} detail={summary.checkTokenUsage ? 'Token 审计' : '未审计'} />
                <Metric label="成本倍率" value={tokenAudit.overallRatio === undefined ? '-' : `${formatNumber(tokenAudit.overallRatio)}x`} tone={ratioTone(tokenAudit.overallRatio)} />
                <Metric label="输入 Tokens" value={formatNumber(summary.metrics.inputTokens)} tone="info" />
                <Metric label="输出 Tokens" value={formatNumber(summary.metrics.outputTokens)} tone="info" />
                <Metric label="总成本" value={formatCurrency(tokenAudit.totalCost)} tone={ratioTone(tokenAudit.overallRatio)} />
                <Metric label="基线成本" value={formatCurrency(tokenAudit.baselineTotalCost)} tone="neutral" />
                <Metric label="Token 审计" value={summary.checkTokenUsage ? (hasUsage ? '已返回' : '等待报告') : '未审查'} tone={summary.checkTokenUsage ? (hasUsage ? 'good' : 'warn') : 'neutral'} />
              </MetricGroup>

              <MetricGroup title="异常与追踪">
                {anomalyText && <Metric label="成本异常" value={anomalyText} tone="high" />}
                {summary.tokenAuditError && <Metric label="审计错误" value={summary.tokenAuditError} tone="bad" />}
              </MetricGroup>
            </div>
          </div>

          <details className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <summary className="cursor-pointer text-sm font-medium text-white">原始 JSON</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-black/30 p-3 text-xs text-white/55">{prettyRaw(task.raw_result_json)}</pre>
          </details>
        </section>

        <section className="rounded-xl border border-[rgba(211,220,255,0.14)] bg-[rgba(9,9,13,0.4)] p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Token 用量审计报告</h3>
              <p className="mt-1 text-[11px] text-white/30">总体 0.1~0.2 偏差属于正常情况</p>
            </div>
            <CheckBadge state={summary.checkTokenUsage ? (hasUsage ? 'pass' : 'warning') : 'unknown'} value={summary.checkTokenUsage ? (hasUsage ? '已返回' : '等待报告') : '未审查'} />
          </div>
          <div>
            {summary.checkTokenUsage ? (
              hasUsage ? (
                <TokenAuditReport audit={tokenAudit} expectedModel={summary.expectedModel} fallbackUsageData={usageChartData(metrics)} />
              ) : (
                <div className="grid h-full min-h-56 place-items-center rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-6 text-center text-sm text-amber-100">
                  暂未返回 Token 用量审计报告。
                </div>
              )
            ) : (
              <div className="grid h-full min-h-56 place-items-center rounded-md border border-white/10 bg-white/5 px-3 py-6 text-center text-sm text-white/45">
                未开启 Token 用量审计。
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

function TaskErrorBlock({ errorMessage }: { errorMessage: string }) {
  return (
    <div className="mb-3 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-red-100">
      <div className="mb-2 text-xs font-medium text-red-200/70">任务错误信息</div>
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{errorMessage}</div>
    </div>
  );
}

function ScoreHero({
  checks,
  score,
  scoreFullCount,
  scoreRows,
  step,
  verdict
}: {
  checks: { label: string; state: CheckState; value: string }[];
  score?: number;
  scoreFullCount: number;
  scoreRows: { key: string; label: string; value: number; max: number }[];
  step: string;
  verdict: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="grid gap-4 xl:grid-cols-[168px_minmax(0,1fr)] 2xl:grid-cols-1">
        <ScoreDial score={score} verdict={verdict} />
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-white">检测评分</h3>
            <span className="truncate text-xs text-white/35">{step}</span>
          </div>
          <div className="space-y-2">
            {scoreRows.map((row) => (
              <ScoreRow key={row.key} label={row.label} max={row.max} value={row.value} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="总体判定" value={verdictLabel(verdict)} tone={verdictTone(verdict)} />
        <Metric label="满分项" value={`${scoreFullCount}/${scoreRows.length}`} tone={scoreFullCount === scoreRows.length ? 'good' : scoreFullCount > 0 ? 'warn' : 'bad'} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {checks.map((check) => (
          <StatusTip key={check.label} label={check.label} state={check.state} value={check.value} />
        ))}
      </div>
    </div>
  );
}

function ScoreDial({ score, verdict }: { score?: number; verdict: string }) {
  const value = clamp(score ?? 0, 0, 100);
  const color = value >= 100 ? '#34d399' : value >= 70 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-md border border-white/10 bg-black/20 p-4">
      <div
        className="grid h-36 w-36 place-items-center rounded-full"
        style={{ background: `conic-gradient(${color} ${value * 3.6}deg, rgba(255,255,255,.1) 0deg)` }}
      >
        <div className="grid h-24 w-24 place-items-center rounded-full bg-[#08051b]">
          <div className="text-center">
            <div className="text-4xl font-semibold text-white">{formatScore(value)}</div>
            <div className="text-xs text-white/35">分数</div>
          </div>
        </div>
      </div>
      <div className={`mt-3 rounded-md border px-3 py-1 text-xs ${verdictClass(verdict)}`}>{verdictLabel(verdict)}</div>
    </div>
  );
}

function ScoreRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  const color = value >= max ? '#34d399' : value > 0 ? '#f59e0b' : '#ef4444';
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-white/70">{label}</span>
        <span className="font-mono text-white/45">{value}/{max}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function Metric({ detail, label, tone = 'neutral', value }: { detail?: string; label: string; tone?: MetricTone; value: string }) {
  return (
    <div className={`rounded-md border p-2.5 ${metricToneClass(tone)}`}>
      <div className="text-xs text-current/60">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-current">{value}</div>
      {detail && <div className="mt-1 truncate text-[11px] text-current/45">{detail}</div>}
    </div>
  );
}

function MetricGroup({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-3 text-xs font-medium text-white/55">{title}</div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(136px,1fr))]">
        {children}
      </div>
    </div>
  );
}

function metricToneClass(tone: MetricTone) {
  const classes: Record<MetricTone, string> = {
    good: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    warn: 'border-yellow-500/25 bg-yellow-500/10 text-yellow-200',
    high: 'border-orange-500/25 bg-orange-500/10 text-orange-200',
    bad: 'border-red-500/25 bg-red-500/10 text-red-200',
    info: 'border-blue-500/25 bg-blue-500/10 text-blue-200',
    neutral: 'border-white/10 bg-black/20 text-white/75'
  };
  return classes[tone];
}

function CheckBadge({ state, value }: { state: CheckState; value: string }) {
  const className = checkStateClass(state);
  return <span className={`rounded-md border px-2 py-1 text-xs ${className}`}>{value}</span>;
}

function StatusTip({ label, state, value }: { label: string; state: CheckState; value: string }) {
  return (
    <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${checkStateClass(state)}`} title={`${label}: ${value}`}>
      <span className="text-current/70">{label}</span>
      <span className="font-medium text-current">{value}</span>
    </span>
  );
}

function checkStateClass(state: CheckState) {
  return state === 'pass'
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
    : state === 'fail'
      ? 'border-red-500/25 bg-red-500/10 text-red-300'
      : state === 'warning'
        ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
        : 'border-white/15 bg-white/5 text-white/45';
}

const defaultReferenceRows = [
  { i: 3, o: 149, cw: 6364, cr: 11317 },
  { i: 1, o: 118, cw: 328, cr: 17681 },
  { i: 1, o: 681, cw: 142, cr: 18009 },
  { i: 1, o: 287, cw: 735, cr: 18151 },
  { i: 1, o: 558, cw: 341, cr: 18886 },
  { i: 1, o: 440, cw: 612, cr: 19227 },
  { i: 1, o: 2088, cw: 494, cr: 19839 },
  { i: 1, o: 729, cw: 2144, cr: 20333 },
  { i: 1, o: 105, cw: 781, cr: 22477 },
  { i: 1, o: 94, cw: 863, cr: 23258 },
  { i: 1, o: 448, cw: 390, cr: 24121 }
];

const sonnetReferenceRows = [
  { i: 3, o: 123, cw: 6393, cr: 11200 },
  { i: 1, o: 110, cw: 324, cr: 17593 },
  { i: 1, o: 87, cw: 134, cr: 17917 },
  { i: 1, o: 311, cw: 727, cr: 18051 },
  { i: 1, o: 681, cw: 333, cr: 18778 },
  { i: 1, o: 882, cw: 604, cr: 19111 },
  { i: 1, o: 708, cw: 486, cr: 19715 },
  { i: 1, o: 656, cw: 2136, cr: 20201 },
  { i: 1, o: 95, cw: 773, cr: 22337 },
  { i: 1, o: 89, cw: 863, cr: 23109 },
  { i: 1, o: 383, cw: 390, cr: 23973 }
];

const opusReferenceRows = [
  { i: 0, o: 152, cw: 20655, cr: 15616 },
  { i: 1, o: 163, cw: 422, cr: 24244 },
  { i: 1, o: 767, cw: 169, cr: 24666 },
  { i: 1, o: 351, cw: 841, cr: 24835 },
  { i: 1, o: 612, cw: 399, cr: 25676 },
  { i: 1, o: 666, cw: 695, cr: 26075 },
  { i: 1, o: 1413, cw: 591, cr: 26770 },
  { i: 1, o: 817, cw: 2460, cr: 27361 },
  { i: 1, o: 133, cw: 938, cr: 29821 },
  { i: 1, o: 111, cw: 1157, cr: 30759 },
  { i: 1, o: 386, cw: 420, cr: 31916 }
];

function TokenAuditReport({
  audit,
  expectedModel,
  fallbackUsageData
}: {
  audit: TokenAuditSummary;
  expectedModel: string;
  fallbackUsageData: { name: string; value: number; color: string }[];
}) {
  if (audit.rows.length === 0) {
    return <CacheBar data={fallbackUsageData} />;
  }

  const maxCost = Math.max(...audit.rows.map((row) => Math.max(row.cost, row.baselineCost)), 0);
  const chartWidth = Math.max(660, audit.rows.length * 60 + 100);
  const legendX = chartWidth - 100;
  const referenceRows = tokenReferenceRows(expectedModel);

  return (
    <div>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5">
        <svg className="mt-0.5 size-4 shrink-0 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
        <p className="text-[11px] leading-relaxed text-amber-200/70">
          实际花费 = 本报告倍率 x 您所用平台的倍率（单价）。差异可能来自缓存命中异常或平台暗改 Token 数量。
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <TokenAuditStat label="官方基线" value={formatCurrency(audit.baselineTotalCost)} />
        <TokenAuditStat label="实际消耗" value={formatCurrency(audit.totalCost)} />
        <TokenAuditStat label="倍率" value={formatRatio(audit.overallRatio)} valueClassName={ratioSummaryClass(audit.overallRatio)} />
        <TokenAuditStat label="缓存命中率" value={formatPercent(audit.cacheHitRate)} valueClassName={cacheHitClass(audit.cacheHitRate)} />
      </div>

      <div className="mt-3">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${auditStateClass(audit.overallRatio)}`}>
          {auditStateLabel(audit.overallRatio)}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <svg viewBox={`0 0 ${chartWidth} 160`} className="w-full" style={{ minWidth: 400 }}>
          {audit.rows.map((row, index) => {
            const actualHeight = maxCost > 0 ? (row.cost / maxCost) * 100 : 0;
            const baselineHeight = maxCost > 0 ? (row.baselineCost / maxCost) * 100 : 0;
            return (
              <g key={row.round} transform={`translate(${60 * index}, 0)`}>
                <rect x={6} y={120 - baselineHeight} width={18} height={baselineHeight} rx={3} fill="rgba(255,255,255,0.15)" />
                <rect x={26} y={120 - actualHeight} width={18} height={actualHeight} rx={3} fill={ratioBarColor(row.ratio)} />
                <text x={25} y={140} textAnchor="middle" fill="#5c6670" fontSize={10}>
                  R{row.round}
                </text>
                <text x={25} y={155} textAnchor="middle" fill={ratioBarColor(row.ratio)} fontSize={9} fontWeight="bold">
                  {formatPlainRatio(row.ratio)}x
                </text>
              </g>
            );
          })}
          <g transform={`translate(${legendX}, 10)`}>
            <rect width={10} height={10} rx={2} fill="rgba(255,255,255,0.15)" />
            <text x={14} y={9} fill="#5c6670" fontSize={9}>官方基线</text>
            <rect y={16} width={10} height={10} rx={2} fill="#34d399" />
            <text x={14} y={25} fill="#5c6670" fontSize={9}>实际消耗</text>
          </g>
        </svg>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#5c6670]">
              <th className="py-1.5 pr-2 text-left">#</th>
              <th className="px-1 py-1.5 text-right">输入</th>
              <th className="px-1 py-1.5 text-right">输出</th>
              <th className="px-1 py-1.5 text-right">缓存创建</th>
              <th className="px-1 py-1.5 text-right">缓存读取</th>
              <th className="py-1.5 pl-2 text-right">实际消耗</th>
              <th className="py-1.5 pl-2 text-right">倍率</th>
            </tr>
          </thead>
          <tbody>
            {audit.rows.map((row) => {
              const reference = referenceRows[row.round - 1];
              return (
                <tr key={row.round} className="border-t border-white/5">
                  <td className="py-1.5 pr-2 text-white/50">{row.round}</td>
                  <td className="px-1 py-1.5 text-right"><ComparedTokenValue reference={reference?.i} value={row.inputTokens} /></td>
                  <td className="px-1 py-1.5 text-right"><ComparedTokenValue reference={reference?.o} value={row.outputTokens} /></td>
                  <td className="px-1 py-1.5 text-right"><ComparedTokenValue reference={reference?.cw} value={row.cacheCreationInputTokens} /></td>
                  <td className="px-1 py-1.5 text-right"><ComparedTokenValue reference={reference?.cr} value={row.cacheReadInputTokens} /></td>
                  <td className="py-1.5 pl-2 text-right font-mono text-white">${row.cost.toFixed(4)}</td>
                  <td className={`py-1.5 pl-2 text-right font-mono font-bold ${ratioRowClass(row.ratio)}`}>{formatPlainRatio(row.ratio)}x</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TokenAuditStat({ label, value, valueClassName = 'text-white' }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <p className="text-[11px] text-[#5c6670]">{label}</p>
      <p className={`mt-0.5 font-mono text-sm ${valueClassName}`}>{value}</p>
    </div>
  );
}

function ComparedTokenValue({ reference, value }: { reference?: number; value: number }) {
  if (reference === undefined || reference === 0) {
    return <span className="font-mono text-white/70">{value}</span>;
  }
  const diff = Math.round(((value - reference) / reference) * 100);
  if (Math.abs(diff) < 5) {
    return <span className="font-mono text-white/70">{value}</span>;
  }

  const diffClass = diff > 20 ? 'text-red-400' : diff < -20 ? 'text-emerald-400' : 'text-white/40';
  return (
    <>
      <span className="font-mono text-white/70">{value}</span>
      <span className={`ml-0.5 text-[10px] ${diffClass}`}>
        ({diff > 0 ? '↑' : '↓'}{Math.abs(diff)}%)
      </span>
    </>
  );
}

function tokenReferenceRows(model: string) {
  const lower = model.toLowerCase();
  if (lower.includes('sonnet')) {
    return sonnetReferenceRows;
  }
  if (lower.includes('opus-4-7') || lower.includes('opus-4.7') || lower.includes('opus-4-8') || lower.includes('opus-4.8')) {
    return opusReferenceRows;
  }
  return defaultReferenceRows;
}

function auditStateLabel(value?: number) {
  if (value === undefined) return '等待报告';
  if (value <= 1.2) return '用量正常';
  if (value <= 1.5) return '用量偏高';
  return '用量异常';
}

function auditStateClass(value?: number) {
  if (value === undefined) return 'bg-white/10 text-white/60';
  if (value <= 1.2) return 'bg-emerald-400/10 text-emerald-400';
  if (value <= 1.5) return 'bg-amber-400/10 text-amber-400';
  return 'bg-red-400/10 text-red-400';
}

function ratioSummaryClass(value?: number) {
  if (value === undefined) return 'text-white';
  if (value <= 1.2) return 'font-bold text-emerald-400';
  if (value <= 1.5) return 'font-bold text-amber-400';
  return 'font-bold text-red-400';
}

function ratioRowClass(value?: number) {
  if (value === undefined) return 'text-white';
  if (value <= 1.2) return 'text-emerald-400';
  if (value <= 2) return 'text-amber-400';
  return 'text-red-400';
}

function ratioBarColor(value?: number) {
  if (value === undefined) return '#34d399';
  if (value <= 1.2) return '#34d399';
  if (value <= 2) return '#fbbf24';
  return '#f87171';
}

function cacheHitClass(value?: number) {
  if (value === undefined) return 'text-white';
  if (value >= 60) return 'text-emerald-400';
  if (value >= 30) return 'text-amber-400';
  return 'text-red-400';
}

function formatRatio(value?: number) {
  if (value === undefined) return '-';
  return `${formatPlainRatio(value)}x`;
}

function formatPlainRatio(value: number) {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function CacheBar({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <div>
      <div className="flex h-9 overflow-hidden rounded-md border border-white/10 bg-black/30">
        {data.filter((item) => item.value > 0).map((item) => (
          <div
            key={item.name}
            style={{ width: `${Math.max(5, (item.value / total) * 100)}%`, backgroundColor: item.color }}
            className="transition-all"
            title={`${item.name}: ${item.value}`}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {data.map((item) => (
          <div key={item.name} className="flex items-center gap-2 text-xs text-white/55">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
            <span>{item.name}</span>
            <span className="ml-auto text-white/35">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
