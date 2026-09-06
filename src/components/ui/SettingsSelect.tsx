import { Check, ChevronDown, Search } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface SettingsSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  alwaysVisible?: boolean;
}
interface SettingsSelectProps {
  id?: string;
  label: string;
  value: string;
  options: SettingsSelectOption[];
  onChange: (value: string) => void;
  searchable?: boolean;
  allowCustom?: boolean;
  disabled?: boolean;
  maxLength?: number;
  className?: string;
}

/** Settings presentation follows Identify speakers; callers own persistence. */
export function SettingsSelect({
  id,
  label,
  value,
  options,
  onChange,
  searchable = false,
  allowCustom = false,
  disabled = false,
  maxLength,
  className = '',
}: SettingsSelectProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listId = `${controlId}-options`;
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLInputElement & HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<CSSProperties>({});
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? value;
  const editable = searchable || allowCustom;
  const visible = options.filter(
    (option) =>
      !editable ||
      query === null ||
      option.alwaysVisible ||
      option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const enabled = visible
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((index) => index >= 0);
  const isOpen = open && !disabled;
  const activeOption = visible[active];
  const close = () => {
    setOpen(false);
    setQuery(null);
    setActive(-1);
  };
  const show = () => {
    if (disabled || trigger.current?.matches(':disabled')) return;
    setOpen(true);
    setActive(
      visible.findIndex((option) => option.value === value && !option.disabled),
    );
  };
  const choose = (option: SettingsSelectOption) => {
    if (disabled || option.disabled) return;
    onChange(option.value);
    close();
    trigger.current?.focus();
  };

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQuery(null);
    }
  }, [disabled]);
  useLayoutEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const rect = container.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 6;
      const margin = 8;
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const flip = below < 208 && above > below;
      const width = Math.min(rect.width, window.innerWidth - margin * 2);
      const styles = getComputedStyle(container.current!);
      const theme = Object.fromEntries(
        [
          'bg',
          'surface',
          'border',
          'text-main',
          'text-muted',
          'hover',
          'accent',
        ].map((token) => [
          `--pro-${token}`,
          styles.getPropertyValue(`--pro-${token}`),
        ]),
      );
      setPosition({
        ...theme,
        position: 'fixed',
        zIndex: 1000,
        width,
        left: Math.max(
          margin,
          Math.min(rect.left, window.innerWidth - width - margin),
        ),
        ...(flip
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
        maxHeight: Math.max(0, Math.min(208, flip ? above : below)),
      });
    };
    update();
    const resize =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (container.current) resize?.observe(container.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      ) {
        setOpen(false);
        setQuery(null);
        setActive(-1);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      resize?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [isOpen]);
  useEffect(() => {
    if (isOpen && active >= 0)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, isOpen, listId]);

  const handleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') close();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        show();
        return;
      }
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const current = enabled.indexOf(active);
      setActive(
        enabled.length
          ? current === -1
            ? event.key === 'ArrowDown'
              ? enabled[0]
              : enabled.at(-1)!
            : enabled[(current + offset + enabled.length) % enabled.length]
          : -1,
      );
    } else if (event.key === 'Enter' && isOpen) {
      event.preventDefault();
      if (activeOption && !activeOption.disabled) choose(activeOption);
      else close();
    } else if (
      !editable &&
      isOpen &&
      (event.key === 'Home' || event.key === 'End')
    ) {
      event.preventDefault();
      setActive(
        event.key === 'Home' ? (enabled[0] ?? -1) : (enabled.at(-1) ?? -1),
      );
    } else if (!editable && isOpen && event.key === ' ') {
      event.preventDefault();
      if (activeOption) choose(activeOption);
    }
  };
  const fieldClass =
    'w-full min-h-10 rounded-lg border border-pro-border bg-pro-bg py-2 pl-3 pr-9 text-left text-[13px] font-medium text-pro-text-main outline-none transition-colors hover:border-pro-text-muted/40 focus:border-pro-accent focus:ring-1 focus:ring-pro-accent disabled:cursor-not-allowed disabled:opacity-50';
  const aria = {
    id: controlId,
    role: 'combobox',
    'aria-label': label,
    'aria-expanded': isOpen,
    'aria-controls': isOpen ? listId : undefined,
    'aria-haspopup': 'listbox' as const,
    'aria-activedescendant':
      isOpen && activeOption && !activeOption.disabled
        ? `${listId}-${active}`
        : undefined,
    disabled,
    onKeyDown: handleKey,
  };
  return (
    <div ref={container} className={`relative min-w-0 ${className}`}>
      {editable ? (
        <>
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pro-text-muted"
          />
          <input
            {...aria}
            ref={trigger}
            type="text"
            autoComplete="off"
            aria-autocomplete="list"
            maxLength={maxLength}
            value={allowCustom ? value : (query ?? selectedLabel)}
            onFocus={(event) => {
              if (!allowCustom) event.currentTarget.select();
            }}
            onClick={() => {
              if (!isOpen) show();
            }}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              setActive(-1);
              setOpen(true);
              if (allowCustom) onChange(next);
            }}
            className={`${fieldClass} pl-9`}
          />
          <button
            type="button"
            disabled={disabled}
            tabIndex={-1}
            aria-label={`${isOpen ? 'Close' : 'Open'} ${label} suggestions`}
            onClick={() => {
              trigger.current?.focus();
              if (isOpen) close();
              else show();
            }}
            className="absolute inset-y-0 right-1 flex items-center rounded px-2 text-pro-text-muted hover:text-pro-text-main disabled:opacity-50"
          >
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </>
      ) : (
        <button
          {...aria}
          ref={trigger}
          type="button"
          onClick={() => {
            if (isOpen) close();
            else show();
          }}
          className={fieldClass}
        >
          <span className="block truncate">{selectedLabel}</span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-pro-text-muted transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      )}
      {isOpen &&
        createPortal(
          <div
            ref={menu}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={`${label} options`}
            style={position}
            onMouseDown={(event) => event.preventDefault()}
            className="overflow-y-auto rounded-xl border border-pro-border/80 bg-pro-surface p-1 shadow-2xl custom-scrollbar space-y-0.5"
          >
            {visible.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                onMouseEnter={() => {
                  if (!option.disabled) setActive(index);
                }}
                onClick={() => choose(option)}
                className={`flex min-h-9 items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[13px] select-none transition-colors ${option.disabled ? 'cursor-not-allowed text-pro-text-muted/40' : active === index ? 'cursor-pointer bg-pro-hover text-pro-text-main' : 'cursor-pointer text-pro-text-main hover:bg-pro-hover/70'}`}
              >
                <span className="min-w-0 break-words font-medium">
                  {option.label}
                </span>
                {option.value === value && (
                  <Check
                    size={14}
                    aria-hidden="true"
                    className="shrink-0 text-pro-accent"
                  />
                )}
              </div>
            ))}
            {!visible.length && (
              <div className="px-2.5 py-2 text-[13px] text-pro-text-muted">
                {allowCustom
                  ? 'Your custom entry will be saved.'
                  : 'No matching options'}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
