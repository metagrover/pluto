export interface AttributionSegment {
    startTime: number
    endTime: number
    text: string
    speaker: string
}

export interface ResolveDuplicateStats {
    candidatePairs: number
    resolvedPairs: number
    droppedMe: number
    droppedThem: number
}

export interface ResolveDuplicateResult<T extends AttributionSegment> {
    segments: T[]
    stats: ResolveDuplicateStats
}

export interface MeBleedStripResult<T extends AttributionSegment> {
    segments: T[]
    droppedMe: number
}

export interface DropShortEchoResult<T extends AttributionSegment> {
    segments: T[]
    dropped: number
}

export interface SpeakerActivityWindow {
    startTime: number
    endTime: number
    speaker: 'Me' | 'Them'
}

export interface CanonicalSpeakerAttributionStats {
    byOverlap: number
    byActivity: number
    byFallback: number
}

export interface CanonicalSpeakerAttributionResult<T extends AttributionSegment> {
    segments: T[]
    stats: CanonicalSpeakerAttributionStats
}

const normalizeText = (text: string): string => {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

const tokenSetSimilarity = (left: string, right: string): number => {
    const leftTokens = new Set(normalizeText(left).split(' ').filter(Boolean))
    const rightTokens = new Set(normalizeText(right).split(' ').filter(Boolean))
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0

    let intersection = 0
    for (const token of leftTokens) {
        if (rightTokens.has(token)) intersection++
    }
    const union = new Set([...leftTokens, ...rightTokens]).size
    return union > 0 ? (intersection / union) : 0
}

const tokenPrefixSimilarity = (left: string, right: string, maxPrefixTokens = 10): number => {
    const leftTokens = normalizeText(left).split(' ').filter(Boolean)
    const rightTokens = normalizeText(right).split(' ').filter(Boolean)
    const shared = Math.min(leftTokens.length, rightTokens.length, maxPrefixTokens)
    if (shared === 0) return 0
    let matched = 0
    for (let i = 0; i < shared; i++) {
        if (leftTokens[i] !== rightTokens[i]) break
        matched++
    }
    return matched / shared
}

const overlapSeconds = (a: AttributionSegment, b: AttributionSegment): number => {
    return Math.max(0, Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime))
}

const activityCoverage = (
    startTime: number,
    endTime: number,
    speaker: 'Me' | 'Them',
    windows: SpeakerActivityWindow[]
): number => {
    if (endTime <= startTime || windows.length === 0) return 0
    let total = 0
    for (const window of windows) {
        if (window.speaker !== speaker) continue
        const overlap = Math.max(0, Math.min(endTime, window.endTime) - Math.max(startTime, window.startTime))
        total += overlap
    }
    return total
}

const isDuplicatePair = (
    left: AttributionSegment,
    right: AttributionSegment
): { duplicate: boolean; overlapRatio: number; tokenSim: number; prefixSim: number } => {
    const overlap = overlapSeconds(left, right)
    if (overlap <= 0) return { duplicate: false, overlapRatio: 0, tokenSim: 0, prefixSim: 0 }

    const leftDur = Math.max(0.01, left.endTime - left.startTime)
    const rightDur = Math.max(0.01, right.endTime - right.startTime)
    const overlapRatio = overlap / Math.min(leftDur, rightDur)
    if (overlapRatio < 0.45) {
        return { duplicate: false, overlapRatio, tokenSim: 0, prefixSim: 0 }
    }

    const leftNorm = normalizeText(left.text)
    const rightNorm = normalizeText(right.text)
    if (!leftNorm || !rightNorm) {
        return { duplicate: false, overlapRatio, tokenSim: 0, prefixSim: 0 }
    }

    if (leftNorm === rightNorm) {
        return { duplicate: true, overlapRatio, tokenSim: 1, prefixSim: 1 }
    }

    const shorter = Math.min(leftNorm.length, rightNorm.length)
    const longer = Math.max(leftNorm.length, rightNorm.length)
    const contains = shorter >= 20
        && (shorter / longer) >= 0.75
        && (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm))
    if (contains) {
        return { duplicate: true, overlapRatio, tokenSim: 0.9, prefixSim: 0.9 }
    }

    const tokenSim = tokenSetSimilarity(leftNorm, rightNorm)
    const prefixSim = tokenPrefixSimilarity(leftNorm, rightNorm)
    const duplicate = tokenSim >= 0.56 || prefixSim >= 0.6 || (tokenSim >= 0.48 && overlapRatio >= 0.6)
    return { duplicate, overlapRatio, tokenSim, prefixSim }
}

const wordCount = (text: string): number => normalizeText(text).split(' ').filter(Boolean).length

const containsTokenSequence = (haystack: string[], needle: string[]): boolean => {
    if (needle.length === 0 || haystack.length < needle.length) return false
    for (let start = 0; start <= haystack.length - needle.length; start++) {
        let matches = true
        for (let i = 0; i < needle.length; i++) {
            if (haystack[start + i] !== needle[i]) {
                matches = false
                break
            }
        }
        if (matches) return true
    }
    return false
}

const hasHeavyRepetition = (text: string): boolean => {
    const tokens = normalizeText(text).split(' ').filter(Boolean)
    if (tokens.length < 8) return false
    const freq = new Map<string, number>()
    let maxTokenFreq = 0
    for (const token of tokens) {
        const next = (freq.get(token) || 0) + 1
        freq.set(token, next)
        if (next > maxTokenFreq) maxTokenFreq = next
    }
    const uniqueRatio = freq.size / tokens.length
    return uniqueRatio <= 0.58 || maxTokenFreq >= 4
}

const oppositeSpeaker = (speaker: 'Me' | 'Them'): 'Me' | 'Them' => (
    speaker === 'Me' ? 'Them' : 'Me'
)

const isQuestionLike = (text: string): boolean => {
    const raw = String(text || '').trim()
    if (!raw) return false
    const normalized = normalizeText(raw)
    if (!normalized) return false
    if (raw.includes('?')) return true
    return /^(do you|did you|are you|can you|could you|would you|will you|what|why|how|when|where|who)\b/.test(normalized)
}

const isAckLike = (text: string): boolean => {
    const normalized = normalizeText(text)
    if (!normalized) return false
    const tokens = normalized.split(' ').filter(Boolean)
    if (tokens.length === 0 || tokens.length > 4) return false
    const first = tokens[0]
    return first === 'yeah'
        || first === 'yes'
        || first === 'yup'
        || first === 'no'
        || first === 'nope'
        || first === 'ok'
        || first === 'okay'
        || first === 'right'
        || first === 'sure'
}

const isUncertaintyLike = (text: string): boolean => {
    const normalized = normalizeText(text)
    if (!normalized) return false
    return normalized.startsWith('not sure')
        || normalized.startsWith('i m not sure')
        || normalized.startsWith('i dont know')
        || normalized.startsWith('i do not know')
}

const pickDuplicateWinner = (
    me: AttributionSegment,
    them: AttributionSegment,
    overlapRatio: number,
    tokenSim: number,
    prefixSim: number
): 'Me' | 'Them' => {
    const meWords = wordCount(me.text)
    const themWords = wordCount(them.text)
    const meDur = Math.max(0.01, me.endTime - me.startTime)
    const themDur = Math.max(0.01, them.endTime - them.startTime)
    const meNorm = normalizeText(me.text)
    const themNorm = normalizeText(them.text)
    const meRepetitive = hasHeavyRepetition(me.text)
    const themRepetitive = hasHeavyRepetition(them.text)

    if ((tokenSim >= 0.58 || prefixSim >= 0.6) && overlapRatio >= 0.45) {
        if (themRepetitive && !meRepetitive) return 'Me'
        if (meRepetitive && !themRepetitive) return 'Them'
    }

    // For short high-similarity overlap, bias toward preserving "Them".
    // Long-form overlap is frequently ambiguous bleed and should require stronger evidence.
    if ((tokenSim >= 0.72 || prefixSim >= 0.72) && overlapRatio >= 0.55 && Math.min(meDur, themDur) <= 4.5) {
        return 'Them'
    }
    if ((tokenSim >= 0.66 || prefixSim >= 0.68) && overlapRatio >= 0.5) {
        return 'Them'
    }

    if (meNorm.includes(themNorm) && meWords >= themWords + 7) return 'Me'
    if (themNorm.includes(meNorm) && themWords >= meWords + 2) return 'Them'

    if (meWords >= themWords + 8 && meDur >= themDur * 1.45) return 'Me'
    if (themWords >= meWords + 2) return 'Them'
    if (themDur >= meDur * 1.15) return 'Them'

    // Conservative default for unresolved duplicates: prefer system channel.
    return 'Them'
}

export const resolveCrossChannelDuplicates = <T extends AttributionSegment>(
    segments: T[]
): ResolveDuplicateResult<T> => {
    if (segments.length < 2) {
        return {
            segments: [...segments],
            stats: { candidatePairs: 0, resolvedPairs: 0, droppedMe: 0, droppedThem: 0 }
        }
    }

    type Candidate = {
        meIndex: number
        themIndex: number
        score: number
        overlapRatio: number
        tokenSim: number
        prefixSim: number
    }

    const candidates: Candidate[] = []
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            const left = segments[i]
            const right = segments[j]
            const speakers = new Set([left.speaker, right.speaker])
            if (!speakers.has('Me') || !speakers.has('Them')) continue

            const meIndex = left.speaker === 'Me' ? i : j
            const themIndex = left.speaker === 'Them' ? i : j
            const me = segments[meIndex]
            const them = segments[themIndex]

            const decision = isDuplicatePair(me, them)
            if (!decision.duplicate) continue

            const score = decision.overlapRatio + decision.tokenSim + decision.prefixSim
            candidates.push({
                meIndex,
                themIndex,
                score,
                overlapRatio: decision.overlapRatio,
                tokenSim: decision.tokenSim,
                prefixSim: decision.prefixSim
            })
        }
    }

    if (candidates.length === 0) {
        return {
            segments: [...segments],
            stats: { candidatePairs: 0, resolvedPairs: 0, droppedMe: 0, droppedThem: 0 }
        }
    }

    candidates.sort((a, b) => b.score - a.score)
    const matchedMe = new Set<number>()
    const matchedThem = new Set<number>()
    const dropped = new Set<number>()
    let droppedMe = 0
    let droppedThem = 0
    let resolvedPairs = 0

    for (const candidate of candidates) {
        if (matchedMe.has(candidate.meIndex) || matchedThem.has(candidate.themIndex)) continue
        if (dropped.has(candidate.meIndex) || dropped.has(candidate.themIndex)) continue

        const me = segments[candidate.meIndex]
        const them = segments[candidate.themIndex]
        const winner = pickDuplicateWinner(
            me,
            them,
            candidate.overlapRatio,
            candidate.tokenSim,
            candidate.prefixSim
        )
        const dropIndex = winner === 'Me' ? candidate.themIndex : candidate.meIndex
        dropped.add(dropIndex)
        if (dropIndex === candidate.meIndex) droppedMe++
        else droppedThem++
        matchedMe.add(candidate.meIndex)
        matchedThem.add(candidate.themIndex)
        resolvedPairs++
    }

    return {
        segments: segments.filter((_, index) => !dropped.has(index)),
        stats: {
            candidatePairs: candidates.length,
            resolvedPairs,
            droppedMe,
            droppedThem
        }
    }
}

export const assignSpeakersToCanonicalSegments = <T extends AttributionSegment>(params: {
    canonicalSegments: T[]
    attributedSegments: AttributionSegment[]
    activityWindows?: SpeakerActivityWindow[]
    tieMargin?: number
}): CanonicalSpeakerAttributionResult<T> => {
    const { canonicalSegments, attributedSegments } = params
    const activityWindows = params.activityWindows || []
    const tieMargin = params.tieMargin ?? 0.18
    if (canonicalSegments.length === 0) {
        return {
            segments: [],
            stats: { byOverlap: 0, byActivity: 0, byFallback: 0 }
        }
    }

    const sortedCanonical = [...canonicalSegments].sort((a, b) => a.startTime - b.startTime)
    const assigned: T[] = []
    let byOverlap = 0
    let byActivity = 0
    let byFallback = 0
    let lastSpeaker: 'Me' | 'Them' = 'Me'

    for (const segment of sortedCanonical) {
        const duration = Math.max(0.01, segment.endTime - segment.startTime)
        let meScore = 0
        let themScore = 0
        let meProximity = 0
        let themProximity = 0
        const segmentMid = (segment.startTime + segment.endTime) / 2

        for (const candidate of attributedSegments) {
            if (candidate.speaker !== 'Me' && candidate.speaker !== 'Them') continue
            const overlap = overlapSeconds(segment, candidate)
            const overlapRatio = overlap > 0 ? (overlap / duration) : 0
            const tokenSim = tokenSetSimilarity(segment.text, candidate.text)
            const prefixSim = tokenPrefixSimilarity(segment.text, candidate.text)
            if (overlap > 0) {
                const overlapScore = overlapRatio + (tokenSim * 0.9) + (prefixSim * 0.5)
                if (candidate.speaker === 'Me') meScore = Math.max(meScore, overlapScore)
                else themScore = Math.max(themScore, overlapScore)
            }

            const candidateMid = (candidate.startTime + candidate.endTime) / 2
            const deltaSeconds = Math.abs(segmentMid - candidateMid)
            if (deltaSeconds <= 3.5) {
                const proximityWeight = Math.max(0, 1 - (deltaSeconds / 3.5))
                const proximityScore = (proximityWeight * 0.8) + (tokenSim * 0.7) + (prefixSim * 0.4)
                if (candidate.speaker === 'Me') meProximity = Math.max(meProximity, proximityScore)
                else themProximity = Math.max(themProximity, proximityScore)
            }
        }

        let speaker: 'Me' | 'Them'
        const hasOverlapEvidence = meScore > 0 || themScore > 0
        const hasProximityEvidence = meProximity > 0 || themProximity > 0
        if (hasOverlapEvidence && Math.abs(meScore - themScore) >= tieMargin) {
            speaker = meScore > themScore ? 'Me' : 'Them'
            byOverlap++
        } else {
            const meCoverage = activityCoverage(segment.startTime, segment.endTime, 'Me', activityWindows)
            const themCoverage = activityCoverage(segment.startTime, segment.endTime, 'Them', activityWindows)
            if (
                (meCoverage > 0 || themCoverage > 0) &&
                Math.abs(meCoverage - themCoverage) >= 0.16
            ) {
                speaker = meCoverage >= themCoverage ? 'Me' : 'Them'
                byActivity++
            } else if (hasOverlapEvidence) {
                const scoreDelta = Math.abs(meScore - themScore)
                const proximityDelta = Math.abs(meProximity - themProximity)
                if (proximityDelta >= 0.12) {
                    speaker = meProximity >= themProximity ? 'Me' : 'Them'
                } else if (scoreDelta <= 0.06) {
                    speaker = oppositeSpeaker(lastSpeaker)
                } else {
                    speaker = meScore > themScore ? 'Me' : 'Them'
                }
                byFallback++
            } else if (hasProximityEvidence && Math.abs(meProximity - themProximity) >= 0.12) {
                speaker = meProximity >= themProximity ? 'Me' : 'Them'
                byFallback++
            } else {
                speaker = lastSpeaker
                byFallback++
            }
        }

        lastSpeaker = speaker
        assigned.push({
            ...segment,
            speaker
        })
    }

    return {
        segments: assigned,
        stats: { byOverlap, byActivity, byFallback }
    }
}

export const applyTurnTakingHeuristics = <T extends AttributionSegment>(segments: T[]): T[] => {
    if (segments.length < 2) return [...segments]
    const adjusted = segments.map((segment) => ({ ...segment }))

    for (let i = 0; i < adjusted.length; i++) {
        const current = adjusted[i]
        if (current.speaker !== 'Me' && current.speaker !== 'Them') continue

        const prev = i > 0 ? adjusted[i - 1] : null
        const next = i + 1 < adjusted.length ? adjusted[i + 1] : null
        const currentQuestion = isQuestionLike(current.text)
        const nextAck = next ? isAckLike(next.text) : false

        if (
            currentQuestion &&
            prev &&
            (prev.speaker === 'Me' || prev.speaker === 'Them') &&
            prev.speaker !== current.speaker &&
            next &&
            nextAck &&
            next.speaker === current.speaker
        ) {
            current.speaker = prev.speaker
        }

        if (
            next &&
            nextAck &&
            (next.speaker === 'Me' || next.speaker === 'Them') &&
            next.speaker === current.speaker &&
            isQuestionLike(current.text)
        ) {
            next.speaker = oppositeSpeaker(current.speaker)
        }

        if (
            prev &&
            (prev.speaker === 'Me' || prev.speaker === 'Them') &&
            (current.speaker === 'Me' || current.speaker === 'Them') &&
            prev.speaker !== current.speaker &&
            isAckLike(prev.text) &&
            isUncertaintyLike(current.text)
        ) {
            current.speaker = prev.speaker
        }
    }

    return adjusted
}

export const reassignShortBoundarySegments = <T extends AttributionSegment>(params: {
    segments: T[]
    maxWords?: number
    maxGapSeconds?: number
}): T[] => {
    const segments = params.segments || []
    const maxWords = params.maxWords ?? 4
    const maxGapSeconds = params.maxGapSeconds ?? 1.2
    if (segments.length < 2) return [...segments]

    const adjusted = segments.map((segment) => ({ ...segment }))
    for (let i = 0; i < adjusted.length; i++) {
        const current = adjusted[i]
        if (current.speaker !== 'Me' && current.speaker !== 'Them') continue
        const next = i + 1 < adjusted.length ? adjusted[i + 1] : null
        if (!next || (next.speaker !== 'Me' && next.speaker !== 'Them')) continue
        if (next.speaker === current.speaker) continue

        const words = wordCount(current.text)
        if (words === 0 || words > maxWords) continue

        const gapSeconds = Math.max(0, next.startTime - current.endTime)
        if (gapSeconds > maxGapSeconds) continue

        const prev = i > 0 ? adjusted[i - 1] : null
        const prevSameSpeaker = Boolean(prev && prev.speaker === current.speaker)
        const cue = normalizeText(current.text)
        const isBridgeCue = (
            cue === 'that s it'
            || cue === 'thats it'
            || cue === 'okay'
            || cue === 'ok'
            || cue === 'yeah'
            || cue === 'right'
            || cue === 'anyway'
            || cue === 'well'
            || cue === 'so'
        )

        if (prevSameSpeaker || isBridgeCue) {
            current.speaker = next.speaker
        }
    }

    return adjusted
}

export const decideNextSpeaker = (params: {
    micRms: number
    systemRms: number
    threshold: number
    ratio: number
}): 'Me' | 'Them' | null => {
    const { micRms, systemRms, threshold, ratio } = params
    const micActive = micRms >= threshold
    const systemActive = systemRms >= threshold

    if (micActive && !systemActive) return 'Me'
    if (!micActive && systemActive) return 'Them'
    if (!micActive && !systemActive) return null
    if (micRms >= systemRms * ratio) return 'Me'
    if (systemRms >= micRms * ratio) return 'Them'
    return null
}

export const shouldDropBySpeakerActivity = (params: {
    targetSpeaker: 'Me' | 'Them'
    overlapRatio: number
    meCoverage: number
    themCoverage: number
}): boolean => {
    const { targetSpeaker, overlapRatio, meCoverage, themCoverage } = params
    if (targetSpeaker === 'Me') {
        return overlapRatio >= 0.45
            && themCoverage >= 0.35
            && themCoverage >= Math.max(0.25, meCoverage * 1.5)
    }

    // Keep "Them" unless "Me" clearly dominates both overlap and activity.
    return overlapRatio >= 0.8
        && meCoverage >= 0.75
        && meCoverage >= Math.max(0.55, themCoverage * 3.0)
}

export const shouldApplyFullSessionMeRecovery = (params: {
    hasChunkMeSegments: boolean
    recoveredMeCount: number
    bleedLikely: boolean
}): boolean => {
    const { hasChunkMeSegments, recoveredMeCount, bleedLikely } = params
    return !hasChunkMeSegments && recoveredMeCount > 0 && !bleedLikely
}

const sumSegmentDurations = (segments: AttributionSegment[]): number => {
    return segments.reduce((total, segment) => (
        total + Math.max(0.01, segment.endTime - segment.startTime)
    ), 0)
}

const getTimelineSpanDuration = (segments: AttributionSegment[]): number => {
    if (segments.length === 0) return 0
    let minStart = Number.POSITIVE_INFINITY
    let maxEnd = Number.NEGATIVE_INFINITY
    for (const segment of segments) {
        if (!Number.isFinite(segment.startTime) || !Number.isFinite(segment.endTime)) continue
        if (segment.startTime < minStart) minStart = segment.startTime
        if (segment.endTime > maxEnd) maxEnd = segment.endTime
    }
    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd <= minStart) return 0
    return maxEnd - minStart
}

export const shouldHydrateCanonicalTranscript = (params: {
    channelSegments: AttributionSegment[]
    canonicalSegments: AttributionSegment[]
    minCoverageRatio?: number
}): boolean => {
    const channelSegments = params.channelSegments || []
    const canonicalSegments = params.canonicalSegments || []
    const minCoverageRatio = params.minCoverageRatio ?? 0.5

    if (canonicalSegments.length === 0) return false
    if (channelSegments.length === 0) return true

    const speakerSet = new Set(
        channelSegments
            .map((segment) => segment.speaker)
            .filter((speaker) => speaker === 'Me' || speaker === 'Them')
    )
    const hasBothSpeakers = speakerSet.has('Me') && speakerSet.has('Them')

    const channelDuration = sumSegmentDurations(channelSegments)
    const canonicalSpanDuration = getTimelineSpanDuration(canonicalSegments)
    const coverageRatio = canonicalSpanDuration > 0
        ? (channelDuration / canonicalSpanDuration)
        : 0

    if (hasBothSpeakers && channelSegments.length >= 4 && coverageRatio >= minCoverageRatio) {
        return false
    }

    return true
}

export const stripLikelyMeBleedSegments = <T extends AttributionSegment>(
    segments: T[]
): MeBleedStripResult<T> => {
    const meSegments: Array<{ index: number; segment: T }> = []
    const themSegments: T[] = []
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        if (segment.speaker === 'Me') meSegments.push({ index: i, segment })
        else if (segment.speaker === 'Them') themSegments.push(segment)
    }

    if (meSegments.length === 0 || themSegments.length === 0) {
        return { segments: [...segments], droppedMe: 0 }
    }

    const dropIndices = new Set<number>()

    for (const { index, segment: me } of meSegments) {
        const meNorm = normalizeText(me.text)
        if (!meNorm) continue

        const meDur = Math.max(0.01, me.endTime - me.startTime)
        const meWords = wordCount(me.text)

        let dropForMe = false
        for (const them of themSegments) {
            const overlap = overlapSeconds(me, them)
            if (overlap <= 0) continue

            const overlapRatio = overlap / meDur
            if (overlapRatio < 0.35) continue

            const themNorm = normalizeText(them.text)
            if (!themNorm) continue
            const themWords = wordCount(them.text)
            const themDur = Math.max(0.01, them.endTime - them.startTime)

            const tokenSim = tokenSetSimilarity(meNorm, themNorm)
            const prefixSim = tokenPrefixSimilarity(meNorm, themNorm)
            const shorter = Math.min(meNorm.length, themNorm.length)
            const longer = Math.max(meNorm.length, themNorm.length)
            const contains = shorter >= 12
                && (shorter / Math.max(1, longer)) >= 0.72
                && (meNorm.includes(themNorm) || themNorm.includes(meNorm))

            const highSimilarity = contains || tokenSim >= 0.55 || prefixSim >= 0.58
            const themStronglyDominant = themDur >= meDur * 1.2 || themWords >= meWords + 5
            const shortEcho = meWords <= 4 && (tokenSim >= 0.36 || prefixSim >= 0.45)
            const mediumEcho = meWords <= 8
                && highSimilarity
                && overlapRatio >= 0.5
                && (themDur >= meDur * 0.95 || themWords >= meWords + 1)

            if ((highSimilarity && themStronglyDominant && overlapRatio >= 0.45) || shortEcho || mediumEcho) {
                dropForMe = true
                break
            }
        }

        if (dropForMe) {
            dropIndices.add(index)
        }
    }

    return {
        segments: segments.filter((_, index) => !dropIndices.has(index)),
        droppedMe: dropIndices.size
    }
}

export const dropShortCrossSpeakerEchoes = <T extends AttributionSegment>(params: {
    segments: T[]
    maxShortWords?: number
    maxGapSec?: number
}): DropShortEchoResult<T> => {
    const segments = params.segments || []
    const maxShortWords = params.maxShortWords ?? 4
    const maxGapSec = params.maxGapSec ?? 2
    if (segments.length < 2) {
        return { segments: [...segments], dropped: 0 }
    }

    const kept: T[] = []
    let dropped = 0

    for (const segment of segments) {
        if (kept.length === 0) {
            kept.push({ ...segment })
            continue
        }

        const prev = kept[kept.length - 1]
        if (prev.speaker === segment.speaker) {
            kept.push({ ...segment })
            continue
        }

        const gapSec = segment.startTime - prev.endTime
        if (gapSec > maxGapSec) {
            kept.push({ ...segment })
            continue
        }

        const prevTokens = normalizeText(prev.text).split(' ').filter(Boolean)
        const currTokens = normalizeText(segment.text).split(' ').filter(Boolean)
        if (prevTokens.length === 0 || currTokens.length === 0) {
            kept.push({ ...segment })
            continue
        }

        const prevIsShort = prevTokens.length <= maxShortWords
        const currIsShort = currTokens.length <= maxShortWords

        if (currIsShort && prevTokens.length >= currTokens.length + 4 && containsTokenSequence(prevTokens, currTokens)) {
            dropped++
            continue
        }

        if (prevIsShort && currTokens.length >= prevTokens.length + 4 && containsTokenSequence(currTokens, prevTokens)) {
            kept.pop()
            dropped++
            kept.push({ ...segment })
            continue
        }

        kept.push({ ...segment })
    }

    return {
        segments: kept,
        dropped
    }
}
