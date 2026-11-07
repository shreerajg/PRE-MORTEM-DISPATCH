import * as React from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { useModalBehavior } from './useModalBehavior';

type DialogProps = {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  size?: 'sm' | 'md';
};

/** Accessible modal surface: focus trap, Escape, backdrop dismissal and restore. */
export function Dialog({ open, title, description, children, onClose, footer, size = 'md' }: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  useModalBehavior(open, onClose, panelRef);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <div
        aria-hidden
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
        onMouseDown={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'animate-dialog-in relative w-full overflow-hidden rounded-2xl border border-slate-900/[0.08] bg-white shadow-lift outline-none',
          size === 'sm' ? 'max-w-md' : 'max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold tracking-tight text-slate-900">
              {title}
            </h2>
            {description ? (
              <div id={descriptionId} className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
                {description}
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-1 -mt-1 h-8 w-8 shrink-0 text-slate-400 hover:text-slate-900"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {children ? <div className="px-5 pb-4">{children}</div> : null}

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-900/[0.06] bg-slate-50/70 p-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  destructive = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            data-autofocus
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

type PromptDialogProps = {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  label: string;
  initialValue?: string;
  placeholder?: string;
  maxLength?: number;
  confirmLabel?: string;
  error?: string | null;
  busy?: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
};

export function PromptDialog({
  open,
  title,
  description,
  label,
  initialValue = '',
  placeholder,
  maxLength = 80,
  confirmLabel = 'Save',
  error: externalError,
  busy = false,
  onSubmit,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = React.useState(initialValue);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();

  React.useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
    }
  }, [open, initialValue]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    if (!next) {
      setError('A name is required.');
      return;
    }
    if (next.length > maxLength) {
      setError(`Use ${maxLength} characters or fewer.`);
      return;
    }
    onSubmit(next);
  };

  return (
    <Dialog open={open} title={title} description={description} onClose={onClose} size="sm">
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor={inputId} className="block text-[11px] font-medium text-slate-600">
          {label}
        </label>
        <input
          id={inputId}
          data-autofocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          maxLength={maxLength + 10}
          autoComplete="off"
          aria-invalid={error || externalError ? true : undefined}
          aria-describedby={error || externalError ? `${inputId}-hint` : undefined}
          className="flex h-10 w-full rounded-lg border border-slate-300/80 bg-white px-3 text-[13px] shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition-colors placeholder:text-slate-400 hover:border-slate-400/80 focus:border-emerald-500/70 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
        />
        <div className="flex items-center justify-between text-[10.5px]">
          <span id={`${inputId}-hint`} className={error || externalError ? 'text-red-600' : 'text-slate-400'}>
            {error ?? externalError ?? `${value.trim().length}/${maxLength} characters`}
          </span>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !value.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
