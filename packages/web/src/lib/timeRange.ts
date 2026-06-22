export interface RangePreset {
  key: string;
  label: string;
  ms: number;
}

export const RANGE_PRESETS: RangePreset[] = [
  { key: "30m", label: "30m", ms: 30 * 60_000 },
  { key: "3h", label: "3h", ms: 3 * 3_600_000 },
  { key: "12h", label: "12h", ms: 12 * 3_600_000 },
  { key: "24h", label: "24h", ms: 24 * 3_600_000 },
  { key: "7d", label: "7d", ms: 7 * 24 * 3_600_000 },
  { key: "30d", label: "30d", ms: 30 * 24 * 3_600_000 },
];

export function presetByKey(key: string): RangePreset {
  return RANGE_PRESETS.find((p) => p.key === key) ?? RANGE_PRESETS[1]!;
}
