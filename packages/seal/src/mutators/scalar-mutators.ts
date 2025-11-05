import type { Mutator } from "../types";

export const stringMutator: Mutator = async value => {
  if (!value) {
    return value;
  }
  return String(value);
};
