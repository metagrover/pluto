import { Logo } from '../Brand/Logo';

interface AskPlutoOverlayProps {
  askPlutoVisible: boolean;
  setAskPlutoVisible: (val: boolean) => void;
  query: string;
  setQuery: (val: string) => void;
  plutoResponse: string;
  setPlutoResponse: (val: string) => void;
}

export const AskPlutoOverlay = ({
  askPlutoVisible,
  setAskPlutoVisible,
  query,
  setQuery,
  plutoResponse,
  setPlutoResponse: _setPlutoResponse,
}: AskPlutoOverlayProps) => {
  if (!askPlutoVisible) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 sm:p-24 animate-in">
      {/* High Contrast Deep Backdrop */}
      <div
        className="absolute inset-0 bg-[#163758]/95 backdrop-blur-xl transition-all duration-1000"
        onClick={() => setAskPlutoVisible(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setAskPlutoVisible(false);
          }
        }}
      />

      <div className="w-full max-w-2xl bg-[#163758] rounded-[3rem] border border-white/10 overflow-hidden relative flex flex-col max-h-[85vh] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)] modal-glow transition-all duration-500 scale-in-center">
        {/* Atmospheric Top Glow */}
        <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-[#C6AA79]/20 via-transparent to-transparent pointer-events-none" />

        {/* Header Area */}
        <div className="p-8 pb-4 flex items-center justify-between relative z-10 border-b border-white/5">
          <div className="flex items-center gap-3">
            <Logo size={24} variant="gold" />
            <h3 className="text-[10px] font-black text-[#C6AA79] uppercase tracking-[0.3em] leading-none">
              Pluto Intelligence
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setAskPlutoVisible(false)}
            className="w-10 h-10 rounded-2xl bg-pro-surface/5 hover:bg-pro-surface/10 transition-all flex items-center justify-center group"
          >
            <span className="text-[10px] font-black text-slate-500 group-hover:text-white transition-colors uppercase tracking-widest">
              Esc
            </span>
          </button>
        </div>

        <div className="px-8 pt-8 pb-6 flex flex-col gap-8 relative z-10">
          {/* Input Section */}
          <div className="relative group/input">
            <input
              placeholder="Ask Pluto anything..."
              className="w-full bg-pro-surface/[0.04] border border-white/10 rounded-2xl p-6 text-xl font-medium tracking-tight text-white focus:bg-pro-surface/[0.07] focus:border-indigo-500/40 outline-none transition-all placeholder:text-white/10"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-indigo-500 text-white flex items-center justify-center shadow-lg transform hover:scale-105 transition-all">
                <svg
                  aria-hidden="true"
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Chips / Suggestions */}
          {!query && (
            <div className="flex flex-wrap gap-2.5 animate-in slide-in-from-top-4 duration-500">
              {[
                'Summarize this week',
                'Action items for Sarah',
                'Neptune status',
              ].map((tag) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => setQuery(tag)}
                  className="px-4 py-2 bg-pro-surface/[0.04] border border-white/5 rounded-xl text-[10px] font-bold text-slate-400 hover:text-white hover:bg-pro-surface/10 transition-all uppercase tracking-widest"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results / Empty State Area */}
        <div className="flex-1 overflow-y-auto px-10 pb-10 custom-scrollbar relative z-10">
          {query ? (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="space-y-4">
                <div className="flex items-center gap-2 opacity-50">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    Synthesis
                  </span>
                </div>

                <p className="text-white text-lg font-medium leading-relaxed tracking-tight">
                  {plutoResponse || 'Thinking...'}
                </p>

                <div className="flex flex-wrap gap-2 pt-2">
                  {['Mon Standup', 'Tech Sync'].map((source) => (
                    <span
                      key={source}
                      className="px-3 py-1.5 bg-pro-surface/[0.05] border border-white/10 rounded-lg text-[9px] font-bold text-slate-400 uppercase tracking-wider"
                    >
                      {source}
                    </span>
                  ))}
                </div>
              </div>

              {/* Primary Action Only */}
              <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                <button
                  type="button"
                  className="h-12 px-8 rounded-xl bg-pro-accent text-[#163758] font-black text-[10px] uppercase tracking-widest hover:bg-pro-accent-alt transition-all shadow-lg active-push"
                >
                  Create Action Item
                </button>
                <button
                  type="button"
                  className="text-[10px] font-bold text-slate-500 hover:text-white transition-colors uppercase tracking-widest"
                >
                  Share Insight →
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center space-y-4">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] opacity-40 hover:opacity-100 transition-opacity">
                Intelligence Ready
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
