import { useState, useRef, useEffect } from 'react'
import { Mic, Loader2 } from 'lucide-react'
import { createWavBlob, computeRms } from '../utils/audio'

interface AudioManagerProps {
    onTranscript: (text: string) => void
    onSessionComplete: (meetingId?: string | number) => void
    onRecordingChange?: (isRecording: boolean) => void
    onProcessingChange?: (isProcessing: boolean) => void
    onSpeakingChange?: (speaker: 'Me' | 'Them' | null) => void
    userNotes?: string
    userTitle?: string
    participants?: string[]
    systemAudioStatus?: string

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
    onAnalyserReadyRef,
    onSpeakingChange,
    systemAudioStatus = 'unknown'
}: AudioManagerProps) => {
  const [isRecording, setIsRecording] = useState(false)

  
  useEffect(() => {
    onRecordingChange?.(isRecording)
  }, [isRecording, onRecordingChange])
  const [isProcessing, setIsProcessing] = useState(false)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  
  // Refs - Dual Recording for source-based speaker labeling
  const micRecorderRef = useRef<MediaRecorder | null>(null)

  
  const micChunksRef = useRef<Blob[]>([])
  const systemChunksRef = useRef<Blob[]>([])
  
  const micChunkIndexRef = useRef(0)
  const systemChunkIndexRef = useRef(0)

  const systemPcmChunksRef = useRef<Float32Array[]>([]) 
  const nativeAudioListenerRef = useRef<((event: any, chunk: any) => void) | null>(null)
  const systemAudioChunkSeenRef = useRef(false)
  
  const speakingLoopRef = useRef<number | null>(null)
  const lastSpeakerRef = useRef<'Me' | 'Them' | null>(null)
  const lastSpeakerTsRef = useRef<number>(0)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const systemAnalyserRef = useRef<AnalyserNode | null>(null) // Capture system audio levels

  const hasMicRecorderRef = useRef(false)
  const hasSystemRecorderRef = useRef(false)
  
  const pendingMicChunksRef = useRef(new Map<number, Blob>())
  const pendingSystemChunksRef = useRef(new Map<number, Blob>())
  const systemRmsRef = useRef<number>(0)
  const processingQueueRef = useRef(Promise.resolve())
  const processedMicSegmentsRef = useRef<TranscriptionSegment[]>([])
  const startTimeRef = useRef<number>(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const visStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)


  const isRecordingRef = useRef(false)
  const isProcessingRef = useRef(false)


  
  // Keep state refs in sync
  useEffect(() => {
    isRecordingRef.current = isRecording
  }, [isRecording])
  
  useEffect(() => {
    onProcessingChange?.(isProcessing)
  }, [isProcessing, onProcessingChange])

  // --- Native Capture Logic ---
  // Functions defined below, event listeners set up after

  const startSession = async () => {
      try {
          startTimeRef.current = Date.now()
          setIsRecording(true)
          
          console.log('[Pluto] Starting session (Robust Mic First)...')

          // 0. Preflight Permissions (Mic only)
          const micStatus = await window.ipcRenderer.invoke('CHECK_MICROPHONE_PERMISSION')
          if (micStatus !== 'granted') {
              window.dispatchEvent(new CustomEvent('SHOW_PERMISSION_OVERLAY', {
                  detail: { micStatus }
              }))
              setIsRecording(false)
              return
          }

          // 1. System Audio Verification (Block start if unavailable)
          if (systemAudioStatus !== 'granted') {
              window.dispatchEvent(new CustomEvent('SHOW_PERMISSION_OVERLAY', {
                  detail: { micStatus: 'granted', systemAudioStatus: 'needs-audio' }
              }))
              setIsRecording(false)
              return
          }

          // 2. Acquire Microphone Stream (Critical Path)
          let micStream: MediaStream | null = null
          try {
              micStream = await navigator.mediaDevices.getUserMedia({
                  audio: {
                      echoCancellation: false, 
                      noiseSuppression: false,
                      autoGainControl: false
                  },
                  video: false
              })
              if (!micStream || micStream.getAudioTracks().length === 0) {
                   micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
              }
          } catch (micErr) {
              console.warn('[Pluto] Failed to capture microphone:', micErr)
              alert('Failed to access microphone. Please check permissions.')
              setIsRecording(false)
              return
          }
          
          micStreamRef.current = micStream

          // 3. Setup Audio Context & Visualizer (Immediate Feedback)
          const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
          audioContextRef.current = audioContext
          if (audioContext.state === 'suspended') await audioContext.resume()
           
          const visAnalyser = audioContext.createAnalyser()
          visAnalyser.fftSize = 256
          setAnalyser(visAnalyser)
           
          if (micStream) {
              const micSource = audioContext.createMediaStreamSource(micStream)
              micSource.connect(visAnalyser)
          }
           
          if (onAnalyserReadyRef?.current) onAnalyserReadyRef.current(visAnalyser)
          startSpeakingMonitor(audioContext, micStream)

          // 4. System Audio: Native AudioCap
          console.log('[Pluto] Starting Native AudioCap...')
          try {
              await window.ipcRenderer.invoke('NATIVE_AUDIO_START')
              hasSystemRecorderRef.current = true
              systemAudioChunkSeenRef.current = false
              
              // Setup Listener
              const handler = (_: any, chunk: any) => {
                  if (chunk && chunk.byteLength > 0) {
                     systemAudioChunkSeenRef.current = true
                     // chunk.buffer is the underlying ArrayBuffer
                     const floatData = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 4)
                     systemPcmChunksRef.current.push(floatData)
                      const rms = computeRms(floatData)
                      systemRmsRef.current = rms
                   }
              }
              nativeAudioListenerRef.current = handler
              window.ipcRenderer.on('NATIVE_AUDIO_CHUNK', handler)
              console.log('[Pluto] Native AudioCap started & listening.')
              
          } catch (sysErr) {
              console.warn('[Pluto] System audio failed:', sysErr)
          }

          // 5. Start Recorders Synced
          micChunksRef.current = []
          systemChunksRef.current = []
          micChunkIndexRef.current = 0
          systemChunkIndexRef.current = 0
          pendingMicChunksRef.current = new Map()
          pendingSystemChunksRef.current = new Map()
          processedMicSegmentsRef.current = []
          
          if (micStream) {
               const micRecorder = new MediaRecorder(micStream, getRecorderOptions())
               micRecorderRef.current = micRecorder
               

               micRecorder.ondataavailable = (event) => {
                   if (event.data && event.data.size > 0) {
                       const index = micChunkIndexRef.current++
                       micChunksRef.current.push(event.data)
                       
                       // Package System Audio for this interval
                       let systemBlob: Blob | undefined
                       // Flatten pending float chunks
                       const floatChunks = systemPcmChunksRef.current
                       if (floatChunks.length > 0) {
                           const totalLen = floatChunks.reduce((acc, c) => acc + c.length, 0)
                           const merged = new Float32Array(totalLen)
                           let offset = 0
                           floatChunks.forEach(c => {
                               merged.set(c, offset)
                               offset += c.length
                           })
                           systemBlob = createWavBlob(merged)
                           // Clear for next chunk
                           systemPcmChunksRef.current = []
                       }
                       
                       // Manually handle chunks
                       handleChunkBlob('mic', index, event.data)
                       if (systemBlob) {
                           handleChunkBlob('system', index, systemBlob)
                       } else {
                           // If no system audio, effectively "silence" - handleChunkBlob logic
                           // expects to wait if hasSystemRecorderRef is true.
                           // But for native capture, we might have pure silence if no output.
                           // Send empty blob or nothing?
                           // If we send nothing, 'handleChunkBlob' might hang waiting for it.
                           // Let's create an empty 1-second silence WAV to keep pipeline flowing?
                           // Or simpler: handleChunkBlob checks "micBlob && (systemBlob || !hasSystemRecorderRef)".
                           // If hasSystemRecorderRef is true, we MUST provide a systemBlob.
                           // So create dummy silence.
                           const silence = new Float32Array(48000 * 1) // 1 sec silence
                           systemBlob = createWavBlob(silence)
                           handleChunkBlob('system', index, systemBlob) 
                       }
                   }
               }
               
               micRecorder.start(CHUNK_SECONDS * 1000)
               console.log('[Pluto] Microphone recording started.')
          }
          


          // 6. No restart loop needed
           
      } catch (e) {
          console.error('[Pluto] Failed to start session', e)
          setIsRecording(false)
      }
  }

  // Effect cleared - logic handled in standard recorder flow now
  useEffect(() => {
      // Intentionally empty - we removed IPC listener
  }, [])
  
  const startSpeakingMonitor = (audioContext: AudioContext, micStream: MediaStream | null) => {
      stopSpeakingMonitor()
      
      let micAnalyser: AnalyserNode | null = null
      if (micStream && micStream.getAudioTracks().length > 0) {
           micAnalyser = audioContext.createAnalyser()
           micAnalyser.fftSize = 256
           const s = audioContext.createMediaStreamSource(micStream)
           s.connect(micAnalyser)
           micAnalyserRef.current = micAnalyser
      }
      
      const tick = () => {
           const now = performance.now()
           const micRms = micAnalyser ? computeRmsFromAnalyser(micAnalyser) : 0
           const systemRms = systemAnalyserRef.current ? computeRmsFromAnalyser(systemAnalyserRef.current) : 0
           systemRmsRef.current = systemRms
           
           // ... logic same ...
           let nextSpeaker: 'Me' | 'Them' | null = null
           const micActive = micRms >= SPEAKING_RMS_THRESHOLD
           const systemActive = systemRms >= SPEAKING_RMS_THRESHOLD
           
           if (micActive && !systemActive) nextSpeaker = 'Me'
           else if (!micActive && systemActive) nextSpeaker = 'Them'
           else if (micActive && systemActive) {
               if (micRms >= systemRms * SPEAKING_RATIO) nextSpeaker = 'Me'
               else if (systemRms >= micRms * SPEAKING_RATIO) nextSpeaker = 'Them'
               else nextSpeaker = lastSpeakerRef.current
           } else {
               nextSpeaker = null
           }
           
           if (now - lastSpeakerTsRef.current >= SPEAKING_MIN_INTERVAL_MS && nextSpeaker !== lastSpeakerRef.current) {
               lastSpeakerRef.current = nextSpeaker
               lastSpeakerTsRef.current = now
               onSpeakingChange?.(nextSpeaker)
           }
           speakingLoopRef.current = requestAnimationFrame(tick)
      }
      speakingLoopRef.current = requestAnimationFrame(tick)
  }
  
  const stopAllTracks = () => {
        if (speakingLoopRef.current) {
            cancelAnimationFrame(speakingLoopRef.current)
            speakingLoopRef.current = null
        }
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(t => t.stop())
            micStreamRef.current = null
        }
  }

  // --- Helpers ---


  const extractTitle = (segments: TranscriptionSegment[]): string => {
      if (segments.length === 0) return 'New Meeting'
      const firstText = segments[0]?.text || ''
      return firstText ? (firstText.substring(0, 30) + (firstText.length > 30 ? '...' : '')) : 'New Meeting'
  }

  type RmsData = { windowSec: number; rms: number[] }

  const RMS_WINDOW_SECONDS = 0.5
  const SPEAKING_RMS_THRESHOLD = 0.012
  const SPEAKING_RATIO = 1.25
  const SPEAKING_MIN_INTERVAL_MS = 200
  const CHUNK_SECONDS = 20



  const getRecorderOptions = (): MediaRecorderOptions | undefined => {
      const candidates = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus'
      ]
      for (const mimeType of candidates) {
          if (MediaRecorder.isTypeSupported(mimeType)) {
              return { mimeType }
          }
      }
      return undefined
  }




  const computeRmsData = async (audioBuffer: ArrayBuffer): Promise<RmsData> => {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      try {
          const decoded = await audioCtx.decodeAudioData(audioBuffer.slice(0))
          const numChannels = decoded.numberOfChannels
          const channels = Array.from({ length: numChannels }, (_, i) => decoded.getChannelData(i))
          const length = decoded.length
          const sampleRate = decoded.sampleRate
          const windowSize = Math.max(1, Math.floor(RMS_WINDOW_SECONDS * sampleRate))
          const rms: number[] = []

          for (let start = 0; start < length; start += windowSize) {
              const end = Math.min(length, start + windowSize)
              let sumSquares = 0
              let count = 0
              for (let i = start; i < end; i++) {
                  let sample = 0
                  for (let ch = 0; ch < numChannels; ch++) {
                      sample += channels[ch][i] || 0
                  }
                  sample /= numChannels
                  sumSquares += sample * sample
                  count++
              }
              const meanSquare = count > 0 ? sumSquares / count : 0
              rms.push(Math.sqrt(meanSquare))
          }

          return { windowSec: RMS_WINDOW_SECONDS, rms }
      } finally {
          audioCtx.close()
      }
  }





  const computeRmsFromAnalyser = (analyser: AnalyserNode): number => {
      const bufferLength = analyser.fftSize
      const data = new Uint8Array(bufferLength)
      analyser.getByteTimeDomainData(data)
      let sumSquares = 0
      for (let i = 0; i < bufferLength; i++) {
          const v = (data[i] - 128) / 128
          sumSquares += v * v
      }
      return Math.sqrt(sumSquares / bufferLength)
  }

  const stopSpeakingMonitor = () => {
      if (speakingLoopRef.current) {
          cancelAnimationFrame(speakingLoopRef.current)
          speakingLoopRef.current = null
      }
      micAnalyserRef.current = null
      lastSpeakerRef.current = null
      lastSpeakerTsRef.current = 0
      onSpeakingChange?.(null)
  }



  const enqueueBackgroundJob = (job: () => Promise<void>) => {
      processingQueueRef.current = processingQueueRef.current.then(job).catch((e) => {
          console.error('[Pluto] Background transcription job failed:', e)
      })
  }

  const handleChunkBlob = (type: 'mic' | 'system', chunkIndex: number, chunkBlob: Blob) => {
       if (type === 'mic') pendingMicChunksRef.current.set(chunkIndex, chunkBlob)
       else pendingSystemChunksRef.current.set(chunkIndex, chunkBlob)
       
       // Try to process pair
       // Simple strategy: If we have both (or if system isn't running and we have mic), process.
       // But 'system' might be silent/empty? No, blob is blob.
       
       const micBlob = pendingMicChunksRef.current.get(chunkIndex)
       const systemBlob = pendingSystemChunksRef.current.get(chunkIndex)
       
       if (micBlob && (systemBlob || !hasSystemRecorderRef.current)) {
           pendingMicChunksRef.current.delete(chunkIndex)
           if (systemBlob) pendingSystemChunksRef.current.delete(chunkIndex)
           
           enqueueBackgroundJob(() => transcribeChunkPair({ 
               micBlob, 
               systemBlob, 
               chunkIndex 
           }))
       }
  }

   const transcribeChunkPair = async (opts: {
       micBlob: Blob
       systemBlob?: Blob
       chunkIndex: number
   }) => {
       const chunkStartSec = opts.chunkIndex * CHUNK_SECONDS
       
       const processStream = async (label: 'Me' | 'Them', blob?: Blob, format: 'webm' | 'wav' = 'webm') => {
           if (!blob || blob.size < 1024) { 
             return { segments: [], rms: null as RmsData | null }
           }
           const buffer = await blob.arrayBuffer()
           let rms: RmsData | null = null
           try {
               // Only compute RMS if we can decode (might fail for raw chunks if no header, but ours have headers)
               // System WAV has header now. Mic WebM has header.
               rms = await computeRmsData(buffer)
           } catch (e) {
               console.warn(`[Pluto] Failed to compute ${label} RMS data:`, e instanceof Error ? e.message : e)
           }

           let wavPath: string | null
           try {
               wavPath = await window.ipcRenderer.invoke('AUDIO_SAVE_AND_CONVERT', buffer, format)
           } catch (e) {
               console.warn(`[Pluto] Skip ${label} chunk (convert failed):`, (e as Error).message)
               return { segments: [], rms }
           }
           if (!wavPath) return { segments: [], rms }
           
           const result = await window.ipcRenderer.invoke('WHISPER_TRANSCRIBE', wavPath, {
               diarize: false,
               language: 'en'
           })
           // ... (rest of mapping logic same as before)
           const segments = result?.segments
               ? result.segments
                     .filter((s: { text: string }) => isValidSegment(s.text))
                     .map((s: { start: number; end: number; text: string }) => ({
                         id: crypto.randomUUID(),
                         startTime: s.start + chunkStartSec,
                         endTime: s.end + chunkStartSec,
                         text: s.text.trim(),
                         speaker: label
                     }))
               : []
           return { segments, rms }
       }

       const [micResult, systemResult] = await Promise.all([
           processStream('Me', opts.micBlob, 'webm'),
           processStream('Them', opts.systemBlob, 'wav')
       ])

       const micSegments = micResult.segments.map((s: { startTime: number; endTime: number;[k: string]: unknown }) => ({
           ...s,
           startTime: s.startTime - chunkStartSec,
           endTime: s.endTime - chunkStartSec
       }))
       
       const systemSegments = systemResult.segments.map((s: { startTime: number; endTime: number;[k: string]: unknown }) => ({
           ...s,
           startTime: s.startTime - chunkStartSec,
           endTime: s.endTime - chunkStartSec
       }))
       
       // Here we could apply bleed suppression if we had it, but we removed it.
       // Just merge raw for now to verify capture.
       
       processedMicSegmentsRef.current.push(
           ...micSegments.map((s: { startTime: number; endTime: number;[k: string]: unknown }) => ({
               ...s,
               startTime: s.startTime + chunkStartSec,
               endTime: s.endTime + chunkStartSec
           })),
           ...systemSegments.map((s: { startTime: number; endTime: number;[k: string]: unknown }) => ({
               ...s,
               startTime: s.startTime + chunkStartSec,
               endTime: s.endTime + chunkStartSec
           }))
       )
   }

  // Common Whisper Hallucinations to filter out
  const INVALID_PHRASES = [
      'you', 'mbc', 'subtitles by', 'captioned by', 
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
              if (!recorder || recorder.state === 'inactive') {
                  if (chunks.length > 0) return new Blob(chunks, { type: 'audio/webm;codecs=opus' })
                  return null
              }
              
              const stopped = new Promise<void>((resolve) => {
                  recorder.onstop = () => resolve()
              })
              recorder.stop()
              await stopped
              
              if (chunks.length === 0) return null
              return new Blob(chunks, { type: 'audio/webm;codecs=opus' })
          }
          
          // Stop Mic Recorder
          const micBlob = await stopRecorder(micRecorderRef.current, micChunksRef.current)
          
          // Stop Native Capture
          await window.ipcRenderer.invoke('NATIVE_AUDIO_STOP')
          if (nativeAudioListenerRef.current) {
              window.ipcRenderer.off('NATIVE_AUDIO_CHUNK', nativeAudioListenerRef.current)
              nativeAudioListenerRef.current = null
          }
          
          // Finalize System Audio
          let systemBlob: Blob | undefined
          if (systemPcmChunksRef.current.length > 0) {
              // Merge remaining
              let totalLen = 0
              for(const c of systemPcmChunksRef.current) totalLen += c.length
              const merged = new Float32Array(totalLen)
              let offset = 0
              for(const c of systemPcmChunksRef.current) {
                  merged.set(c, offset)
                  offset += c.length
              }
              systemBlob = createWavBlob(merged)
              systemPcmChunksRef.current = []
              console.log(`[Pluto] Finalized System Audio: ${systemBlob.size} bytes`)
          }

          // Stop all tracks
          stopAllTracks()
          
          // Reset refs
          micRecorderRef.current = null
          micChunksRef.current = []
          hasMicRecorderRef.current = false
          hasSystemRecorderRef.current = false
          
          // Cleanup visualization
          stopSpeakingMonitor()
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
          
          // Process final chunks
          for (const [chunkIndex, micB] of pendingMicChunksRef.current.entries()) {
              const sysB = pendingSystemChunksRef.current.get(chunkIndex)
              enqueueBackgroundJob(() => transcribeChunkPair({ micBlob: micB, systemBlob: sysB, chunkIndex }))
          }
          pendingMicChunksRef.current.clear()
          pendingSystemChunksRef.current.clear()
          
          // Wait for queue
          await processingQueueRef.current

          // Store a single full audio file for playback
          let primaryAudioPath = ''
          const primaryBlob = micBlob // Default to mic
          if (primaryBlob && primaryBlob.size > 0) {
              try {
                  const buffer = await primaryBlob.arrayBuffer()
                  const maybePath = await window.ipcRenderer.invoke('AUDIO_SAVE_AND_CONVERT', buffer)
                  if (maybePath) primaryAudioPath = maybePath
              } catch (e) {
                  console.warn('[Pluto] Save failed:', e)
              }
          }
          // Notify completion
          // ... (rest of logic)


          // Wait for background chunk processing to finish
          await processingQueueRef.current
          const micSegments = processedMicSegmentsRef.current

          // Merge by timestamp
          const sortedSegments = [...micSegments].sort((a, b) => a.startTime - b.startTime)
          
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
          
          const summaryPromise = window.ipcRenderer.invoke('GENERATE_SUMMARY', { 
              transcript: fullTranscript,
              userNotes: userNotes,
              participants: participants,
              meetingTitle: userTitle
          })

          const [summaryResult] = await Promise.allSettled([summaryPromise])
          if (summaryResult.status === 'fulfilled') {
              enhancedNotes = summaryResult.value
          } else {
              console.error('[Pluto] Summary generation failed:', summaryResult.reason)
          }

          // Relabel transcript segments with actual speaker names
          const labeledTranscription = newTranscription

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
          void (async () => {
              const runExtraction = async () => {
                  try {
                      console.log('[Pluto] Extracting entities for Knowledge Graph...')
                      window.dispatchEvent(new CustomEvent('MEETING_ENTITIES_PROCESSING', { detail: { meetingId: meetingData.id, processing: true } }))
                      const fullTranscriptText = labeledTranscription.map(s => `${s.speaker}: ${s.text}`).join('\n')
                      const entityResult = await window.ipcRenderer.invoke('EXTRACT_AND_PROCESS_ENTITIES', {
                          transcript: fullTranscriptText,
                          meetingId: String(meetingData.id)
                      })
                      console.log(`[Pluto] Entity extraction complete: ${entityResult.created} created, ${entityResult.linked} linked`)
                      window.dispatchEvent(new CustomEvent('MEETING_ENTITIES_UPDATED', { detail: { meetingId: meetingData.id } }))
                  } catch (entityErr) {
                      console.error('[Pluto] Knowledge Graph processing failed:', entityErr)
                      // Non-blocking error
                  } finally {
                      window.dispatchEvent(new CustomEvent('MEETING_ENTITIES_PROCESSING', { detail: { meetingId: meetingData.id, processing: false } }))
                  }
              }

              if ('requestIdleCallback' in window) {
                  window.requestIdleCallback(() => { void runExtraction() }, { timeout: 2000 })
              } else {
                  setTimeout(() => { void runExtraction() }, 300)
              }
          })()
          
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
