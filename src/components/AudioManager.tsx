import { useState, useRef, useEffect } from 'react'
import { Mic, Loader2 } from 'lucide-react'

interface AudioManagerProps {
    onTranscript: (text: string) => void
    onSessionComplete: (meetingId?: string | number) => void
    onRecordingChange?: (isRecording: boolean) => void
    onProcessingChange?: (isProcessing: boolean) => void
    userNotes?: string
    userTitle?: string
    participants?: string[]
    onStopSessionRef?: React.MutableRefObject<(() => void) | null>
    onStartSessionRef?: React.MutableRefObject<(() => void) | null>
    onAnalyserReadyRef?: React.MutableRefObject<((analyser: AnalyserNode) => void) | null>
}

interface TranscriptionSegment {
    id: string;
    startTime: number;
    endTime: number;
    text: string;
    speaker: string;
}

export const AudioManager = ({ 
    onTranscript, 
    onSessionComplete, 
    onRecordingChange, 
    onProcessingChange,
    userNotes = '', 
    userTitle = '',
    participants = [],
    onStopSessionRef, 
    onStartSessionRef, 
    onAnalyserReadyRef 
}: AudioManagerProps) => {
  const [isRecording, setIsRecording] = useState(false)
  
  useEffect(() => {
    onRecordingChange?.(isRecording)
  }, [isRecording, onRecordingChange])
  const [isProcessing, setIsProcessing] = useState(false)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  
  // Refs - Dual Recording for source-based speaker labeling
  const micRecorderRef = useRef<MediaRecorder | null>(null)
  const systemRecorderRef = useRef<MediaRecorder | null>(null)
  const micChunksRef = useRef<Blob[]>([])
  const systemChunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const visStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)
  const isRecordingRef = useRef(false)
  const isProcessingRef = useRef(false)

  const isScreenPermissionGranted = (status: string) => {
      return status === 'authorized' || status === 'granted'
  }

  const logAudioTracks = (label: string, stream: MediaStream | null) => {
      if (!stream) {
          console.log(`[Pluto][Audio] ${label}: no stream`)
          return
      }
      const tracks = stream.getAudioTracks()
      console.log(`[Pluto][Audio] ${label}: ${tracks.length} audio track(s)`)
      tracks.forEach((track, index) => {
          const settings = track.getSettings ? track.getSettings() : {}
          const capabilities = track.getCapabilities ? track.getCapabilities() : {}
          console.log(`[Pluto][Audio] ${label} track ${index}`, {
              id: track.id,
              label: track.label,
              enabled: track.enabled,
              muted: track.muted,
              readyState: track.readyState,
              settings,
              capabilities
          })
      })
  }
  
  // Keep state refs in sync
  useEffect(() => {
    isRecordingRef.current = isRecording
  }, [isRecording])
  
  useEffect(() => {
    isProcessingRef.current = isProcessing
    onProcessingChange?.(isProcessing)
  }, [isProcessing, onProcessingChange])

  // --- Native Capture Logic ---
  // Functions defined below, event listeners set up after

  const startSession = async () => {
      try {
          startTimeRef.current = Date.now()
          setIsRecording(true)
          
          console.log('[Pluto] Starting native capture session...')

          // 0. Preflight permissions (macOS)
          const screenStatus = await window.ipcRenderer.invoke('CHECK_SCREEN_PERMISSION')
          const micStatus = await window.ipcRenderer.invoke('CHECK_MICROPHONE_PERMISSION')
          console.log('[Pluto] Screen permission status:', screenStatus)
          console.log('[Pluto] Microphone permission status:', micStatus)
          if (!isScreenPermissionGranted(screenStatus) || micStatus !== 'granted') {
              if (!isScreenPermissionGranted(screenStatus)) {
                  await window.ipcRenderer.invoke('REQUEST_SCREEN_PERMISSION')
              }
              window.dispatchEvent(new CustomEvent('SHOW_PERMISSION_OVERLAY', {
                  detail: { screenStatus, micStatus }
              }))
              setIsRecording(false)
              return
          }
          
          // 1. Capture System Audio FIRST (via Loopback API)
          let systemStream: MediaStream | null = null
          try {
              // Enable loopback mode (activates Chromium's hidden flags)
              console.log('[Pluto] Enabling audio loopback...')
              await window.ipcRenderer.invoke('enable-loopback-audio')
              
              // Get stream with system audio
              systemStream = await navigator.mediaDevices.getDisplayMedia({
                  video: true,
                  audio: true
              })
              
              // Remove video tracks (we only need audio)
              systemStream.getVideoTracks().forEach(track => {
                  track.stop()
                  systemStream!.removeTrack(track)
              })
              
              // Disable loopback mode (restore normal getDisplayMedia)
              await window.ipcRenderer.invoke('disable-loopback-audio')
              
              if (systemStream.getAudioTracks().length === 0) {
                  console.warn('[Pluto] System stream has no audio tracks')
                  alert(
                      'System audio was not captured.\n\n' +
                      'Make sure "Share system audio" is enabled in the picker and that ' +
                      'Pluto is allowed in Screen & System Audio Recording settings.'
                  )
              } else {
                  console.log('[Pluto] System audio started successfully via Loopback')
              }
              logAudioTracks('System', systemStream)
          } catch (sysErr) {
              console.warn('[Pluto] Failed to capture system audio:', sysErr)
              console.warn('[Pluto] System audio error details:', sysErr instanceof Error ? sysErr.message : sysErr)
              // Ensure loopback is disabled if we errored
              try { await window.ipcRenderer.invoke('disable-loopback-audio') } catch (e) { console.error('Failed to disable loopback', e) }
              // Don't block, just continue with Mic
          }
          
          // 2. Capture Microphone AFTER system audio (to ensure getDisplayMedia doesn't affect it)
          let micStream: MediaStream | null = null
          try {
              micStream = await navigator.mediaDevices.getUserMedia({
                  audio: {
                      echoCancellation: false,  // Disable processing to get raw audio
                      noiseSuppression: false,
                      autoGainControl: false
                  },
                  video: false
              })
              console.log('[Pluto] Microphone started successfully')
              logAudioTracks('Microphone', micStream)
          } catch (micErr) {
              console.warn('[Pluto] Failed to capture microphone:', micErr)
              console.warn('[Pluto] Microphone error details:', micErr instanceof Error ? micErr.message : micErr)
          }
                    // Check if we have at least one source
          if (!systemStream && !micStream) {
              throw new Error('No audio sources available. Please check Microphone and Screen Recording permissions.')
          }
          
          // Store streams for cleanup
          micStreamRef.current = micStream
          systemStreamRef.current = systemStream
          
          // 3. Create AudioContext for visualization only
          const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
          audioContextRef.current = audioContext
          
          if (audioContext.state === 'suspended') {
              await audioContext.resume()
          }
          
          // Visualization: mix both for visual feedback only
          const visDestination = audioContext.createMediaStreamDestination()
          
          if (systemStream && systemStream.getAudioTracks().length > 0) {
              const systemSource = audioContext.createMediaStreamSource(systemStream)
              systemSource.connect(visDestination)
          }
          
          if (micStream && micStream.getAudioTracks().length > 0) {
              const micSource = audioContext.createMediaStreamSource(micStream)
              micSource.connect(visDestination)
          }
          
          const visAnalyser = audioContext.createAnalyser()
          visAnalyser.fftSize = 256
          setAnalyser(visAnalyser)
          // Expose to parent
          if (onAnalyserReadyRef?.current) {
               onAnalyserReadyRef.current(visAnalyser)
          }
          
          const mixedSource = audioContext.createMediaStreamSource(visDestination.stream)
          mixedSource.connect(visAnalyser)
          visStreamRef.current = visDestination.stream
          
          // 4. Record SEPARATELY - Dual Recording for source-based labeling
          micChunksRef.current = []
          systemChunksRef.current = []
          
          // Mic recorder
          if (micStream && micStream.getAudioTracks().length > 0) {
              const micRecorder = new MediaRecorder(micStream, {
                  mimeType: 'audio/webm;codecs=opus'
              })
              micRecorderRef.current = micRecorder
              
              micRecorder.ondataavailable = (event) => {
                  if (event.data.size > 0) {
                      micChunksRef.current.push(event.data)
                  }
              }
              micRecorder.start(100)
              console.log('[Pluto] Mic recording started (separate)')
          }
          
          // System audio recorder
          if (systemStream && systemStream.getAudioTracks().length > 0) {
              const systemRecorder = new MediaRecorder(systemStream, {
                  mimeType: 'audio/webm;codecs=opus'
              })
              systemRecorderRef.current = systemRecorder
              
              systemRecorder.ondataavailable = (event) => {
                  if (event.data.size > 0) {
                      systemChunksRef.current.push(event.data)
                  }
              }
              systemRecorder.start(100)
              console.log('[Pluto] System audio recording started (separate)')
          }
          
          console.log('[Pluto] Dual recording started')

      } catch (e) {
          console.error('[Pluto] Failed to start native session', e)
          alert(`Failed to start recording: ${(e as Error).message}`)
          setIsRecording(false)
      }
  }

  // --- Helpers ---
  const stopAllTracks = () => {
      if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach(t => t.stop())
          micStreamRef.current = null
      }
      if (systemStreamRef.current) {
          systemStreamRef.current.getTracks().forEach(t => t.stop())
          systemStreamRef.current = null
      }
  }

  const extractTitle = (segments: TranscriptionSegment[]): string => {
      if (segments.length === 0) return 'New Meeting'
      const firstText = segments[0]?.text || ''
      return firstText ? (firstText.substring(0, 30) + (firstText.length > 30 ? '...' : '')) : 'New Meeting'
  }

  // Common Whisper Hallucinations to filter out
  const INVALID_PHRASES = [
      'you', 'thank you', 'thanks', 'mbc', 'subtitles by', 'captioned by', 
      'watching', 'subscribe', 'copyright', 'all rights reserved'
  ]

  const isValidSegment = (text: string): boolean => {
      const clean = text.toLowerCase().trim().replace(/[.,!?]/g, '')
      if (clean.length < 2) return false // Too short
      if (INVALID_PHRASES.includes(clean)) return false
      return true
  }

  const stopSession = async () => {
      console.log('[Pluto] Stopping session...')
      setIsProcessing(true)
      
      try {
          // Helper to stop a recorder and get its blob
          const stopRecorder = async (recorder: MediaRecorder | null, chunks: Blob[]): Promise<Blob | null> => {
              if (!recorder || recorder.state !== 'recording') return null
              
              const stopped = new Promise<void>((resolve) => {
                  recorder.onstop = () => resolve()
              })
              recorder.stop()
              await stopped
              
              if (chunks.length === 0) return null
              return new Blob(chunks, { type: 'audio/webm;codecs=opus' })
          }
          
          // Stop both recorders
          const [micBlob, systemBlob] = await Promise.all([
              stopRecorder(micRecorderRef.current, micChunksRef.current),
              stopRecorder(systemRecorderRef.current, systemChunksRef.current)
          ])
          
          // Stop all tracks
          stopAllTracks()
          
          // Reset refs
          micRecorderRef.current = null
          systemRecorderRef.current = null
          micChunksRef.current = []
          systemChunksRef.current = []
          
          // Cleanup visualization
          if (audioContextRef.current) {
              audioContextRef.current.close()
              audioContextRef.current = null
          }
          if (visStreamRef.current) {
             visStreamRef.current.getTracks().forEach(t => t.stop())
             visStreamRef.current = null
          }
          setAnalyser(null)
          setIsRecording(false)
          
          // Convert and transcribe each source separately
          let micSegments: TranscriptionSegment[] = []
          let systemSegments: TranscriptionSegment[] = []
          let primaryAudioPath = ''
          
          // Transcribe mic (label as "You")
          if (micBlob && micBlob.size > 0) {
              console.log('[Pluto] Processing mic audio...')
              const buffer = await micBlob.arrayBuffer()
              const wavPath = await window.ipcRenderer.invoke('AUDIO_SAVE_AND_CONVERT', buffer)
              primaryAudioPath = wavPath
              
              console.log('[Pluto] Transcribing mic...')
              const result = await window.ipcRenderer.invoke('WHISPER_TRANSCRIBE', wavPath, {
                  diarize: false // No diarization needed - we know it's "You"
              })
              
              if (result?.segments) {
                  micSegments = result.segments
                      .filter((s: { text: string }) => isValidSegment(s.text))
                      .map((s: { start: number; end: number; text: string }) => ({
                          id: crypto.randomUUID(),
                          startTime: s.start,
                          endTime: s.end,
                          text: s.text.trim(),
                          speaker: 'You'
                      }))
              }
              console.log(`[Pluto] Mic: ${micSegments.length} segments`)
          }
          
          // Transcribe system audio (label as "Others")
          if (systemBlob && systemBlob.size > 0) {
              console.log('[Pluto] Processing system audio...')
              const buffer = await systemBlob.arrayBuffer()
              const wavPath = await window.ipcRenderer.invoke('AUDIO_SAVE_AND_CONVERT', buffer)
              if (!primaryAudioPath) primaryAudioPath = wavPath
              
              console.log('[Pluto] Transcribing system audio...')
              const result = await window.ipcRenderer.invoke('WHISPER_TRANSCRIBE', wavPath, {
                  diarize: false // No diarization needed - we know it's "Others"
              })
              
              if (result?.segments) {
                  systemSegments = result.segments
                      .filter((s: { text: string }) => isValidSegment(s.text))
                      .map((s: { start: number; end: number; text: string }) => ({
                          id: crypto.randomUUID(),
                          startTime: s.start,
                          endTime: s.end,
                          text: s.text.trim(),
                          speaker: 'Others'
                      }))
              }
              console.log(`[Pluto] System: ${systemSegments.length} segments`)
          }
          
          // Merge by timestamp
          const sortedSegments = [...micSegments, ...systemSegments]
              .sort((a, b) => a.startTime - b.startTime)
          
          // Merge consecutive segments from the same speaker
          const newTranscription: TranscriptionSegment[] = []
          for (const segment of sortedSegments) {
              const lastSegment = newTranscription[newTranscription.length - 1]
              
              // Always merge if same speaker (regardless of time gap)
              if (lastSegment && lastSegment.speaker === segment.speaker) {
                  lastSegment.text += ' ' + segment.text
                  lastSegment.endTime = segment.endTime
              } else {
                  newTranscription.push({ ...segment })
              }
          }
          
          console.log(`[Pluto] Merged: ${sortedSegments.length} raw segments → ${newTranscription.length} merged segments`)
          
          if (onTranscript && newTranscription.length > 0) {
              const fullText = newTranscription.map(s => s.text).join(' ')
              onTranscript(fullText)
          }
          if (newTranscription.length === 0) {
              console.warn('[Pluto] No transcription segments from either source')
          }

          // 3. Generate Strategic Summary & Extract Speaker Identity (LLM)
          const fullTranscript = newTranscription.map(s => `${s.speaker}: ${s.text}`).join('\n')
          let enhancedNotes = ''
          let otherSpeakerName = 'Speaker' // Default fallback
          
          try {
              // Generate summary (provider selected automatically by backend)
              console.log('[Pluto] Generating strategic summary...')
              enhancedNotes = await window.ipcRenderer.invoke('GENERATE_SUMMARY', { 
                  transcript: fullTranscript,
                  userNotes: userNotes,
                  participants: participants,
                  meetingTitle: userTitle
              })
              
              // Extract speaker identity
              console.log('[Pluto] Extracting speaker identity...')
              const extractedName = await window.ipcRenderer.invoke('EXTRACT_SPEAKER_IDENTITY', {
                  transcript: fullTranscript
              })
              
              if (extractedName) {
                  otherSpeakerName = extractedName
                  console.log(`[Pluto] Identified other speaker as: ${otherSpeakerName}`)
              }
          } catch (llmErr) {
              console.error('[Pluto] AI processing failed:', llmErr)
              // Continue with default speaker name on error
          }

          // Relabel transcript segments with actual speaker names
          const labeledTranscription = newTranscription.map(seg => ({
              ...seg,
              speaker: seg.speaker === 'Others' ? otherSpeakerName : seg.speaker
          }))

          // 4. Save to DB
          const duration = (Date.now() - (startTimeRef.current || 0)) / 1000
          const startTime = new Date(startTimeRef.current || Date.now()).toISOString()
          const endTime = new Date().toISOString()
          
          // Generate intelligent title
          let title = userTitle || 'Meeting'
          if (!userTitle) {
              try {
                  const fullTranscript = labeledTranscription.map(s => `${s.speaker}: ${s.text}`).join('\n')
                  title = await window.ipcRenderer.invoke('GENERATE_TITLE', { 
                      transcript: fullTranscript 
                  })
                  console.log(`[Pluto] Generated title: ${title}`)
              } catch (titleErr) {
                  console.error('[Pluto] Title generation failed, using fallback:', titleErr)
                  title = extractTitle(labeledTranscription)
              }
          }
          
          const meetingData = {
              id: crypto.randomUUID(),
              title: title,
              meeting_type: 'Recording',
              started_at: startTime,
              ended_at: endTime,
              duration_seconds: Math.floor(duration),
              audio_path: primaryAudioPath,
              transcript_json: JSON.stringify(labeledTranscription),
              user_notes: userNotes,
              enhanced_notes: enhancedNotes,
              participants: participants,
              folder_id: null,
              is_favorite: false
          }
          
          await window.ipcRenderer.invoke('SAVE_MEETING', meetingData)
          console.log('[Pluto] Session saved to DB with transcript segments:', labeledTranscription.length, 'summary length:', enhancedNotes.length)
          
          // 5. Extract & Process Entities for Knowledge Graph (Sprint 2)
          try {
              console.log('[Pluto] Extracting entities for Knowledge Graph...')
              const fullTranscriptText = labeledTranscription.map(s => `${s.speaker}: ${s.text}`).join('\n')
              const entityResult = await window.ipcRenderer.invoke('EXTRACT_AND_PROCESS_ENTITIES', {
                  transcript: fullTranscriptText,
                  meetingId: String(meetingData.id)
              })
              console.log(`[Pluto] Entity extraction complete: ${entityResult.created} created, ${entityResult.linked} linked`)
          } catch (entityErr) {
              console.error('[Pluto] Knowledge Graph processing failed:', entityErr)
              // Non-blocking error
          }
          
          if (onSessionComplete) {
              onSessionComplete(meetingData.id)
          }
          
      } catch (e) {
          console.error('[Pluto] Processing failed:', e)
          alert(`Failed to process recording: ${(e as Error).message}`)
          setIsRecording(false)
      } finally {
          setIsProcessing(false)
      }
  }

  // Set up event listeners for external control (e.g., "End Meeting" button)
  useEffect(() => {
    const handleStopRecording = () => {
        console.log('[Pluto] STOP_RECORDING event received, isRecording:', isRecordingRef.current)
        if (isRecordingRef.current && !isProcessingRef.current) {
            stopSession()
        }
    }
    const handleStartRecording = () => {
        console.log('[Pluto] START_RECORDING event received')
        if (!isRecordingRef.current && !isProcessingRef.current) {
            startSession()
        }
    }
    window.addEventListener('STOP_RECORDING', handleStopRecording)
    window.addEventListener('START_RECORDING', handleStartRecording)
    return () => {
        window.removeEventListener('STOP_RECORDING', handleStopRecording)
        window.removeEventListener('START_RECORDING', handleStartRecording)
    }
  })

  // Expose stopSession and startSession to parent via refs
  useEffect(() => {
    if (onStopSessionRef) {
      onStopSessionRef.current = stopSession
    }
    if (onStartSessionRef) {
      onStartSessionRef.current = startSession
    }
  })

  const toggleSession = () => {
      if (isRecording) {
          stopSession()
      } else if (!isProcessing) {
          startSession()
      }
  }

  return (
    <div className="w-full space-y-4">      
      {/* Waveform Visualizer + Recording Button */}
      <WaveformVisualizer 
        analyser={analyser}
        isRecording={isRecording}
        isProcessing={isProcessing}
        onToggle={toggleSession}
      />

      {/* Local-First Badge */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-pro-border/40 shadow-sm">
            <div className="flex -space-x-1">
                <div className="w-1.5 h-1.5 rounded-full bg-pro-accent" />
                <div className="w-1.5 h-1.5 rounded-full bg-pro-accent/30 animate-pulse" />
            </div>
            <span className="text-[9px] font-bold text-pro-text-muted/60 uppercase tracking-widest">Local Session</span>
        </div>
      </div>
    </div>
  )
}

const WaveformVisualizer = ({ 
  analyser, 
  isRecording, 
  isProcessing, 
  onToggle 
}: { 
  analyser: AnalyserNode | null
  isRecording: boolean
  isProcessing: boolean
  onToggle: () => void 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [elapsed, setElapsed] = useState(0)

  // Timer logic
  useEffect(() => {
    if (!isRecording) {
        setElapsed(0)
        return
    }
    const interval = setInterval(() => {
        setElapsed(prev => prev + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [isRecording])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  // Visualize waveform
  useEffect(() => {
    if (!analyser || !canvasRef.current || !isRecording) return
    
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    let animationId: number
    
    const draw = () => {
      analyser.getByteFrequencyData(dataArray)
      
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      const barCount = 48
      const barWidth = 2
      const gap = 3
      const cornerRadius = 1
      
      const totalWidth = barCount * (barWidth + gap)
      const startX = (canvas.width - totalWidth) / 2
      
      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * (dataArray.length / 2))
        const value = dataArray[dataIndex]
        const percent = value / 255
        const barHeight = Math.max(2, percent * canvas.height * 0.8)
        
        const x = startX + i * (barWidth + gap)
        const y = (canvas.height - barHeight) / 2

        ctx.fillStyle = '#C6AA79' // Pro Accent Gold
        
        // Draw rounded rect
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barHeight, cornerRadius)
        ctx.fill()
      }
      
      animationId = requestAnimationFrame(draw)
    }
    
    draw()
    return () => cancelAnimationFrame(animationId)
  }, [analyser, isRecording])
  
  return (
    <div className="relative w-full group">
      {/* Premium Glass Card */}
      <div className={`
        relative w-full h-[280px] rounded-[2.5rem] overflow-hidden transition-all duration-700 ease-out
        border border-white/50 bg-gradient-to-b from-white/80 via-white/40 to-white/30 backdrop-blur-2xl
        shadow-[0_20px_40px_-12px_rgba(0,0,0,0.05)]
        ${isRecording ? 'shadow-[0_25px_50px_-12px_rgba(99,102,241,0.15)] ring-1 ring-pro-accent/20' : 'hover:shadow-[0_30px_60px_-12px_rgba(0,0,0,0.08)] hover:scale-[1.01]'}
      `}>
          
        {/* Subtle internal gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-white/40 pointer-events-none" />

        {/* Status Indicator (Top Center) */}
        <div className="absolute top-8 left-0 right-0 flex justify-center pointer-events-none">
            {isRecording ? (
                <div className="flex flex-col items-center gap-1 animate-in fade-in zoom-in duration-500">
                    <span className="text-[10px] font-bold text-pro-accent uppercase tracking-[0.2em]">{formatTime(elapsed)}</span>
                    <div className="flex items-center gap-1.5 opacity-60">
                        <div className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[9px] font-bold text-pro-text-main">REC</span>
                    </div>
                </div>
            ) : (
                <span className="text-[10px] font-bold text-pro-text-muted/30 uppercase tracking-[0.2em]">Ready to Capture</span>
            )}
        </div>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-10 translate-y-2">
            
            {/* Visualization Area */}
            <div className="h-12 w-full flex items-center justify-center gap-1.5">
                {isRecording ? (
                    <div className="relative w-full max-w-[200px] h-full opacity-80 mix-blend-multiply">
                        <canvas 
                            ref={canvasRef} 
                            className="w-full h-full"
                            width={400}
                            height={56}
                        />
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 h-full opacity-20 group-hover:opacity-40 transition-opacity duration-500">
                        {/* Static Equalizer (reacts to hover only) */}
                        {[...Array(5)].map((_, i) => (
                            <div 
                                key={i} 
                                className="w-1 rounded-full bg-pro-text-main transition-all duration-500 ease-out h-1 group-hover:h-2"
                            />
                        ))}
                    </div>
                )}
            </div>
            
            {/* Primary Action Button */}
            <button
                onClick={onToggle}
                disabled={isProcessing}
                className={`
                  relative group/btn flex items-center justify-center gap-3 px-8 py-4 rounded-full font-black text-[11px] uppercase tracking-[0.2em] transition-all duration-300
                  ${isProcessing 
                    ? 'bg-pro-bg text-pro-text-muted cursor-not-allowed border border-pro-border'
                    : isRecording 
                      ? 'bg-white text-pro-text-main shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 border border-transparent ring-2 ring-red-50/50' 
                      : 'bg-pro-text-main text-white shadow-[0_10px_20px_-5px_rgba(0,0,0,0.2)] hover:shadow-[0_15px_30px_-5px_rgba(0,0,0,0.3)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm'
                  }
                `}
            >
                {isProcessing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Processing</span>
                  </>
                ) : isRecording ? (
                  <>
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                    <span>Finish</span>
                  </>
                ) : (
                  <>
                    <Mic size={16} className="text-white/80 group-hover/btn:scale-110 transition-transform" />
                    <span>Start Session</span>
                  </>
                )}
            </button>
        </div>
      </div>
    </div>
  )
}
