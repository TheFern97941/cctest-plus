import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import type { TaskStatus } from './types';

export function StatusPill({ status, label }: { status: TaskStatus | 'succeeded' | 'failed'; label?: string }) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${meta.className}`}>
      <Icon className={`h-3.5 w-3.5 ${meta.spin ? 'animate-spin' : ''}`} />
      {label ?? meta.label}
    </span>
  );
}

function statusMeta(status: string) {
  switch (status) {
    case 'succeeded':
      return { label: '成功', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300', icon: CheckCircle2, spin: false };
    case 'partial_failed':
      return { label: '部分异常', className: 'border-amber-500/25 bg-amber-500/10 text-amber-300', icon: AlertTriangle, spin: false };
    case 'failed':
      return { label: '失败', className: 'border-red-500/25 bg-red-500/10 text-red-300', icon: XCircle, spin: false };
    case 'timeout':
      return { label: '超时', className: 'border-red-500/25 bg-red-500/10 text-red-300', icon: Clock, spin: false };
    case 'polling':
    case 'submitted':
      return { label: '检测中', className: 'border-blue-500/25 bg-blue-500/10 text-blue-300', icon: Loader2, spin: true };
    default:
      return { label: '待提交', className: 'border-white/15 bg-white/5 text-white/50', icon: Clock, spin: false };
  }
}
