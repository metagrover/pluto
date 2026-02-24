import {
  BarChart3,
  Check,
  ChevronDown,
  Copy,
  FileText,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { Meeting, TranscriptSegment } from '../../types';
import {
  analysisDocumentToMarkdown,
  resolveMeetingAnalysisDocument,
} from '../../utils/analysisDocument';
import { EntitySidebar } from '../KnowledgeGraph/EntitySidebar';

interface MeetingViewProps {
  selectedMeeting: Meeting | undefined;
  editingTitle: boolean;
  setEditingTitle: (val: boolean) => void;
  titleValue: string;
  setTitleValue: (val: string) => void;
  fetchMeetings: () => void;
  handleCopySummary: (text: string) => void;
  copySuccess: boolean;
  handleDeleteMeeting: (id: string | number) => void;
  highlightEntities: (text: string) => ReactNode;
  transcriptVisible: boolean;
  setTranscriptVisible: (val: boolean) => void;
}

export const MeetingView = ({
  selectedMeeting,
  editingTitle,
  setEditingTitle,
  titleValue,
  setTitleValue,
  fetchMeetings,
  handleCopySummary,
  copySuccess,
  handleDeleteMeeting,
  highlightEntities,
  transcriptVisible,
  setTranscriptVisible,
}: MeetingViewProps) => {
  if (!selectedMeeting) return null;

  const transcriptBodyRef = useRef<HTMLDivElement>(null);
  const [transcriptBodyHeight, setTranscriptBodyHeight] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The selected meeting fields are intentionally included to recalculate measured height when content changes.
  useLayoutEffect(() => {
    if (!transcriptVisible) {
      setTranscriptBodyHeight(0);
      return;
    }
    const el = transcriptBodyRef.current;
    if (!el) return;
    setTranscriptBodyHeight(0);
    const frame = requestAnimationFrame(() => {
      setTranscriptBodyHeight(el.scrollHeight);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    transcriptVisible,
    selectedMeeting?.transcript_json,
    selectedMeeting?.enhanced_notes,
    selectedMeeting?.user_notes,
  ]);

  useEffect(() => {
    if (!transcriptVisible) return;
    const handleResize = () => {
      const el = transcriptBodyRef.current;
      if (el) setTranscriptBodyHeight(el.scrollHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [transcriptVisible]);

  const analysisDoc = resolveMeetingAnalysisDocument(selectedMeeting);
  const canonicalAnalysisMarkdown = analysisDoc
    ? analysisDocumentToMarkdown(analysisDoc)
    : selectedMeeting.enhanced_notes || selectedMeeting.user_notes || '';
  const summaryParagraphs = analysisDoc?.summary.length
    ? analysisDoc.summary
    : ['No summary was generated for this meeting.'];
  const keyPoints = analysisDoc?.key_points || [];
  const actionItems = analysisDoc?.action_items || [];
  const decisions = analysisDoc?.decisions || [];

  return (
    <div
      key={selectedMeeting.id}
      className="max-w-4xl mx-auto w-full space-y-20 animate-in pb-32"
    >
      {/* Clean Hero Header */}
      <div className="flex flex-col md:flex-row items-start justify-between gap-8 border-b border-pro-border/40 pb-12">
        <div className="space-y-4 flex-1">
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-bold text-pro-accent uppercase tracking-widest bg-pro-accent/5 px-2 py-1 rounded">
              Synthesis Ready
            </span>
            <span className="text-[10px] text-pro-text-muted/60 font-medium uppercase tracking-widest">
              {new Date(
                selectedMeeting?.created_at ||
                  selectedMeeting?.started_at ||
                  Date.now(),
              ).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
          {editingTitle ? (
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={async () => {
                setEditingTitle(false);
                if (
                  titleValue.trim() &&
                  selectedMeeting &&
                  titleValue !== selectedMeeting.title
                ) {
                  // Save to database
                  await window.ipcRenderer.invoke('SAVE_MEETING', {
                    ...selectedMeeting,
                    title: titleValue.trim(),
                  });
                  // Refresh meetings list
                  fetchMeetings();
                } else if (!titleValue.trim()) {
                  setTitleValue(selectedMeeting?.title || 'Untitled Session');
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                  setTitleValue(selectedMeeting?.title || 'Untitled Session');
                  setEditingTitle(false);
                }
              }}
              className="text-4xl font-extrabold tracking-tight text-pro-text-main leading-tight bg-transparent border-b-2 border-pro-accent outline-none w-full"
            />
          ) : (
            <h1
              onClick={() => {
                setEditingTitle(true);
                setTitleValue(selectedMeeting?.title || 'Untitled Session');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingTitle(true);
                  setTitleValue(selectedMeeting?.title || 'Untitled Session');
                }
              }}
              className="text-2xl md:text-4xl font-extrabold tracking-tight text-pro-text-main leading-tight cursor-text hover:text-pro-accent/80 transition-colors"
            >
              {selectedMeeting?.title || 'Untitled Session'}
            </h1>
          )}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-2 px-3 py-1 bg-pro-accent/10 rounded-full border border-pro-accent/20 ml-2 shadow-sm">
              <BarChart3 className="w-3 h-3 text-pro-accent" />
              <div className="flex items-center gap-0.5 h-3">
                {Array.from({ length: 8 }, (_, barIndex) => barIndex).map(
                  (barIndex) => (
                    <div
                      key={barIndex}
                      className="w-0.5 rounded-full bg-pro-accent/60 animate-pulse"
                      style={{
                        height: `${Math.random() * 8 + 4}px`,
                        animationDelay: `${barIndex * 0.1}s`,
                      }}
                    />
                  ),
                )}
              </div>
              <p className="text-[10px] font-black text-pro-accent uppercase tracking-widest ml-1 opacity-90">
                {selectedMeeting?.duration_seconds
                  ? `${Math.floor(selectedMeeting.duration_seconds / 60)}m ${selectedMeeting.duration_seconds % 60}s`
                  : 'Biometric Audio'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleCopySummary(canonicalAnalysisMarkdown)}
            className={`w-10 h-10 rounded-xl border flex items-center justify-center text-sm transition-all duration-300 ${copySuccess ? 'bg-green-500 border-green-600 text-white scale-110' : 'bg-pro-bg border-pro-border/40 hover:bg-white text-pro-text-main hover:scale-105'}`}
            title="Copy Summary"
          >
            {copySuccess ? (
              <Check className="w-4 h-4" />
            ) : (
              <Copy className="w-4 h-4 opacity-60" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedMeeting) {
                const summaryText = canonicalAnalysisMarkdown;
                const content = `Session: ${selectedMeeting.title}\nDate: ${selectedMeeting.created_at}\n\nSummary:\n${summaryText}\n\nTranscript:\n${selectedMeeting.transcript_json}`;
                const blob = new Blob([content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `pluto-session-${selectedMeeting.id}.txt`;
                a.click();
              }
            }}
            className="w-10 h-10 rounded-xl bg-pro-bg border border-pro-border/40 flex items-center justify-center text-pro-text-main/60 hover:text-pro-text-main hover:bg-white transition-all"
            title="Export Session"
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => handleDeleteMeeting(selectedMeeting.id)}
            className="w-10 h-10 rounded-xl bg-red-500/5 border border-red-500/20 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all active:scale-95"
            title="Delete Meeting"
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Discovery Hub - Related Entities (Knowledge Graph) */}
      <div className="mb-12">
        <EntitySidebar
          meetingId={String(selectedMeeting.id)}
          onEntityClick={(entity) => {
            // Handle entity jump - for now just high level
            console.log('Entity clicked:', entity);
          }}
        />
      </div>

      {/* Summary & Analysis Section */}
      {analysisDoc ? (
        <div className="space-y-16">
          <div className="grid grid-cols-12 gap-8 items-start overflow-visible">
            {/* Left Column: Executive Summary & Key Points */}
            <div className="col-span-12 lg:col-span-7 space-y-12">
              {/* Executive Summary */}
              <div className="space-y-4">
                <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
                  Executive Summary
                </h2>
                <div className="text-xl font-medium leading-[1.6] text-pro-text-main/90 bg-white/40 backdrop-blur-sm p-8 rounded-[2rem] border border-pro-border/40 shadow-sm">
                  {summaryParagraphs.map((line, i) => (
                    <p
                      key={`${line}-${line.length}`}
                      className={i > 0 ? 'mt-4' : ''}
                    >
                      {highlightEntities(line)}
                    </p>
                  ))}
                </div>
              </div>

              {/* Key Insights / Points */}
              <div className="space-y-6">
                <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
                  Key Insights
                </h2>
                <div className="space-y-4">
                  {(keyPoints.length > 0
                    ? keyPoints
                    : ['No key points were captured.']
                  ).map((item) => (
                    <div
                      key={`${item}-${item.length}`}
                      className="p-6 rounded-2xl bg-white border border-pro-border shadow-sm flex gap-4 group hover:border-pro-accent/30 transition-all"
                    >
                      <span className="text-pro-accent group-hover:scale-125 transition-transform shrink-0 pt-0.5">
                        ◆
                      </span>
                      <p className="text-[15px] font-medium leading-relaxed text-pro-text-main/80">
                        {highlightEntities(item)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Decisions Section */}
              <div className="space-y-6">
                <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
                  Decisions
                </h2>
                <div className="p-8 rounded-[2rem] bg-indigo-50/30 border border-indigo-100/50 space-y-4">
                  {(decisions.length > 0
                    ? decisions
                    : ['No explicit decisions were made.']
                  ).map((item) => (
                    <div
                      key={`${item}-${item.length}`}
                      className="flex gap-3 items-baseline"
                    >
                      <span className="text-indigo-500 font-bold leading-none -translate-y-[3px]">
                        ↳
                      </span>
                      <p className="text-[14px] font-semibold text-indigo-900/80 leading-relaxed">
                        {highlightEntities(item)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Action Items */}
            <div className="col-span-12 lg:col-span-5 space-y-12 lg:sticky lg:top-24 lg:self-start">
              <div className="space-y-6">
                <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
                  Action Items
                </h2>
                <div className="space-y-4">
                  {(actionItems.length > 0
                    ? actionItems
                    : ['No concrete action items were explicitly committed.']
                  ).map((item) => (
                    <div
                      key={`${item}-${item.length}`}
                      className="p-6 rounded-2xl bg-white border border-pro-border shadow-premium flex gap-4 group hover:border-pro-accent/30 transition-all card-hover-effect"
                    >
                      <div className="w-6 h-6 rounded-lg border border-pro-border flex items-center justify-center shrink-0 mt-0.5 group-hover:border-pro-accent group-hover:bg-pro-accent/5 transition-all">
                        <Check className="w-3.5 h-3.5 text-pro-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <p className="text-[15px] font-medium leading-relaxed text-pro-text-main/80">
                        {highlightEntities(item)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Empty State vs Content */}
      {!analysisDoc &&
      !selectedMeeting?.enhanced_notes &&
      !selectedMeeting?.user_notes &&
      (!selectedMeeting?.transcript_json ||
        selectedMeeting.transcript_json === '[]') ? (
        <div className="flex-1 flex flex-col items-center justify-center p-20 text-center space-y-6 opacity-60">
          <div className="w-16 h-16 rounded-2xl bg-stone-100 flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-stone-300" />
          </div>
          <h3 className="text-xl font-bold text-pro-text-main">
            No Content Recorded
          </h3>
          <p className="text-sm text-pro-text-muted max-w-sm">
            No audio was detected during this session, so no transcript or
            summary could be generated.
          </p>
        </div>
      ) : (
        <div
          className={`flex-1 flex flex-col ${transcriptVisible ? 'lg:flex-row' : 'lg:flex-col'} h-auto overflow-visible relative`}
        >
          {/* Right: Transcript (Collapsible) - Visual polish */}
          <div className="relative bg-pro-bg lg:bg-transparent z-20 flex-1 border-l border-pro-border/40 lg:border-l-0">
            {transcriptVisible && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-pro-bg z-20" />
            )}
            <div className="flex flex-col">
              {transcriptVisible && (
                <div
                  className="sticky z-30 bg-pro-bg pt-6"
                  style={{ top: '-65px' }}
                >
                  <div className="bg-white shadow-md overflow-hidden">
                    <div className="p-6 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-pro-accent/10 flex items-center justify-center text-pro-accent">
                          <MessageSquare size={14} />
                        </div>
                        <div>
                          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-pro-text-main">
                            Transcript
                          </h3>
                          <p className="text-[9px] font-bold text-pro-text-muted uppercase tracking-widest mt-0.5">
                            Verbatim Record
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTranscriptVisible(false)}
                        className="lg:hidden p-2 hover:bg-black/5 rounded-full transition-colors"
                      >
                        <ChevronDown className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div
                className={`transition-[max-height,opacity] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden ${
                  transcriptVisible
                    ? 'opacity-100'
                    : 'opacity-0 pointer-events-none'
                }`}
                style={{
                  maxHeight: transcriptVisible ? transcriptBodyHeight : 0,
                }}
              >
                <div
                  ref={transcriptBodyRef}
                  className="px-8 pb-10 pt-6 bg-stone-50/30"
                >
                  <div className="space-y-8 max-w-xl mx-auto pt-4">
                    {(() => {
                      if (!selectedMeeting?.transcript_json) return null;
                      let segments = [];
                      try {
                        segments = JSON.parse(selectedMeeting.transcript_json);
                      } catch (e) {
                        console.error('Failed to parse transcript', e);
                        return null;
                      }

                      if (segments.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-20 opacity-40">
                            <Sparkles className="w-5 h-5 text-pro-accent/20 mx-auto mb-3" />
                            <p className="text-pro-text-muted/40 font-bold uppercase tracking-widest text-[9px]">
                              No biometric voice data found
                            </p>
                          </div>
                        );
                      }

                      const mergedSegments: TranscriptSegment[] = [];
                      for (const segment of segments) {
                        const lastSegment =
                          mergedSegments[mergedSegments.length - 1];
                        if (
                          lastSegment &&
                          String(lastSegment.speaker) ===
                            String(segment.speaker)
                        ) {
                          lastSegment.text += ` ${segment.text}`;
                        } else {
                          mergedSegments.push({ ...segment });
                        }
                      }

                      return mergedSegments.map(
                        (s: TranscriptSegment, index: number) => {
                          const segmentKey = `${String(s.speaker ?? 'unknown')}-${index}-${s.text}`;
                          return (
                            <div
                              key={segmentKey}
                              className="group flex gap-12 transition-all"
                            >
                              <div className="w-20 shrink-0 pt-1 text-right">
                                <span className="text-[10px] font-black text-pro-accent uppercase tracking-[0.2em] opacity-40 group-hover:opacity-100 transition-opacity">
                                  {s.speaker || 'Unknown'}
                                </span>
                              </div>
                              <div className="flex-1">
                                <p className="text-pro-text-main text-lg leading-[1.8] font-medium opacity-80 group-hover:opacity-100 transition-opacity">
                                  {highlightEntities(s.text)}
                                </p>
                              </div>
                            </div>
                          );
                        },
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Expansion Action Bar - Refined Gradient & integrated button */}
              {transcriptVisible && (
                <div className="relative flex items-end justify-center pb-8 transition-all duration-700 pt-16 pb-24">
                  <button
                    type="button"
                    onClick={() => setTranscriptVisible(!transcriptVisible)}
                    className="group relative px-8 py-3 bg-white border border-pro-border/60 shadow-[0_4px_24px_rgba(0,0,0,0.04)] rounded-full hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)] hover:border-pro-accent/20 transition-all flex items-center gap-3 active:scale-95"
                  >
                    <span className="text-[10px] font-black text-pro-text-main/80 uppercase tracking-widest group-hover:text-pro-text-main transition-colors">
                      Collapse Transcript
                    </span>
                    <div className="w-5 h-5 rounded-full bg-pro-accent/5 flex items-center justify-center transition-transform duration-500 rotate-180">
                      <ChevronDown className="w-3 h-3 text-pro-accent" />
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>

          {!transcriptVisible && (
            <div className="flex w-full items-center justify-center py-6">
              <button
                type="button"
                onClick={() => setTranscriptVisible(true)}
                className="group relative px-8 py-3 bg-white border border-pro-border/60 shadow-[0_4px_24px_rgba(0,0,0,0.04)] rounded-full hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)] hover:border-pro-accent/20 transition-all flex items-center gap-3 active:scale-95"
              >
                <span className="text-[10px] font-black text-pro-text-main/80 uppercase tracking-widest group-hover:text-pro-text-main transition-colors">
                  Explore Full Transcript
                </span>
                <div className="w-5 h-5 rounded-full bg-pro-accent/5 flex items-center justify-center transition-transform duration-500">
                  <ChevronDown className="w-3 h-3 text-pro-accent" />
                </div>
                <div className="absolute -right-2 -top-2 flex items-center justify-center w-5 h-5 bg-pro-accent text-white rounded-full text-[9px] font-bold shadow-sm animate-in zoom-in duration-300 delay-100">
                  +
                </div>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Discreet Footer */}
      <div className="pt-12 flex items-center justify-between border-t border-pro-border/20 px-4">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest">
              Encrypted
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-pro-accent/30" />
            <span className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest">
              Local Engine v4.2
            </span>
          </div>
        </div>
        <div className="text-[9px] font-bold text-pro-text-muted/20 uppercase tracking-widest">
          Pluto Persistence Layer
        </div>
      </div>
    </div>
  );
};
