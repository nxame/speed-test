const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export function sparkline(values, width = 60) {
  if (!values || values.length === 0) return ''.padEnd(width, ' ');
  const sliced = values.slice(-width);
  const min = Math.min(...sliced);
  const max = Math.max(...sliced);
  const range = max - min || 1;
  return sliced
    .map((val) => {
      const idx = Math.min(
        SPARK_CHARS.length - 1,
        Math.max(0, Math.floor(((val - min) / range) * SPARK_CHARS.length))
      );
      return SPARK_CHARS[idx];
    })
    .join('');
}
