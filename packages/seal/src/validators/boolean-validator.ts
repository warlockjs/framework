import { booleanRule } from "../rules";
import { BaseValidator } from "./base-validator";
import { ScalarValidator } from "./scalar-validator";

/**
 * Boolean validator class
 */
export class BooleanValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();
    this.addRule(booleanRule, errorMessage);
  }

  // Accepted/Declined methods from ScalarValidator
  /** Value must be accepted (true, "yes", 1, "on", etc.) */
  public accepted = ScalarValidator.prototype.accepted;
  /** Value must be accepted if another field equals a value */
  public acceptedIf = ScalarValidator.prototype.acceptedIf;
  /** Value must be accepted unless another field equals a value */
  public acceptedUnless = ScalarValidator.prototype.acceptedUnless;
  /** Value must be accepted if another field is required */
  public acceptedIfRequired = ScalarValidator.prototype.acceptedIfRequired;
  /** Value must be accepted if another field is present */
  public acceptedIfPresent = ScalarValidator.prototype.acceptedIfPresent;
  /** Value must be accepted if another field is missing */
  public acceptedWithout = ScalarValidator.prototype.acceptedWithout;

  /** Value must be declined (false, "no", 0, "off", etc.) */
  public declined = ScalarValidator.prototype.declined;
  /** Value must be declined if another field equals a value */
  public declinedIf = ScalarValidator.prototype.declinedIf;
  /** Value must be declined unless another field equals a value */
  public declinedUnless = ScalarValidator.prototype.declinedUnless;
  /** Value must be declined if another field is required */
  public declinedIfRequired = ScalarValidator.prototype.declinedIfRequired;
  /** Value must be declined if another field is present */
  public declinedIfPresent = ScalarValidator.prototype.declinedIfPresent;
  /** Value must be declined if another field is missing */
  public declinedWithout = ScalarValidator.prototype.declinedWithout;

  /**
   * Value must be strictly true (not "yes", "on", 1, etc.)
   * @alias accepted - strict version
   */
  public mustBeTrue(errorMessage?: string) {
    return this.equal(true, errorMessage);
  }

  /**
   * Value must be strictly false (not "no", "off", 0, etc.)
   * @alias declined - strict version
   */
  public mustBeFalse(errorMessage?: string) {
    return this.equal(false, errorMessage);
  }
}
