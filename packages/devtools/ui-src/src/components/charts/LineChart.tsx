export type LineSeries = {
  name: string;
  /** A CSS colour, e.g. `var(--chart-1)`. */
  color: string;
  /** Oldest first. */
  points: { at: number; value: number }[];
};

/**
 * A line chart with several series on one shared value axis. Plain SVG: a
 * baseline, a few value gridlines, a legend and a text table fallback for
 * assistive technology.
 */
export function LineChart({
  title,
  series,
  format,
  height = 140,
  max: fixedMax,
}: {
  title: string;
  series: LineSeries[];
  /** Formats an axis value (`formatBytes`, `formatPercent`). */
  format: (value: number) => string;
  height?: number;
  /** Fixes the top of the axis (e.g. 1 for a ratio); otherwise the data decides. */
  max?: number;
}) {
  const all = series.flatMap((item) => item.points);

  if (all.length < 2) {
    return <p className="text-xs text-muted-foreground">{title}: waiting for more readings.</p>;
  }

  const width = 480;
  const left = 56;
  const bottom = 18;
  const top = 6;
  const minAt = Math.min(...all.map((point) => point.at));
  const maxAt = Math.max(...all.map((point) => point.at));
  const maxValue = fixedMax ?? (Math.max(...all.map((point) => point.value)) || 1);
  const plotWidth = width - left - 4;
  const plotHeight = height - top - bottom;
  const x = (at: number) => left + ((at - minAt) / (maxAt - minAt || 1)) * plotWidth;
  const y = (value: number) =>
    top + plotHeight - (Math.min(value, maxValue) / maxValue) * plotHeight;
  const ticks = [0, 0.5, 1].map((fraction) => fraction * maxValue);

  return (
    <figure className="m-0">
      <figcaption className="mb-1 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-medium">{title}</span>
        {series.map((item) => (
          <span key={item.name} className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="inline-block h-0.5 w-3" style={{ background: item.color }} />
            {item.name}
          </span>
        ))}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${title}: ${series
          .map((item) => `${item.name} latest ${format(item.points.at(-1)?.value ?? 0)}`)
          .join(", ")}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - 4}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={left - 4}
              y={y(tick) + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--muted-foreground)"
            >
              {format(tick)}
            </text>
          </g>
        ))}
        {series.map((item) => (
          <polyline
            key={item.name}
            fill="none"
            stroke={item.color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            points={item.points
              .map((point) => `${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`)
              .join(" ")}
          />
        ))}
        <text x={left} y={height - 4} fontSize={9} fill="var(--muted-foreground)">
          {new Date(minAt).toLocaleTimeString()}
        </text>
        <text
          x={width - 4}
          y={height - 4}
          textAnchor="end"
          fontSize={9}
          fill="var(--muted-foreground)"
        >
          {new Date(maxAt).toLocaleTimeString()}
        </text>
      </svg>
    </figure>
  );
}
