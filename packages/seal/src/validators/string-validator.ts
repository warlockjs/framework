import {
  alphaOnlyMutator,
  alphanumericOnlyMutator,
  appendMutator,
  base64DecodeMutator,
  base64EncodeMutator,
  camelCaseMutator,
  capitalizeMutator,
  htmlEscapeMutator,
  kebabCaseMutator,
  lowercaseMutator,
  ltrimMutator,
  maskMutator,
  padEndMutator,
  padStartMutator,
  pascalCaseMutator,
  prependMutator,
  removeNumbersMutator,
  removeSpecialCharactersMutator,
  repeatMutator,
  replaceAllMutator,
  replaceMutator,
  reverseMutator,
  rtrimMutator,
  safeHtmlMutator,
  slugMutator,
  snakeCaseMutator,
  stringifyMutator,
  titleCaseMutator,
  trimMultipleWhitespaceMutator,
  trimMutator,
  truncateMutator,
  unescapeHtmlMutator,
  uppercaseMutator,
  urlDecodeMutator,
  urlEncodeMutator,
} from "../mutators";
import {
  alphaNumericRule,
  alphaRule,
  betweenLengthRule,
  colorRule,
  containsRule,
  darkColorRule,
  emailRule,
  endsWithRule,
  hexColorRule,
  hslColorRule,
  ip4Rule,
  ip6Rule,
  ipRule,
  isCreditCardRule,
  isNumericRule,
  lengthRule,
  lightColorRule,
  maxLengthRule,
  maxWordsRule,
  minLengthRule,
  minWordsRule,
  notContainsRule,
  patternRule,
  rgbColorRule,
  rgbaColorRule,
  startsWithRule,
  stringRule,
  strongPasswordRule,
  urlRule,
  withoutWhitespaceRule,
  wordsRule,
} from "../rules";
import { BaseValidator } from "./base-validator";
import { ScalarValidator } from "./scalar-validator";

/**
 * String validator class
 */
export class StringValidator extends BaseValidator {
  public constructor(errorMessage?: string) {
    super();
    this.addRule(stringRule, errorMessage);
  }

  // ==================== Mutators ====================

  /**
   * Stringify the value if not a string
   */
  public toString() {
    this.addMutator(stringifyMutator);
    return this;
  }

  /** Convert string to uppercase */
  public uppercase() {
    this.addMutator(uppercaseMutator);
    return this;
  }

  /** Convert string to lowercase */
  public lowercase() {
    this.addMutator(lowercaseMutator);
    return this;
  }

  /** Capitalize only the first letter of the string */
  public capitalize() {
    this.addMutator(capitalizeMutator);
    return this;
  }

  /** Capitalize the first letter of each word (Title Case) */
  public titleCase() {
    this.addMutator(titleCaseMutator);
    return this;
  }

  /** Convert to camelCase */
  public camelCase() {
    this.addMutator(camelCaseMutator);
    return this;
  }

  /** Convert to PascalCase */
  public pascalCase() {
    this.addMutator(pascalCaseMutator);
    return this;
  }

  /** Convert to snake_case */
  public snakeCase() {
    this.addMutator(snakeCaseMutator);
    return this;
  }

  /** Convert to kebab-case */
  public kebabCase() {
    this.addMutator(kebabCaseMutator);
    return this;
  }

  /**
   * Trim the given needle from the string
   * If no needle is provided, the default is a single space
   */
  public trim(needle?: string) {
    this.addMutator(trimMutator, { needle });
    return this;
  }

  /** Trim from the left/start */
  public ltrim(needle?: string) {
    this.addMutator(ltrimMutator, { needle });
    return this;
  }

  /** Trim from the right/end */
  public rtrim(needle?: string) {
    this.addMutator(rtrimMutator, { needle });
    return this;
  }

  /** Trim multiple whitespace into single space */
  public trimMultipleWhitespace() {
    this.addMutator(trimMultipleWhitespaceMutator);
    return this;
  }

  /** Pad string from the start to reach target length */
  public padStart(length: number, char = " ") {
    this.addMutator(padStartMutator, { length, char });
    return this;
  }

  /** Pad string from the end to reach target length */
  public padEnd(length: number, char = " ") {
    this.addMutator(padEndMutator, { length, char });
    return this;
  }

  /** Remove HTML tags (safe HTML) */
  public safeHtml() {
    this.addMutator(safeHtmlMutator);
    return this;
  }

  /** HTML escape special characters */
  public htmlEscape() {
    return this.addMutator(htmlEscapeMutator);
  }

  /** Unescape HTML entities */
  public unescapeHtml() {
    this.addMutator(unescapeHtmlMutator);
    return this;
  }

  /**
   * Remove special characters
   * This will remove all characters that are not alphanumeric or whitespace
   */
  public removeSpecialCharacters() {
    this.addMutator(removeSpecialCharactersMutator);
    return this;
  }

  /** Convert to only alphabetic characters */
  public toAlpha() {
    this.addMutator(alphaOnlyMutator);
    return this;
  }

  /** Convert to only alphanumeric characters */
  public toAlphanumeric() {
    this.addMutator(alphanumericOnlyMutator);
    return this;
  }

  /** Remove all numeric characters */
  public removeNumbers() {
    this.addMutator(removeNumbersMutator);
    return this;
  }

  /** URL decode */
  public urlDecode() {
    this.addMutator(urlDecodeMutator);
    return this;
  }

  /** URL encode */
  public urlEncode() {
    this.addMutator(urlEncodeMutator);
    return this;
  }

  /** Convert to URL-friendly slug */
  public slug() {
    this.addMutator(slugMutator);
    return this;
  }

  /** Base64 encode */
  public base64Encode() {
    this.addMutator(base64EncodeMutator);
    return this;
  }

  /** Base64 decode */
  public base64Decode() {
    this.addMutator(base64DecodeMutator);
    return this;
  }

  /** Replace substring or pattern */
  public replace(search: string | RegExp, replace: string) {
    this.addMutator(replaceMutator, { search, replace });
    return this;
  }

  /** Replace all occurrences of substring or pattern */
  public replaceAll(search: string | RegExp, replace: string) {
    this.addMutator(replaceAllMutator, { search, replace });
    return this;
  }

  /** Append/suffix text to the end */
  public append(suffix: string) {
    this.addMutator(appendMutator, { suffix });
    return this;
  }

  /** Prepend/prefix text to the beginning */
  public prepend(prefix: string) {
    this.addMutator(prependMutator, { prefix });
    return this;
  }

  /** Reverse the string */
  public reverse() {
    this.addMutator(reverseMutator);
    return this;
  }

  /** Truncate to a maximum length */
  public truncate(maxLength: number, suffix = "...") {
    this.addMutator(truncateMutator, { maxLength, suffix });
    return this;
  }

  /** Repeat string N times */
  public repeat(count: number) {
    this.addMutator(repeatMutator, { count });
    return this;
  }

  /** Mask part of string */
  public mask(start: number, end?: number, char = "*") {
    this.addMutator(maskMutator, { start, end, char });
    return this;
  }

  // ==================== Validation Rules ====================

  /** Value must be a valid email */
  public email(errorMessage?: string) {
    this.addRule(emailRule, errorMessage);
    return this;
  }

  /** Value must be a valid URL */
  public url(errorMessage?: string) {
    this.addRule(urlRule, errorMessage);
    return this;
  }

  /** Value can not have whitespace */
  public withoutWhitespace(errorMessage?: string) {
    this.addRule(withoutWhitespaceRule, errorMessage);
    return this;
  }

  /** Value must match the given pattern */
  public pattern(pattern: RegExp, errorMessage?: string) {
    const rule = this.addRule(patternRule, errorMessage);
    rule.context.options.pattern = pattern;
    return this;
  }

  /**
   * Value must be a strong password
   * Requirements:
   * - At least 8 characters
   * - At least 1 uppercase letter
   * - At least 1 lowercase letter
   * - At least 1 number
   * - At least 1 special character
   */
  public strongPassword(minLength?: number, errorMessage?: string) {
    const rule = this.addRule(strongPasswordRule, errorMessage);
    rule.context.options.minLength = minLength;
    return this;
  }

  /** Value must be exactly the given number of words */
  public words(words: number, errorMessage?: string) {
    const rule = this.addRule(wordsRule, errorMessage);
    rule.context.options.words = words;
    return this;
  }

  /** Value must be at least the given number of words */
  public minWords(words: number, errorMessage?: string) {
    const rule = this.addRule(minWordsRule, errorMessage);
    rule.context.options.minWords = words;
    return this;
  }

  /** Value must be at most the given number of words */
  public maxWords(words: number, errorMessage?: string) {
    const rule = this.addRule(maxWordsRule, errorMessage);
    rule.context.options.maxWords = words;
    return this;
  }

  /** Value length must be greater than the given length */
  public minLength(length: number, errorMessage?: string) {
    const rule = this.addRule(minLengthRule, errorMessage);
    rule.context.options.minLength = length;
    return this;
  }

  /** @alias minLength */
  public min(min: number, errorMessage?: string) {
    return this.minLength(min, errorMessage);
  }

  /** Value length must be less than the given length */
  public maxLength(length: number, errorMessage?: string) {
    const rule = this.addRule(maxLengthRule, errorMessage);
    rule.context.options.maxLength = length;
    return this;
  }

  /** @alias maxLength */
  public max(max: number, errorMessage?: string) {
    return this.maxLength(max, errorMessage);
  }

  /** Value must be of the given length */
  public length(length: number, errorMessage?: string) {
    const rule = this.addRule(lengthRule, errorMessage);
    rule.context.options.length = length;
    return this;
  }

  /**
   * String length must be between min and max (inclusive)
   *
   * @param min - Minimum length (inclusive)
   * @param max - Maximum length (inclusive)
   *
   * @example
   * ```ts
   * v.string().between(5, 10)  // Length: 5 to 10 characters
   * v.string().lengthBetween(8, 20)  // Same using alias
   * ```
   *
   * @category Validation Rule
   */
  public between(min: number, max: number, errorMessage?: string) {
    const rule = this.addRule(betweenLengthRule, errorMessage);
    rule.context.options.minLength = min;
    rule.context.options.maxLength = max;
    return this;
  }

  /**
   * Alias for between() - string length between min and max
   */
  public lengthBetween(min: number, max: number, errorMessage?: string) {
    return this.between(min, max, errorMessage);
  }

  /** Allow only alphabetic characters */
  public alpha(errorMessage?: string) {
    this.addRule(alphaRule, errorMessage);
    return this;
  }

  /** Allow only alphanumeric characters */
  public alphanumeric(errorMessage?: string) {
    this.addRule(alphaNumericRule, errorMessage);
    return this;
  }

  /** Allow only numeric characters */
  public numeric(errorMessage?: string) {
    this.addRule(isNumericRule, errorMessage);
    return this;
  }

  /** Value must starts with the given string */
  public startsWith(value: string, errorMessage?: string) {
    const rule = this.addRule(startsWithRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /** Value must ends with the given string */
  public endsWith(value: string, errorMessage?: string) {
    const rule = this.addRule(endsWithRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /** Value must contain the given string */
  public contains(value: string, errorMessage?: string) {
    const rule = this.addRule(containsRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /** Value must not contain the given string */
  public notContains(value: string, errorMessage?: string) {
    const rule = this.addRule(notContainsRule, errorMessage);
    rule.context.options.value = value;
    return this;
  }

  /** Value must be a valid IP address */
  public ip(errorMessage?: string) {
    this.addRule(ipRule, errorMessage);
    return this;
  }

  /** Value must be a valid IPv4 address */
  public ip4(errorMessage?: string) {
    this.addRule(ip4Rule, errorMessage);
    return this;
  }

  /** Value must be a valid IPv6 address */
  public ip6(errorMessage?: string) {
    this.addRule(ip6Rule, errorMessage);
    return this;
  }

  /** Check if the string matches a credit card number */
  public creditCard(errorMessage?: string) {
    this.addRule(isCreditCardRule, errorMessage);
    return this;
  }

  /** Determine if the value is a valid color */
  public color(errorMessage?: string) {
    this.addRule(colorRule, errorMessage);
    return this;
  }

  /** Determine if the value is a valid hex color */
  public hexColor(errorMessage?: string) {
    this.addRule(hexColorRule, errorMessage);
    return this;
  }

  /** Determine if the value is a valid HSL color */
  public hslColor(errorMessage?: string) {
    this.addRule(hslColorRule, errorMessage);
    return this;
  }

  /** Determine if the value is a valid RGB color */
  public rgbColor(errorMessage?: string) {
    this.addRule(rgbColorRule, errorMessage);
    return this;
  }

  /** Determine if the value is a valid RGBA color */
  public rgbaColor(errorMessage?: string) {
    this.addRule(rgbaColorRule, errorMessage);
    return this;
  }

  /** Determine if the value is a valid light color */
  public lightColor(errorMessage?: string) {
    this.addRule(lightColorRule, errorMessage);
    return this;
  }

  /** Determine if the value is a valid dark color */
  public darkColor(errorMessage?: string) {
    this.addRule(darkColorRule, errorMessage);
    return this;
  }

  // Enum and value checking methods from ScalarValidator
  public enum = ScalarValidator.prototype.enum;
  /** Value must be in one of the given values */
  public in = ScalarValidator.prototype.in;
  /** @alias in */
  public oneOf = ScalarValidator.prototype.in;
  /** @alias oneOf */
  public allowsOnly = ScalarValidator.prototype.allowsOnly;
  /** Forbid the value from being one of the given values */
  public forbids = ScalarValidator.prototype.forbids;
  /** @alias forbids */
  public notIn = ScalarValidator.prototype.forbids;
}
