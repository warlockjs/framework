import type { DevtoolsAiBreakdownRow } from "@contracts";
import { ShareBar } from "@/components/charts";
import { HEAD, NUM_CELL, rowOpen, TableCard } from "@/components/listing";
import { DASH, formatNumber } from "@/components/ui/panel-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatLatency, formatRatio, formatTokens, formatUsd } from "./format-ai";
import { NoPricingPill } from "./pills";

/** The top agents or top models table: runs, tokens, estimated cost with a share bar, error rate and p95. */
export function BreakdownTable({
  label,
  heading,
  rows,
  unpriced,
  onOpen,
}: {
  label: string;
  heading: string;
  rows: DevtoolsAiBreakdownRow[];
  unpriced?: ReadonlySet<string>;
  onOpen?: (row: DevtoolsAiBreakdownRow) => void;
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing in this range.</p>;

  return (
    <TableCard label={label}>
      <TableHeader>
        <TableRow>
          <TableHead className={HEAD}>{heading}</TableHead>
          <TableHead className={`${HEAD} ${NUM_CELL}`}>Runs</TableHead>
          <TableHead className={`${HEAD} ${NUM_CELL}`}>Tokens</TableHead>
          <TableHead className={`${HEAD} ${NUM_CELL}`}>Estimated cost</TableHead>
          <TableHead className={`${HEAD} ${NUM_CELL}`}>Error rate</TableHead>
          <TableHead className={`${HEAD} ${NUM_CELL}`}>p95</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const { totals } = row;

          return (
            <TableRow
              key={row.key}
              {...(onOpen
                ? { ...rowOpen(() => onOpen(row)), "aria-label": `Open ${row.label}` }
                : {})}
            >
              <TableCell className="max-w-64 truncate font-medium">
                {row.label}
                {unpriced?.has(row.key) || totals.cost.unpricedRuns > 0 ? (
                  <span className="ml-2">
                    <NoPricingPill />
                  </span>
                ) : null}
              </TableCell>
              <TableCell className={NUM_CELL}>{formatNumber(totals.runs)}</TableCell>
              <TableCell className={NUM_CELL}>
                {formatTokens(totals.tokens.input + totals.tokens.output)}
              </TableCell>
              <TableCell className={NUM_CELL}>
                <ShareBar share={row.share}>
                  {totals.cost.pricedRuns > 0 ? formatUsd(totals.cost.estimatedUsd) : DASH}
                </ShareBar>
              </TableCell>
              <TableCell className={NUM_CELL}>{formatRatio(totals.errorRate)}</TableCell>
              <TableCell className={NUM_CELL}>{formatLatency(totals.latency.p95Ms)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </TableCard>
  );
}
