import { Calendar, FolderKanban, Search, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type {
  SearchPlutoResult,
  SearchPlutoResultKind,
} from './searchPlutoModel';

interface SearchOverlayProps {
  searchVisible: boolean;
  setSearchVisible: (val: boolean) => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  results: SearchPlutoResult[];
  onOpenMeeting: (id: string | number) => void;
  onOpenProjects: (id: string | number) => void;
  onOpenPeople: (id: string | number) => void;
}

const KIND_LABELS: Record<SearchPlutoResultKind, string> = {
  project: 'Projects',
  person: 'People',
  meeting: 'Meetings',
};

const ResultIcon = ({ kind }: { kind: SearchPlutoResultKind }) => {
  if (kind === 'project') return <FolderKanban aria-hidden="true" size={18} />;
  if (kind === 'person') return <UserRound aria-hidden="true" size={18} />;
  return <Calendar aria-hidden="true" size={18} />;
};

export const SearchOverlay = ({
  searchVisible,
  setSearchVisible,
  searchQuery,
  setSearchQuery,
  results,
  onOpenMeeting,
  onOpenProjects,
  onOpenPeople,
}: SearchOverlayProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const groupedResults = useMemo(
    () =>
      (['project', 'person', 'meeting'] as const).map((kind) => ({
        kind,
        label: KIND_LABELS[kind],
        results: results.filter((result) => result.kind === kind),
      })),
    [results],
  );

  useEffect(() => {
    if (searchVisible) inputRef.current?.focus();
  }, [searchVisible]);

  if (!searchVisible) return null;

  const handleSelect = (result: SearchPlutoResult) => {
    if (result.kind === 'meeting') {
      onOpenMeeting(result.id);
    } else if (result.kind === 'project') {
      onOpenProjects(result.id);
    } else {
      onOpenPeople(result.id);
    }
    setSearchVisible(false);
    setSearchQuery('');
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center px-4 pt-[calc(12vh+64px)] animate-in">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => setSearchVisible(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSearchVisible(false);
          }
        }}
      />
      <div
        data-search-panel
        className="w-full max-w-2xl bg-pro-surface rounded-md shadow-2xl border border-pro-border overflow-hidden relative scale-in-center"
      >
        <div className="px-5 py-4 border-b border-pro-border/35 flex items-center gap-3">
          <Search
            aria-hidden="true"
            size={20}
            className="shrink-0 text-pro-text-muted/75"
          />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search Pluto"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-lg font-medium tracking-normal placeholder:font-serif placeholder:text-pro-text-muted/55 text-pro-text-main"
          />
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 bg-pro-bg border border-pro-border/70 rounded-lg text-[10px] font-bold text-pro-text-muted/60">
              Esc
            </span>
          </div>
        </div>
        <div
          data-search-results
          className="max-h-[50vh] overflow-y-auto p-2 custom-scrollbar"
        >
          {!searchQuery.trim() ? (
            <div className="py-10 text-center">
              <p className="text-pro-text-muted/65 font-semibold text-sm">
                Search projects, people, and meetings
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-pro-text-muted/65 font-semibold text-sm">
                No matching memory found
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {groupedResults.map((group) =>
                group.results.length > 0 ? (
                  <div key={group.kind} className="space-y-1">
                    <h3 className="px-3 pt-2 pb-1 text-[10px] font-bold text-pro-text-muted/70 font-medium">
                      {group.label}
                    </h3>
                    <div className="space-y-1">
                      {group.results.map((result) => (
                        <button
                          type="button"
                          data-search-result-kind={result.kind}
                          key={`${result.kind}-${result.id}`}
                          onClick={() => handleSelect(result)}
                          className="w-full text-left px-3 py-2.5 rounded-md border border-transparent hover:bg-pro-surface focus-visible:border-pro-border focus-visible:bg-pro-surface focus-visible:outline-none transition-all duration-300 flex items-center gap-3 group transition-colors "
                        >
                          <div className="w-7 h-7 rounded-lg bg-pro-bg border border-pro-border/40 flex items-center justify-center text-pro-text-muted/75 group-hover:text-pro-text-main transition-colors">
                            <ResultIcon kind={result.kind} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-pro-text-main tracking-normal line-clamp-1">
                              {result.title}
                            </p>
                            <span className="text-[10px] font-semibold text-pro-text-muted/65 font-medium">
                              {result.subtitle}
                            </span>
                          </div>
                          {result.updatedAt && (
                            <span className="text-[10px] font-semibold text-pro-text-muted/55">
                              {new Date(result.updatedAt).toLocaleDateString(
                                [],
                                {
                                  month: 'short',
                                  day: 'numeric',
                                },
                              )}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
