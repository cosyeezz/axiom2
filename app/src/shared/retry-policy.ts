/** Per-attempt waits, not cumulative deadlines. The initial request is not a retry. */
export const sessionRetryDelaysMs = [
  2_000, 4_000, 8_000, 16_000, 32_000,
  2 * 60_000, 4 * 60_000, 8 * 60_000, 30 * 60_000,
] as const;

export const retryDelayText = (ms: number) => ms >= 60_000 && ms % 60_000 === 0
  ? `${ms / 60_000} 分钟` : `${ms / 1000} 秒`;
