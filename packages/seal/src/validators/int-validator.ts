import { intRule } from "../rules";
import { NumberValidator } from "./number-validator";

/**
 * Integer validator class
 */
export class IntValidator extends NumberValidator {
  public constructor(errorMessage?: string) {
    super();
    this.addMutableRule(intRule, errorMessage);
  }
}
