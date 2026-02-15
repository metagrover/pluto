import { useState, useEffect, useRef, useReducer } from 'react'
import { AudioManager } from './components/AudioManager'
import { SetupWizard } from './components/Setup/SetupWizard'
import './App.css'

// Layout Components
import { Sidebar } from './components/layout/Sidebar'

// Feature Components
import { ZenMode } from './components/features/ZenMode'
import { Dashboard } from './components/features/Dashboard'
import { MeetingView } from './components/features/MeetingView'

// Knowledge Graph Components
import { PeopleTab } from './components/KnowledgeGraph/PeopleTab'
import { ProjectsTab } from './components/KnowledgeGraph/ProjectsTab'
import { TasksTab } from './components/KnowledgeGraph/TasksTab'
import { KnowledgeTab } from './components/KnowledgeGraph/KnowledgeTab'

// Overlay Components
import { SearchOverlay } from './components/overlays/SearchOverlay'
import { AskPlutoOverlay } from './components/overlays/AskPlutoOverlay'
import { PermissionsOverlay } from './components/overlays/PermissionsOverlay'
import { SettingsOverlay } from './components/overlays/SettingsOverlay'

// Types
import { Meeting } from './types'

type CallAlertVisibilityState = {
  visible: boolean
}

type CallAlertVisibilityEvent = {
  type: 'SHOW' | 'HIDE'
}

const callAlertVisibilityReducer = (
  _state: CallAlertVisibilityState,
  event: CallAlertVisibilityEvent
): CallAlertVisibilityState => {
  if (event.type === 'SHOW') return { visible: true }
  return { visible: false }
}

function App() {
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null)
  const [isServerReady, setIsServerReady] = useState(false)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [meetingTitle, setMeetingTitle] = useState('')
  const [meetingParticipants, setMeetingParticipants] = useState<string[]>([])
  const [participantInput, setParticipantInput] = useState('')

  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | number | null>(null)
  const [activeTab, setActiveTab] = useState<'hub' | 'people' | 'projects' | 'wiki' | 'tasks'>('hub')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [searchVisible, setSearchVisible] = useState(false)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [permissionsVisible, setPermissionsVisible] = useState(false)
  const [permissionStatus, setPermissionStatus] = useState({ mic: 'unknown', systemAudio: 'unknown' })
  const [searchQuery, setSearchQuery] = useState('')
  const [llmProvider, setLlmProvider] = useState<'ollama' | 'gemini' | 'openai' | 'claude'>('ollama')
  const [hfToken, setHfToken] = useState('')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [claudeApiKey, setClaudeApiKey] = useState('')
  const [ollamaModel, setOllamaModel] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [askPlutoVisible, setAskPlutoVisible] = useState(false)
  const [query, setQuery] = useState('')
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set())
  const [currentNotes, setCurrentNotes] = useState('')
  const [inlineAskPluto, setInlineAskPluto] = useState(false)
  const [plutoResponse, setPlutoResponse] = useState('')
  const [transcriptVisible, setTranscriptVisible] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const stopSessionRef = useRef<(() => void) | null>(null)
  const startSessionRef = useRef<(() => void) | null>(null)
  const onAnalyserReadyRef = useRef<((node: AnalyserNode) => void) | null>(null)
  const activeCallAlertInFlightRef = useRef<string | null>(null)
  const alertVisibilityAutoResetRef = useRef<number | null>(null)
  const isRecordingRef = useRef(false)
  const isProcessingRef = useRef(false)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [speakingSource, setSpeakingSource] = useState<'Me' | 'Them' | null>(null)
  const [, dispatchCallAlertVisibility] = useReducer(
    callAlertVisibilityReducer,
    { visible: false }
  )

  useEffect(() => {
    isRecordingRef.current = isRecording
    isProcessingRef.current = isProcessing
  }, [isRecording, isProcessing])

  // Connect the ref
  onAnalyserReadyRef.current = (node) => {
      setAnalyser(node)
  }

  const handleCopySummary = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

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
      setTranscriptVisible(false)
      if (contentScrollRef.current) {
          contentScrollRef.current.scrollTo({ top: 0, behavior: 'auto' })
      }
  }, [selectedMeetingId])

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
          subParts.forEach((sp, k) => {
            newParts.push(sp);
            if (matches && matches[k]) {
              newParts.push(
                <span 
                  key={`${entity.type}-${k}`} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchQuery(matches[k]!);
                    setSearchVisible(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-pro-accent/5 border border-pro-accent/20 rounded-md text-pro-accent font-bold text-[13px] hover:bg-pro-accent hover:text-white transition-colors cursor-pointer group/pill"
                >
                  <span className="opacity-60 group-hover/pill:opacity-100">{entity.icon}</span>
                  {matches[k]}
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

  useEffect(() => {
    window.ipcRenderer.invoke('GET_SETTING', 'setup_complete').then((val) => {
      setSetupNeeded(val !== 'true')
    })
    
    fetchMeetings()
    
    window.ipcRenderer.invoke('GET_SETTING', 'llm_provider').then((val) => {
      if (val) setLlmProvider(val as 'ollama' | 'gemini' | 'openai' | 'claude')
    })
    window.ipcRenderer.invoke('GET_SETTING', 'hf_token').then((val) => {
      if (val) setHfToken(val)
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
    window.ipcRenderer.invoke('GET_SETTING', 'ollama_model').then((val) => {
      if (val) setOllamaModel(val)
    })

    const checkServer = async () => {
        try {
            const health = await window.ipcRenderer.invoke('WHISPERX_HEALTH')
            if (health.status === 'ok') {
                setIsServerReady(true)
            } else {
                setTimeout(checkServer, 1000)
            }
        } catch (e) {
            setTimeout(checkServer, 1000)
        }
    }
    checkServer()

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
  }, [isRecording])

  const fetchMeetings = async () => {
    try {
      const data = await window.ipcRenderer.invoke('GET_MEETINGS')
      setMeetings(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('Failed to fetch meetings', e)
      setMeetings([])
    }
  }

  const handleRecordingChange = (recording: boolean) => {
      const wasRecording = isRecording
      setIsRecording(recording)
      if (recording && !wasRecording) {
          setCurrentNotes('')
          setMeetingTitle('')
          setMeetingParticipants([])
          setParticipantInput('')
          setSelectedMeetingId(null)
      }
  }

  const setCallAlertVisibility = async (visible: boolean, appName?: string) => {
      dispatchCallAlertVisibility({ type: visible ? 'SHOW' : 'HIDE' })

      if (alertVisibilityAutoResetRef.current !== null) {
          window.clearTimeout(alertVisibilityAutoResetRef.current)
          alertVisibilityAutoResetRef.current = null
      }

      if (visible) {
          await window.ipcRenderer.invoke('SHOW_ACTIVE_CALL_ALERT', { appName: appName || 'Call' })
          alertVisibilityAutoResetRef.current = window.setTimeout(() => {
              dispatchCallAlertVisibility({ type: 'HIDE' })
              alertVisibilityAutoResetRef.current = null
          }, 16000)
          return
      }

      await window.ipcRenderer.invoke('HIDE_ACTIVE_CALL_ALERT')
  }

  const safeMeetings = Array.isArray(meetings) ? meetings : []
  const selectedMeeting = safeMeetings.find(m => String(m.id) === String(selectedMeetingId))

  const filteredMeetings = safeMeetings.filter(m => 
    (m.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (m.enhanced_notes || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  const getProactiveIntelligence = () => {
      const upcomingMeeting = safeMeetings[0]
      const hasOverdue = true
      
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

  const checkSystemAudioPermission = async (micStatus: string, allowSilent = true) => {
    try {
      const ok = await window.ipcRenderer.invoke('SYSTEM_AUDIO_PROBE', { durationMs: 1500, allowSilent })
      const systemAudioStatus = ok ? 'granted' : 'needs-audio'
      setPermissionStatus(prev => ({ ...prev, mic: micStatus, systemAudio: systemAudioStatus }))
      return { systemAudioStatus }
    } catch {
      setPermissionStatus(prev => ({ ...prev, mic: micStatus, systemAudio: 'needs-audio' }))
      return { systemAudioStatus: 'needs-audio' }
    }
  }

  useEffect(() => {
    const probeOnBoot = async () => {
      const alreadyDone = await window.ipcRenderer.invoke('BOOT_PROBE_STATUS')
      if (alreadyDone) return
      await window.ipcRenderer.invoke('BOOT_PROBE_MARK')
      const micStatus = await window.ipcRenderer.invoke('CHECK_MICROPHONE_PERMISSION')
      const { systemAudioStatus } = await checkSystemAudioPermission(micStatus)
      if (micStatus !== 'granted' || systemAudioStatus !== 'granted') {
        window.dispatchEvent(new CustomEvent('SHOW_PERMISSION_OVERLAY', {
          detail: { micStatus, systemAudioStatus }
        }))
      }
    }

    void probeOnBoot()
    const handlePermissionsOverlay = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      setPermissionStatus({
        mic: detail.micStatus || 'unknown',
        systemAudio: detail.systemAudioStatus || 'unknown'
      })
      setPermissionsVisible(true)
    }
    window.addEventListener('SHOW_PERMISSION_OVERLAY', handlePermissionsOverlay)
    return () => window.removeEventListener('SHOW_PERMISSION_OVERLAY', handlePermissionsOverlay)
  }, [])

  useEffect(() => {
    const micGranted = permissionStatus.mic === 'granted' || permissionStatus.mic === 'authorized'
    const systemGranted = permissionStatus.systemAudio === 'granted' || permissionStatus.systemAudio === 'authorized'
    if (micGranted && systemGranted) {
      setPermissionsVisible(false)
    }
  }, [permissionStatus])

  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null

    const pollActiveCall = async () => {
      if (setupNeeded !== false || isRecording || isProcessing) {
        activeCallAlertInFlightRef.current = null
        await setCallAlertVisibility(false)
        return
      }

      try {
        const result = await window.ipcRenderer.invoke('DETECT_ACTIVE_CALL')
        if (cancelled) return

        const appName = typeof result?.appName === 'string' ? result.appName : null
        const isActive = Boolean(result?.active) && Boolean(appName)

        if (!isActive || !appName) {
          activeCallAlertInFlightRef.current = null
          return
        }

        if (activeCallAlertInFlightRef.current !== appName) {
          activeCallAlertInFlightRef.current = appName
          await setCallAlertVisibility(true, appName)
        }
      } catch {
        activeCallAlertInFlightRef.current = null
      }
    }

    void pollActiveCall()
    intervalId = window.setInterval(() => {
      void pollActiveCall()
    }, 12000)

    return () => {
      cancelled = true
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [setupNeeded, isRecording, isProcessing])

  useEffect(() => {
    return () => {
      if (alertVisibilityAutoResetRef.current !== null) {
        window.clearTimeout(alertVisibilityAutoResetRef.current)
        alertVisibilityAutoResetRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleTakeNotesFromAlert = () => {
      if (startSessionRef.current && !isRecordingRef.current && !isProcessingRef.current) {
        startSessionRef.current()
      }
    }

    window.ipcRenderer.on('ACTIVE_CALL_TAKE_NOTES', handleTakeNotesFromAlert)
    return () => window.ipcRenderer.off('ACTIVE_CALL_TAKE_NOTES', handleTakeNotesFromAlert)
  }, [])

  const retryRecordingIfReady = async () => {
    await window.ipcRenderer.invoke('APP_RELAUNCH')
  }

  if (setupNeeded === null || (!setupNeeded && !isServerReady)) return (
    <div className="h-screen w-screen bg-pro-bg flex flex-col gap-4 items-center justify-center text-pro-text-muted/40 font-black uppercase tracking-[0.2em] animate-pulse text-xs">
        <div className="w-8 h-8 rounded-full border-2 border-pro-accent border-t-transparent animate-spin mb-4" />
        <span>Initializing Neural Engine...</span>
    </div>
  )
  if (setupNeeded) return <SetupWizard onComplete={() => setSetupNeeded(false)} />

  return (
    <div className="flex h-screen w-screen bg-pro-bg text-pro-text-main font-sans overflow-hidden hover:cursor-default selection:bg-pro-accent/20">
      <div className="hidden">
        <AudioManager 
            onTranscript={() => {}} 
            onSessionComplete={async (meetingId) => {
                await fetchMeetings()
                if (meetingId) {
                    setSelectedMeetingId(meetingId)
                }
            }} 
            onRecordingChange={handleRecordingChange}
            onProcessingChange={setIsProcessing}
            systemAudioStatus={permissionStatus.systemAudio}
            userNotes={currentNotes}
            onStopSessionRef={stopSessionRef}
            onStartSessionRef={startSessionRef}
            onAnalyserReadyRef={onAnalyserReadyRef}
            onSpeakingChange={setSpeakingSource}
            userTitle={meetingTitle}
            participants={meetingParticipants}
        />
      </div>
      
      {!isRecording && !isProcessing && (
        <>
          <div 
            className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-30 lg:hidden transition-opacity duration-300 ${sidebarVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} 
            onClick={() => setSidebarVisible(false)}
          />
          <Sidebar 
            sidebarVisible={sidebarVisible}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            selectedMeetingId={selectedMeetingId}
            setSelectedMeetingId={setSelectedMeetingId}
            safeMeetings={safeMeetings}
            onStartRecording={() => {
                if (startSessionRef.current) {
                    startSessionRef.current()
                }
            }}
            handleDeleteMeeting={handleDeleteMeeting}
            setSettingsVisible={setSettingsVisible}
          />
        </>
      )}

      {(isRecording || isProcessing) ? (
        <ZenMode 
          isProcessing={isProcessing}
          onEndMeeting={() => {
              if (stopSessionRef.current && !isProcessing) {
                  stopSessionRef.current()
              }
          }}
          meetingTitle={meetingTitle}
          setMeetingTitle={setMeetingTitle}
          meetingParticipants={meetingParticipants}
          setMeetingParticipants={setMeetingParticipants}
          participantInput={participantInput}
          setParticipantInput={setParticipantInput}
          currentNotes={currentNotes}
          setCurrentNotes={setCurrentNotes}
          inlineAskPluto={inlineAskPluto}
          setInlineAskPluto={setInlineAskPluto}
          query={query}
          setQuery={setQuery}
          plutoResponse={plutoResponse}
          setPlutoResponse={setPlutoResponse}
          analyser={analyser}
          speakingSource={speakingSource}
        />
      ) : (
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
                        {isProcessing ? 'Processing Intelligence...' : isRecording ? 'Capturing Intelligence' : selectedMeetingId ? selectedMeeting?.title || 'Review' : activeTab === 'hub' ? 'Dashboard' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                    </h2>
                    <p className="text-[10px] font-bold text-pro-text-muted/60 uppercase tracking-widest mt-1">
                        {isRecording ? 'Neural Stream Live' : selectedMeetingId ? 'Archived Context' : 'All Activities'}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-4">
                <button 
                    onClick={() => setAskPlutoVisible(true)}
                    className="h-12 px-6 rounded-2xl bg-white border border-pro-border shadow-soft flex items-center gap-4 hover:border-pro-accent/40 transition-all active-push group"
                >
                    <span className="text-lg">🧠</span>
                    <span className="text-[10px] font-black text-pro-text-muted/60 uppercase tracking-[0.2em]">Ask Pluto Intelligence</span>
                    <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                        <span className="w-5 h-5 rounded-md border border-pro-border flex items-center justify-center text-[10px] font-bold">⌘</span>
                        <span className="w-5 h-5 rounded-md border border-pro-border flex items-center justify-center text-[10px] font-bold">K</span>
                    </div>
                </button>
                <div className="w-[1px] h-6 bg-pro-border/20" />
                <button 
                    onClick={() => setSettingsVisible(true)}
                    className="w-11 h-11 rounded-xl bg-white border border-pro-border/40 shadow-premium flex items-center justify-center text-pro-text-muted hover:bg-pro-bg transition-all active-push"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                </button>
            </div>
         </header>

          <div ref={contentScrollRef} className="flex-1 overflow-y-auto px-4 md:px-12 lg:px-20 py-8 md:py-16 space-y-12 md:space-y-20 flex flex-col scroll-smooth relative">
               <div className="fixed top-0 right-0 w-[800px] h-[800px] bg-pro-accent/5 rounded-full blur-[120px] -mr-96 -mt-96 pointer-events-none z-0" />
               <div className="fixed bottom-0 left-0 w-[600px] h-[600px] bg-pro-accent/5 rounded-full blur-[100px] -ml-40 -mb-40 pointer-events-none z-0" />
               <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-pro-accent/5 rounded-full blur-[150px] pointer-events-none z-0 opacity-40" />

                 {selectedMeetingId ? (
                    <MeetingView 
                        selectedMeeting={selectedMeeting}
                        editingTitle={editingTitle}
                        setEditingTitle={setEditingTitle}
                        titleValue={titleValue}
                        setTitleValue={setTitleValue}
                        fetchMeetings={fetchMeetings}
                        handleCopySummary={handleCopySummary}
                        copySuccess={copySuccess}
                        handleDeleteMeeting={handleDeleteMeeting}
                        highlightEntities={highlightEntities}
                        transcriptVisible={transcriptVisible}
                        setTranscriptVisible={setTranscriptVisible}
                    />
                 ) : activeTab === 'hub' ? (
                    <Dashboard 
                        intelligence={intelligence}
                        isRecording={isRecording}
                        setSelectedMeetingId={setSelectedMeetingId}
                        setActiveTab={setActiveTab}
                        completedTasks={completedTasks}
                        handleCompleteTask={handleCompleteTask}
                    />
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
                                onClick={() => {
                                    if (startSessionRef.current) startSessionRef.current()
                                }}
                                className="h-16 px-12 rounded-3xl bg-pro-text-main text-white font-black text-xs uppercase tracking-[0.2em] shadow-2xl hover:bg-pro-accent hover:scale-[1.02] transition-all active-push"
                             >
                                Initialize Capture
                             </button>
                             <p className="text-[10px] font-black text-pro-text-muted/30 uppercase tracking-[0.3em]">Ready for M-Series Deployment</p>
                        </div>
                    </div>
                )}
          </div>
        </main>
      )}

      {/* Global Overlays */}
      <AskPlutoOverlay 
        askPlutoVisible={askPlutoVisible}
        setAskPlutoVisible={setAskPlutoVisible}
        query={query}
        setQuery={setQuery}
        plutoResponse={plutoResponse}
        setPlutoResponse={setPlutoResponse}
      />

      <SearchOverlay 
        searchVisible={searchVisible}
        setSearchVisible={setSearchVisible}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filteredMeetings={filteredMeetings}
        setSelectedMeetingId={setSelectedMeetingId}
      />

      <SettingsOverlay 
        settingsVisible={settingsVisible}
        setSettingsVisible={setSettingsVisible}
        llmProvider={llmProvider}
        setLlmProvider={setLlmProvider}
        hfToken={hfToken}
        setHfToken={setHfToken}
        geminiApiKey={geminiApiKey}
        setGeminiApiKey={setGeminiApiKey}
        openaiApiKey={openaiApiKey}
        setOpenaiApiKey={setOpenaiApiKey}
        claudeApiKey={claudeApiKey}
        setClaudeApiKey={setClaudeApiKey}
        ollamaModel={ollamaModel}
        setOllamaModel={setOllamaModel}
        fetchMeetings={fetchMeetings}
        setSelectedMeetingId={setSelectedMeetingId}
      />

      <PermissionsOverlay
        visible={permissionsVisible}
        onClose={() => setPermissionsVisible(false)}
        micStatus={permissionStatus.mic}
        systemAudioStatus={permissionStatus.systemAudio}
        onRetry={retryRecordingIfReady}
        onOpenSystemSettings={(pane) => {
          window.ipcRenderer.invoke('OPEN_SYSTEM_SETTINGS_PRIVACY', pane)
        }}
      />
    </div>
  )
}

export default App
