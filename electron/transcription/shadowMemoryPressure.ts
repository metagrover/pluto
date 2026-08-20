const isValidPercent = (value: number | undefined): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100;

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
  private refreshInFlight: Promise<void> | undefined;

  constructor(private readonly probe: () => Promise<number | null>) {}

  current(): number | undefined {
    return this.value;
  }

  refresh(): void {
    if (this.refreshInFlight) return;
    this.refreshInFlight = this.probe()
      .then((value) => {
        const percentage = value ?? undefined;
        this.value = isValidPercent(percentage) ? percentage : undefined;
      })
      .catch(() => {})
      .finally(() => {
        this.refreshInFlight = undefined;
      });
  }
}
