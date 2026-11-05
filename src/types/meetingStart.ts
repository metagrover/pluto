/** Title, people and notes for a meeting started from a person or a note. */
export interface MeetingStartContext {
  title: string;
  participants: string[];
  notes?: string;
}
