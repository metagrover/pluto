import { describe, expect, it } from 'vitest'

import {
    analysisDocumentToMarkdown,
    fallbackAnalysisDocument,
    parseAnalysisMarkdown
} from '../../electron/llm/analysisDocument'

describe('analysisDocument parsing and canonicalization', () => {
    it('keeps multiline bullets as a single logical item', () => {
        const markdown = `## Summary
Short recap.

## Key Points
- First line of insight
continues on next line for detail.
- Second item.

## Action Items
- [ ] Follow up with security researcher
and attach remediation notes.

## Decisions
- Keep hosted model for production safety.`

        const parsed = parseAnalysisMarkdown(markdown)

        expect(parsed.issues).toEqual([])
        expect(parsed.document.key_points).toEqual([
            'First line of insight continues on next line for detail.',
            'Second item.'
        ])
        expect(parsed.document.action_items).toEqual([
            'Follow up with security researcher and attach remediation notes.'
        ])
    })

    it('strips forbidden internal field prefixes from user-facing bullets', () => {
        const markdown = `## Summary
Observation: Security is improving.

## Key Points
- Why it matters: Maintainer bandwidth remains limited.

## Action Items
- [ ] Supporting detail: Send fix PRs with reports.

## Decisions
- Evidence: Keep AI checks enabled for skills.`

        const parsed = parseAnalysisMarkdown(markdown)

        expect(parsed.document.summary).toEqual(['Security is improving.'])
        expect(parsed.document.key_points).toEqual(['Maintainer bandwidth remains limited.'])
        expect(parsed.document.action_items).toEqual(['Send fix PRs with reports.'])
        expect(parsed.document.decisions).toEqual(['Keep AI checks enabled for skills.'])
    })

    it('falls back with safe structure when markdown is invalid after retry path', () => {
        const parsed = parseAnalysisMarkdown('invalid', 1)
        const fallback = fallbackAnalysisDocument(1, parsed.issues)
        const canonical = analysisDocumentToMarkdown(fallback)

        expect(fallback.quality.fallback_used).toBe(true)
        expect(fallback.quality.retry_count).toBe(1)
        expect(canonical).toContain('## Summary')
        expect(canonical).toContain('## Decisions')
    })
})

