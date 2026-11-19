import { useId, useState, type KeyboardEvent } from "react";
import type { DevtoolsAiRatePoint } from "@contracts";
import { bucketLabel, bucketTitle, niceCeil } from "./buckets";
import { ChartFrame } from "./ChartFrame";
import { ChartTooltip } from "./ChartTooltip";

const WIDTH = 640;
const HEIGHT = 200;
const LEFT = 52;
const RIGHT = 8;
const TOP = 8;
const BOTTOM = 22;

export type TimeLineChartProps = {
  title: string;
  /** The name of the one series ("Error rate"); a single series has no legend. */
  seriesName: string;
  /** Points oldest first; a `rate` of `null` leaves a gap in the line. */
  points: DevtoolsAiRatePoint[];
  stepMs: number;
  /** Formats a rate (0 to 1) for the axis, the tooltip and the table. */
  format: (value: number) => string;
  /** The line colour (a series token). */
  color: string;
  emptyText: string;
  loading?: boolean;
  description?: string;
};

/**
 * A 2px line over time with gaps where a bucket has no value, a crosshair that
 * snaps to the nearest bucket, and the same keyboard and table behaviour as
 * the column chart.
 */
export function TimeLineChart({
  title,
  seriesName,
  points,
  stepMs,
  format,
  color,
  emptyText,
  loading,
  description,
}: TimeLineChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const tooltipId = useId();
  const count = points.length;
  const known = points.filter((point) => point.rate !== null);

  const table = (
    <table aria-label={`${title} as a table`} className="w-full text-xs tabular-nums">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-3 font-medium">
            Period
          </th>
          <th scope="col" className="py-1 pr-3 text-right font-medium">
            {seriesName}
          </th>
          <th scope="col" className="py-1 pr-3 text-right font-medium">
            Runs
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            Failed
          </th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.at} className="border-t">
            <th scope="row" className="py-1 pr-3 text-left font-normal">
              {bucketTitle(point.at, stepMs)}
            </th>
            <td className="py-1 pr-3 text-right">
              {point.rate === null ? "No runs" : format(point.rate)}
            </td>
            <td className="py-1 pr-3 text-right">{point.runs}</td>
            <td className="py-1 text-right">{point.errors}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (!count || !known.length) {
    return (
      <ChartFrame title={title} loading={loading} description={description}>
        <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
      </ChartFrame>
    );
  }

  const max = niceCeil(Math.max(...known.map((point) => point.rate ?? 0)));
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const band = plotWidth / count;
  const x = (index: number) => LEFT + index * band + band / 2;
  const y = (value: number) => TOP + plotHeight - (value / max) * plotHeight;
  const labelEvery = Math.ceil(count / 6);

  // Consecutive buckets with a value form one segment; a null bucket ends it.
  const segments: { index: number; rate: number }[][] = [];

  points.forEach((point, index) => {
    if (point.rate === null) {
      segments.push([]);

      return;
    }

    if (!segments.length) segments.push([]);

    segments[segments.length - 1]?.push({ index, rate: point.rate });
  });

  const drawn = segments.filter((segment) => segment.length);
  const summary = `${title}: latest ${format(known.at(-1)?.rate ?? 0)}, highest ${format(Math.max(...known.map((point) => point.rate ?? 0)))} over ${count} periods. Use the left and right arrow keys to read each period.`;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft") setActive((value) => Math.max(0, (value ?? count) - 1));
    else if (event.key === "ArrowRight")
      setActive((value) => Math.min(count - 1, (value ?? -1) + 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(count - 1);
    else if (event.key === "Escape") setActive(null);
    else return;

    event.preventDefault();
  };

  const current = active === null ? undefined : points[active];

  return (
    <ChartFrame title={title} loading={loading} description={description} table={table}>
      <div
        role="group"
        tabIndex={0}
        aria-label={summary}
        aria-describedby={active === null ? undefined : tooltipId}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((value) => value ?? count - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="relative rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" aria-hidden="true">
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={y(max * fraction)}
                y2={y(max * fraction)}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={LEFT - 6}
                y={y(max * fraction) + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {format(max * fraction)}
              </text>
            </g>
          ))}
          {points.map((point, index) =>
            index % labelEvery === 0 ? (
              <text
                key={point.at}
                x={x(index)}
                y={HEIGHT - 6}
                textAnchor="middle"
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {bucketLabel(point.at, stepMs, index)}
              </text>
            ) : null,
          )}
          {active !== null ? (
            <line
              data-testid="crosshair"
              x1={x(active)}
              x2={x(active)}
              y1={TOP}
              y2={TOP + plotHeight}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ) : null}
          {drawn.map((segment) =>
            segment.length === 1 ? (
              <circle
                key={segment[0]?.index}
                data-testid="line-dot"
                cx={x(segment[0]?.index ?? 0)}
                cy={y(segment[0]?.rate ?? 0)}
                r={4}
                fill={color}
                stroke="var(--card)"
                strokeWidth={2}
              />
            ) : (
              <path
                key={segment[0]?.index}
                data-testid="line-segment"
                d={segment
                  .map(
                    (p, i) =>
                      `${i === 0 ? "M" : "L"}${x(p.index).toFixed(1)},${y(p.rate).toFixed(1)}`,
                  )
                  .join("")}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ),
          )}
          {current && current.rate !== null ? (
            <circle
              cx={x(active ?? 0)}
              cy={y(current.rate)}
              r={4}
              fill={color}
              stroke="var(--card)"
              strokeWidth={2}
            />
          ) : null}
          {points.map((point, index) => (
            <rect
              key={point.at}
              data-testid="chart-hit"
              x={LEFT + index * band}
              y={TOP}
              width={band}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setActive(index)}
              onMouseMove={() => setActive(index)}
            />
          ))}
        </svg>
        {current ? (
          <ChartTooltip
            id={tooltipId}
            title={bucketTitle(current.at, stepMs)}
            left={(x(active ?? 0) / WIDTH) * 100}
            rows={[
              {
                key: "rate",
                label: seriesName,
                value: current.rate === null ? "No runs" : format(current.rate),
                color,
                shape: "line",
              },
              { key: "runs", label: "runs", value: String(current.runs), color: "transparent" },
              {
                key: "errors",
                label: "failed",
                value: String(current.errors),
                color: "transparent",
              },
            ]}
          />
        ) : null}
      </div>
    </ChartFrame>
  );
}
