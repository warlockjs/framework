/** A tiny trend line with no axes. `values` oldest first. */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  label,
  className,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  label?: string;
  className?: string;
}) {
  if (values.length < 2) {
    return (
      <span
        className="text-xs text-muted-foreground"
        role="img"
        aria-label={label ?? "No trend yet"}
      >
        no trend yet
      </span>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map(
      (value, index) =>
        `${(index * step).toFixed(1)},${(height - 2 - ((value - min) / range) * (height - 4)).toFixed(1)}`,
    )
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label ?? "Trend"}
      className={className}
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--chart-2)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
