import { z } from "zod";

/**
 * One ping cycle result: the agent sends `ping_count` echoes, collects the
 * per-reply RTTs, and reports summary stats plus the sorted RTT vector that
 * drives the smoke-chart percentile bands.
 */
export const SampleSchema = z.object({
  /** ISO timestamp of when the cycle started. */
  time: z.string().datetime(),
  target_id: z.number().int(),
  loss_pct: z.number().min(0).max(100),
  min_ms: z.number().nullable(),
  max_ms: z.number().nullable(),
  avg_ms: z.number().nullable(),
  median_ms: z.number().nullable(),
  stddev_ms: z.number().nullable(),
  /** Sorted RTTs of the successful replies (ascending), in ms. */
  rtts: z.array(z.number()),
});
export type Sample = z.infer<typeof SampleSchema>;

/** Batch of samples pushed by an agent in one request. */
export const SampleBatchSchema = z.object({
  samples: z.array(SampleSchema).max(500),
});
export type SampleBatch = z.infer<typeof SampleBatchSchema>;

/** A point as returned by the series API for rendering a smoke chart. */
export const SeriesPointSchema = z.object({
  t: z.number(), // epoch ms
  loss_pct: z.number(),
  median_ms: z.number().nullable(),
  min_ms: z.number().nullable(),
  max_ms: z.number().nullable(),
  /**
   * Percentile ladder used to draw nested bands: [p0(min), p10, p25, median,
   * p75, p90, p100(max)] in ms. Null entries mean no data for that bucket.
   */
  bands: z.array(z.number().nullable()),
});
export type SeriesPoint = z.infer<typeof SeriesPointSchema>;

/** Percentile ladder positions (0..1) corresponding to `bands` above. */
export const BAND_PERCENTILES = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1] as const;
/** Index of the median entry within a `bands` array. */
export const MEDIAN_BAND_INDEX = 3;

export const SeriesResolutionSchema = z.enum(["raw", "5m", "1h"]);
export type SeriesResolution = z.infer<typeof SeriesResolutionSchema>;

export const CollectorSeriesSchema = z.object({
  collector_id: z.number().int(),
  collector_name: z.string(),
  points: z.array(SeriesPointSchema),
});
export type CollectorSeries = z.infer<typeof CollectorSeriesSchema>;

export const SeriesResponseSchema = z.object({
  target_id: z.number().int(),
  resolution: SeriesResolutionSchema,
  from: z.number(),
  to: z.number(),
  series: z.array(CollectorSeriesSchema),
});
export type SeriesResponse = z.infer<typeof SeriesResponseSchema>;
