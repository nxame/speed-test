export function mean(values) {
  if (!values || values.length === 0) return null;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

export function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function percentile(values, pct) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  const clamped = Math.min(Math.max(idx, 0), sorted.length - 1);
  return sorted[clamped];
}

export function jitter(values) {
  if (!values || values.length < 2) return null;
  let total = 0;
  for (let i = 1; i < values.length; i += 1) {
    total += Math.abs(values[i] - values[i - 1]);
  }
  return total / (values.length - 1);
}

export function summarize(values, { includeP95 = false } = {}) {
  if (!values) return null;
  return {
    median: median(values),
    mean: mean(values),
    p95: includeP95 ? percentile(values, 95) : null,
    trials: values
  };
}

export function toFixedNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value.toFixed(digits));
}
