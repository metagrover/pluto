import type { NotesDraft } from './meetingNotesTypes';

/** Main-process-owned, bounded cache of validated writer results only. */
export class NotesStageCache {
  private entries = new Map<string, { draft: NotesDraft; expires: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  get(key: string): NotesDraft | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return;
    }
    return structuredClone(entry.draft);
  }
  set(key: string, draft: NotesDraft): void {
    this.entries.delete(key);
    this.entries.set(key, {
      draft: structuredClone(draft),
      expires: this.now() + 15 * 60 * 1000,
    });
    while (this.entries.size > 4)
      this.entries.delete(this.entries.keys().next().value!);
  }
}
