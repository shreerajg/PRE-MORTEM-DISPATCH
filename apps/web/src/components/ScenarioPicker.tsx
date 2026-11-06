import * as React from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { ScenarioSummary } from '../lib/api';
import { cn, disruptionLabel, scenarioTitle } from '../lib/utils';

type ScenarioPickerProps = {
  id: string;
  label: string;
  value: string;
  scenarios: ScenarioSummary[];
  onChange: (id: string) => void;
  placeholder?: string;
  emptyHint?: string;
  className?: string;
};

/** Searchable scenario picker: keyboard-driven, works with hundreds of runs. */
export function ScenarioPicker({
  id,
  label,
  value,
  scenarios,
  onChange,
  placeholder = 'Select a scenario…',
  emptyHint = 'No scenarios match this workspace yet.',
  className,
}: ScenarioPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selected = scenarios.find((scenario) => scenario.id === value);
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? scenarios.filter((scenario) =>
        [scenarioTitle(scenario), disruptionLabel(scenario.disruption), scenario.status, scenario.id]
          .join(' ')
          .toLowerCase()
          .includes(normalized),
      )
    : scenarios;

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      const selectedIndex = Math.max(
        0,
        scenarios.findIndex((scenario) => scenario.id === value),
      );
      setActiveIndex(selectedIndex);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, scenarios, value]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        document.getElementById(id)?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [id, open]);

  const choose = (scenarioId: string) => {
    onChange(scenarioId);
    setOpen(false);
  };

  const activeOptionId = filtered.length
    ? `${id}-option-${Math.min(activeIndex, filtered.length - 1)}`
    : undefined;

  const move = (delta: number) => {
    if (!filtered.length) return;
    const next = (activeIndex + delta + filtered.length) % filtered.length;
    setActiveIndex(next);
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <label htmlFor={id} className="mb-1.5 block text-[11px] font-medium text-slate-600">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-listbox`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-lg border border-slate-300/80 bg-white px-3 text-left text-[13px] shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition-colors hover:border-slate-400/80 focus:border-emerald-500/70 focus:outline-none focus:ring-4 focus:ring-emerald-500/10',
          open && 'border-emerald-500/70 ring-4 ring-emerald-500/10',
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', selected ? 'text-slate-800' : 'text-slate-400')}>
          {selected
            ? `${scenarioTitle(selected)} · ${disruptionLabel(selected.disruption)} · ${selected.status}`
            : placeholder}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.375rem)] z-40 overflow-hidden rounded-xl border border-slate-900/[0.08] bg-white shadow-lift">
          <div className="flex items-center gap-2 border-b border-slate-900/[0.06] px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const candidate = filtered[activeIndex];
                  if (candidate) choose(candidate.id);
                }
              }}
              placeholder="Search name, disruption, status or id"
              aria-label="Search scenarios"
              aria-controls={`${id}-listbox`}
              aria-autocomplete="list"
              aria-activedescendant={activeOptionId}
              className="h-7 min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-slate-400"
            />
          </div>
          <ul
            id={`${id}-listbox`}
            ref={listRef}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            className="max-h-64 overflow-y-auto p-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-[11.5px] text-slate-400">{emptyHint}</li>
            ) : (
              filtered.map((scenario, index) => {
                const isSelected = scenario.id === value;
                return (
                  <li key={scenario.id} role="presentation">
                    <button
                      type="button"
                      id={`${id}-option-${index}`}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(scenario.id)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-[11.5px] transition-colors',
                        index === activeIndex ? 'bg-slate-900/[0.045]' : 'hover:bg-slate-50',
                      )}
                    >
                      <Check
                        className={cn(
                          'mt-0.5 h-3.5 w-3.5 shrink-0',
                          isSelected ? 'text-emerald-600' : 'text-transparent',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-800">
                          {scenarioTitle(scenario)}
                        </span>
                        <span className="mt-0.5 block truncate text-[10.5px] text-slate-500">
                          {disruptionLabel(scenario.disruption)} · {scenario.status} ·{' '}
                          {scenario.created_at.slice(0, 16).replace('T', ' ')}
                        </span>
                      </span>
                      <span className="mt-0.5 font-mono text-[9px] text-slate-300">{scenario.id.slice(0, 6)}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
