import path from 'node:path'
import { spawn } from 'node:child_process'

export type ActiveCallState = {
  active: boolean
  appName: string | null
  pidCount: number | null
  confidence: 'low' | 'medium' | 'high'
  reason: string
}

type RunningProcessInfo = {
  pid: number
  ppid: number
  name: string
  command: string
}

type BrowserId = 'chrome' | 'edge' | 'brave' | 'safari' | 'firefox'

type BrowserScriptKind = 'chromium' | 'safari' | 'firefox'

type CallProvider = 'google-meet' | 'zoom' | 'teams' | 'slack'

type CallAppMatcher = {
  label: string
  patterns: RegExp[]
  allowSilentFallback: boolean
  browserId?: BrowserId
}

type BrowserAdapter = {
  automationAppName: string
  scriptKind: BrowserScriptKind
}

type ProviderUrlMatcher = {
  patterns?: RegExp[]
  test?: (url: URL) => boolean
}

type MatchedCallApp = {
  label: string
  allowSilentFallback: boolean
  browserId?: BrowserId
  pids: number[]
}

type RunAudioProbeOptions = {
  durationMs?: number
  allowSilent?: boolean
  includeSelf?: boolean
  targetPids?: number[]
  silentProbe?: boolean
}

type CreateActiveCallDetectorArgs = {
  runAudioProbe: (options: RunAudioProbeOptions) => Promise<boolean>
}

const BROWSER_DISPLAY_LABELS: Record<string, string> = {
  chrome: 'Chrome',
  'google chrome': 'Chrome',
  chromium: 'Chrome',
  edge: 'Edge',
  'microsoft edge': 'Edge',
  brave: 'Brave',
  'brave browser': 'Brave',
  safari: 'Safari',
  firefox: 'Firefox',
  'mozilla firefox': 'Firefox'
}

const CALL_APP_MATCHERS: CallAppMatcher[] = [
  { label: 'Google Chrome', patterns: [/google chrome/i, /chrome helper/i, /\bchromium\b/i], allowSilentFallback: false, browserId: 'chrome' },
  { label: 'Microsoft Edge', patterns: [/microsoft edge/i, /edge helper/i], allowSilentFallback: false, browserId: 'edge' },
  { label: 'Brave Browser', patterns: [/brave browser/i, /brave helper/i], allowSilentFallback: false, browserId: 'brave' },
  { label: 'Safari', patterns: [/\bsafari\b/i], allowSilentFallback: false, browserId: 'safari' },
  { label: 'Mozilla Firefox', patterns: [/mozilla firefox/i, /\bfirefox\b/i], allowSilentFallback: false, browserId: 'firefox' },
  { label: 'Slack', patterns: [/\bslack\b/i, /slack helper/i], allowSilentFallback: true },
  { label: 'Zoom', patterns: [/zoom\.us/i, /\bzoom\b/i, /cpthost/i], allowSilentFallback: true },
  { label: 'Microsoft Teams', patterns: [/microsoft teams/i, /\bteams\b/i], allowSilentFallback: true }
]

const BROWSER_ADAPTERS: Partial<Record<BrowserId, BrowserAdapter>> = {
  chrome: { automationAppName: 'Google Chrome', scriptKind: 'chromium' },
  edge: { automationAppName: 'Microsoft Edge', scriptKind: 'chromium' },
  brave: { automationAppName: 'Brave Browser', scriptKind: 'chromium' },
  safari: { automationAppName: 'Safari', scriptKind: 'safari' },
  firefox: { automationAppName: 'Firefox', scriptKind: 'firefox' }
}

const SLACK_CALL_TOKEN_PATTERN = /(^|[/?#&=_.-])(huddle|call|calls)([/?#&=_.-]|$)/i

const CALL_PROVIDER_URL_PATTERNS: Record<CallProvider, ProviderUrlMatcher> = {
  'google-meet': {
    patterns: [
      /^https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/i
    ]
  },
  zoom: {
    patterns: [
      /^https?:\/\/(?:[\w-]+\.)?zoom\.us\/(?:wc|j)\//i
    ]
  },
  teams: {
    patterns: [
      /^https?:\/\/teams\.microsoft\.com\/l\/meetup-join/i,
      /^https?:\/\/teams\.live\.com\/meet\//i
    ]
  },
  slack: {
    test: (url: URL) => {
      const host = url.hostname.toLowerCase()
      if (host !== 'app.slack.com' && !host.endsWith('.slack.com')) return false
      const callPath = `${url.pathname}${url.search}${url.hash}`
      return SLACK_CALL_TOKEN_PATTERN.test(callPath)
    }
  }
}

const toDisplayLabel = (rawAppName: string): string => {
  const normalized = rawAppName.trim().toLowerCase()
  return BROWSER_DISPLAY_LABELS[normalized] || rawAppName
}

const getRunningProcesses = async (): Promise<RunningProcessInfo[]> => {
  return await new Promise<RunningProcessInfo[]>((resolve) => {
    let stdout = ''
    let stderr = ''
    const ps = spawn('ps', ['-axo', 'pid=,ppid=,comm='])

    ps.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    ps.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    ps.on('close', (code) => {
      if (code !== 0) {
        console.error('[Pluto] Failed to read process list:', stderr)
        return resolve([])
      }
      const processes = stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map((line): RunningProcessInfo | null => {
          const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
          if (!match) return null
          const pid = Number.parseInt(match[1], 10)
          const ppid = Number.parseInt(match[2], 10)
          if (!Number.isInteger(pid) || pid <= 0) return null
          if (!Number.isInteger(ppid) || ppid < 0) return null
          const rawName = match[3].trim()
          return {
            pid,
            ppid,
            name: path.basename(rawName).toLowerCase(),
            command: rawName.toLowerCase()
          }
        })
        .filter((proc): proc is RunningProcessInfo => proc !== null)
      resolve(processes)
    })

    ps.on('error', (err) => {
      console.error('[Pluto] Failed to spawn process list probe:', err)
      resolve([])
    })
  })
}

const buildBrowserTabUrlScript = (adapter: BrowserAdapter): string => {
  if (adapter.scriptKind === 'firefox') {
    return `tell application "${adapter.automationAppName}"
if it is not running then return ""
set urls to ""
try
  repeat with w in windows
    try
      repeat with t in tabs of w
        try
          set u to URL of t
          if u is not missing value and u is not "" then
            set urls to urls & u & linefeed
          end if
        end try
      end repeat
    end try
    try
      set u to URL of w
      if u is not missing value and u is not "" then
        set urls to urls & u & linefeed
      end if
    end try
  end repeat
end try
try
  set u to URL of front document
  if u is not missing value and u is not "" then
    set urls to urls & u & linefeed
  end if
end try
return urls
end tell`
  }

  if (adapter.scriptKind === 'safari') {
    return `tell application "${adapter.automationAppName}"
if it is not running then return ""
set urls to ""
repeat with w in windows
  repeat with t in tabs of w
    set u to URL of t
    if u is not missing value and u is not "" then
      set urls to urls & u & linefeed
    end if
  end repeat
end repeat
return urls
end tell`
  }

  return `tell application "${adapter.automationAppName}"
if it is not running then return ""
set urls to ""
repeat with w in windows
  repeat with t in tabs of w
    set u to URL of t
    if u is not "" then
      set urls to urls & u & linefeed
    end if
  end repeat
end repeat
return urls
end tell`
}

const listBrowserTabUrls = async (
  browserId: BrowserId
): Promise<string[]> => {
  if (process.platform !== 'darwin') return []
  const adapter = BROWSER_ADAPTERS[browserId]
  if (!adapter) return []
  const script = buildBrowserTabUrlScript(adapter)

  return await new Promise<string[]>((resolve) => {
    const proc = spawn('osascript', ['-e', script])
    let stdout = ''
    proc.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    proc.on('close', (code) => {
      if (code !== 0) return resolve([])
      const urls = stdout
        .split(/\r?\n/)
        .map(url => url.trim())
        .filter(Boolean)
      resolve(urls)
    })
    proc.on('error', () => {
      resolve([])
    })
  })
}

const matchProviderFromUrl = (rawUrl: string): CallProvider | null => {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl.trim())
  } catch {
    return null
  }

  const normalizedUrl = parsedUrl.toString()
  for (const [provider, matcher] of Object.entries(CALL_PROVIDER_URL_PATTERNS) as [CallProvider, ProviderUrlMatcher][]) {
    if (matcher.patterns?.some(pattern => pattern.test(normalizedUrl))) {
      return provider
    }
    if (matcher.test?.(parsedUrl)) {
      return provider
    }
  }
  return null
}

const detectBrowserCallProviders = async (
  matchedApps: MatchedCallApp[]
): Promise<Map<string, CallProvider>> => {
  const providerByLabel = new Map<string, CallProvider>()
  for (const matched of matchedApps) {
    if (!matched.browserId) continue
    const urls = await listBrowserTabUrls(matched.browserId)
    const provider = urls
      .map(matchProviderFromUrl)
      .find((candidate): candidate is CallProvider => Boolean(candidate))
    if (provider) {
      providerByLabel.set(matched.label, provider)
    }
  }
  return providerByLabel
}

export const createActiveCallDetector = ({
  runAudioProbe
}: CreateActiveCallDetectorArgs) => {
  return async (): Promise<ActiveCallState> => {
    if (process.platform !== 'darwin') {
      return {
        active: false,
        appName: null,
        pidCount: null,
        confidence: 'low',
        reason: 'unsupported-platform'
      }
    }

    const processes = await getRunningProcesses()
    const childrenByParent = new Map<number, number[]>()
    for (const proc of processes) {
      const children = childrenByParent.get(proc.ppid) ?? []
      children.push(proc.pid)
      childrenByParent.set(proc.ppid, children)
    }
    const expandWithDescendants = (rootPids: number[]) => {
      const expanded = new Set<number>(rootPids)
      const queue = [...rootPids]
      while (queue.length > 0) {
        const current = queue.shift()!
        const children = childrenByParent.get(current) ?? []
        for (const childPid of children) {
          if (expanded.has(childPid)) continue
          expanded.add(childPid)
          queue.push(childPid)
        }
      }
      return Array.from(expanded)
    }

    const matchedApps: MatchedCallApp[] = CALL_APP_MATCHERS
      .map(matcher => {
        const directPids = processes
          .filter(proc =>
            matcher.patterns.some(pattern => pattern.test(proc.name) || pattern.test(proc.command))
          )
          .map(proc => proc.pid)
        const pids = expandWithDescendants(directPids)
        return {
          label: matcher.label,
          allowSilentFallback: matcher.allowSilentFallback,
          browserId: matcher.browserId,
          pids
        }
      })
      .filter(entry => entry.pids.length > 0)
    const browserCallProviderByLabel = await detectBrowserCallProviders(matchedApps)

    if (matchedApps.length === 0) {
      return {
        active: false,
        appName: null,
        pidCount: null,
        confidence: 'low',
        reason: 'no-call-app-running'
      }
    }

    for (const matched of matchedApps) {
      const externalAudioActive = await runAudioProbe({
        durationMs: 1200,
        includeSelf: false,
        allowSilent: false,
        targetPids: matched.pids,
        silentProbe: true
      })

      if (externalAudioActive) {
        return {
          active: true,
          appName: toDisplayLabel(matched.label),
          pidCount: matched.pids.length,
          confidence: 'high',
          reason: 'call-app-running-with-active-audio'
        }
      }
    }

    // Silent fallback: treat as active only when target audio processes exist,
    // even if no non-zero samples were observed during probe window.
    for (const matched of matchedApps) {
      const hasBrowserCallTab = browserCallProviderByLabel.has(matched.label)
      const allowSilentFallback = matched.allowSilentFallback || hasBrowserCallTab
      if (!allowSilentFallback) continue
      const silentButAttached = await runAudioProbe({
        durationMs: 1200,
        includeSelf: false,
        allowSilent: true,
        targetPids: matched.pids,
        silentProbe: true
      })

      if (silentButAttached) {
        const reason = hasBrowserCallTab
          ? 'browser-call-tab-open-silent-fallback'
          : 'call-app-running-silent-fallback'
        return {
          active: true,
          appName: toDisplayLabel(matched.label),
          pidCount: matched.pids.length,
          confidence: 'medium',
          reason
        }
      }
    }

    return {
      active: false,
      appName: matchedApps[0] ? toDisplayLabel(matchedApps[0].label) : null,
      pidCount: matchedApps[0]?.pids.length || null,
      confidence: 'low',
      reason: 'call-app-running-without-target-audio'
    }
  }
}
