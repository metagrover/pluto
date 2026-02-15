import { describe, expect, it } from 'vitest'

import {
    getEntitiesPrompt,
    getSummaryPrompt,
    getSummaryRepairPrompt,
    getValueSignalsPrompt
} from '../../electron/llm/prompts'

describe('getSummaryPrompt', () => {
    it('enforces four sections and forbids internal label leakage', () => {
        const prompt = getSummaryPrompt('Speaker A: We integrated VirusTotal checks.')

        expect(prompt).toContain('Write exactly:')
        expect(prompt).toContain('## Summary')
        expect(prompt).toContain('## Key Points')
        expect(prompt).toContain('## Action Items')
        expect(prompt).toContain('## Decisions')
        expect(prompt).toContain('forbidden: "Observation:", "Why it matters:", "Supporting detail:", "Evidence:", "Pluto use:"')
        expect(prompt).toContain('Action Items')
        expect(prompt).toContain('Include only explicit committed next steps.')
        expect(prompt).toContain('Decisions')
        expect(prompt).toContain('List explicit decisions and implemented choices.')
    })

    it('includes user notes block only when notes are provided', () => {
        const withoutNotes = getSummaryPrompt('Speaker A: update')
        const withNotes = getSummaryPrompt('Speaker A: update', 'Prioritize explicit decisions')

        expect(withoutNotes).not.toContain('User Notes (high-priority context):')
        expect(withNotes).toContain('User Notes (high-priority context):')
        expect(withNotes).toContain('Prioritize explicit decisions')
    })
})

describe('getSummaryRepairPrompt', () => {
    it('requires corrected markdown only with strict section order', () => {
        const prompt = getSummaryRepairPrompt(
            'Speaker A: update',
            'Bad draft',
            'Prefer action/decision clarity'
        )

        expect(prompt).toContain('Repair this draft analysis into Pluto\'s required structure.')
        expect(prompt).toContain('Return only the corrected markdown with the required sections.')
        expect(prompt).toContain('## Summary')
        expect(prompt).toContain('## Key Points')
        expect(prompt).toContain('## Action Items')
        expect(prompt).toContain('## Decisions')
    })
})

describe('getValueSignalsPrompt', () => {
    it('enforces hybrid internal signal JSON with capped free-form tags', () => {
        const prompt = getValueSignalsPrompt(
            'Speaker A: We need better disclosure quality and ownership.',
            'Summary: Ownership is unclear.'
        )

        expect(prompt).toContain('hidden internal signals')
        expect(prompt).toContain('"continuity": ["string"]')
        expect(prompt).toContain('"accountability_risks": ["string"]')
        expect(prompt).toContain('"decision_impacts": ["string"]')
        expect(prompt).toContain('"extra_tags": [{"tag": "string", "confidence": 0.0}]')
        expect(prompt).toContain('normalize to lowercase kebab-case')
        expect(prompt).toContain('max 8')
    })
})

describe('getEntitiesPrompt', () => {
    it('embeds value signals and deterministic hints as auxiliary context only', () => {
        const prompt = getEntitiesPrompt('Speaker A: Sarah owns API migration', {
            summary: 'Sarah is driving the migration.',
            valueSignals: {
                analysis_schema_version: 2,
                continuity: ['API migration is ongoing'],
                accountability_risks: ['No explicit deadline'],
                decision_impacts: ['Using stronger models for production paths'],
                extra_tags: [{ tag: 'ownership-risk', confidence: 0.84 }]
            },
            priorityHints: {
                prioritized_terms: ['api migration', 'ownership'],
                relationship_bias: { works_on: 0.1, assigned_to: 0.12 }
            }
        })

        expect(prompt).toContain('Summary context (auxiliary, do not treat as new facts):')
        expect(prompt).toContain('Value-gain signals (auxiliary prioritization hints, not standalone evidence):')
        expect(prompt).toContain('Deterministic extraction hints:')
        expect(prompt).toContain('prioritize what to extract from transcript text; never invent entities')
    })
})

