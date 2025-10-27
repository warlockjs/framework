import { round } from "@mongez/reinforcements";
import type { Mutator } from "../types";

/** Convert value to number */
export const numberMutator: Mutator = async value => {
  if (!value) return value;
  return Number(value);
};

/** Round number to specified decimals */
export const roundNumberMutator: Mutator = async (value, context) => {
  return round(value, context.options.decimals ?? 2);
};

/** Convert to boolean */
export const booleanMutator: Mutator = async value => {
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(value);
};
