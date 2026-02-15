import { describe, expect, it } from 'vitest'

import { cleanTranscriptSegments } from '../../electron/transcriptCleanup'
import {
    resolveCrossChannelDuplicates,
    stripLikelyMeBleedSegments
} from '../../src/utils/speakerAttribution'

type Speaker = 'Me' | 'Them'

interface Segment {
    startTime: number
    endTime: number
    speaker: Speaker
    text: string
}

const runSyntheticAttribution = (segments: Segment[]) => {
    const resolved = resolveCrossChannelDuplicates(segments)
    const shouldStripMeBleed = resolved.stats.candidatePairs >= 2 && resolved.stats.droppedThem > 0
    const normalized = shouldStripMeBleed
        ? stripLikelyMeBleedSegments(resolved.segments).segments
        : resolved.segments
    const cleaned = cleanTranscriptSegments(normalized)
    return { resolved, cleaned }
}

const transcriptLines = (segments: Array<{ speaker?: string | number; text: string }>): string[] => {
    return segments.map((segment) => `${String(segment.speaker)}: ${segment.text}`)
}

describe('synthetic speaker attribution fixtures', () => {
    it('avoids Me dominance and preserves key Them interruption content in reported bleed pattern', () => {
        const fixture: Segment[] = [
            {
                startTime: 0.0,
                endTime: 9.6,
                speaker: 'Me',
                text: 'And honestly I call it my simple power. Let me recap everything that happened in tech this week.'
            },
            {
                startTime: 0.1,
                endTime: 9.4,
                speaker: 'Them',
                text: 'And honestly I call it my simple power. Let me recap everything that happened in tech this week.'
            },
            {
                startTime: 9.8,
                endTime: 11.0,
                speaker: 'Them',
                text: 'Thing. I could create a company.'
            },
            {
                startTime: 11.2,
                endTime: 20.8,
                speaker: 'Me',
                text: 'Ethical sourcing is moving from PR to operations with audits, terminations, and transparency.'
            },
            {
                startTime: 11.3,
                endTime: 20.5,
                speaker: 'Them',
                text: 'Ethical sourcing is moving from PR to operations with audits, terminations, and transparency.'
            }
        ]

        const { cleaned } = runSyntheticAttribution(fixture)
        const lines = transcriptLines(cleaned.segments)

        const joined = lines.join(' ').toLowerCase()
        expect(joined).toContain('create a company')
        expect(lines.some((line) => line.startsWith('Them:'))).toBe(true)
    })

    it('keeps strategy-sync meaning while preventing Me from dominating duplicated channel bleed', () => {
        const fixture: Segment[] = [
            {
                startTime: 0.0,
                endTime: 8.0,
                speaker: 'Me',
                text: 'Quick recap: Capital One acquiring Discover shifts fintech distribution from partnerships to ownership.'
            },
            {
                startTime: 0.2,
                endTime: 7.8,
                speaker: 'Them',
                text: 'Quick recap: Capital One acquiring Discover shifts fintech distribution from partnerships to ownership.'
            },
            {
                startTime: 8.1,
                endTime: 9.4,
                speaker: 'Them',
                text: 'Hold on, do we have customer migration numbers yet?'
            },
            {
                startTime: 9.6,
                endTime: 15.0,
                speaker: 'Me',
                text: 'Not yet, but AI infrastructure cost pressure will hit margin unless we prioritize high-retention workflows.'
            },
            {
                startTime: 9.7,
                endTime: 14.8,
                speaker: 'Them',
                text: 'Not yet, but AI infrastructure cost pressure will hit margin unless we prioritize high-retention workflows.'
            }
        ]

        const { cleaned } = runSyntheticAttribution(fixture)
        const lines = transcriptLines(cleaned.segments)

        const joined = lines.join(' ').toLowerCase()
        expect(joined).toContain('customer migration numbers')
        expect(joined).toContain('high-retention workflows')
        expect(lines.some((line) => line.startsWith('Them:'))).toBe(true)
    })

    it('keeps Them when a short overlapped turn contains continuation detail', () => {
        const fixture: Segment[] = [
            {
                startTime: 20.0,
                endTime: 22.6,
                speaker: 'Me',
                text: 'Shopping behavior is shifting from intent search to feed-based discovery.'
            },
            {
                startTime: 20.1,
                endTime: 23.2,
                speaker: 'Them',
                text: 'Shopping behavior is shifting from intent search to feed-based discovery, especially when social proof comes from creators.'
            }
        ]

        const { cleaned } = runSyntheticAttribution(fixture)
        const lines = transcriptLines(cleaned.segments)

        expect(lines).toEqual([
            'Them: Shopping behavior is shifting from intent search to feed-based discovery, especially when social proof comes from creators.'
        ])
    })

    it('does not collapse paraphrased overlap from a real discussion into one speaker', () => {
        const fixture: Segment[] = [
            {
                startTime: 0.0,
                endTime: 4.2,
                speaker: 'Me',
                text: 'We should pilot compliance reporting for top suppliers first.'
            },
            {
                startTime: 0.3,
                endTime: 4.0,
                speaker: 'Them',
                text: 'I agree, start with top suppliers and publish the audit cadence.'
            },
            {
                startTime: 4.5,
                endTime: 7.1,
                speaker: 'Me',
                text: 'Great, then legal can wire termination clauses to missed milestones.'
            }
        ]

        const { cleaned } = runSyntheticAttribution(fixture)
        const lines = transcriptLines(cleaned.segments)

        expect(lines).toEqual([
            'Me: We should pilot compliance reporting for top suppliers first.',
            'Them: I agree, start with top suppliers and publish the audit cadence.',
            'Me: Great, then legal can wire termination clauses to missed milestones.'
        ])
    })

    it('attributes long fully-overlapped identical spans to Them by default', () => {
        const fixture: Segment[] = [
            {
                startTime: 0.0,
                endTime: 12.0,
                speaker: 'Me',
                text: 'AI infrastructure spend is turning into a global arms race and distribution controls outcome.'
            },
            {
                startTime: 0.2,
                endTime: 11.8,
                speaker: 'Them',
                text: 'AI infrastructure spend is turning into a global arms race and distribution controls outcome.'
            }
        ]

        const { cleaned } = runSyntheticAttribution(fixture)
        const lines = transcriptLines(cleaned.segments)

        expect(lines).toEqual([
            'Them: AI infrastructure spend is turning into a global arms race and distribution controls outcome.'
        ])
    })

    it('keeps clear speaker alternation when turns do not overlap', () => {
        const fixture: Segment[] = [
            { startTime: 0, endTime: 4, speaker: 'Me', text: 'Opening context and framing.' },
            { startTime: 4.4, endTime: 6.2, speaker: 'Them', text: 'Quick response.' },
            { startTime: 6.6, endTime: 9.1, speaker: 'Me', text: 'Follow up question.' }
        ]

        const { cleaned, resolved } = runSyntheticAttribution(fixture)
        const lines = transcriptLines(cleaned.segments)

        expect(resolved.stats.resolvedPairs).toBe(0)
        expect(lines).toEqual([
            'Me: Opening context and framing.',
            'Them: Quick response.',
            'Me: Follow up question.'
        ])
    })

    it('keeps both speakers readable during two-way interruption with overlapping starts', () => {
        const fixture: Segment[] = [
            {
                startTime: 0.0,
                endTime: 4.0,
                speaker: 'Me',
                text: 'I think we should pause rollout because churn is up this week.'
            },
            {
                startTime: 3.1,
                endTime: 5.2,
                speaker: 'Them',
                text: 'Wait, churn is concentrated in one region, not global.'
            },
            {
                startTime: 5.0,
                endTime: 6.6,
                speaker: 'Me',
                text: 'No, the weekly cohort is down across three regions now.'
            },
            {
                startTime: 6.4,
                endTime: 8.1,
                speaker: 'Them',
                text: 'Okay, then let us gate the rollout by plan tier first.'
            }
        ]

        const { cleaned, resolved } = runSyntheticAttribution(fixture)
        const lines = transcriptLines(cleaned.segments)

        expect(resolved.stats.resolvedPairs).toBe(0)
        expect(lines).toEqual([
            'Me: I think we should pause rollout because churn is up this week.',
            'Them: Wait, churn is concentrated in one region, not global.',
            'Me: No, the weekly cohort is down across three regions now.',
            'Them: Okay, then let us gate the rollout by plan tier first.'
        ])
    })

    it('drops YouTube-style repeated Me bleed while keeping real Me commentary', () => {
        const fixture: Segment[] = [
            {
                startTime: 0.0,
                endTime: 3.8,
                speaker: 'Me',
                text: 'So I am told the issue has been resolved, let us find out and play the video now.'
            },
            {
                startTime: 4.0,
                endTime: 10.8,
                speaker: 'Them',
                text: 'It is a blessing. It is a blessing. This is the end of the world. This is the end of the world.'
            },
            {
                startTime: 4.2,
                endTime: 10.6,
                speaker: 'Me',
                text: 'It is a blessing. It is a blessing. This is the end of the world. This is the end of the world.'
            },
            {
                startTime: 11.0,
                endTime: 17.0,
                speaker: 'Me',
                text: 'The speaker says he built an app getting attention online but he is not trying to monetize it.'
            },
            {
                startTime: 17.2,
                endTime: 19.1,
                speaker: 'Them',
                text: 'Chuckle is true.'
            },
            {
                startTime: 17.3,
                endTime: 19.0,
                speaker: 'Me',
                text: 'Chuckle is true.'
            },
            {
                startTime: 19.5,
                endTime: 20.8,
                speaker: 'Me',
                text: 'Look out for himself.'
            },
            {
                startTime: 19.4,
                endTime: 21.0,
                speaker: 'Them',
                text: 'Look out for himself.'
            }
        ]

        const { cleaned } = runSyntheticAttribution(fixture)
        const lines = transcriptLines(cleaned.segments)

        expect(lines).toEqual([
            'Me: So I am told the issue has been resolved, let us find out and play the video now.',
            'Them: It is a blessing. It is a blessing. This is the end of the world. This is the end of the world.',
            'Me: The speaker says he built an app getting attention online but he is not trying to monetize it.',
            'Them: Chuckle is true. Look out for himself.'
        ])
    })
})
