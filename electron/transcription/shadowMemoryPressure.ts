const isValidPercent = (value: number | undefined): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100;

export const MAX_SHADOW_MEMORY_PRESSURE_AGE_MS = 45_000;

export const selectShadowFreePercent = ({
  memoryPressureFreePercent,
  osFreePercent,
}: {
  memoryPressureFreePercent: number | undefined;
  osFreePercent: number;
}): number =>
  isValidPercent(memoryPressureFreePercent)
    ? memoryPressureFreePercent
    : osFreePercent;

export class CachedMemoryPressureFreePercent {
  private value: number | undefined;
  private updatedAt: number | undefined;
  private refreshInFlight: Promise<void> | undefined;

  constructor(
    private readonly probe: () => Promise<number | null>,
    private readonly now: () => number = Date.now,
  ) {}

  current(): number | undefined {
    if (
      this.updatedAt === undefined ||
      this.now() - this.updatedAt > MAX_SHADOW_MEMORY_PRESSURE_AGE_MS
    )
      return undefined;
    return this.value;
  }

  refresh(): void {
    if (this.refreshInFlight) return;
    this.refreshInFlight = this.probe()
      .then((value) => {
        const percentage = value ?? undefined;
        this.value = isValidPercent(percentage) ? percentage : undefined;
        this.updatedAt = this.value === undefined ? undefined : this.now();
      })
      .catch(() => {
        this.value = undefined;
        this.updatedAt = undefined;
      })
      .finally(() => {
        this.refreshInFlight = undefined;
      });
  }
}
