import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { TaskDetail } from './TaskDetail';
import { buildResultSummary, cacheUsageRate, clamp, formatPercent, formatScore, formatTime, parseRaw, verdictClass, verdictLabel } from './resultUtils';
import { StatusPill } from './StatusPill';
import { finalStatuses, type Health, type Model, type Task, type TaskListResponse } from './types';
import './styles.css';

const pageSize = 10;
const storageKeys = {
  auditTokenUsageReport: 'cctest-plus.auditTokenUsageReport',
  clearFormAfterSubmit: 'cctest-plus.clearFormAfterSubmit'
};

function App() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [models, setModels] = React.useState<Model[]>([]);
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [selectedTaskId, setSelectedTaskId] = React.useState<number | null>(null);
  const [selectedTask, setSelectedTask] = React.useState<Task | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [rerunningTaskId, setRerunningTaskId] = React.useState<number | null>(null);
  const [notice, setNotice] = React.useState('');
  const [auditTokenUsageReport, setAuditTokenUsageReport] = React.useState(() => readStoredBoolean(storageKeys.auditTokenUsageReport));
  const [clearFormAfterSubmit, setClearFormAfterSubmit] = React.useState(() => readStoredBoolean(storageKeys.clearFormAfterSubmit));
  const selectedTaskRef = React.useRef<Task | null>(null);
  const listPollTimerRef = React.useRef<number | null>(null);
  const listRequestInFlightRef = React.useRef(false);
  const listPageRef = React.useRef(page);
  const [form, setForm] = React.useState({
    remark: '',
    url: '',
    apiKey: '',
    models: [] as string[]
  });

  const loadHealth = React.useCallback(async () => {
    const response = await fetch('/api/health');
    setHealth(await response.json());
  }, []);

  const loadModels = React.useCallback(async () => {
    const response = await fetch('/api/models');
    const data = await response.json();
    const items = data.items ?? [];
    setModels(items);
    setForm((current) => ({
      ...current,
      models: current.models.length > 0 ? current.models : items.slice(0, 1).map((item: Model) => item.id)
    }));
  }, []);

  const clearListPollTimer = React.useCallback(() => {
    if (listPollTimerRef.current !== null) {
      window.clearTimeout(listPollTimerRef.current);
      listPollTimerRef.current = null;
    }
  }, []);

  const scheduleListPoll = React.useCallback((items: Task[]) => {
    clearListPollTimer();
    if (!items.some((task) => !finalStatuses.has(task.status))) {
      return;
    }
    listPollTimerRef.current = window.setTimeout(() => {
      void loadTasksRef.current({ keepTimer: true });
    }, 3000);
  }, [clearListPollTimer]);

  const loadTasksRef = React.useRef<(options?: { keepTimer?: boolean }) => Promise<void>>(async () => {});
  const loadTasks = React.useCallback(async (options?: { keepTimer?: boolean }) => {
    if (listRequestInFlightRef.current) {
      return;
    }
    if (!options?.keepTimer) {
      clearListPollTimer();
    }
    listRequestInFlightRef.current = true;
    try {
      const response = await fetch(`/api/tasks?page=${listPageRef.current}&page_size=${pageSize}`);
      const data: TaskListResponse = await response.json();
      const items = data.items ?? [];
      setTasks(items);
      setTotal(data.total ?? 0);
      setIsLoading(false);
      scheduleListPoll(items);
    } finally {
      listRequestInFlightRef.current = false;
    }
  }, [clearListPollTimer, scheduleListPoll]);

  const loadSelectedTask = React.useCallback(async () => {
    if (!selectedTaskId) {
      setSelectedTask(null);
      return;
    }
    const response = await fetch(`/api/tasks/${selectedTaskId}`);
    if (response.ok) {
      setSelectedTask(await response.json());
    }
  }, [selectedTaskId]);

  React.useEffect(() => {
    void loadHealth();
    void loadModels();
  }, [loadHealth, loadModels]);

  React.useEffect(() => {
    writeStoredBoolean(storageKeys.auditTokenUsageReport, auditTokenUsageReport);
  }, [auditTokenUsageReport]);

  React.useEffect(() => {
    writeStoredBoolean(storageKeys.clearFormAfterSubmit, clearFormAfterSubmit);
  }, [clearFormAfterSubmit]);

  React.useEffect(() => {
    loadTasksRef.current = loadTasks;
  }, [loadTasks]);

  React.useEffect(() => {
    listPageRef.current = page;
  }, [page]);

  React.useEffect(() => {
    selectedTaskRef.current = selectedTask;
  }, [selectedTask]);

  React.useEffect(() => {
    void loadTasks();
    return clearListPollTimer;
  }, [loadTasks, page, clearListPollTimer]);

  React.useEffect(() => {
    void loadSelectedTask();
    if (!selectedTaskId || (selectedTaskRef.current && finalStatuses.has(selectedTaskRef.current.status))) {
      return;
    }
    const timer = window.setInterval(() => {
      if (selectedTaskRef.current && finalStatuses.has(selectedTaskRef.current.status)) {
        window.clearInterval(timer);
        return;
      }
      void loadSelectedTask();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadSelectedTask, selectedTaskId]);

  async function submitTasks(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    const normalizedURL = normalizeTargetURL(form.url);
    if (normalizedURL !== form.url) {
      setForm((current) => ({ ...current, url: normalizedURL }));
    }
    if (form.models.length === 0) {
      setNotice('至少选择一个模型');
      return;
    }
    setIsSubmitting(true);
    try {
      for (const model of form.models) {
        const response = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            remark: form.remark,
            url: normalizedURL,
            apiKey: form.apiKey,
            model,
            checkTokenUsage: auditTokenUsageReport
          })
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error ?? `提交失败: ${response.status}`);
        }
      }
      setNotice(`已提交 ${form.models.length} 个任务`);
      if (clearFormAfterSubmit) {
        setForm((current) => ({ ...current, remark: '', url: '', apiKey: '' }));
      }
      listPageRef.current = 1;
      setPage(1);
      await loadTasks();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '提交失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function rerunTask(event: React.MouseEvent<HTMLButtonElement>, task: Task) {
    event.stopPropagation();
    const auditText = auditTokenUsageReport ? '开启' : '关闭';
    if (!window.confirm(`确认再来一次「${task.remark}」？\n会使用原任务的 URL、目标 API Key 和模型，并按当前开关${auditText} Token 用量审计。`)) {
      return;
    }

    setNotice('');
    setRerunningTaskId(task.id);
    try {
      const response = await fetch(`/api/tasks/${task.id}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkTokenUsage: auditTokenUsageReport })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error ?? `再来一次失败: ${response.status}`);
      }
      const created: Task = await response.json();
      setNotice(`已创建新任务 #${created.id}`);
      setSelectedTaskId(created.id);
      listPageRef.current = 1;
      setPage(1);
      await loadTasks();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '再来一次失败');
    } finally {
      setRerunningTaskId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="min-h-screen bg-cctest-base text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,197,94,0.12),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(59,130,246,0.18),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_35%)]" />
      <div className="relative mx-auto grid min-h-screen w-full max-w-[118rem] items-start gap-4 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(500px,580px)_minmax(0,1fr)] xl:grid-cols-[minmax(580px,660px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(680px,760px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-4">
          <header className="rounded-lg border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-blue-100">
                  <img src="/logo-mark.png" alt="" className="h-6 w-6 rounded-md" />
                  CCTest Plus
                </div>
                <h1 className="text-xl font-semibold tracking-normal text-white">Claude Code API 检测任务</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-white/55">
                <StatusPill status={health?.cctest_configured ? 'succeeded' : 'failed'} label={health?.cctest_configured ? 'CCTest Key 已配置' : 'CCTest Key 未配置'} />
                <span className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs">轮询 {health?.poll_interval_secs ?? 3}s</span>
              </div>
            </div>
          </header>

          <section className="rounded-lg border border-white/10 bg-white/5 p-4 shadow-glow backdrop-blur-xl">
            <form className="grid gap-3" onSubmit={submitTasks}>
              <Field label="备注">
                <input
                  className="input"
                  placeholder="填写任务备注"
                  value={form.remark}
                  onChange={(event) => setForm({ ...form, remark: event.target.value })}
                  required
                />
              </Field>
              <Field label="检测 URL">
                <input
                  className="input"
                  placeholder="https://你的中转地址"
                  value={form.url}
                  onChange={(event) => setForm({ ...form, url: event.target.value })}
                  onBlur={(event) => setForm({ ...form, url: normalizeTargetURL(event.target.value) })}
                  required
                />
              </Field>
              <Field label="目标 API Key">
                <input
                  className="input"
                  type="password"
                  placeholder="填写目标 API Key"
                  value={form.apiKey}
                  onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                  required
                />
              </Field>
              <div>
                <div className="mb-2 text-xs font-medium text-white/45">模型</div>
                <div className="flex flex-wrap gap-2">
                  {models.map((model) => {
                    const checked = form.models.includes(model.id);
                    return (
                      <label key={model.id} className={`model-chip ${checked ? 'model-chip-active' : ''}`}>
                        <input
                          className="sr-only"
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setForm((current) => ({
                              ...current,
                              models: event.target.checked ? [...current.models, model.id] : current.models.filter((id) => id !== model.id)
                            }));
                          }}
                        />
                        {model.label}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Switch
                  checked={auditTokenUsageReport}
                  label="审查 Token 用量报告"
                  onChange={setAuditTokenUsageReport}
                />
                <Switch
                  checked={clearFormAfterSubmit}
                  label="提交后清空表单"
                  onChange={setClearFormAfterSubmit}
                />
              </div>
              <button className="button-primary w-full" disabled={isSubmitting} type="submit">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                提交
              </button>
            </form>
            {notice && <div className="mt-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">{notice}</div>}
          </section>

          <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-white/10 bg-white/5 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 p-3">
              <div>
                <h2 className="text-sm font-medium text-white">任务列表</h2>
                <p className="mt-1 text-xs text-white/45">总任务数量 {total}</p>
              </div>
              <button className="button-ghost h-8 px-2.5 text-xs" onClick={() => void loadTasks()}>
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
            </div>
            <div className="min-h-0 overflow-auto">
              <table className="min-w-[680px] table-fixed text-left text-sm">
                <thead className="border-b border-white/10 text-xs text-white/35">
                  <tr>
                    <th className="px-3 py-2 font-medium">任务 / 模型</th>
                    <th className="w-28 px-3 py-2 font-medium">状态 / 判定</th>
                    <th className="w-28 px-3 py-2 font-medium">分数 / 缓存率</th>
                    <th className="w-36 px-3 py-2 font-medium">创建时间</th>
                    <th className="w-14 px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td className="px-3 py-8 text-center text-white/45" colSpan={5}>加载中</td></tr>
                  ) : tasks.length === 0 ? (
                    <tr><td className="px-3 py-8 text-center text-white/45" colSpan={5}>暂无任务</td></tr>
                  ) : (
                    tasks.map((task) => {
                      const rowRaw = parseRaw(task.raw_result_json);
                      const rowSummary = buildResultSummary(task, rowRaw);
                      const rowCacheRate = cacheUsageRate(rowRaw);
                      return (
                        <tr
                          key={task.id}
                          className={`cursor-pointer border-b border-white/5 transition hover:bg-white/[0.04] ${selectedTaskId === task.id ? 'bg-white/[0.06]' : ''}`}
                          onClick={() => setSelectedTaskId(task.id)}
                        >
                          <td className="px-3 py-2.5">
                            <div className="truncate font-medium text-white">{task.remark}</div>
                            <div className="mt-1 flex items-center gap-2 text-xs">
                              <span className="rounded-md border border-blue-400/20 bg-blue-500/10 px-1.5 py-0.5 text-blue-200">{task.model}</span>
                              <span className="truncate text-white/30">{task.target_api_key_masked}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div><StatusPill status={task.status} /></div>
                            <div className="mt-1">
                              <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${verdictClass(rowSummary.verdict)}`}>{verdictLabel(rowSummary.verdict)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="mb-1">
                              <ScoreCell score={rowSummary.score} />
                            </div>
                            <CacheRateCell value={rowCacheRate} />
                          </td>
                          <td className="px-3 py-2.5 text-xs text-white/45">{formatTime(task.created_at)}</td>
                          <td className="px-3 py-2.5">
                            <button
                              aria-label={`再来一次 ${task.remark}`}
                              className="button-ghost h-9 w-9 px-0"
                              disabled={rerunningTaskId !== null}
                              onClick={(event) => void rerunTask(event, task)}
                              type="button"
                            >
                              {rerunningTaskId === task.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between p-4 text-sm text-white/45">
              <button className="button-ghost" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                <ChevronLeft className="h-4 w-4" />
                上一页
              </button>
              <span>{page} / {pageCount}</span>
              <button className="button-ghost" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                下一页
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        </section>

        <TaskDetail
          task={selectedTask ?? tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null}
        />
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-white/45">{label}</span>
      {children}
    </label>
  );
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      aria-pressed={checked}
      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition ${checked ? 'border-blue-400/45 bg-blue-500/15 text-blue-100' : 'border-white/10 bg-black/20 text-white/55 hover:bg-white/10'}`}
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span className={`relative h-4 w-7 rounded-full transition ${checked ? 'bg-blue-400' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${checked ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  );
}

function ScoreCell({ score }: { score?: number }) {
  if (score === undefined) {
    return <span className="text-white/35">-</span>;
  }
  const color = score >= 100 ? 'text-emerald-300' : score >= 70 ? 'text-amber-300' : 'text-red-300';
  return <span className={"font-mono text-sm font-medium " + color}>{formatScore(score)}</span>;
}

function CacheRateCell({ value }: { value?: number }) {
  if (value === undefined) {
    return <span className="text-white/35">-</span>;
  }
  const color = value >= 50 ? '#34d399' : value > 0 ? '#f59e0b' : '#94a3b8';
  return (
    <div className="min-w-[96px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs text-white/35">缓存率</span>
        <span className="font-mono text-xs text-white/70">{formatPercent(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: clamp(value, 0, 100) + '%', backgroundColor: color }} />
      </div>
    </div>
  );
}
function normalizeTargetURL(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return trimmed;
  }
}

function readStoredBoolean(key: string) {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(key) === 'true';
}

function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, value ? 'true' : 'false');
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
