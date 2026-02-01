import { useState, useEffect, useRef } from 'react'
import { AudioManager } from './components/AudioManager'
import { SetupWizard } from './components/Setup/SetupWizard'
import './App.css'

// Knowledge Graph Components
import { EntitySidebar } from './components/KnowledgeGraph/EntitySidebar'
import { PeopleTab } from './components/KnowledgeGraph/PeopleTab'
import { ProjectsTab } from './components/KnowledgeGraph/ProjectsTab'
import { TasksTab } from './components/KnowledgeGraph/TasksTab'
import { KnowledgeTab } from './components/KnowledgeGraph/KnowledgeTab'
import { Logo } from './components/Brand/Logo'

interface TranscriptSegment {
    text: string;
    speaker?: string | number;
}

interface Meeting {
    id: string | number;
    title: string;
    created_at: string;
    started_at: string;
    duration_seconds?: number;
    meeting_type?: string;
    enhanced_notes?: string;
    transcript_json?: string;
}

function App() {
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])

  const [isRecording, setIsRecording] = useState(false)
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | number | null>(null)
  const [activeTab, setActiveTab] = useState<'hub' | 'people' | 'projects' | 'wiki' | 'tasks'>('hub')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [searchVisible, setSearchVisible] = useState(false)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [llmProvider, setLlmProvider] = useState<'ollama' | 'gemini' | 'openai' | 'claude'>('ollama')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [claudeApiKey, setClaudeApiKey] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [askPlutoVisible, setAskPlutoVisible] = useState(false)
  const [query, setQuery] = useState('')
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set())
  const [currentNotes, setCurrentNotes] = useState('')
  const [inlineAskPluto, setInlineAskPluto] = useState(false)
  const [plutoResponse, setPlutoResponse] = useState('')
  const stopSessionRef = useRef<(() => void) | null>(null)
  const startSessionRef = useRef<(() => void) | null>(null)

  // Phase 3: Task Completion Handler
  const handleCompleteTask = (taskId: string) => {
      setCompletedTasks(prev => {
          const next = new Set(prev)
          if (next.has(taskId)) next.delete(taskId)
          else next.add(taskId)
          return next
      })
  }

  const handleDeleteMeeting = async (id: string | number) => {
      if (window.confirm('Are you sure you want to delete this meeting and all related intelligence? This cannot be undone.')) {
          try {
              await window.ipcRenderer.invoke('DELETE_MEETING', id)
              setSelectedMeetingId(null)
              fetchMeetings()
          } catch (e) {
              console.error('Failed to delete meeting', e)
          }
      }
  }


  useEffect(() => {
    // Check if setup is needed
    window.ipcRenderer.invoke('GET_SETTING', 'setup_complete').then((val) => {
      setSetupNeeded(val !== 'true')
    })
    
    // Initial fetch of meetings
    fetchMeetings()
    
    // Load LLM settings
    window.ipcRenderer.invoke('GET_SETTING', 'llm_provider').then((val) => {
      if (val) setLlmProvider(val as any)
    })
    window.ipcRenderer.invoke('GET_SETTING', 'gemini_api_key').then((val) => {
      if (val) setGeminiApiKey(val)
    })
    window.ipcRenderer.invoke('GET_SETTING', 'openai_api_key').then((val) => {
      if (val) setOpenaiApiKey(val)
    })
    window.ipcRenderer.invoke('GET_SETTING', 'claude_api_key').then((val) => {
      if (val) setClaudeApiKey(val)
    })

    // Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
            e.preventDefault()
            setSidebarVisible(prev => !prev)
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
            e.preventDefault()
            if (startSessionRef.current && !isRecording) {
                startSessionRef.current()
            }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault()
            setAskPlutoVisible(prev => !prev)
        }
        if ((e.metaKey || e.ctrlKey) && e.key === ',') {
            e.preventDefault()
            setSettingsVisible(true)
        }
        if (e.key === 'Escape') {
            setSearchVisible(false)
            setAskPlutoVisible(false)
        }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const fetchMeetings = async () => {
    try {
      const data = await window.ipcRenderer.invoke('GET_MEETINGS')
      setMeetings(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Failed to fetch meetings', e)
      setMeetings([])
    }
  }

  const handleTranscript = (text: string) => {
      if (!text) return
      // We no longer keep a local transcript array state if it's unused,
      // but we could pass it to notes or just handle via AudioManager
  }


  const handleRecordingChange = (recording: boolean) => {
      const wasRecording = isRecording
      setIsRecording(recording)
      // Only clear on NEW recording start (transition from false -> true)
      if (recording && !wasRecording) {
          setCurrentNotes('') // Clear notes
          setSelectedMeetingId(null) // Switch to live view
      }
  }


  const safeMeetings = Array.isArray(meetings) ? meetings : []

  const selectedMeeting = safeMeetings.find(m => String(m.id) === String(selectedMeetingId))

  const filteredMeetings = safeMeetings.filter(m => 
    (m.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (m.enhanced_notes || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Phase 1: Proactive Intelligence Logic
  const getProactiveIntelligence = () => {
      // 1. Check for upcoming meetings (mock logic since calendar is Sprint 6)
      // For demo, let's assume if there are meetings, the first one is "upcoming"
      const upcomingMeeting = safeMeetings[0]
      
      // 2. Check for overdue items (mock logic for now since entity extraction is Sprint 2)
      // We can check if any meeting has "Action Items" in enhanced_notes
      const hasOverdue = true // Mock for UI/UX demo
      
      if (isRecording) return { greeting: "Capturing Intelligence", detail: "Neural Stream Live", type: "recording" }
      
      if (upcomingMeeting && !selectedMeetingId) {
          return {
              greeting: `Upcoming Meeting Prep`,
              detail: `${upcomingMeeting.title} · Happening in 45 mins`,
              type: "meeting",
              actionLabel: "Review Prep Intel",
              meetingId: upcomingMeeting.id
          }
      }
      
      if (hasOverdue) {
          return {
              greeting: "1 Overdue Item",
              detail: "Finalize Knowledge Graph Schema · Needed for Q1 Demo.",
              type: "urgent",
              actionLabel: "Clear Blocker"
          }
      }
      
      return {
          greeting: `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}`,
          detail: "You're all caught up for now.",
          type: "default"
      }
  }

  const intelligence = getProactiveIntelligence()


  // Fallback if IPC is slow
  useEffect(() => {
    const timer = setTimeout(() => {
        if (setupNeeded === null) setSetupNeeded(false)
    }, 2000)
    return () => clearTimeout(timer)
  }, [setupNeeded])

  if (setupNeeded === null) return <div className="h-screen w-screen bg-pro-bg flex items-center justify-center text-pro-text-muted/20 font-black uppercase tracking-[0.5em] animate-pulse text-xs">Loading Pluto...</div>
  if (setupNeeded) return <SetupWizard onComplete={() => setSetupNeeded(false)} />

  return (
    <div className="flex h-screen w-screen bg-pro-bg text-pro-text-main font-sans overflow-hidden hover:cursor-default selection:bg-pro-accent/20">
      {/* Search Bar - Global HUD */}
      {searchVisible && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 animate-in fade-in duration-300">
           <div className="fixed inset-0 bg-pro-text-main/20 backdrop-blur-sm" onClick={() => setSearchVisible(false)} />
           <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-pro-border relative z-10 overflow-hidden transform animate-in slide-in-from-top-4 duration-500">
                <div className="p-6 flex items-center gap-4 border-b border-pro-border">
                    <span className="text-xl">🔍</span>
                    <input 
                        autoFocus
                        type="text" 
                        placeholder="Search your second brain..." 
                        className="flex-1 bg-transparent border-none outline-none text-lg font-medium text-pro-text-main placeholder:text-pro-text-muted/30"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-1 rounded bg-pro-bg border border-pro-border text-[10px] font-bold text-pro-text-muted/40 uppercase tracking-widest">ESC</span>
                    </div>
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-4 space-y-2">
                    {filteredMeetings.length > 0 ? filteredMeetings.map(m => (
                        <button 
                            key={m.id}
                            onClick={() => { setSelectedMeetingId(m.id); setSearchVisible(false); }}
                            className="w-full text-left p-4 rounded-2xl hover:bg-pro-bg transition-colors group flex items-center justify-between"
                        >
                            <div>
                                <h4 className="font-bold text-pro-text-main group-hover:text-pro-accent transition-colors">{m.title || 'Untitled Session'}</h4>
                                <p className="text-[11px] text-pro-text-muted font-medium mt-1 uppercase tracking-widest">{new Date(m.created_at).toLocaleDateString()}</p>
                            </div>
                            <span className="text-pro-text-muted opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                        </button>
                    )) : (
                        <div className="p-12 text-center">
                            <p className="text-pro-text-muted font-medium italic">No matches found for your search.</p>
                        </div>
                    )}
                </div>
           </div>
        </div>
      )}

      {/* Ask Pluto HUD */}
      {askPlutoVisible && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-in fade-in duration-500">
              <div className="fixed inset-0 bg-pro-text-main/40 backdrop-blur-md" onClick={() => setAskPlutoVisible(false)} />
              <div className="w-full max-w-3xl bg-white rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(26,35,64,0.3)] border border-pro-border relative z-10 overflow-hidden transform animate-in zoom-in-95 duration-500 flex flex-col h-[85vh] md:h-[600px]">
                  <div className="p-8 border-b border-pro-border bg-pro-bg/30">
                      <div className="flex items-center gap-4 mb-6">
                          <div className="w-10 h-10 rounded-xl bg-pro-text-main flex items-center justify-center text-xl shadow-lg">🧠</div>
                          <div>
                              <h2 className="text-xl font-black tracking-tight text-pro-text-main">Ask Pluto</h2>
                              <p className="text-[10px] font-bold text-pro-text-muted/60 uppercase tracking-[.15em] mt-0.5">Neural Synthesis Engine · v1.0</p>
                          </div>
                          <button 
                              onClick={() => setAskPlutoVisible(false)}
                              className="ml-auto w-10 h-10 rounded-xl hover:bg-pro-text-main/5 flex items-center justify-center text-pro-text-muted transition-colors"
                          >✕</button>
                      </div>
                      <div className="relative">
                          <input 
                              autoFocus
                              type="text"
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                              onKeyDown={async (e) => {
                                  if (e.key === 'Enter' && query) {
                                      setPlutoResponse('Thinking...')
                                      try {
                                          const response = await window.ipcRenderer.invoke('ASK_PLUTO', { query, meetingId: selectedMeetingId })
                                          setPlutoResponse(response)
                                      } catch (err) {
                                          setPlutoResponse('I encountered an error while processing your request. Please try again.')
                                      }
                                  }
                              }}
                              placeholder="Search deep memory or ask a question..."
                              className="w-full h-16 px-6 bg-white border border-pro-border rounded-2xl text-lg font-medium outline-none shadow-inner-soft focus:ring-4 focus:ring-pro-accent/10 transition-all placeholder:text-pro-text-muted/20"
                          />
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                              <span className="text-[10px] font-bold text-pro-text-muted/30 uppercase tracking-widest mr-2">Press Enter</span>
                              <div className="w-8 h-8 rounded-lg bg-pro-bg border border-pro-border flex items-center justify-center">↵</div>
                          </div>
                      </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-12 bg-white flex flex-col custom-scrollbar">
                      {plutoResponse ? (
                          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                               <div className="flex items-center gap-3">
                                   <div className="w-1.5 h-1.5 rounded-full bg-pro-accent pulse-glow" />
                                   <span className="text-[10px] font-black text-pro-accent uppercase tracking-widest">Synthesis Output</span>
                               </div>
                               <div className="text-lg leading-relaxed text-pro-text-main/90 font-medium whitespace-pre-wrap selection:bg-pro-accent/20">
                                   {plutoResponse === 'Thinking...' ? (
                                       <div className="flex flex-col gap-4">
                                           <div className="h-4 w-3/4 bg-pro-bg rounded-lg animate-pulse" />
                                           <div className="h-4 w-1/2 bg-pro-bg rounded-lg animate-pulse" />
                                           <div className="h-4 w-5/6 bg-pro-bg rounded-lg animate-pulse" />
                                       </div>
                                   ) : plutoResponse}
                               </div>
                          </div>
                      ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 opacity-40">
                              <div className="w-16 h-16 rounded-3xl bg-pro-bg flex items-center justify-center text-3xl">✨</div>
                              <div className="space-y-1">
                                  <p className="text-sm font-bold text-pro-text-main">Ready to assist.</p>
                                  <p className="text-[11px] font-medium text-pro-text-muted">Ask about specific meetings, projects, or people.</p>
                              </div>
                          </div>
                      )}
                  </div>
                  <div className="p-6 bg-pro-bg/50 border-t border-pro-border flex items-center justify-between">
                      <div className="flex gap-2">
                          {['Projects', 'Timeline', 'People'].map(tag => (
                              <button key={tag} className="px-3 py-1.5 rounded-lg bg-white border border-pro-border text-[10px] font-bold text-pro-text-muted uppercase tracking-widest hover:border-pro-accent transition-colors">{tag}</button>
                          ))}
                      </div>
                      <span className="text-[10px] font-bold text-pro-text-muted/30 uppercase tracking-widest">Powered by {llmProvider}</span>
                  </div>
              </div>
          </div>
      )}

      {/* Settings Modal */}
      {/* Settings Modal (Placeholder for removal if duplicate exists) */}


      {/* Main Content Area */}
      <div className="flex h-screen w-screen bg-pro-bg text-pro-text-main font-sans overflow-hidden hover:cursor-default selection:bg-pro-accent/20">
      {/* AudioManager - Always mounted, always hidden (handles audio in background) */}
      <div className="hidden">
        <AudioManager 
            onTranscript={handleTranscript} 
            onSessionComplete={() => {
                fetchMeetings()
            }} 
            onRecordingChange={handleRecordingChange}
            userNotes={currentNotes}
            onStopSessionRef={stopSessionRef}
            onStartSessionRef={startSessionRef}
        />
      </div>
      
      {/* Sidebar - Navigation (Hidden in Zen Mode) */}
      {!isRecording && (<>
      <div 
        className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-30 lg:hidden transition-opacity duration-300 ${sidebarVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} 
        onClick={() => setSidebarVisible(false)}
      />
      <aside 
        className={`
            w-[85vw] md:w-80 bg-pro-bg/95 backdrop-blur-xl border-r border-pro-border flex flex-col shrink-0 absolute lg:relative h-full z-40 transition-transform duration-300 ease-in-out shadow-2xl lg:shadow-none
            ${sidebarVisible ? 'translate-x-0' : '-translate-x-full lg:-translate-x-80'}
            ${sidebarVisible ? '' : 'lg:-mr-80'}
        `}
      >
        <div className="p-9 pb-8 flex items-center">
             <Logo size={40} showText variant="default" />
        </div>

        {/* Simplified Meeting Widget */}
        <div className="px-6 pb-6 pt-2">
            <div className="relative group">
                <div className="relative overflow-hidden rounded-2xl bg-white border border-pro-border shadow-sm p-5 flex flex-col items-center text-center gap-4 transition-all duration-300 hover:shadow-md hover:border-pro-accent/20">
                    <div className="space-y-1">
                        <h3 className="text-[15px] font-bold text-pro-text-main tracking-tight">New Meeting</h3>
                        <p className="text-[11px] text-pro-text-muted font-medium px-2 leading-normal opacity-70">Capture every detail, effortlessly.</p>
                    </div>

                    <button 
                        onClick={() => {
                            if (startSessionRef.current) {
                                startSessionRef.current()
                            }
                        }}
                        className="w-full h-10 rounded-xl bg-pro-text-main text-white text-[12px] font-bold hover:bg-pro-accent transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                        <span>Start Recording</span>
                    </button>

                    <div className="flex items-center gap-1.5 opacity-20 group-hover:opacity-40 transition-opacity">
                        <span className="text-[9px] font-bold text-pro-text-muted uppercase tracking-widest flex items-center gap-1">
                            <kbd className="font-sans">Cmd</kbd>
                            <span className="w-0.5 h-0.5 rounded-full bg-stone-300" />
                            <kbd className="font-sans">N</kbd>
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-10 custom-scrollbar sidebar-mask">
            {/* Workspace Section */}
            <div className="space-y-1">
                <div className="flex items-center justify-between px-4 mb-3">
                    <h3 className="text-[10px] font-bold text-pro-text-muted/50 uppercase tracking-[0.15em]">Overview</h3>
                </div>
                <button 
                    onClick={() => { setActiveTab('hub'); setSelectedMeetingId(null); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group relative ${activeTab === 'hub' && !selectedMeetingId ? 'bg-pro-text-main text-white shadow-premium' : 'text-pro-text-muted hover:bg-pro-text-main/5 hover:text-pro-text-main'}`}
                >
                    <span className={`text-base transition-transform group-hover:scale-110 ${activeTab === 'hub' && !selectedMeetingId ? 'opacity-100' : 'opacity-60'}`}>🏠</span>
                    <span className="text-[13px] font-bold tracking-tight">Dashboard</span>
                    {activeTab === 'hub' && !selectedMeetingId && <div className="absolute left-[-12px] w-1 h-5 bg-pro-accent rounded-full" />}
                </button>
                <button 
                    onClick={() => { setActiveTab('tasks'); setSelectedMeetingId(null); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group relative ${activeTab === 'tasks' ? 'bg-pro-text-main text-white shadow-premium' : 'text-pro-text-muted hover:bg-pro-text-main/5 hover:text-pro-text-main'}`}
                >
                    <span className={`text-base transition-transform group-hover:scale-110 ${activeTab === 'tasks' ? 'opacity-100' : 'opacity-60'}`}>✅</span>
                    <span className="text-[13px] font-bold tracking-tight">Action Items</span>
                    {activeTab === 'tasks' && <div className="absolute left-[-12px] w-1 h-5 bg-pro-accent rounded-full" />}
                </button>
            </div>

            {/* Second Brain Section */}
            <div className="space-y-1 pt-4">
                <h3 className="px-4 text-[10px] font-bold text-pro-text-muted/30 uppercase tracking-[0.2em] mb-3">Library</h3>
                {[
                    { id: 'projects', name: 'Projects', icon: '📁' },
                    { id: 'people', name: 'People', icon: '👤' },
                    { id: 'wiki', name: 'Knowledge', icon: '🧠' },
                ].map((item) => (
                    <button 
                        key={item.id}
                        onClick={() => { setActiveTab(item.id as any); setSelectedMeetingId(null); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 group relative ${activeTab === item.id && !selectedMeetingId ? 'bg-pro-text-main text-white shadow-premium' : 'text-pro-text-muted hover:bg-pro-text-main/5 hover:text-pro-text-main'}`}
                    >
                        <span className={`text-base transition-transform group-hover:scale-110 ${activeTab === item.id && !selectedMeetingId ? 'opacity-100' : 'opacity-60'}`}>{item.icon}</span>
                        <span className="text-[13px] font-bold tracking-tight">{item.name}</span>
                        {activeTab === item.id && !selectedMeetingId && <div className="absolute left-[-12px] w-1 h-5 bg-pro-accent rounded-full" />}
                    </button>
                ))}
            </div>

            {/* Archive Section */}
            <div className="space-y-1 pt-2">
                <div className="flex items-center justify-between px-4 mb-3">
                    <h3 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">Timeline</h3>
                    <div className="w-1.5 h-1.5 rounded-full bg-pro-accent shadow-status-ok" />
                </div>
                <div className="space-y-1.5">
                    {safeMeetings.slice(0, 10).map((m, i) => (
                        <div key={m.id} className="relative group">
                            <button 
                                onClick={() => { setSelectedMeetingId(m.id); setActiveTab('hub'); }}
                                className={`
                                    w-full text-left px-4 py-3 rounded-xl transition-all border duration-300 relative
                                    ${selectedMeetingId === m.id 
                                        ? 'bg-white border-pro-border shadow-premium' 
                                        : 'border-transparent hover:bg-white/40 hover-lift'
                                    }
                                `}
                            >
                                <div className="flex items-center justify-between gap-3 pr-6">
                                    <span className={`text-[12px] font-bold block truncate ${selectedMeetingId === m.id ? 'text-pro-text-main' : 'text-pro-text-muted/70 group-hover:text-pro-text-main'}`}>
                                        {m.title || 'Untitled Session'}
                                    </span>
                                    {i === 0 && <span className="recency-dot w-1.5 h-1.5 rounded-full bg-pro-accent shrink-0 shadow-status-ok" title="Most Recent" />}
                                </div>
                                <span className="text-[9px] font-black text-pro-text-muted/30 uppercase tracking-widest mt-1 block px-[1px]">
                                    {new Date(m.created_at || m.started_at || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </span>
                            </button>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteMeeting(m.id);
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-red-500/0 hover:bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center z-30"
                                title="Delete Session"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
        
        <div className="p-8 border-t border-pro-border/20 flex flex-col gap-4">
            <button 
                onClick={() => setSettingsVisible(true)}
                className="flex items-center gap-3 text-[11px] font-semibold text-pro-text-muted hover:text-pro-accent transition-all active-push group"
            >
                <div className="w-8 h-8 rounded-lg bg-white border border-pro-border/40 flex items-center justify-center text-sm group-hover:bg-pro-bg transition-colors shadow-sm">⚙️</div>
                <span className="uppercase tracking-widest">Settings</span>
            </button>
            <div className="flex items-center gap-2 px-1">
                <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] shadow-[0_0_12px_rgba(16,185,129,0.3)]" />
                <span className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest leading-none">Safe to Record</span>
            </div>
        </div>
      </aside>
      </>)}
       
       {/* ZEN MODE - Full-screen Granola-inspired interface */}
       {isRecording ? (
            <main className="flex-1 flex flex-col h-full relative z-10 bg-pro-bg overflow-hidden">
                {/* Minimal Top Bar */}
                <header className="h-14 flex items-center justify-between px-6 bg-white/60 backdrop-blur-xl border-b border-stone-200/60 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-red-500/10">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-[10px] font-semibold text-red-600 uppercase tracking-wide">Recording</span>
                        </div>
                    </div>
                    <button 
                        onClick={() => {
                            console.log('[App] End Meeting clicked, ref:', stopSessionRef.current)
                            if (stopSessionRef.current) {
                                stopSessionRef.current()
                            }
                        }}
                        className="px-4 py-1.5 rounded-lg bg-stone-900 text-white text-xs font-semibold hover:bg-stone-800 transition-colors"
                    >
                        End Meeting
                    </button>
                </header>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col relative overflow-hidden">
                    {/* Primary: Note Editor (Granola-style) */}
                    <div className="flex-1 overflow-y-auto">
                        <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-12">
                            <textarea
                                autoFocus
                                value={currentNotes}
                                onChange={(e) => setCurrentNotes(e.target.value)}
                                placeholder="Start typing your notes...\n\nPluto is listening in the background and will enhance these notes with context from the conversation."
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
                                        autoFocus
                                        type="text"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        onKeyDown={async (e) => {
                                            if (e.key === 'Enter' && query) {
                                                setPlutoResponse('Checking past context...')
                                                try {
                                                    const res = await window.ipcRenderer.invoke('ASK_PLUTO', { query })
                                                    setPlutoResponse(res)
                                                } catch (err) {
                                                    setPlutoResponse('Unable to reach your second brain right now.')
                                                }
                                            }
                                            if (e.key === 'Escape') {
                                                setInlineAskPluto(false)
                                                setQuery('')
                                                setPlutoResponse('')
                                            }
                                        }}
                                        placeholder="Ask about previous meetings, decisions, or context..."
                                        className="flex-1 bg-transparent outline-none text-[15px] font-medium text-pro-text-main placeholder:text-pro-text-muted/30"
                                    />
                                    <button 
                                        onClick={() => {
                                            setInlineAskPluto(false)
                                            setQuery('')
                                            setPlutoResponse('')
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
                                             <span className="text-[10px] font-black text-pro-text-muted uppercase tracking-[0.2em]">Synthesis</span>
                                         </div>
                                        {plutoResponse}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="max-w-3xl mx-auto px-8 py-5 flex items-center justify-between">
                                <button
                                    onClick={() => setInlineAskPluto(true)}
                                    className="flex items-center gap-3 text-sm text-pro-text-muted/60 hover:text-pro-accent transition-all group"
                                >
                                    <span className="text-base group-hover:scale-125 transition-transform duration-500">✨</span>
                                    <span className="font-medium">Ask Pluto about previous meetings...</span>
                                </button>
                                <div className="flex items-center gap-1.5 opacity-20 group-hover:opacity-40 transition-opacity">
                                    <span className="px-1.5 py-0.5 rounded bg-white border border-pro-border text-[9px] font-bold text-pro-text-muted/60 uppercase">⌘</span>
                                    <span className="px-1.5 py-0.5 rounded bg-white border border-pro-border text-[9px] font-bold text-pro-text-muted/60 uppercase">K</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>
       ) : (<>
       <main className="flex-1 flex flex-col bg-pro-bg h-full relative z-10 rounded-l-[2.5rem] overflow-hidden content-shift border-l border-pro-border/10">

         <header className="h-28 flex items-center justify-between px-6 md:px-12 shrink-0 bg-pro-bg/40 backdrop-blur-3xl sticky top-0 border-b border-pro-border/20 z-20">
            <div className="flex items-center gap-8">
                <button 
                    onClick={() => setSidebarVisible(prev => !prev)}
                    className="w-11 h-11 rounded-xl bg-white border border-pro-border/40 shadow-premium flex items-center justify-center text-pro-text-muted hover:bg-pro-bg transition-all active-push group"
                >
                    <svg className={`w-5 h-5 transition-transform duration-700 ${sidebarVisible ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                </button>
                <div>
                    <h2 className="text-sm font-black tracking-tight text-pro-text-main group cursor-default">
                         {isRecording ? 'Capturing Intelligence' : selectedMeetingId ? selectedMeeting?.title || 'Review' : activeTab === 'hub' ? 'Dashboard' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                    </h2>
                    <div className="flex items-center gap-2 mt-0.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-pro-accent/20'}`} />
                        <span className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest leading-none">
                            {isRecording ? 'Neural Stream Live' : selectedMeetingId ? 'Archived Context' : 'All Activities'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-4">
                <div 
                    onClick={() => setAskPlutoVisible(true)}
                    className="h-11 px-5 rounded-xl bg-pro-bg/50 border border-pro-border flex items-center gap-4 cursor-text hover:border-pro-accent/40 transition-all group shadow-sm backdrop-blur-xl"
                >
                    <div className="flex items-center gap-3">
                        <span className="text-pro-text-muted opacity-40 group-hover:scale-110 transition-transform">🧠</span>
                        <span className="text-[11px] font-bold text-pro-text-muted/40 uppercase tracking-widest">Ask Pluto Intelligence</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-white border border-pro-border text-[9px] font-bold text-pro-text-muted/30 uppercase">⌘</span>
                        <span className="px-1.5 py-0.5 rounded bg-white border border-pro-border text-[9px] font-bold text-pro-text-muted/30 uppercase">K</span>
                    </div>
                </div>
                {selectedMeetingId && (
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => handleDeleteMeeting(selectedMeetingId)}
                        className="h-11 w-11 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all active-push shadow-sm"
                        title="Delete Meeting"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                    <button 
                        onClick={() => {
                            if (selectedMeeting) {
                                const content = `Session: ${selectedMeeting.title}\nDate: ${selectedMeeting.created_at}\n\nSummary:\n${selectedMeeting.enhanced_notes}\n\nTranscript:\n${selectedMeeting.transcript_json}`
                                const blob = new Blob([content], { type: 'text/plain' })
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement('a')
                                a.href = url
                                a.download = `pluto-session-${selectedMeeting.id}.txt`
                                a.click()
                            }
                        }}
                        className="h-11 px-8 rounded-xl bg-pro-text-main text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-premium hover:bg-pro-accent hover:scale-[1.02] transition-all active-push"
                    >
                        Export
                    </button>
                </div>
                )}
            </div>
         </header>

          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-y-auto px-4 md:px-12 lg:px-20 py-8 md:py-16 space-y-12 md:space-y-20 flex flex-col scroll-smooth relative">
               {/* Global Atmosphere Glows */}
               <div className="fixed top-0 right-0 w-[800px] h-[800px] bg-pro-accent/5 rounded-full blur-[120px] -mr-96 -mt-96 pointer-events-none z-0" />
               <div className="fixed bottom-0 left-0 w-[600px] h-[600px] bg-pro-accent/5 rounded-full blur-[100px] -ml-40 -mb-40 pointer-events-none z-0" />
               <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-pro-accent/5 rounded-full blur-[150px] pointer-events-none z-0 opacity-40" />

                 {selectedMeetingId ? (
                    <div key={selectedMeetingId} className="max-w-4xl mx-auto w-full space-y-20 animate-in pb-32">
                      {/* Clean Hero Header */}
                      <div className="flex flex-col md:flex-row items-start justify-between gap-8 border-b border-pro-border/40 pb-12">
                          <div className="space-y-4 flex-1">
                              <div className="flex items-center gap-4">
                                  <span className="text-[10px] font-bold text-pro-accent uppercase tracking-widest bg-pro-accent/5 px-2 py-1 rounded">Synthesis Ready</span>
                                  <span className="text-[10px] text-pro-text-muted/60 font-medium uppercase tracking-widest">{new Date(selectedMeeting?.created_at || selectedMeeting?.started_at || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                              </div>
                              {editingTitle ? (
                                  <input
                                      autoFocus
                                      type="text"
                                      value={titleValue}
                                      onChange={(e) => setTitleValue(e.target.value)}
                                      onBlur={async () => {
                                          setEditingTitle(false)
                                          if (titleValue.trim() && selectedMeeting && titleValue !== selectedMeeting.title) {
                                              // Save to database
                                              await window.ipcRenderer.invoke('SAVE_MEETING', {
                                                  ...selectedMeeting,
                                                  title: titleValue.trim()
                                              })
                                              // Refresh meetings list
                                              fetchMeetings()
                                          } else if (!titleValue.trim()) {
                                              setTitleValue(selectedMeeting?.title || 'Untitled Session')
                                          }
                                      }}
                                      onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                              e.currentTarget.blur()
                                          }
                                          if (e.key === 'Escape') {
                                              setTitleValue(selectedMeeting?.title || 'Untitled Session')
                                              setEditingTitle(false)
                                          }
                                      }}
                                      className="text-4xl font-extrabold tracking-tight text-pro-text-main leading-tight bg-transparent border-b-2 border-pro-accent outline-none w-full"
                                  />
                              ) : (
                                  <h1 
                                      onClick={() => {
                                          setEditingTitle(true)
                                          setTitleValue(selectedMeeting?.title || 'Untitled Session')
                                      }}
                                      className="text-2xl md:text-4xl font-extrabold tracking-tight text-pro-text-main leading-tight cursor-text hover:text-pro-accent/80 transition-colors"
                                  >
                                      {selectedMeeting?.title || 'Untitled Session'}
                                  </h1>
                              )}
                          </div>
                          <div className="flex gap-2">
                               <button 
                                   onClick={() => handleDeleteMeeting(selectedMeetingId!)}
                                   className="w-10 h-10 rounded-xl bg-red-500/5 border border-red-500/20 flex items-center justify-center text-sm hover:bg-red-500 hover:text-white transition-all text-red-500"
                                   title="Delete Meeting"
                               >
                                   🗑️
                               </button>
                               <button className="w-10 h-10 rounded-xl bg-pro-bg border border-pro-border/40 flex items-center justify-center text-sm hover:bg-white transition-all">💾</button>
                               <button className="w-10 h-10 rounded-xl bg-pro-bg border border-pro-border/40 flex items-center justify-center text-sm hover:bg-white transition-all">🔗</button>
                          </div>
                      </div>

                       {/* Discovery Hub - Related Entities (Knowledge Graph) */}
                       <div className="mb-16">
                           <EntitySidebar 
                                meetingId={selectedMeetingId!} 
                                onEntityClick={(entity) => {
                                    // Handle entity jump - for now just high level
                                    console.log('Entity clicked:', entity)
                                }}
                           />
                       </div>

                       {/* Strategic Reflection Grid */}
                      {/* Structured Analysis Grid */}
                      {selectedMeeting?.enhanced_notes ? (
                          <div className="grid grid-cols-12 gap-8">
                               <div className="col-span-12 space-y-12">
                                   {/* Executive Summary */}
                                   <div className="space-y-4">
                                       <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
                                          Executive Summary
                                       </h2>
                                       <div className="text-xl font-medium leading-relaxed text-pro-text-main/90 bg-pro-bg/20 p-8 rounded-[2rem] border border-pro-border/40">
                                            {selectedMeeting.enhanced_notes.split('\n').filter((l: string) => l.trim() && !l.trim().startsWith('-')).slice(0, 1).map((line: string, i: number) => (
                                                <p key={i}>{line}</p>
                                            ))}
                                       </div>
                                   </div>

                                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                       {/* Key Insights */}
                                       <div className="space-y-6">
                                           <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
                                               Key Insights
                                           </h2>
                                           <div className="space-y-4">
                                                {selectedMeeting.enhanced_notes.split('\n').filter((l: string) => l.trim() && !l.trim().startsWith('-')).slice(1, 5).map((line: string, i: number) => (
                                                    <div key={i} className="p-5 rounded-2xl bg-white border border-pro-border shadow-sm flex gap-4">
                                                        <span className="text-pro-accent">◆</span>
                                                        <p className="text-[14px] font-medium leading-relaxed opacity-80">{line}</p>
                                                    </div>
                                                ))}
                                           </div>
                                       </div>

                                       {/* Action Items */}
                                       <div className="space-y-6">
                                           <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
                                               Action Items
                                           </h2>
                                           <div className="space-y-3">
                                               {selectedMeeting.enhanced_notes.split('\n').filter((l: string) => l.trim().startsWith('-')).map((line: string, i: number) => {
                                                   const cleanLabel = line.replace(/^- \[ \]|^- |^\d+\.\s+/, '').trim()
                                                   if (!cleanLabel) return null
                                                   return (
                                                       <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-pro-bg/50 border border-pro-border/50 group/item hover:bg-white transition-colors">
                                                           <div className="w-5 h-5 rounded-md border-2 border-pro-accent/20 mt-0.5 flex-shrink-0 bg-white" />
                                                           <span className="text-[13px] font-semibold text-pro-text-main/70 leading-snug">{cleanLabel}</span>
                                                       </div>
                                                   )
                                               })}
                                           </div>
                                       </div>
                                   </div>
                               </div>
                          </div>
                      ) : (
                          <div className="py-16 px-10 bg-pro-bg/30 border border-dashed border-pro-border rounded-[2rem] text-center">
                              <p className="text-[10px] font-black text-pro-text-muted/30 uppercase tracking-[0.2em]">No synthesis found</p>
                          </div>
                      )}

                      {/* Transcript Section */}
                      <div className="space-y-12 pb-24">
                        <div className="flex items-center gap-6">
                            <h3 className="text-[10px] font-bold text-pro-text-muted/40 uppercase tracking-[0.2em]">Full Transcript</h3>
                            <div className="flex-1 h-[1px] bg-pro-border/30" />
                        </div>
                        <div className="space-y-12">
                            {(() => {
                                let segments: TranscriptSegment[] = []
                                try {
                                    if (selectedMeeting && selectedMeeting.transcript_json) {
                                        const parsed = JSON.parse(selectedMeeting.transcript_json)
                                        segments = Array.isArray(parsed) ? parsed : (parsed?.segments || [])
                                    } else {
                                        // NEVER fallback to live 'transcript' state in the Archive view
                                        segments = []
                                    }
                                } catch (e) {
                                    console.error('Transcript parse error', e)
                                }
                                
                                if (segments.length === 0) {
                                    return (
                                        <div className="py-12 text-center">
                                            <p className="text-pro-text-muted/40 font-bold uppercase tracking-widest text-[10px]">No transcript data found for this session</p>
                                        </div>
                                    )
                                }

                                // Merge consecutive segments from the same speaker (UI-level fix for old transcripts)
                                const mergedSegments: TranscriptSegment[] = []
                                for (const segment of segments) {
                                    const lastSegment = mergedSegments[mergedSegments.length - 1]
                                    
                                    if (lastSegment && String(lastSegment.speaker) === String(segment.speaker)) {
                                        // Merge with previous segment
                                        lastSegment.text += ' ' + segment.text
                                    } else {
                                        // New speaker, add as new segment
                                        mergedSegments.push({ ...segment })
                                    }
                                }

                                return mergedSegments.map((s: TranscriptSegment, i: number) => {
                                    // Entity Pill logic - Mock for UI demo
                                    const highlightEntities = (text: string) => {
                                        const entities = [
                                            { pattern: /Sarah Chen|Sarah/g, type: 'person', icon: '👤' },
                                            { pattern: /Dave|David/g, type: 'person', icon: '👤' },
                                            { pattern: /API Migration|API/g, type: 'project', icon: '📁' },
                                            { pattern: /Knowledge Graph|Schema/g, type: 'topic', icon: '💡' },
                                            { pattern: /Friday|Monday|Standup/g, type: 'topic', icon: '🗓️' },
                                        ];
                                        
                                        let parts: (string | JSX.Element)[] = [text];
                                        entities.forEach(entity => {
                                            const newParts: (string | JSX.Element)[] = [];
                                            parts.forEach(part => {
                                                if (typeof part === 'string') {
                                                    const subParts = part.split(entity.pattern);
                                                    const matches = part.match(entity.pattern);
                                                    subParts.forEach((sp, j) => {
                                                        newParts.push(sp);
                                                        if (matches && matches[j]) {
                                                            newParts.push(
                                                                <span key={`${entity.type}-${j}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-pro-accent/5 border border-pro-accent/20 rounded-md text-pro-accent font-bold text-[13px] hover:bg-pro-accent hover:text-white transition-colors cursor-pointer group/pill">
                                                                    <span className="opacity-60 group-hover/pill:opacity-100">{entity.icon}</span>
                                                                    {matches[j]}
                                                                </span>
                                                            );
                                                        }
                                                    });
                                                } else {
                                                    newParts.push(part);
                                                }
                                            });
                                            parts = newParts;
                                        });
                                        return parts;
                                    };

                                    return (
                                        <div key={i} className="group flex gap-12 transition-all">
                                            <div className="w-20 shrink-0 pt-1 text-right">
                                                <span className="text-[10px] font-black text-pro-accent uppercase tracking-[0.2em] opacity-40 group-hover:opacity-100 transition-opacity">
                                                    {s.speaker || 'Unknown'}
                                                </span>
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-pro-text-main text-lg leading-relaxed font-medium opacity-80 group-hover:opacity-100 transition-opacity">
                                                    {highlightEntities(s.text)}
                                                </p>
                                            </div>
                                        </div>
                                    )
                                })
                            })()}
                        </div>
                      </div>

                      {/* Discreet Footer */}
                      <div className="pt-12 flex items-center justify-between border-t border-pro-border/20 px-4">
                         <div className="flex items-center gap-8">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                <span className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest">Encrypted</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-pro-accent/30" />
                                <span className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest">Local Engine v4.2</span>
                            </div>
                         </div>
                         <div className="text-[9px] font-bold text-pro-text-muted/20 uppercase tracking-widest">
                            Pluto Persistence Layer
                         </div>
                      </div>
                    </div>
                 ) : activeTab === 'hub' ? (
                    <div className="max-w-5xl mx-auto w-full space-y-16 animate-in relative pb-32">
                         {/* Phase 1: Dynamic Hero Section */}
                         <div className="space-y-10 relative">
                             <div className="space-y-4 max-w-2xl">
                                <p className="text-[10px] font-black text-pro-accent uppercase tracking-[0.3em] mb-2">Pluto Intelligence</p>
                                <h1 className="text-4xl font-black heading-premium tracking-tight text-pro-text-main leading-tight">
                                    {intelligence.greeting}
                                </h1>
                                <p className="text-xl text-pro-text-muted font-medium leading-relaxed">
                                    {intelligence.type === 'default' ? "You're all caught up." : intelligence.detail}
                                </p>
                                {intelligence.actionLabel && (
                                    <div className="pt-4 flex items-center gap-4">
                                        <button 
                                            onClick={() => intelligence.meetingId && setSelectedMeetingId(intelligence.meetingId)}
                                            className="px-8 py-4 rounded-2xl bg-pro-text-main text-white font-black text-[11px] uppercase tracking-[.15em] shadow-premium hover:bg-pro-accent hover:scale-[1.02] transition-all active-push"
                                        >
                                            {intelligence.actionLabel}
                                        </button>
                                        <button className="px-6 py-4 rounded-2xl bg-white border border-pro-border text-pro-text-muted font-black text-[11px] uppercase tracking-[.15em] hover:bg-pro-bg transition-all active-push">
                                            Ignore for now
                                        </button>
                                    </div>
                                )}
                             </div>

                             <div className="flex flex-wrap gap-2.5">
                                {[
                                    { label: "Summarize week", icon: "✨", active: intelligence.type === 'default' },
                                    { label: "Check focus areas", icon: "🎯", active: false },
                                    { label: "Prepare standup", icon: "🚀", active: true },
                                    { label: "Ask Pluto...", icon: "🧠", active: false },
                                ].filter(cta => cta.active || intelligence.type === 'default').slice(0, 3).map((action, i) => (
                                    <button 
                                        key={i}
                                        className="px-5 py-2.5 rounded-full bg-white border border-pro-border shadow-sm hover:border-pro-accent/40 hover:scale-[1.02] transition-all active-push flex items-center gap-2 group"
                                    >
                                        <span className="text-sm group-hover:scale-110 transition-transform">{action.icon}</span>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-pro-text-main opacity-60 group-hover:opacity-100">{action.label}</span>
                                    </button>
                                ))}
                             </div>
                         </div>
 
                         {/* Phase 2: Priority Card System */}
                         <div className="grid grid-cols-12 gap-6 items-start">
                            {/* Live Recording Stream (Hero priority if recording) */}


                            {/* Main Intelligence Grid */}
                            <div className="grid grid-cols-12 gap-6 col-span-12">
                                {/* Next Meeting Intelligence - SECONDARY (or HERO if no recording) */}
                                <div className={`${!isRecording ? 'col-span-12 xl:col-span-8' : 'col-span-6'} bg-white border border-pro-border rounded-[2.5rem] p-10 flex flex-col justify-between min-h-[420px] shadow-sm relative overflow-hidden group hover:border-pro-accent/40 card-hover-effect`}>
                                    <div className="z-10 space-y-8">
                                        <div className="flex items-center justify-between">
                                            <div className="w-12 h-12 rounded-2xl bg-pro-bg border border-pro-border flex items-center justify-center text-xl shadow-soft group-hover:bg-pro-accent group-hover:text-white transition-all duration-700">📅</div>
                                            <span className="text-[10px] font-black text-pro-accent uppercase tracking-[0.2em] bg-pro-accent/5 px-3 py-1.5 rounded-full">Coming Up Next</span>
                                        </div>
                                        <div className="space-y-4">
                                            <div>
                                                <h3 className="text-2xl md:text-3xl font-black tracking-tight leading-tight">Product Alignment</h3>
                                                <p className="text-[12px] text-pro-text-muted font-bold opacity-40 mt-1 uppercase tracking-widest">With Sarah Chen, Dave Miller + 2 others</p>
                                            </div>
                                            <div className="p-6 bg-pro-bg/50 rounded-3xl border border-pro-border/40 space-y-4">
                                                <p className="text-[9px] font-black text-pro-text-muted/40 uppercase tracking-[.2em]">Last discussed (Jan 28)</p>
                                                <p className="text-[14px] font-bold text-pro-text-main leading-relaxed italic line-height-extra">"We need to finalize the schema for the knowledge graph before Friday's demo."</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-3 relative z-10 pt-8">
                                        <button className="flex-1 py-4 rounded-xl bg-[#1E1F24] text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-2xl hover:bg-pro-accent transition-all active-push">Prep Intel Card</button>
                                        <button className="w-14 h-14 rounded-xl bg-white border border-pro-border flex items-center justify-center hover:bg-pro-bg transition-all active-push shadow-sm">🔗</button>
                                    </div>
                                    <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-pro-accent/5 rounded-full blur-[100px] group-hover:bg-pro-accent/10 transition-colors pointer-events-none" />
                                </div>

                                {/* Overdue / Pending Items - SECONDARY */}
                                <div className={`${!isRecording ? 'col-span-12 xl:col-span-4' : 'col-span-6'} glass-card border border-pro-border rounded-[2.5rem] p-10 min-h-[420px] shadow-sm flex flex-col space-y-8 card-hover-effect overflow-hidden relative`}>
                                    <div className="flex items-center justify-between relative z-10">
                                        <h3 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
                                        ⚠️ Action Insights
                                        </h3>
                                        <button className="h-8 px-4 rounded-lg bg-pro-bg border border-pro-border text-[9px] font-black text-pro-accent uppercase tracking-widest hover:bg-pro-accent hover:text-white transition-all active-push shadow-sm" onClick={() => setActiveTab('tasks')}>View all</button>
                                    </div>
                                    <div className="flex-1 space-y-2 overflow-y-auto pr-2 custom-scrollbar relative z-10">
                                        {[
                                            { id: 't1', task: "Finalize Schema", due: "Yesterday", status: "overdue", source: "Project Alignment" },
                                            { id: 't2', task: "API migration doc", due: "Today", status: "stale", source: "Team Standup" },
                                            { id: 't3', task: "Review Dave's PR", due: "Tomorrow", status: "active", source: "Technical Sync" },
                                        ].map((t) => {
                                            const isDone = completedTasks.has(t.id)
                                            return (
                                                <div 
                                                    key={t.id} 
                                                    onClick={(e) => { e.stopPropagation(); handleCompleteTask(t.id); }}
                                                    className={`group/item p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-4 ${isDone ? 'bg-pro-success/5 border-pro-success/20 opacity-60 scale-[0.98] success-ring' : 'hover:border-pro-border/20 hover:bg-white border-transparent'}`}
                                                >
                                                    <div className={`w-6 h-6 rounded-lg border-2 mt-0.5 flex items-center justify-center transition-all ${isDone ? 'bg-pro-success border-pro-success' : 'border-pro-border group-hover/item:border-pro-accent'}`}>
                                                        {isDone && <span className="text-white text-[10px]">✓</span>}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start gap-2 mb-1">
                                                            <span className={`text-[13px] font-bold leading-tight truncate transition-all ${isDone ? 'line-through text-pro-text-muted' : 'text-pro-text-main'}`}>
                                                                {t.task}
                                                            </span>
                                                            {!isDone && <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 shadow-sm ${t.status === 'overdue' ? 'bg-pro-urgent pulse-urgent' : t.status === 'stale' ? 'bg-pro-warning' : 'bg-pro-accent/20'}`} />}
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[9px] font-bold text-pro-text-muted/30 uppercase tracking-widest">Due {t.due}</span>
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); console.log('Snooze'); }}
                                                                className="text-[9px] font-bold text-pro-accent/40 uppercase tracking-widest opacity-0 group-hover/item:opacity-100 transition-opacity hover:text-pro-accent"
                                                            >
                                                                Snooze
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}

                                        <div className="pt-4 text-center">
                                            <p className="text-[10px] font-bold text-pro-text-muted/20 uppercase tracking-widest cursor-pointer hover:text-pro-text-muted/40 transition-colors">+ 2 more items</p>
                                        </div>
                                    </div>
                                    <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-pro-urgent/5 rounded-full blur-3xl pointer-events-none" />
                                </div>
                            </div>

                            <div className="col-span-12 bg-pro-bg border border-pro-border rounded-[2.5rem] p-10 relative overflow-hidden group hover:border-pro-accent/40 card-hover-effect">
                                {/* Background Effects (Shared) */}
                                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-pro-accent/5 rounded-full blur-[120px] -mr-40 -mt-40 pointer-events-none opacity-50" />
                                <div className="absolute -left-20 -bottom-20 w-80 h-80 bg-pro-success/5 rounded-full blur-[100px] pointer-events-none" />

                                {/* Layout 1: Vertical (Mobile -> Laptop) */}
                                <div className="flex xl:hidden flex-col justify-between h-full relative z-10 gap-8">
                                     <div className="space-y-8">
                                        <div className="flex items-center justify-between">
                                            <div className="w-12 h-12 rounded-2xl bg-white border border-pro-border flex items-center justify-center text-3xl shadow-soft">👤</div>
                                            <div className="flex items-center gap-4">
                                                <span className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">Contextual Spotlight</span>
                                                <div className="w-1.5 h-1.5 rounded-full bg-pro-success shadow-status-ok" />
                                            </div>
                                        </div>
                                        <div className="space-y-6">
                                            <div>
                                                <h4 className="text-3xl font-black tracking-tighter leading-none mb-2 uppercase text-pro-text-main">Sarah Chen</h4>
                                                <p className="text-[11px] font-bold text-pro-accent uppercase tracking-[.25em]">Principal Engineering Lead</p>
                                            </div>
                                            <div className="p-8 bg-pro-bg/50 rounded-3xl border border-pro-border/40 space-y-6">
                                                <div className="flex items-center justify-between border-b border-pro-border/20 pb-4">
                                                    <span className="text-[9px] font-black text-pro-text-muted/40 uppercase tracking-widest">Smart Insight</span>
                                                    <span className="text-[9px] font-black text-pro-accent uppercase tracking-widest">Sprint 1 Target</span>
                                                </div>
                                                <p className="text-[16px] font-medium text-pro-text-main leading-relaxed italic">
                                                    "You haven't followed up on the schema design with Sarah in 3 days. Sarah is attending today's Product Alignment."
                                                </p>
                                                <div className="flex flex-wrap gap-2">
                                                    {["API Migration", "Schema Design"].map((tag) => (
                                                        <span key={tag} className="px-3 py-1.5 bg-white border border-pro-border rounded-lg text-[9px] font-black text-pro-text-main/60 uppercase tracking-tight">{tag}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-3 pt-4 mt-auto">
                                        <button onClick={() => setActiveTab('people')} className="flex-1 py-4 rounded-xl bg-white border border-pro-border text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] shadow-soft hover:bg-pro-bg transition-all active-push">View Biography</button>
                                        <button className="flex-1 py-4 rounded-xl bg-[#2A2B32] text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-premium hover:bg-pro-accent transition-all active-push">Draft Follow-up</button>
                                    </div>
                                </div>

                                {/* Layout 2: 3-Column Specific Layout (Desktop XL+) - MATCHES USER SCREENSHOT */}
                                <div className="hidden xl:flex relative z-10 w-full h-full items-center justify-between gap-12">
                                     {/* Left: Identity */}
                                     <div className="flex flex-col gap-6 w-[280px] shrink-0">
                                         <span className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] px-1">Contextual Spotlight</span>
                                         <div className="flex items-center gap-6">
                                            <div className="w-24 h-24 rounded-[1.5rem] bg-white border border-pro-border/10 flex items-center justify-center text-pro-accent shadow-sm relative overflow-hidden group-hover:scale-105 transition-transform duration-500 shrink-0">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 text-[#5E82A3]">
                                                    <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
                                                </svg>
                                            </div>
                                            <div className="space-y-1.5 flex-1 min-w-0">
                                                <h4 className="text-2xl font-black text-pro-text-main tracking-tight uppercase leading-none break-words">Sarah Chen</h4>
                                                <p className="text-[10px] font-bold text-pro-accent uppercase tracking-[0.25em] leading-relaxed">Principal Engineering Lead</p>
                                            </div>
                                         </div>
                                     </div>

                                     {/* Center: Insight Card */}
                                     <div className="flex-1 bg-pro-bg rounded-[2.5rem] border border-pro-border/10 p-8 space-y-6 self-stretch flex flex-col justify-center max-w-2xl shadow-sm">
                                         <div className="flex items-center justify-between">
                                              <span className="text-[9px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">Smart Insight</span>
                                              <span className="text-[9px] font-black text-pro-accent uppercase tracking-[0.2em]">Sprint 1 Target</span>
                                         </div>
                                         <p className="text-[13px] font-bold text-pro-text-main/80 leading-relaxed italic">
                                             "You haven't followed up on the schema design with Sarah in 3 days. Sarah is attending today's Product Alignment."
                                         </p>
                                         <div className="flex gap-2">
                                             {["API Migration", "Schema Design"].map(tag => (
                                                 <span key={tag} className="px-3 py-1.5 bg-white border border-pro-border/10 rounded-lg text-[9px] font-bold text-pro-text-muted uppercase tracking-wider shadow-sm">{tag}</span>
                                             ))}
                                         </div>
                                     </div>

                                     {/* Right: Actions */}
                                     <div className="flex flex-col gap-4 w-[200px] shrink-0">
                                         <button onClick={() => setActiveTab('people')} className="w-full py-4 rounded-xl bg-white border border-pro-border/10 text-pro-text-main font-black text-[10px] uppercase tracking-[0.2em] shadow-sm hover:bg-pro-bg transition-all active-push">
                                             View Biography
                                         </button>
                                         <button className="w-full py-4 rounded-xl bg-[#1A1D26] text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-premium hover:bg-pro-accent transition-all active-push">
                                             Draft Follow-up
                                         </button>
                                     </div>
                                </div>
                            </div>
                         </div>
 
                         <div className="space-y-8">
                            <div className="flex items-center justify-between border-b border-pro-border/40 pb-6">
                                 <h2 className="text-xl font-black tracking-tight">Live Intelligence Documents</h2>
                                <button className="text-[10px] font-black text-pro-accent uppercase tracking-[0.15em] hover:underline" onClick={() => setActiveTab('wiki')}>Library Hub</button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                                 {[
                                     { title: "Engineering Standups", desc: "Accumulated team context across 14 sessions.", icon: "👥", count: "14 Sessions" },
                                     { title: "API Migration Space", desc: "Consolidated decisions and technical schema logic.", icon: "🏗️", count: "8 Decisions" },
                                     { title: "Sarah Chen Dossier", desc: "Recurring themes and deliverables discussed with Sarah.", icon: "👤", count: "12 Mentions" },
                                     { title: "Product Roadmap", desc: "Evolving vision tracked through weekly syncs.", icon: "🚀", count: "5 Key Shifts" },
                                 ].map((item, i) => (
                                     <button key={i} className="text-left glass-card border border-pro-border rounded-[2rem] p-8 space-y-6 hover:border-pro-accent/40 transition-all group card-hover-effect">
                                         <div className="w-12 h-12 rounded-2xl bg-white border border-pro-border flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-soft">{item.icon}</div>
                                         <div className="space-y-2">
                                             <div className="flex items-center justify-between">
                                                 <h4 className="text-[14px] font-black tracking-tight leading-loose uppercase">{item.title}</h4>
                                             </div>
                                             <p className="text-[11px] text-pro-text-muted font-bold leading-relaxed opacity-60 line-clamp-2">{item.desc}</p>
                                         </div>
                                         <div className="pt-4 border-t border-pro-border/10 flex items-center justify-between">
                                             <span className="text-[9px] font-black text-pro-accent uppercase tracking-widest">{item.count}</span>
                                             <span className="text-pro-text-muted/40 text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                                         </div>
                                     </button>
                                 ))}
                            </div>
                         </div>
                    </div>
                ) : activeTab === 'people' ? (
                     <div className="max-w-4xl mx-auto w-full space-y-12 animate-in pb-20">
                        <PeopleTab />
                     </div>
                ) : activeTab === 'projects' ? (
                    <div className="max-w-4xl mx-auto w-full space-y-12 animate-in pb-20">
                        <ProjectsTab />
                    </div>
                ) : activeTab === 'wiki' ? (
                    <div className="max-w-5xl mx-auto w-full space-y-12 animate-in pb-20">
                        <KnowledgeTab />
                    </div>
                ) : activeTab === 'tasks' ? (
                    <div className="max-w-4xl mx-auto w-full space-y-12 animate-in pb-20">
                        <TasksTab />
                    </div>
                ) : (
                    <div className="max-w-4xl mx-auto w-full space-y-24 animate-in duration-1000 text-center py-40 relative">
                        {/* Background Atmosphere */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pro-accent/5 rounded-full blur-[120px] pointer-events-none" />
                        
                        <div className="w-32 h-32 rounded-[3.5rem] bg-white border border-pro-border flex items-center justify-center text-5xl mx-auto mb-10 shadow-premium active-push group">
                            <span className="group-hover:rotate-12 transition-transform duration-500">
                                {activeTab === 'people' ? '👤' : activeTab === 'projects' ? '📁' : activeTab === 'wiki' ? '🧠' : '🎯'}
                            </span>
                        </div>
                        
                        <div className="space-y-6 relative z-10">
                            <h2 className="text-5xl font-black heading-premium tracking-tighter uppercase italic opacity-10">{activeTab} Terminal</h2>
                            <h2 className="text-4xl font-black tracking-tight tracking-tighter">Your {activeTab} space is <span className="gradient-text">awaiting context.</span></h2>
                            <p className="text-lg text-pro-text-muted/60 font-medium max-w-xl mx-auto leading-relaxed">
                                The extraction engine is indexing your local nebula. Record a session to populate this space with interconnected insights.
                            </p>
                        </div>

                        <div className="pt-10 flex flex-col items-center gap-6 relative z-10">
                             <button 
                                onClick={() => window.dispatchEvent(new CustomEvent('START_RECORDING'))}
                                className="h-16 px-12 rounded-3xl bg-pro-text-main text-white font-black text-xs uppercase tracking-[0.2em] shadow-2xl hover:bg-pro-accent hover:scale-[1.02] transition-all active-push"
                             >
                                Initialize Capture
                             </button>
                             <p className="text-[10px] font-black text-pro-text-muted/30 uppercase tracking-[0.3em]">Ready for M-Series Deployment</p>
                        </div>
                    </div>
                )  }
         </div>
        </main>
      </>
      )}

      {/* Global Overlays - High Z-Index, Viewport Fixed */}
      
      {/* Ask Pluto Overlay */}
      {askPlutoVisible && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 sm:p-24 animate-in">
              {/* High Contrast Deep Backdrop */}
              <div 
                className="absolute inset-0 bg-[#163758]/95 backdrop-blur-xl transition-all duration-1000" 
                onClick={() => setAskPlutoVisible(false)} 
              />
              
              <div className="w-full max-w-2xl bg-[#163758] rounded-[3rem] border border-white/10 overflow-hidden relative flex flex-col max-h-[85vh] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)] modal-glow transition-all duration-500 scale-in-center">
                  {/* Atmospheric Top Glow */}
                  <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-[#C6AA79]/20 via-transparent to-transparent pointer-events-none" />
                  
                  {/* Header Area */}
                  <div className="p-8 pb-4 flex items-center justify-between relative z-10 border-b border-white/5">
                      <div className="flex items-center gap-3">
                           <Logo size={24} variant="gold" />
                           <h3 className="text-[10px] font-black text-[#C6AA79] uppercase tracking-[0.3em] leading-none">Pluto Intelligence</h3>
                      </div>
                      <button 
                        onClick={() => setAskPlutoVisible(false)} 
                        className="w-10 h-10 rounded-2xl bg-white/5 hover:bg-white/10 transition-all flex items-center justify-center group"
                      >
                           <span className="text-[10px] font-black text-slate-500 group-hover:text-white transition-colors uppercase tracking-widest">Esc</span>
                      </button>
                  </div>

                  <div className="px-8 pt-8 pb-6 flex flex-col gap-8 relative z-10">
                      {/* Input Section */}
                      <div className="relative group/input">
                          <input 
                            autoFocus
                            placeholder="Ask Pluto anything..."
                            className="w-full bg-white/[0.04] border border-white/10 rounded-2xl p-6 text-xl font-medium tracking-tight text-white focus:bg-white/[0.07] focus:border-indigo-500/40 outline-none transition-all placeholder:text-white/10"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-3">
                              <div className="w-11 h-11 rounded-xl bg-indigo-500 text-white flex items-center justify-center shadow-lg transform hover:scale-105 transition-all">
                                 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                 </svg>
                              </div>
                          </div>
                      </div>

                      {/* Chips / Suggestions */}
                      {!query && (
                      <div className="flex flex-wrap gap-2.5 animate-in slide-in-from-top-4 duration-500">
                          {["Summarize this week", "Action items for Sarah", "Neptune status"].map(tag => (
                              <button 
                                key={tag} 
                                onClick={() => setQuery(tag)} 
                                className="px-4 py-2 bg-white/[0.04] border border-white/5 rounded-xl text-[10px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-all uppercase tracking-widest"
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
                                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Synthesis</span>
                                  </div>

                                  <p className="text-white text-lg font-medium leading-relaxed tracking-tight">
                                      Based on your recent sessions, Sarah Chen is focused on the <span className="text-indigo-400 font-bold decoration-indigo-400/30 underline">API Migration</span> project. She highlighted a schema design bottleneck during the technical sync.
                                  </p>

                                  <div className="flex flex-wrap gap-2 pt-2">
                                      {["Mon Standup", "Tech Sync"].map(source => (
                                          <span key={source} className="px-3 py-1.5 bg-white/[0.05] border border-white/10 rounded-lg text-[9px] font-bold text-slate-400 uppercase tracking-wider">{source}</span>
                                      ))}
                                  </div>
                              </div>

                              {/* Primary Action Only */}
                              <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                                  <button className="h-12 px-8 rounded-xl bg-pro-accent text-[#163758] font-black text-[10px] uppercase tracking-widest hover:bg-pro-accent-alt transition-all shadow-lg active-push">
                                      Create Action Item
                                  </button>
                                  <button className="text-[10px] font-bold text-slate-500 hover:text-white transition-colors uppercase tracking-widest">Share Insight →</button>
                              </div>
                          </div>
                      ) : (
                          <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-center space-y-4">
                               <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center">
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                               </div>
                               <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Intelligence Ready</p>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
      {searchVisible && (
          <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-24 px-6 animate-in">
              <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md" onClick={() => setSearchVisible(false)} />
              <div className="w-full max-w-3xl bg-white rounded-[2.5rem] shadow-2xl border border-pro-border overflow-hidden relative scale-in-center">
                  <div className="p-10 border-b border-pro-border/40 flex items-center gap-8">
                      <div className="w-12 h-12 rounded-2xl bg-pro-bg flex items-center justify-center border border-pro-border/40 text-pro-text-muted shadow-sm">
                          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                      </div>
                      <input 
                        autoFocus
                        type="text" 
                        placeholder="Search your second brain..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-1 bg-transparent border-none outline-none text-3xl font-black tracking-tight placeholder:text-pro-text-muted/20 text-pro-text-main"
                      />
                      <div className="flex items-center gap-2">
                          <span className="px-3 py-1.5 bg-pro-bg border border-pro-border rounded-xl text-[10px] font-black text-pro-text-muted/40 uppercase tracking-widest">Esc</span>
                      </div>
                  </div>
                  <div className="max-h-[60vh] overflow-y-auto p-10 custom-scrollbar">
                      {searchQuery && filteredMeetings.length === 0 ? (
                          <div className="py-20 text-center">
                              <p className="text-pro-text-muted/40 font-black uppercase tracking-[0.2em] text-[12px]">No matching artifacts found</p>
                          </div>
                      ) : (
                          <div className="space-y-10">
                             {filteredMeetings.length > 0 && (
                                <div className="space-y-6">
                                    <h3 className="text-[10px] font-black text-pro-text-muted/30 uppercase tracking-[0.3em] px-2">Memory Clusters</h3>
                                    <div className="grid grid-cols-2 gap-6">
                                        {filteredMeetings.map(m => (
                                            <button 
                                                key={m.id}
                                                onClick={() => {
                                                    setSelectedMeetingId(m.id)
                                                    setSearchVisible(false)
                                                    setSearchQuery('')
                                                }}
                                                className="w-full text-left p-8 rounded-[2rem] bg-white border border-pro-border/40 hover:border-pro-accent/40 hover:shadow-xl transition-all flex flex-col gap-4 group shadow-sm active-push"
                                            >
                                                <div className="flex justify-between items-center">
                                                    <div className="w-10 h-10 rounded-xl bg-pro-bg flex items-center justify-center text-xl group-hover:scale-110 transition-transform">📄</div>
                                                    <span className="text-[10px] font-black text-pro-text-muted/30 uppercase tracking-widest">{new Date(m.created_at || m.started_at || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                                                </div>
                                                <p className="text-xl font-black text-pro-text-main tracking-tight line-clamp-1">{m.title || 'Untitled Session'}</p>
                                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <span className="text-[9px] font-black text-pro-accent uppercase tracking-widest">Open Artifact →</span>
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
      )}
      {settingsVisible && (
          <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-24 px-6 animate-in">
              <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md" onClick={() => setSettingsVisible(false)} />
              <div className="w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl border border-pro-border overflow-hidden relative scale-in-center">
                  <div className="p-10 border-b border-pro-border/40 flex items-center justify-between bg-pro-bg/50">
                      <div className="flex items-center gap-6">
                          <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-3xl border border-pro-border/40 shadow-sm">⚙️</div>
                          <div>
                              <h2 className="text-3xl font-black tracking-tighter">System Settings</h2>
                              <p className="text-[10px] text-pro-text-muted/60 font-black uppercase tracking-[0.2em] mt-2">Local Intelligence Engine v4.2</p>
                          </div>
                      </div>
                      <button onClick={() => setSettingsVisible(false)} className="w-12 h-12 rounded-2xl hover:bg-pro-bg transition-all flex items-center justify-center text-sm border border-pro-border/40 shadow-sm active-push group">
                         <span className="text-pro-text-muted group-hover:text-pro-text-main transition-colors font-bold">✕</span>
                      </button>
                  </div>
                  
                  <div className="p-10 space-y-12">
                      {/* Provider Selection */}
                      <div className="space-y-8">
                          <div className="flex items-center justify-between">
                              <label className="text-[11px] font-black text-pro-text-main uppercase tracking-[0.2em]">Cognitive Provider</label>
                              <span className="text-[10px] font-black text-pro-accent uppercase bg-pro-accent/5 px-3 py-1 rounded-full border border-pro-accent/10 tracking-widest">
                                {llmProvider === 'ollama' ? 'Local-First' : 'Cloud Hybrid'}
                              </span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                              {[
                                  { id: 'ollama', name: 'Ollama', label: 'Local', icon: '🦙' },
                                  { id: 'gemini', name: 'Gemini', label: 'Google', icon: '✨' },
                                  { id: 'openai', name: 'OpenAI', label: 'GPT-4', icon: '🤖' },
                                  { id: 'claude', name: 'Claude', label: 'Anthropic', icon: '🎭' },
                              ].map(p => (
                                  <button
                                    key={p.id}
                                    onClick={() => {
                                        setLlmProvider(p.id as any)
                                        window.ipcRenderer.invoke('SET_SETTING', { key: 'llm_provider', value: p.id })
                                    }}
                                    className={`p-6 rounded-[1.5rem] border-2 transition-all flex flex-col gap-3 text-left group ${llmProvider === p.id ? 'border-pro-accent bg-pro-accent/5 shadow-premium' : 'border-pro-border hover:border-pro-accent/20 bg-white'}`}
                                  >
                                      <div className="flex justify-between items-center">
                                          <span className="text-2xl group-hover:scale-110 transition-transform">{p.icon}</span>
                                          {llmProvider === p.id && <div className="w-2 h-2 rounded-full bg-pro-accent shadow-status-ok" />}
                                      </div>
                                      <div>
                                          <span className="block text-[14px] font-black tracking-tight">{p.name}</span>
                                          <span className="text-[9px] font-black text-pro-text-muted/60 uppercase tracking-widest">{p.label}</span>
                                      </div>
                                  </button>
                              ))}
                          </div>
 
                          {llmProvider !== 'ollama' && (
                            <div className="space-y-4 pt-4 animate-in slide-in-from-top-4">
                              <label className="text-[10px] font-black text-pro-text-muted uppercase tracking-[0.2em]">Encryption Key / API Token</label>
                              <input
                                type="password"
                                placeholder={`Enter your ${llmProvider} credentials...`}
                                value={llmProvider === 'gemini' ? geminiApiKey : llmProvider === 'openai' ? openaiApiKey : claudeApiKey}
                                onChange={(e) => {
                                  const value = e.target.value
                                  if (llmProvider === 'gemini') {
                                    setGeminiApiKey(value)
                                    window.ipcRenderer.invoke('SET_SETTING', { key: 'gemini_api_key', value })
                                  } else if (llmProvider === 'openai') {
                                    setOpenaiApiKey(value)
                                    window.ipcRenderer.invoke('SET_SETTING', { key: 'openai_api_key', value })
                                  } else if (llmProvider === 'claude') {
                                    setClaudeApiKey(value)
                                    window.ipcRenderer.invoke('SET_SETTING', { key: 'claude_api_key', value })
                                  }
                                }}
                                className="w-full p-5 rounded-2xl border-2 border-pro-border bg-white text-[15px] font-bold tracking-tight focus:border-pro-accent outline-none transition-all shadow-inner"
                              />
                            </div>
                          )}
                          
                          {llmProvider === 'ollama' && (
                            <div className="p-6 bg-indigo-500/5 rounded-2xl border border-indigo-500/10 flex gap-4 items-start">
                              <span className="text-xl">🛡️</span>
                              <div>
                                <p className="text-[12px] font-bold text-pro-text-main leading-relaxed">
                                  Privacy-First Local Deployment
                                </p>
                                <p className="text-[11px] text-pro-text-muted/70 leading-relaxed mt-1">
                                  Neural weights are processed exclusively on your machine. Zero data egress.
                                </p>
                              </div>
                            </div>
                          )}
                      </div>
 
                      <div className="pt-10 border-t border-pro-border/20 flex items-center justify-between">
                          <button 
                            className="text-[10px] font-black text-red-500/40 hover:text-red-500 uppercase tracking-widest transition-colors px-4 py-2 rounded-lg hover:bg-red-50 text-left"
                            onClick={async () => {
                                if (confirm('Are you sure you want to reset all knowledge? This action is irreversible.')) {
                                    try {
                                        await window.ipcRenderer.invoke('RESET_KNOWLEDGE')
                                        fetchMeetings()
                                        setSelectedMeetingId(null)
                                        setSettingsVisible(false)
                                    } catch (e) {
                                        console.error('Failed to reset knowledge', e)
                                        alert('Failed to reset knowledge base')
                                    }
                                }
                            }}
                          >
                            Reset Neural Fabric
                          </button>
                          <button 
                            onClick={() => setSettingsVisible(false)} 
                            className="h-14 px-12 rounded-2xl bg-pro-text-main text-white font-black text-[12px] uppercase tracking-[0.2em] hover:bg-pro-accent transition-all active-push shadow-premium"
                          >
                            Save & Return
                          </button>
                      </div>

                  </div>
              </div>
          </div>
      )}
    </div>
    </div>
  )
}

export default App

