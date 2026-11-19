import type { DevtoolsAiPricingState } from "@contracts";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Pill } from "@/components/listing";

/** A model that carried tokens without pricing: a warning with an icon and words, never a $0. */
export function NoPricingPill() {
  return (
    <Pill tone="warning">
      <TriangleAlertIcon className="size-3" aria-hidden="true" />
      No pricing
    </Pill>
  );
}

/** The pricing state of a model row. */
export function PricingPill({ state }: { state: DevtoolsAiPricingState }) {
  if (state === "missing") return <NoPricingPill />;

  // Its runs used no tokens (for example every one failed before the first call): nothing to price.
  if (state === "no-tokens") {
    return (
      <Pill tone="neutral">
        <CircleMinusIcon className="size-3" aria-hidden="true" />
        No tokens used
      </Pill>
    );
  }

  if (state === "partial") {
    return (
      <Pill tone="info">
        <CircleDashedIcon className="size-3" aria-hidden="true" />
        Partly priced
      </Pill>
    );
  }

  return (
    <Pill tone="success">
      <CircleCheckIcon className="size-3" aria-hidden="true" />
      Pricing set
    </Pill>
  );
}
