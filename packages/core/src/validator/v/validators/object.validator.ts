import { objectRule } from "../rules";
import { objectMutator } from "../mutators";
import { BaseValidator } from "./base.validator";
import type { ScalarValidator } from "./scalar.validator";

export class ObjectValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();

    this.addRule(objectRule, errorMessage);
    this.addMutator(objectMutator);
  }

  // Scalar methods
  public enum: typeof ScalarValidator.prototype.enum = ScalarValidator.prototype.enum;
  public in: typeof ScalarValidator.prototype.in = ScalarValidator.prototype.in;
  public oneOf: typeof ScalarValidator.prototype.in = ScalarValidator.prototype.in;
  public unique: typeof ScalarValidator.prototype.unique = ScalarValidator.prototype.unique;
  public uniqueExceptCurrentUser: typeof ScalarValidator.prototype.uniqueExceptCurrentUser = ScalarValidator.prototype.uniqueExceptCurrentUser;
  public uniqueExceptCurrentId: typeof ScalarValidator.prototype.uniqueExceptCurrentId = ScalarValidator.prototype.uniqueExceptCurrentId;
  public exists: typeof ScalarValidator.prototype.exists = ScalarValidator.prototype.exists;
  public existsExceptCurrentUser: typeof ScalarValidator.prototype.existsExceptCurrentUser = ScalarValidator.prototype.existsExceptCurrentUser;
  public existsExceptCurrentId: typeof ScalarValidator.prototype.existsExceptCurrentId = ScalarValidator.prototype.existsExceptCurrentId;
  public allowsOnly: typeof ScalarValidator.prototype.allowsOnly = ScalarValidator.prototype.allowsOnly;
  public forbids: typeof ScalarValidator.prototype.forbids = ScalarValidator.prototype.forbids;
  public notIn: typeof ScalarValidator.prototype.forbids = ScalarValidator.prototype.forbids;
} 