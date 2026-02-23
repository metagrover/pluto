import type { Meeting } from '../../types';

interface SearchOverlayProps {
  searchVisible: boolean;
  setSearchVisible: (val: boolean) => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  filteredMeetings: Meeting[];
  setSelectedMeetingId: (id: string | number | null) => void;
}

export const SearchOverlay = ({
  searchVisible,
  setSearchVisible,
  searchQuery,
  setSearchQuery,
  filteredMeetings,
  setSelectedMeetingId,
}: SearchOverlayProps) => {
  if (!searchVisible) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-24 px-6 animate-in">
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-md"
        onClick={() => setSearchVisible(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSearchVisible(false);
          }
        }}
      />
      <div className="w-full max-w-3xl bg-white rounded-[2.5rem] shadow-2xl border border-pro-border overflow-hidden relative scale-in-center">
        <div className="p-10 border-b border-pro-border/40 flex items-center gap-8">
          <div className="w-12 h-12 rounded-2xl bg-pro-bg flex items-center justify-center border border-pro-border/40 text-pro-text-muted shadow-sm">
            <svg
              aria-hidden="true"
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search your second brain..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-3xl font-black tracking-tight placeholder:text-pro-text-muted/20 text-pro-text-main"
          />
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 bg-pro-bg border border-pro-border rounded-xl text-[10px] font-black text-pro-text-muted/40 uppercase tracking-widest">
              Esc
            </span>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-10 custom-scrollbar">
          {searchQuery && filteredMeetings.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-pro-text-muted/40 font-black uppercase tracking-[0.2em] text-[12px]">
                No matching artifacts found
              </p>
            </div>
          ) : (
            <div className="space-y-10">
              {filteredMeetings.length > 0 && (
                <div className="space-y-6">
                  <h3 className="text-[10px] font-black text-pro-text-muted/30 uppercase tracking-[0.3em] px-2">
                    Memory Clusters
                  </h3>
                  <div className="grid grid-cols-2 gap-6">
                    {filteredMeetings.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => {
                          setSelectedMeetingId(m.id);
                          setSearchVisible(false);
                          setSearchQuery('');
                        }}
                        className="w-full text-left p-8 rounded-[2rem] bg-white border border-pro-border/40 hover:border-pro-accent/40 hover:shadow-xl transition-all flex flex-col gap-4 group shadow-sm active-push"
                      >
                        <div className="flex justify-between items-center">
                          <div className="w-10 h-10 rounded-xl bg-pro-bg flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                            📄
                          </div>
                          <span className="text-[10px] font-black text-pro-text-muted/30 uppercase tracking-widest">
                            {new Date(
                              m.created_at || m.started_at || Date.now(),
                            ).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                        <p className="text-xl font-black text-pro-text-main tracking-tight line-clamp-1">
                          {m.title || 'Untitled Session'}
                        </p>
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[9px] font-black text-pro-accent uppercase tracking-widest">
                            Open Artifact →
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
