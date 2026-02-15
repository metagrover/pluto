import type { AnalysisDocument, Meeting } from '../types'

const FORBIDDEN_PREFIXES = [
    'observation:',
    'why it matters:',
    'supporting detail:',
    'evidence:',
    'pluto use:',
    'inference:'
]

const normalizeWhitespace = (value: string): string => {
    return value.replace(/\s+/g, ' ').trim()
}

const stripForbiddenPrefixes = (value: string): string => {
    let clean = value.trim()
    for (const prefix of FORBIDDEN_PREFIXES) {
        if (clean.toLowerCase().startsWith(prefix)) {
            clean = clean.slice(prefix.length).trim()
        }
    }
    return clean
}

const extractSection = (markdown: string, title: string): string => {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(?:^|\\n)##\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i')
    const match = markdown.match(regex)
    return match?.[1]?.trim() || ''
}

const flushCurrentItem = (items: string[], chunks: string[]): void => {
    if (chunks.length === 0) return
    const text = stripForbiddenPrefixes(normalizeWhitespace(chunks.join(' ')))
    if (text) {
        items.push(text)
    }
    chunks.length = 0
}

const parseBullets = (sectionBody: string): string[] => {
    const lines = sectionBody
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

    const items: string[] = []
    const current: string[] = []

    for (const line of lines) {
        const isBullet = /^[-*]\s+/.test(line) || /^[-*]\s*\[\s*[xX]?\s*\]\s+/.test(line)
        if (isBullet) {
            flushCurrentItem(items, current)
            const cleaned = line
                .replace(/^[-*]\s*\[\s*[xX]?\s*\]\s+/, '')
                .replace(/^[-*]\s+/, '')
                .trim()
            current.push(cleaned)
            continue
        }
        current.push(line)
    }

    flushCurrentItem(items, current)
    return items
}

const parseSummary = (sectionBody: string): string[] => {
    return sectionBody
        .split(/\n\s*\n/g)
        .map((part) => stripForbiddenPrefixes(normalizeWhitespace(part)))
        .filter(Boolean)
}

const hasStringArray = (value: unknown): value is string[] => {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

const normalizeSummary = (value: unknown): string[] => {
    if (typeof value === 'string') {
        return parseSummary(value)
    }
    if (!Array.isArray(value)) {
        return []
    }
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => stripForbiddenPrefixes(normalizeWhitespace(item)))
        .filter(Boolean)
}

const normalizeBullets = (value: unknown): string[] => {
    if (typeof value === 'string') {
        return parseBullets(value)
    }
    if (!Array.isArray(value)) {
        return []
    }
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => stripForbiddenPrefixes(normalizeWhitespace(item)))
        .filter(Boolean)
}

const normalizeAnalysisDocument = (value: unknown): AnalysisDocument | null => {
    if (!value || typeof value !== 'object') {
        return null
    }

    const record = value as Record<string, unknown>
    const summary = normalizeSummary(record.summary)
    const keyPoints = normalizeBullets(record.key_points)
    const actionItems = normalizeBullets(record.action_items)
    const decisions = normalizeBullets(record.decisions)
    const qualityRecord = (record.quality && typeof record.quality === 'object')
        ? (record.quality as Record<string, unknown>)
        : {}

    return {
        analysis_schema_version: 2,
        summary,
        key_points: keyPoints,
        action_items: actionItems,
        decisions,
        quality: {
            format_pass: Boolean(qualityRecord.format_pass),
            retry_count: typeof qualityRecord.retry_count === 'number' ? qualityRecord.retry_count : 0,
            fallback_used: Boolean(qualityRecord.fallback_used),
            issues: hasStringArray(qualityRecord.issues) ? qualityRecord.issues : []
        }
    }
}

export const parseAnalysisDocumentJson = (raw?: string | null): AnalysisDocument | null => {
    if (!raw || !raw.trim()) {
        return null
    }
    try {
        const parsed = JSON.parse(raw) as unknown
        return normalizeAnalysisDocument(parsed)
    } catch {
        return null
    }
}

export const parseAnalysisMarkdown = (markdown?: string | null): AnalysisDocument | null => {
    if (!markdown || !markdown.trim()) {
        return null
    }

    const summary = parseSummary(extractSection(markdown, 'Summary'))
    const keyPoints = parseBullets(extractSection(markdown, 'Key Points'))
    const actionItems = parseBullets(extractSection(markdown, 'Action Items'))
    const decisions = parseBullets(extractSection(markdown, 'Decisions'))

    if (summary.length === 0 && keyPoints.length === 0 && actionItems.length === 0 && decisions.length === 0) {
        return null
    }

    return {
        analysis_schema_version: 2,
        summary,
        key_points: keyPoints,
        action_items: actionItems,
        decisions,
        quality: {
            format_pass: false,
            retry_count: 0,
            fallback_used: false,
            issues: []
        }
    }
}

export const resolveMeetingAnalysisDocument = (meeting?: Meeting): AnalysisDocument | null => {
    if (!meeting) {
        return null
    }
    return parseAnalysisDocumentJson(meeting.analysis_json) || parseAnalysisMarkdown(meeting.enhanced_notes)
}

export const analysisDocumentToMarkdown = (doc: AnalysisDocument): string => {
    const summaryBody = doc.summary.length > 0
        ? doc.summary.join('\n\n')
        : 'No summary was generated for this meeting.'
    const keyPointsBody = doc.key_points.length > 0
        ? doc.key_points.map((item) => `- ${item}`).join('\n')
        : '- No key points were captured.'
    const actionItemsBody = doc.action_items.length > 0
        ? doc.action_items.map((item) => `- [ ] ${item}`).join('\n')
        : '- [ ] No concrete action items were explicitly committed.'
    const decisionsBody = doc.decisions.length > 0
        ? doc.decisions.map((item) => `- ${item}`).join('\n')
        : '- No explicit decisions were made.'

    return [
        '## Summary',
        summaryBody,
        '',
        '## Key Points',
        keyPointsBody,
        '',
        '## Action Items',
        actionItemsBody,
        '',
        '## Decisions',
        decisionsBody
    ].join('\n')
}

