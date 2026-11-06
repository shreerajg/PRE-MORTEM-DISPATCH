import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToastTone = 'success' | 'warning' | 'danger' | 'info';

export type Toast = {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
};

let nextId = 1;
let items: Toast[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function dismissToast(id: number) {
  items = items.filter((item) => item.id !== id);
  emit();
}

export function notify(
  title: string,
  description?: string,
  tone: ToastTone = 'info',
): number {
  const toast: Toast = { id: nextId++, title, description, tone };
  items = [...items.slice(-4), toast];
  emit();
  window.setTimeout(() => dismissToast(toast.id), tone === 'danger' ? 9000 : 6000);
  return toast.id;
}

const TONES: Record<ToastTone, { icon: React.ElementType; className: string }> = {
  success: { icon: CheckCircle2, className: 'border-emerald-600/15 bg-emerald-50 text-emerald-800' },
  warning: { icon: AlertTriangle, className: 'border-amber-600/20 bg-amber-50 text-amber-800' },
  danger: { icon: AlertTriangle, className: 'border-red-600/15 bg-red-50 text-red-800' },
  info: { icon: Info, className: 'border-slate-900/[0.07] bg-white text-slate-700' },
};

export function ToastViewport() {
  const [toasts, setToasts] = React.useState<Toast[]>(items);

  React.useEffect(() => {
    const listener = () => setToasts(items);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[95] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5"
    >
      {toasts.map((toast) => {
        const tone = TONES[toast.tone];
        const Icon = tone.icon;
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-lift',
              tone.className,
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium leading-snug">{toast.title}</div>
              {toast.description ? (
                <div className="mt-0.5 text-[11px] leading-relaxed opacity-80">{toast.description}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="-mr-1 -mt-1 rounded-md p-1 opacity-50 transition-opacity hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
