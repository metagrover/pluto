import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Logo } from '../Brand/Logo'

interface SetupWizardProps {
  onComplete: () => void
}

export const SetupWizard = ({ onComplete }: SetupWizardProps) => {
  const [step, setStep] = useState(1)
  const [pythonStatus, setPythonStatus] = useState<{ available: boolean; version?: string; error?: string } | null>(null)
  const [hfToken, setHfToken] = useState('')
  const [llmProvider, setLlmProvider] = useState('ollama')
  const [hydrated, setHydrated] = useState(false)

  // Restore saved progress so user doesn't redo first screens
  useEffect(() => {
    const load = async () => {
      const [setupComplete, savedStep, savedHf, savedLlm] = await Promise.all([
        window.ipcRenderer.invoke('GET_SETTING', 'setup_complete'),
        window.ipcRenderer.invoke('GET_SETTING', 'setup_step'),
        window.ipcRenderer.invoke('GET_SETTING', 'hf_token'),
        window.ipcRenderer.invoke('GET_SETTING', 'llm_provider'),
      ])
      if (setupComplete === 'true') {
        onComplete()
        return
      }
      const stepNum = savedStep ? Math.min(4, Math.max(1, Number(savedStep))) : 1
      setStep(stepNum)
      setHfToken(savedHf ?? '')
      setLlmProvider(savedLlm ?? 'ollama')
      setHydrated(true)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, [])

  useEffect(() => {
    if (step === 2) {
      checkPython()
    }
  }, [step])

  const checkPython = async () => {
    const status = await window.ipcRenderer.invoke('WHISPERX_CHECK_PYTHON')
    setPythonStatus(status)
  }

  const persistStep = async (s: number) => {
    await window.ipcRenderer.invoke('SET_SETTING', { key: 'setup_step', value: String(s) })
  }

  const handleFinish = async () => {
    await window.ipcRenderer.invoke('SET_SETTING', { key: 'setup_complete', value: 'true' })
    await window.ipcRenderer.invoke('SET_SETTING', { key: 'hf_token', value: hfToken })
    await window.ipcRenderer.invoke('SET_SETTING', { key: 'llm_provider', value: llmProvider })
    onComplete()
  }

  if (!hydrated) {
    return (
      <div className="fixed inset-0 bg-pro-bg z-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-pro-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-pro-bg z-50 overflow-y-auto selection:bg-pro-accent/20">
      <div className="min-h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto w-full space-y-12">
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="relative inline-block mb-10">
                <div className="w-48 h-48 rounded-[2.5rem] bg-white shadow-2xl flex items-center justify-center p-8 border border-pro-border relative group">
                    <Logo size={120} />
                    <div className="absolute inset-0 bg-pro-accent/5 rounded-[2.5rem] blur-2xl -z-10 group-hover:bg-pro-accent/10 transition-all" />
                </div>
                <div className="absolute -bottom-2 -right-2 w-12 h-12 bg-pro-accent rounded-2xl flex items-center justify-center text-xl shadow-2xl shadow-pro-accent/40 animate-bounce cursor-default text-white">✨</div>
            </div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tighter text-pro-text-main leading-tight">
                Focus on the <span className="gradient-text">human.</span>
            </h1>
            <p className="mt-6 text-pro-text-muted/80 leading-relaxed font-bold text-lg max-w-sm mx-auto">
              Pluto is your personal second brain for deep focus and effortless recall.
            </p>
            <button
              onClick={async () => { await persistStep(2); setStep(2) }}
              className="mt-14 w-full h-16 bg-pro-text-main text-white rounded-2xl font-bold text-xs uppercase tracking-[0.2em] shadow-xl hover:scale-[1.02] transition-all active:scale-[0.98]"
            >
              Get Started
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-right-8 duration-700 space-y-10">
            <div className="space-y-4">
                <h2 className="text-2xl md:text-4xl font-black tracking-tighter text-pro-text-main">Local Engine</h2>
                <p className="text-base text-pro-text-muted/60 font-bold uppercase tracking-widest leading-relaxed">
                    Preparing your local high-performance compute.
                </p>
            </div>
            
            <div className="p-10 bg-white border border-pro-border rounded-[2rem] shadow-premium text-left space-y-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className={`w-3 h-3 rounded-full ${pythonStatus?.available ? 'bg-green-500 shadow-status-ok' : 'bg-pro-border pulse-glow'}`} />
                    <span className="text-[10px] font-bold text-pro-text-muted/60 uppercase tracking-[0.15em]">Python Engine Check</span>
                </div>
                {pythonStatus === null ? (
                    <Loader2 size={16} className="animate-spin text-pro-accent" />
                ) : pythonStatus.available ? (
                    <div className="px-3 py-1 bg-green-500/10 rounded-lg">
                        <span className="text-green-600 text-[9px] font-bold uppercase tracking-widest">Online</span>
                    </div>
                ) : (
                    <div className="px-3 py-1 bg-red-500/10 rounded-lg">
                        <span className="text-red-500 text-[9px] font-bold uppercase tracking-widest">Missing</span>
                    </div>
                )}
              </div>
              {pythonStatus?.version && (
                <div className="p-4 bg-pro-bg/50 rounded-2xl border border-pro-border group">
                    <p className="text-[10px] text-pro-text-muted/40 font-mono font-bold group-hover:text-pro-accent transition-colors">{pythonStatus.version}</p>
                </div>
              )}
              {pythonStatus?.error && (
                <div className="p-6 bg-red-50 border border-red-100 rounded-2xl space-y-3">
                  <p className="text-xs text-red-600 font-bold leading-relaxed">{pythonStatus.error}</p>
                  <p className="text-[9px] font-black text-red-400 uppercase tracking-widest leading-loose">Check installation guide in README</p>
                </div>
              )}
            </div>

            <div className="flex gap-6 mt-12">
              <button
                onClick={() => setStep(1)}
                className="flex-1 h-14 text-pro-text-muted/40 font-bold text-[10px] uppercase tracking-[0.2em] hover:text-pro-text-main transition-colors"
              >
                Go back
              </button>
              <button
                onClick={async () => { await persistStep(3); setStep(3) }}
                disabled={!pythonStatus?.available}
                className="flex-[2] h-16 bg-pro-text-main text-white rounded-2xl font-bold text-[11px] uppercase tracking-[0.2em] shadow-xl transition-all disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed hover:scale-[1.02]"
              >
                Continue Setup
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-right-8 duration-700 space-y-12">
            <div className="space-y-4">
                <h2 className="text-2xl md:text-4xl font-black tracking-tighter text-pro-text-main">Speaker ID</h2>
                <p className="text-base text-pro-text-muted/60 font-bold uppercase tracking-widest leading-relaxed">
                    Optional diarization for identity tracking.
                </p>
            </div>
            
            <div className="text-left space-y-4">
              <label className="block text-[10px] font-bold text-pro-text-muted/40 uppercase tracking-[0.2em] mb-4 pl-4">Hugging Face Token</label>
              <input
                type="password"
                placeholder="hf_..."
                value={hfToken}
                onChange={(e) => setHfToken(e.target.value)}
                className="w-full h-16 p-6 bg-white border border-pro-border rounded-2xl text-sm focus:outline-none focus:ring-4 focus:ring-pro-accent/10 transition-all font-mono shadow-sm placeholder:text-pro-text-muted/20"
              />
              <div className="p-6 bg-pro-bg/50 rounded-2xl border border-pro-border">
                <p className="text-[10px] text-pro-text-muted/50 font-medium leading-loose italic">
                    You can skip this if you don't need speaker labels. To enable, enter a token from your HF Dashboard &gt; Tokens.
                </p>
              </div>
            </div>

            <div className="flex gap-6 mt-14">
              <button
                onClick={() => setStep(2)}
                className="flex-1 h-14 text-pro-text-muted/40 font-bold text-[10px] uppercase tracking-[0.2em] hover:text-pro-text-main transition-colors"
              >
                Back
              </button>
              <button
                onClick={async () => {
                  await window.ipcRenderer.invoke('SET_SETTING', { key: 'hf_token', value: hfToken })
                  await persistStep(4)
                  setStep(4)
                }}
                className="flex-[2] h-16 bg-pro-text-main text-white rounded-2xl font-bold text-[11px] uppercase tracking-[0.2em] shadow-xl hover:scale-[1.02] transition-all"
              >
                {hfToken ? 'Continue' : 'Skip Step'}
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="animate-in fade-in slide-in-from-right-8 duration-700 space-y-12">
            <div className="space-y-4">
                <h2 className="text-2xl md:text-4xl font-black tracking-tighter text-pro-text-main">AI Model</h2>
                <p className="text-base text-pro-text-muted/60 font-bold uppercase tracking-widest leadign-relaxed">
                    Choose your reasoning provider. 
                </p>
            </div>
            
            <div className="space-y-4">
              {[
                { id: 'ollama', name: 'Ollama (Local Model)', desc: 'Private Local Reasoning', icon: '🏠' },
                { id: 'gemini', name: 'Gemini 1.5 Pro', desc: 'Powerful Cloud Model', icon: '✨' },
                { id: 'openai', name: 'GPT-4o', desc: 'Standard Cloud Model', icon: '☁️' }
              ].map(provider => (
                <button
                  key={provider.id}
                  onClick={() => {
                    setLlmProvider(provider.id)
                    window.ipcRenderer.invoke('SET_SETTING', { key: 'llm_provider', value: provider.id })
                  }}
                  className={`w-full p-6 text-left border rounded-3xl transition-all duration-500 group relative overflow-hidden ${
                    llmProvider === provider.id 
                    ? 'border-pro-accent bg-white shadow-xl ring-2 ring-pro-accent/10' 
                    : 'border-pro-border bg-white/60 hover:bg-white hover:border-pro-accent/20'
                  }`}
                >
                  <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-5">
                        <span className={`text-2xl grayscale group-hover:grayscale-0 transition-all ${llmProvider === provider.id ? 'grayscale-0' : ''}`}>{provider.icon}</span>
                        <div>
                            <span className={`text-base font-bold tracking-tight ${llmProvider === provider.id ? 'text-pro-text-main' : 'text-pro-text-main/60'}`}>{provider.name}</span>
                            <p className="text-[10px] text-pro-text-muted/50 font-bold uppercase tracking-tighter mt-1 leading-none">{provider.desc}</p>
                        </div>
                    </div>
                    {llmProvider === provider.id && (
                        <div className="w-6 h-6 rounded-full bg-pro-accent flex items-center justify-center text-[10px] text-white shadow-lg shadow-pro-accent/30 animate-in zoom-in-50 duration-300">✓</div>
                    )}
                  </div>
                  {llmProvider === provider.id && <div className="absolute inset-0 bg-pro-accent/5 animate-pulse" />}
                </button>
              ))}
            </div>

            <div className="flex gap-6 mt-12">
              <button
                onClick={() => setStep(3)}
                className="flex-1 h-14 text-pro-text-muted/40 font-bold text-[10px] uppercase tracking-[0.2em] hover:text-pro-text-main transition-colors"
              >
                Go back
              </button>
              <button
                onClick={handleFinish}
                className="flex-[2] h-16 bg-pro-text-main text-white rounded-2xl font-bold text-[11px] uppercase tracking-[0.2em] shadow-xl hover:scale-[1.02] transition-all"
              >
                Finish Setup
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
