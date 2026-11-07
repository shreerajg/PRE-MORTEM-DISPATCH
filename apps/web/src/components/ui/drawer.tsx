import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalBehavior } from './useModalBehavior';

type DrawerProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * Left-docked menu sheet for small screens. Same focus trap, Escape handling,
 * backdrop dismissal and scroll lock as the dialogs, via useModalBehavior.
 */
export function Drawer({ open, title, onClose, children }: DrawerProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  useModalBehavior(open, onClose, panelRef);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] md:hidden">
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
        tabIndex={-1}
        className="animate-drawer-in absolute inset-y-0 left-0 flex w-[86%] max-w-[320px] flex-col overflow-hidden bg-ink-900 text-slate-300 shadow-lift outline-none"
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-5">
          <span id={titleId} className="text-[13px] font-semibold tracking-tight text-white">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-mr-1 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
