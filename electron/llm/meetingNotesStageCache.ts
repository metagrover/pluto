import type { NotesDraft } from './meetingNotesTypes';
import type { ReconciledSource } from './meetingNotesReconciliation';

/** Main-process-owned, bounded cache of validated writer results only. */
export class NotesStageCache {
  private entries = new Map<string, { draft: NotesDraft; expires: number }>();
  private reconciliations = new Map<
    string,
    { value: ReconciledSource; expires: number }
  >();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 15 * 60 * 1000,
  ) {}
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
      expires: this.now() + this.ttlMs,
    });
    while (this.entries.size > 64)
      this.entries.delete(this.entries.keys().next().value!);
  }
  getReconciliation(key: string): ReconciledSource | undefined {
    const entry = this.reconciliations.get(key);
    if (!entry) return;
    if (entry.expires <= this.now()) {
      this.reconciliations.delete(key);
      return;
    }
    return structuredClone(entry.value);
  }
  setReconciliation(key: string, value: ReconciledSource): void {
    this.reconciliations.delete(key);
    this.reconciliations.set(key, {
      value: structuredClone(value),
      expires: this.now() + this.ttlMs,
    });
    while (this.reconciliations.size > 64) {
      this.reconciliations.delete(this.reconciliations.keys().next().value!);
    }
  }
}
