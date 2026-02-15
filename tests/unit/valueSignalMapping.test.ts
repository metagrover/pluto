import { describe, expect, it } from 'vitest'

import { mapValueSignalsToPriorityHints } from '../../electron/valueSignalMapping'

describe('mapValueSignalsToPriorityHints', () => {
    it('maps core signals and tags into deterministic soft hints', () => {
        const hints = mapValueSignalsToPriorityHints({
            analysis_schema_version: 2,
            continuity: ['Skill-directory hardening remains active'],
            accountability_risks: ['Single maintainer bandwidth bottleneck'],
            decision_impacts: ['Keep stronger hosted model in production path'],
            extra_tags: [
                { tag: 'responsible-disclosure', confidence: 0.84 },
                { tag: 'ownership-risk', confidence: 0.77 }
            ]
        })

        expect(hints.prioritized_terms.length).toBeGreaterThan(0)
        expect(hints.prioritized_terms.some((term) => term.includes('hardening'))).toBe(true)
        expect(hints.relationship_bias.assigned_to).toBeGreaterThan(0)
        expect(hints.relationship_bias.works_on).toBeGreaterThan(0)
        expect(hints.relationship_bias.impacts).toBeGreaterThan(0)
    })

    it('returns empty hints for missing signal payload', () => {
        const hints = mapValueSignalsToPriorityHints(undefined)

        expect(hints).toEqual({
            prioritized_terms: [],
            relationship_bias: {}
        })
    })
})
