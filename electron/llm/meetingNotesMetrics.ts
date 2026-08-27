const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const ms = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value / 1e6
    : null;

export const readNotesMetrics = (packet: Record<string, unknown>) => ({
  inputTokens: count(packet.prompt_eval_count),
  outputTokens: count(packet.eval_count),
  promptMs: ms(packet.prompt_eval_duration),
  outputMs: ms(packet.eval_duration),
  loadMs: ms(packet.load_duration),
});
