export interface TranscriptSegment {
    text: string;
    speaker?: string | number;
}

export interface Meeting {
    id: string | number;
    title: string;
    created_at: string;
    started_at: string;
    duration_seconds?: number;
    meeting_type?: string;
    enhanced_notes?: string;
    transcript_json?: string;
    user_notes?: string;
}
