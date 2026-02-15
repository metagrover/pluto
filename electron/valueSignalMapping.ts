import type { ExtractionPriorityHints, InternalSignalDocument } from './llm/provider'

const MAX_TERMS = 20

const clamp = (value: number, min: number, max: number): number => {
    return Math.min(max, Math.max(min, value))
}

const normalizeTerm = (value: string): string => {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
}

const pushTerms = (target: string[], phrase: string): void => {
    const normalized = normalizeTerm(phrase)
    if (!normalized) return

    target.push(normalized)
    for (const token of normalized.split(' ')) {
        if (token.length >= 4) {
            target.push(token)
        }
    }
}

const addBias = (bias: Record<string, number>, relationship: string, delta: number): void => {
    const current = bias[relationship] || 0
    bias[relationship] = clamp(current + delta, 0, 0.3)
}

const applyTagBias = (bias: Record<string, number>, tag: string): void => {
    if (/(owner|assignee|accountability|follow-up|handoff)/.test(tag)) {
        addBias(bias, 'assigned_to', 0.08)
    }
    if (/(project|roadmap|milestone|delivery|execution)/.test(tag)) {
        addBias(bias, 'works_on', 0.06)
    }
    if (/(decision|policy|tradeoff|impact)/.test(tag)) {
        addBias(bias, 'impacts', 0.08)
    }
    if (/(release|launch|publish|artifact|report)/.test(tag)) {
        addBias(bias, 'produced', 0.05)
    }
    if (/(risk|dependency|constraint|security)/.test(tag)) {
        addBias(bias, 'relates_to', 0.05)
    }
}

export const mapValueSignalsToPriorityHints = (
    signals?: InternalSignalDocument | null
): ExtractionPriorityHints => {
    if (!signals) {
        return {
            prioritized_terms: [],
            relationship_bias: {}
        }
    }

    const rawTerms: string[] = []
    const bias: Record<string, number> = {}

    for (const entry of signals.continuity) {
        pushTerms(rawTerms, entry)
    }
    for (const entry of signals.accountability_risks) {
        pushTerms(rawTerms, entry)
    }
    for (const entry of signals.decision_impacts) {
        pushTerms(rawTerms, entry)
    }

    if (signals.continuity.length > 0) {
        addBias(bias, 'works_on', 0.05)
        addBias(bias, 'relates_to', 0.04)
    }
    if (signals.accountability_risks.length > 0) {
        addBias(bias, 'assigned_to', 0.07)
        addBias(bias, 'relates_to', 0.03)
    }
    if (signals.decision_impacts.length > 0) {
        addBias(bias, 'impacts', 0.09)
        addBias(bias, 'produced', 0.04)
    }

    for (const tag of signals.extra_tags) {
        if (tag.confidence < 0.35) continue
        const term = normalizeTerm(tag.tag.replace(/-/g, ' '))
        if (term) {
            rawTerms.push(term)
        }
        applyTagBias(bias, tag.tag)
    }

    const dedupedTerms = Array.from(new Set(rawTerms.filter(Boolean))).slice(0, MAX_TERMS)

    return {
        prioritized_terms: dedupedTerms,
        relationship_bias: bias
    }
}

