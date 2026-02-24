import { Plus, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../Brand/Logo";
import { ZenVisualizer } from "../ZenVisualizer";

interface ZenModeProps {
  isProcessing: boolean;
  onEndMeeting: () => void;
  meetingTitle: string;
  setMeetingTitle: (val: string) => void;
  meetingParticipants: string[];
  setMeetingParticipants: (
    val: string[] | ((prev: string[]) => string[]),
  ) => void;
  participantInput: string;
  setParticipantInput: (val: string) => void;
  currentNotes: string;
  setCurrentNotes: (val: string) => void;
  inlineAskPluto: boolean;
  setInlineAskPluto: (val: boolean) => void;
  query: string;
  setQuery: (val: string) => void;
  plutoResponse: string;
  setPlutoResponse: (val: string) => void;
  analyser: AnalyserNode | null;
  speakingSource: "Me" | "Them" | null;
}

type EntitySuggestion = {
  id?: string;
  type: string;
  name: string;
};

export const ZenMode = ({
  isProcessing,
  onEndMeeting,
  meetingTitle,
  setMeetingTitle,
  meetingParticipants,
  setMeetingParticipants,
  participantInput,
  setParticipantInput,
  currentNotes,
  setCurrentNotes,
  inlineAskPluto,
  setInlineAskPluto,
  query,
  setQuery,
  plutoResponse,
  setPlutoResponse,
  analyser,
  speakingSource,
}: ZenModeProps) => {
  const [suggestions, setSuggestions] = useState<EntitySuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRequestId = useRef(0);

  useEffect(() => {
    const fetchSuggestions = async () => {
      const requestId = ++suggestionsRequestId.current;
      if (!participantInput || participantInput.length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      try {
        // IPC call to search entities
        const results =
          (await window.ipcRenderer.invoke<EntitySuggestion[]>(
            "SEARCH_ENTITIES",
            participantInput,
          )) || [];

        // Filter for people only and limit to 5
        const people = results.filter((e) => e.type === "person").slice(0, 5);

        if (requestId !== suggestionsRequestId.current) return;

        setSuggestions(people);
        setShowSuggestions(people.length > 0);
      } catch (e) {
        console.error("Failed to fetch suggestions", e);
      }
    };

    const timeoutId = setTimeout(fetchSuggestions, 300); // Debounce
    return () => clearTimeout(timeoutId);
  }, [participantInput]);

  return (
    <main className="flex-1 flex flex-col h-full relative z-10 bg-pro-bg overflow-hidden">
      {/* Minimal Top Bar - Added padding for Traffic Lights */}
      <header className="h-20 flex items-center justify-between px-6 pl-24 bg-white/60 backdrop-blur-xl border-b border-stone-200/60 shrink-0 select-none drag-region">
        <div className="flex items-center gap-6 no-drag">
          <Logo size={28} showText={false} variant="default" />

          <div className="h-6 w-px bg-stone-200" />

          {/* Audio Visualizer */}
          <ZenVisualizer analyser={analyser} isProcessing={isProcessing} />

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-pro-border/40 text-[10px] font-black uppercase tracking-widest text-pro-text-muted/70">
            <span
              className={`w-1.5 h-1.5 rounded-full ${speakingSource === "Me" ? "bg-pro-accent" : "bg-stone-300"}`}
            />
            <span
              className={`w-1.5 h-1.5 rounded-full ${speakingSource === "Them" ? "bg-pro-accent" : "bg-stone-300"}`}
            />
            <span>Speaking: {speakingSource ?? "—"}</span>
          </div>
        </div>

        <button
          type="button"
          disabled={isProcessing}
          onClick={onEndMeeting}
          className={`no-drag px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 flex items-center gap-2
                        ${
                          isProcessing
                            ? "bg-stone-100 text-stone-400 cursor-not-allowed border border-stone-200"
                            : "bg-stone-900 text-white hover:bg-stone-800"
                        }`}
        >
          {isProcessing && (
            <div className="w-3 h-3 rounded-full border-2 border-stone-400 border-t-transparent animate-spin" />
          )}
          {isProcessing ? "Processing..." : "End Meeting"}
        </button>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* Primary: Note Editor (Premium style) */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-12 flex flex-col gap-8">
            {/* Metadata Editor */}
            <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-700">
              <input
                type="text"
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                placeholder="Add Meeting Title..."
                className="text-4xl md:text-5xl font-extrabold tracking-tight text-pro-text-main bg-transparent outline-none placeholder:text-stone-300/50 w-full"
              />

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-stone-400 mr-2">
                  <Users size={16} />
                  <span className="text-xs font-bold uppercase tracking-widest">
                    Participants:
                  </span>
                </div>
                {meetingParticipants.map((p, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: Participant names are not guaranteed unique, so index is used for deterministic removal.
                    key={i}
                    className="flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full bg-stone-100 border border-stone-200 text-sm font-medium text-stone-600 animate-in fade-in zoom-in group"
                  >
                    <span>{p}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setMeetingParticipants((prev: string[]) =>
                          prev.filter((_, idx) => idx !== i),
                        )
                      }
                      className="text-stone-400 hover:text-red-500 transition-colors bg-stone-200/50 rounded-full p-0.5 hover:bg-stone-200"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                <div className="relative group">
                  <input
                    type="text"
                    value={participantInput}
                    onChange={(e) => setParticipantInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && participantInput.trim()) {
                        setMeetingParticipants((prev: string[]) => [
                          ...prev,
                          participantInput.trim(),
                        ]);
                        setParticipantInput("");
                        setShowSuggestions(false);
                      }
                    }}
                    onBlur={() =>
                      setTimeout(() => setShowSuggestions(false), 200)
                    }
                    onFocus={() => {
                      if (suggestions.length > 0) setShowSuggestions(true);
                    }}
                    placeholder="Add person..."
                    className="bg-transparent outline-none text-sm font-medium text-pro-text-main w-32 placeholder:text-stone-300/50 focus:placeholder-stone-300 transition-all"
                  />
                  <Plus
                    size={12}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-stone-300 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                  />

                  {/* Autocomplete Dropdown */}
                  {showSuggestions && (
                    <div className="absolute top-full left-0 mt-2 w-48 bg-white/90 backdrop-blur-md border border-pro-border rounded-xl shadow-premium z-50 overflow-hidden animate-in slide-in-from-top-1 fade-in duration-200">
                      {suggestions.map((person, index) => (
                        <button
                          type="button"
                          key={person.id ?? person.name}
                          onClick={() => {
                            setMeetingParticipants((prev: string[]) => [
                              ...prev,
                              person.name,
                            ]);
                            setParticipantInput("");
                            setShowSuggestions(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-pro-text-main hover:bg-pro-accent/5 hover:text-pro-accent transition-colors flex items-center gap-2"
                        >
                          <span className="opacity-50">👤</span>
                          {person.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <textarea
              value={currentNotes}
              onChange={(e) => setCurrentNotes(e.target.value)}
              placeholder="Start typing your notes... Pluto is listening in the background and will enhance these notes with context from the conversation."
              className="w-full min-h-[50vh] resize-none outline-none text-lg text-stone-800 placeholder:text-stone-300 leading-relaxed bg-transparent font-['Georgia',serif]"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Inline Ask Pluto - Non-obtrusive */}
        <div className="border-t border-pro-border/20 bg-pro-bg/80 backdrop-blur-md">
          {inlineAskPluto ? (
            <div className="max-w-3xl mx-auto px-8 py-6 space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xl">✨</span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && query) {
                      setPlutoResponse("Checking past context...");
                      try {
                        const res = await window.ipcRenderer.invoke<string>(
                          "ASK_PLUTO",
                          { query },
                        );
                        setPlutoResponse(res);
                      } catch (err) {
                        setPlutoResponse(
                          "Unable to reach your second brain right now.",
                        );
                      }
                    }
                    if (e.key === "Escape") {
                      setInlineAskPluto(false);
                      setQuery("");
                      setPlutoResponse("");
                    }
                  }}
                  placeholder="Ask about previous meetings, decisions, or context..."
                  className="flex-1 bg-transparent outline-none text-[15px] font-medium text-pro-text-main placeholder:text-pro-text-muted/30"
                />
                <button
                  type="button"
                  onClick={() => {
                    setInlineAskPluto(false);
                    setQuery("");
                    setPlutoResponse("");
                  }}
                  className="text-[10px] font-bold text-pro-text-muted/40 uppercase tracking-widest px-2 py-1 rounded bg-white border border-pro-border hover:text-pro-text-main transition-colors"
                >
                  ESC
                </button>
              </div>
              {plutoResponse && (
                <div className="p-6 bg-white rounded-2xl border border-pro-border shadow-premium text-sm text-pro-text-main/80 leading-relaxed animate-in slide-in-from-bottom-2 duration-500 selection:bg-pro-accent/20">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1 h-3 bg-pro-accent rounded-full" />
                    <span className="text-[10px] font-black text-pro-text-muted uppercase tracking-[0.2em]">
                      Synthesis
                    </span>
                  </div>
                  {plutoResponse}
                </div>
              )}
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-8 py-5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setInlineAskPluto(true)}
                className="flex items-center gap-3 text-sm text-pro-text-muted/60 hover:text-pro-accent transition-all group"
              >
                <span className="text-base group-hover:scale-125 transition-transform duration-500">
                  ✨
                </span>
                <span className="font-medium">
                  Ask Pluto about previous meetings...
                </span>
              </button>
              <div className="flex items-center gap-1.5 opacity-20 group-hover:opacity-40 transition-opacity">
                <span className="px-1.5 py-0.5 rounded bg-white border border-pro-border text-[9px] font-bold text-pro-text-muted/60 uppercase">
                  ⌘
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white border border-pro-border text-[9px] font-bold text-pro-text-muted/60 uppercase">
                  K
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
