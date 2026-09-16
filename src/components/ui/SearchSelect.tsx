import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface SearchSelectOption {
  value: string;
  label: string;
  description?: string;
  keywords?: readonly string[];
  disabled?: boolean;
}

export interface SearchSelectProps {
  value: string;
  options: readonly SearchSelectOption[];
  onValueChange: (value: string) => void;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  searchable?: boolean;
  clearable?: boolean;
  allowCustomValue?: boolean;
  inputValue?: string;
  onInputValueChange?: (value: string) => void;
  onCreateOption?: (value: string) => void;
  canCreateOption?: (value: string) => boolean;
  createOptionLabel?: (value: string) => ReactNode;
  clearLabel?: string;
  clearOnSelect?: boolean;
  maxLength?: number;
  className?: string;
}

const normalize = (value: string) =>
  value.trim().normalize('NFC').toLocaleLowerCase();

export const SearchSelect = ({
  value,
  options,
  onValueChange,
  id,
  ariaLabel,
  placeholder = 'Choose an option',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matching options',
  disabled = false,
  searchable = true,
  clearable = false,
  allowCustomValue = false,
  inputValue,
  onInputValueChange,
  onCreateOption,
  canCreateOption,
  createOptionLabel,
  clearLabel,
  clearOnSelect = false,
  maxLength,
  className = '',
}: SearchSelectProps) => {
  const generatedId = useId().replace(/:/g, '');
  const controlId = id ?? `search-select-${generatedId}`;
  const listId = `${controlId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLInputElement | HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const selectedOption = options.find((option) => option.value === value);
  const displayedValue = inputValue ?? selectedOption?.label ?? value;
  const effectiveQuery = open ? query : displayedValue;
  const normalizedQuery = normalize(query);
  const queryMatchesSelection =
    selectedOption && normalize(selectedOption.label) === normalizedQuery;
  const filterQuery = queryMatchesSelection ? '' : normalizedQuery;
  const filteredOptions = useMemo(() => {
    if (!searchable || !filterQuery) return options;
    return options.filter((option) =>
      [option.label, option.value, ...(option.keywords ?? [])]
        .map(normalize)
        .some((candidate) => candidate.includes(filterQuery)),
    );
  }, [filterQuery, options, searchable]);
  const creatableQuery = query.trim();
  const canCreate = Boolean(
    onCreateOption &&
      creatableQuery &&
      (canCreateOption?.(creatableQuery) ?? true) &&
      !options.some(
        (option) => normalize(option.label) === normalize(creatableQuery),
      ),
  );
  const itemCount = filteredOptions.length + (canCreate ? 1 : 0);

  useEffect(() => {
    if (!open) setQuery(displayedValue);
  }, [displayedValue, open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const updatePosition = () => {
    const rect = controlRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 6;
    const desiredHeight = Math.min(260, Math.max(80, itemCount * 42 + 10));
    const availableBelow = window.innerHeight - rect.bottom - gap;
    const showAbove =
      availableBelow < desiredHeight && rect.top > availableBelow;
    const availableHeight = showAbove
      ? Math.max(80, rect.top - gap - 8)
      : Math.max(80, availableBelow - 8);
    const popoverWidth = Math.min(rect.width, window.innerWidth - 16);
    const popoverLeft = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - popoverWidth - 8),
    );
    setPopoverStyle({
      position: 'fixed',
      left: popoverLeft,
      width: popoverWidth,
      maxHeight: Math.min(260, availableHeight),
      top: showAbove ? undefined : rect.bottom + gap,
      bottom: showAbove ? window.innerHeight - rect.top + gap : undefined,
      zIndex: 1200,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, itemCount]);

  const openList = () => {
    if (disabled) return;
    setQuery(displayedValue);
    setHighlightedIndex(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };

  const selectOption = (option: SearchSelectOption) => {
    if (option.disabled) return;
    onValueChange(option.value);
    if (clearOnSelect) {
      onInputValueChange?.('');
      setQuery('');
    } else {
      onInputValueChange?.(option.label);
      setQuery(option.label);
    }
    setOpen(false);
    setHighlightedIndex(-1);
  };

  const clear = () => {
    onValueChange('');
    onInputValueChange?.('');
    setQuery('');
    setHighlightedIndex(0);
    setOpen(true);
    requestAnimationFrame(() => controlRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      if (!itemCount) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setHighlightedIndex(
        (current) => (Math.max(0, current) + direction + itemCount) % itemCount,
      );
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (!searchable && !open) {
        event.preventDefault();
        openList();
        return;
      }
      if (event.key === ' ' && searchable) return;
      if (!open) {
        const exact = options.find(
          (opt) => normalize(opt.label) === normalize(query),
        );
        if (exact) {
          event.preventDefault();
          selectOption(exact);
          return;
        }
        if (canCreate) {
          event.preventDefault();
          onCreateOption?.(creatableQuery);
          if (clearOnSelect) {
            onInputValueChange?.('');
            setQuery('');
          }
          return;
        }
        return;
      }
      event.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        selectOption(filteredOptions[highlightedIndex]);
      } else if (canCreate) {
        onCreateOption?.(creatableQuery);
        if (clearOnSelect) {
          onInputValueChange?.('');
          setQuery('');
        }
        setOpen(false);
      } else if (allowCustomValue && query.trim()) {
        onValueChange(query.trim());
        if (clearOnSelect) {
          onInputValueChange?.('');
          setQuery('');
        }
        setOpen(false);
      }
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery(displayedValue);
    }
  };

  const listbox =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel ? `${ariaLabel} options` : 'Options'}
            style={popoverStyle}
            onMouseDown={(event) => event.preventDefault()}
            className="overflow-y-auto rounded-xl border border-pro-border/80 bg-pro-surface p-1 shadow-2xl custom-scrollbar animate-in fade-in zoom-in-95 duration-100"
          >
            {filteredOptions.map((option, index) => {
              const selected = option.value === value;
              const highlighted = index === highlightedIndex;
              return (
                <button
                  key={option.value}
                  data-value={option.value}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  disabled={option.disabled}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectOption(option)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                    highlighted
                      ? 'bg-pro-hover text-pro-text-main'
                      : 'text-pro-text-muted hover:bg-pro-hover/70 hover:text-pro-text-main'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-pro-text-main">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span className="mt-0.5 block truncate text-[11px] text-pro-text-muted">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {selected ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-pro-accent" />
                  ) : null}
                </button>
              );
            })}
            {canCreate ? (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={highlightedIndex === filteredOptions.length}
                onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
                onClick={() => {
                  onCreateOption?.(creatableQuery);
                  if (clearOnSelect) {
                    onInputValueChange?.('');
                    setQuery('');
                  }
                  setOpen(false);
                }}
                className={`mt-1 flex w-full items-center rounded-lg border-t border-pro-border/40 px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  highlightedIndex === filteredOptions.length
                    ? 'bg-pro-hover text-pro-text-main'
                    : 'text-pro-text-muted hover:bg-pro-hover/70 hover:text-pro-text-main'
                }`}
              >
                {createOptionLabel?.(creatableQuery) ??
                  `Create “${creatableQuery}”`}
              </button>
            ) : null}
            {filteredOptions.length === 0 && !canCreate ? (
              <p className="px-3 py-5 text-center text-xs text-pro-text-muted">
                {emptyMessage}
              </p>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {searchable ? (
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-pro-text-main/60"
          />
          <input
            ref={controlRef as React.RefObject<HTMLInputElement>}
            id={controlId}
            type="text"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={
              open && highlightedIndex >= 0
                ? `${listId}-option-${highlightedIndex}`
                : undefined
            }
            value={effectiveQuery}
            maxLength={maxLength}
            placeholder={open ? searchPlaceholder : placeholder}
            disabled={disabled}
            onFocus={(event) => {
              openList();
              event.currentTarget.select();
            }}
            onClick={(event) => {
              if (!open) openList();
              event.currentTarget.select();
            }}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              setHighlightedIndex(0);
              setOpen(true);
              if (inputValue !== undefined) onInputValueChange?.(next);
              else if (allowCustomValue) onValueChange(next);
            }}
            onKeyDown={handleKeyDown}
            className="w-full rounded-lg border border-pro-border/80 bg-pro-bg py-2.5 pl-9 pr-14 text-[14px] text-pro-text-main outline-none transition-colors placeholder:text-pro-text-muted/60 hover:border-pro-border focus:border-pro-accent focus:ring-1 focus:ring-pro-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-2">
            {clearable && displayedValue ? (
              <button
                type="button"
                aria-label={clearLabel ?? `Clear ${ariaLabel ?? 'selection'}`}
                disabled={disabled}
                onClick={clear}
                className="rounded p-1 text-pro-text-main/60 transition-colors hover:bg-pro-hover hover:text-pro-text-main"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
            <button
              type="button"
              tabIndex={-1}
              aria-label={open ? 'Close options' : 'Open options'}
              disabled={disabled}
              onClick={() => {
                if (open) setOpen(false);
                else {
                  openList();
                  requestAnimationFrame(() => controlRef.current?.focus());
                }
              }}
              className="rounded p-1 text-pro-text-main/60 transition-colors hover:text-pro-text-main"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={controlRef as React.RefObject<HTMLButtonElement>}
          id={controlId}
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={handleKeyDown}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-pro-border/80 bg-pro-bg px-3 py-2.5 text-left text-[14px] text-pro-text-main outline-none transition-colors hover:border-pro-border focus-visible:border-pro-accent focus-visible:ring-1 focus-visible:ring-pro-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span
            className={
              selectedOption ? 'truncate' : 'truncate text-pro-text-muted'
            }
          >
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-pro-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}
      {listbox}
    </div>
  );
};
