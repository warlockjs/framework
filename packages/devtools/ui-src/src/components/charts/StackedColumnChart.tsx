import { useId, useState, type KeyboardEvent } from "react";
import type { DevtoolsAiSeriesSet } from "@contracts";
import { bucketLabel, bucketTitle, niceCeil } from "./buckets";
import { ChartFrame } from "./ChartFrame";
import { ChartLegend } from "./ChartLegend";
import { ChartTooltip } from "./ChartTooltip";
import { OTHER_COLOR } from "./series";

const WIDTH = 640;
const HEIGHT = 220;
const LEFT = 52;
const RIGHT = 6;
const TOP = 8;
const BOTTOM = 22;
const GAP = 2;
const RADIUS = 4;

/** A path with only its top corners rounded, for the topmost segment of a column. */
function roundedTop(x: number, y: number, width: number, height: number): string {
  const r = Math.min(RADIUS, width / 2, height);

  return `M${x},${y + height}V${y + r}a${r},${r} 0 0 1 ${r},${-r}H${x + width - r}a${r},${r} 0 0 1 ${r},${r}V${y + height}Z`;
}

export type StackedColumnChartProps = {
  title: string;
  /** The series and buckets from the API. */
  set: DevtoolsAiSeriesSet;
  stepMs: number;
  /** Formats a value for the axis, the tooltip and the table. */
  format: (value: number) => string;
  /** The colour of a named series; `Other` series always use the gray. */
  color: (key: string) => string;
  /** Shown instead of the plot when every bucket is zero. */
  emptyText: string;
  loading?: boolean;
  description?: string;
};

/**
 * Stacked columns, one per bucket. A 2px surface gap separates the segments,
 * the topmost one has a rounded top, and every bucket has a full-height hit
 * area for the tooltip. The plot is one tab stop: Left and Right move the
 * focused bucket, Escape clears it.
 */
export function StackedColumnChart({
  title,
  set,
  stepMs,
  format,
  color,
  emptyText,
  loading,
  description,
}: StackedColumnChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const tooltipId = useId();
  const count = set.buckets.length;
  const colorOf = (series: DevtoolsAiSeriesSet["series"][number]) =>
    series.other ? OTHER_COLOR : color(series.key);
  const totals = set.buckets.map((_, index) =>
    set.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0),
  );
  const grandTotal = totals.reduce((sum, value) => sum + value, 0);
  const legend = (
    <ChartLegend
      items={set.series.map((s) => ({ key: s.key, label: s.label, color: colorOf(s) }))}
    />
  );

  const table = (
    <table aria-label={`${title} as a table`} className="w-full text-xs tabular-nums">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-3 font-medium">
            Period
          </th>
          {set.series.map((series) => (
            <th key={series.key} scope="col" className="py-1 pr-3 text-right font-medium">
              {series.label}
            </th>
          ))}
          <th scope="col" className="py-1 text-right font-medium">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {set.buckets.map((at, index) => (
          <tr key={at} className="border-t">
            <th scope="row" className="py-1 pr-3 text-left font-normal">
              {bucketTitle(at, stepMs)}
            </th>
            {set.series.map((series) => (
              <td key={series.key} className="py-1 pr-3 text-right">
                {format(series.values[index] ?? 0)}
              </td>
            ))}
            <td className="py-1 text-right font-medium">{format(totals[index] ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (!count || grandTotal === 0) {
    return (
      <ChartFrame title={title} loading={loading} description={description}>
        <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
      </ChartFrame>
    );
  }

  const max = niceCeil(Math.max(...totals));
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const band = plotWidth / count;
  const barWidth = Math.max(2, band - Math.min(4, band * 0.2));
  const y = (value: number) => TOP + plotHeight - (value / max) * plotHeight;
  const labelEvery = Math.ceil(count / 6);
  const summary = `${title}: ${format(grandTotal)} in total over ${count} periods from ${bucketTitle(set.buckets[0] ?? 0, stepMs)}. Series: ${set.series.map((s) => s.label).join(", ")}. Use the left and right arrow keys to read each period.`;

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

  const bucketAt = active === null ? undefined : set.buckets[active];

  return (
    <ChartFrame
      title={title}
      loading={loading}
      description={description}
      legend={legend}
      table={table}
    >
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
          {set.buckets.map((at, index) => {
            const x = LEFT + index * band + (band - barWidth) / 2;
            let stacked = 0;
            const segments = set.series
              .map((series) => ({ series, value: series.values[index] ?? 0 }))
              .filter((segment) => segment.value > 0);

            return (
              <g key={at}>
                {segments.map((segment, position) => {
                  const bottom = y(stacked);

                  stacked += segment.value;

                  const top = y(stacked);
                  const height = Math.max(1, bottom - top);
                  const fill = colorOf(segment.series);
                  const common = { fill, stroke: "var(--card)", strokeWidth: GAP / 2 } as const;

                  return position === segments.length - 1 ? (
                    <path
                      key={segment.series.key}
                      d={roundedTop(x, top, barWidth, height)}
                      {...common}
                    />
                  ) : (
                    <rect
                      key={segment.series.key}
                      x={x}
                      y={top}
                      width={barWidth}
                      height={height}
                      {...common}
                    />
                  );
                })}
                {active === index ? (
                  <rect
                    x={LEFT + index * band}
                    y={TOP}
                    width={band}
                    height={plotHeight}
                    fill="var(--foreground)"
                    opacity={0.06}
                  />
                ) : null}
                {index % labelEvery === 0 ? (
                  <text
                    x={LEFT + index * band + band / 2}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--muted-foreground)"
                  >
                    {bucketLabel(at, stepMs, index)}
                  </text>
                ) : null}
                <rect
                  data-testid="chart-hit"
                  x={LEFT + index * band}
                  y={TOP}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setActive(index)}
                  onMouseMove={() => setActive(index)}
                />
              </g>
            );
          })}
        </svg>
        {active !== null && bucketAt !== undefined ? (
          <ChartTooltip
            id={tooltipId}
            title={bucketTitle(bucketAt, stepMs)}
            left={((LEFT + active * band + band / 2) / WIDTH) * 100}
            total={format(totals[active] ?? 0)}
            rows={[...set.series].reverse().map((series) => ({
              key: series.key,
              label: series.label,
              value: format(series.values[active] ?? 0),
              color: colorOf(series),
            }))}
          />
        ) : null}
      </div>
    </ChartFrame>
  );
}
