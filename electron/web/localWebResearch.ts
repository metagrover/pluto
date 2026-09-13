import { isIP } from 'node:net';
import { net, BrowserWindow, session } from 'electron';

export interface LocalWebResult {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  passage?: string;
}

export interface LocalWebResearchResult {
  status: 'completed' | 'unavailable';
  sanitizedQuery: string;
  results: LocalWebResult[];
}

const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';
const MAX_QUERY_LENGTH = 160;
const MAX_PAGE_BYTES = 300_000;
const MAX_PASSAGE_CHARS = 2_400;
const GENERIC_TOPIC_RULES: Array<[RegExp, string]> = [
  [/\bfeedback|critique|review\b/i, 'giving constructive feedback'],
  [/\bconflict|disagree|tension|difficult\b/i, 'workplace conflict resolution'],
  [/\bnegotiat|compensation|salary\b/i, 'professional negotiation'],
  [/\bboundar|saying no|push back\b/i, 'professional boundaries'],
  [/\bdelegat|accountab|ownership\b/i, 'delegation and accountability'],
  [/\btrust|rapport|relationship\b/i, 'workplace trust building'],
  [/\bleadership|manag|coach|mentor\b/i, 'leadership coaching'],
  [/\bcareer|promotion|development\b/i, 'career development'],
  [/\bremote|hybrid|distributed\b/i, 'remote work collaboration'],
  [/\bmeeting|conversation|agenda|prepare\b/i, 'conversation preparation'],
  [/\bmessage|email|write|draft|follow.?up\b/i, 'professional messaging'],
  [/\binterrupt|cut(?:s|ting)?\s+(?:me\s+)?off\b/i, 'conversation turn taking'],
  [/\bcommunicat|listen|clarif\b/i, 'workplace communication'],
  [/\bteam|collaborat|stakeholder\b/i, 'team collaboration'],
  [/\bchange|transition|migration|adoption\b/i, 'change management'],
  [
    /\bsoftware|technical|architecture|engineering\b/i,
    'engineering collaboration',
  ],
];

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );

const stripMarkup = (value: string) =>
  decodeHtml(
    value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

const safeHttpsUrl = (value: string): URL | null => {
  try {
    const url = new URL(decodeHtml(value), SEARCH_ENDPOINT);
    const isDuckDuckGo =
      url.hostname === 'duckduckgo.com' ||
      url.hostname.endsWith('.duckduckgo.com');
    if (isDuckDuckGo) {
      const redirected = url.searchParams.get('uddg');
      if (redirected) return safeHttpsUrl(redirected);
    }
    const hostname = url.hostname.toLocaleLowerCase();
    const ipHostname = hostname.replace(/^\[|\]$/g, '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      isIP(ipHostname) !== 0
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};

export const sanitizeWebResearchQuery = (
  query: string,
  sensitiveTerms: string[] = [],
): string => {
  let sanitized = query
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, ' ')
    .replace(/[“”"'][^“”"']{3,}[“”"']/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ');
  for (const term of sensitiveTerms
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .sort((left, right) => right.length - left.length)) {
    sanitized = sanitized.replace(
      new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      ' ',
    );
  }
  sanitized = sanitized
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const topics = GENERIC_TOPIC_RULES.filter(([pattern]) =>
    pattern.test(sanitized),
  )
    .map(([, topic]) => topic)
    .slice(0, 3);
  const freshness =
    /\b(latest|current|recent|research|evidence|sources?)\b/i.test(sanitized)
      ? 'current research'
      : 'best practices';
  return [
    'workplace',
    ...(topics.length ? topics : ['professional relationship advice']),
    freshness,
  ]
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(' ')
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
};

export const parseDuckDuckGoHtml = (html: string): LocalWebResult[] => {
  const blocks = html.split(/class=["'][^"']*result(?:\s|__body)/i).slice(1);
  const results: LocalWebResult[] = [];
  for (const block of blocks) {
    const anchor = block.match(
      /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!anchor) continue;
    const url = safeHttpsUrl(anchor[1]);
    if (!url || url.hostname.endsWith('duckduckgo.com')) continue;
    const snippetMatch = block.match(
      /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\//i,
    );
    results.push({
      title: stripMarkup(anchor[2]).slice(0, 180),
      url: url.toString(),
      domain: url.hostname.replace(/^www\./, ''),
      snippet: stripMarkup(snippetMatch?.[1] ?? '').slice(0, 500),
    });
    if (results.length === 3) break;
  }
  return results;
};

const extractReadableText = (html: string) =>
  stripMarkup(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' '),
  ).slice(0, MAX_PASSAGE_CHARS);

const fetchText = async (url: string, signal: AbortSignal) => {
  const response = await net.fetch(url, {
    signal,
    redirect: 'error',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return '';
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_PAGE_BYTES) return '';
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (bytes < MAX_PAGE_BYTES) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      text += decoder.decode(chunk.value, { stream: true });
      if (bytes >= MAX_PAGE_BYTES) break;
    }
    text += decoder.decode();
    return text.slice(0, MAX_PAGE_BYTES);
  } finally {
    await reader.cancel().catch(() => {});
  }
};

const searchWithHiddenWindow = async (
  query: string,
  signal: AbortSignal,
): Promise<LocalWebResult[]> => {
  const partition = session.fromPartition('person-chat-web');
  partition.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: partition,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      javascript: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const preventInsecureNavigation = (event: Electron.Event, target: string) => {
    try {
      if (new URL(target).protocol !== 'https:') event.preventDefault();
    } catch {
      event.preventDefault();
    }
  };
  window.webContents.on('will-navigate', preventInsecureNavigation);
  window.webContents.on('will-redirect', preventInsecureNavigation);
  const preventDownload = (event: Electron.Event) => event.preventDefault();
  window.webContents.session.on('will-download', preventDownload);
  const abort = () => {
    if (!window.isDestroyed()) window.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`;
    await window.loadURL(url);
    if (signal.aborted || window.isDestroyed()) return [];
    const raw = (await window.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('.result')).slice(0, 6).map((row) => {
        const link = row.querySelector('.result__a');
        const snippet = row.querySelector('.result__snippet');
        return link ? { title: link.textContent || '', url: link.href || '', snippet: snippet?.textContent || '' } : null;
      }).filter(Boolean)
    `)) as Array<{ title: string; url: string; snippet: string }>;
    return raw
      .map((item) => {
        const url = safeHttpsUrl(item.url);
        return url
          ? {
              title: item.title.trim().slice(0, 180),
              url: url.toString(),
              domain: url.hostname.replace(/^www\./, ''),
              snippet: item.snippet.trim().slice(0, 500),
            }
          : null;
      })
      .filter((item): item is LocalWebResult => Boolean(item))
      .slice(0, 3);
  } finally {
    signal.removeEventListener('abort', abort);
    partition.removeListener('will-download', preventDownload);
    if (!window.isDestroyed()) window.destroy();
    await Promise.allSettled([
      partition.clearStorageData(),
      partition.clearCache(),
    ]);
  }
};

export interface LocalWebResearchService {
  research(input: {
    query: string;
    sensitiveTerms?: string[];
    signal?: AbortSignal;
  }): Promise<LocalWebResearchResult>;
}

export const createLocalWebResearchService = (): LocalWebResearchService => {
  let previousJob: Promise<void> = Promise.resolve();
  return {
    async research({ query, sensitiveTerms = [], signal }) {
      const sanitizedQuery = sanitizeWebResearchQuery(query, sensitiveTerms);
      if (!sanitizedQuery) {
        return { status: 'unavailable', sanitizedQuery, results: [] };
      }
      const timeout = AbortSignal.timeout(8_000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const predecessor = previousJob;
      let releaseJob = () => {};
      previousJob = new Promise<void>((resolve) => {
        releaseJob = resolve;
      });
      try {
        await predecessor;
        if (combined.aborted) {
          return { status: 'unavailable', sanitizedQuery, results: [] };
        }
        let results: LocalWebResult[] = [];
        try {
          const html = await fetchText(
            `${SEARCH_ENDPOINT}?q=${encodeURIComponent(sanitizedQuery)}`,
            combined,
          );
          results = parseDuckDuckGoHtml(html);
        } catch {
          results = [];
        }
        if (results.length === 0 && !combined.aborted) {
          results = await searchWithHiddenWindow(sanitizedQuery, combined);
        }
        if (results.length === 0) {
          return { status: 'unavailable', sanitizedQuery, results: [] };
        }
        const enriched = await Promise.all(
          results.map(async (result, index) => {
            if (index >= 2 || combined.aborted) return result;
            try {
              const html = await fetchText(result.url, combined);
              return { ...result, passage: extractReadableText(html) };
            } catch {
              return result;
            }
          }),
        );
        return { status: 'completed', sanitizedQuery, results: enriched };
      } catch {
        return { status: 'unavailable', sanitizedQuery, results: [] };
      } finally {
        releaseJob();
      }
    },
  };
};
