import { describe, expect, it } from "vitest";
import { safeJsonStringify } from "./safe-json-stringify";

describe("safeJsonStringify", () => {
  describe("primitives and plain values", () => {
    it("serializes a plain object", () => {
      const result = safeJsonStringify({ a: 1, b: "two" });

      expect(JSON.parse(result)).toEqual({ a: 1, b: "two" });
    });

    it("serializes primitives", () => {
      expect(safeJsonStringify("hello")).toBe('"hello"');
      expect(safeJsonStringify(42)).toBe("42");
      expect(safeJsonStringify(true)).toBe("true");
      expect(safeJsonStringify(null)).toBe("null");
    });

    it("honors the space argument for pretty printing", () => {
      const result = safeJsonStringify({ a: 1 }, 2);

      expect(result).toBe('{\n  "a": 1\n}');
    });

    it("returns an empty string when the value serializes to undefined", () => {
      expect(safeJsonStringify(undefined)).toBe("");
      expect(safeJsonStringify(() => {})).toBe("");
    });
  });

  describe("Error serialization", () => {
    it("surfaces the non-enumerable name, message, and stack of a top-level Error", () => {
      const error = new Error("boom");
      const parsed = JSON.parse(safeJsonStringify(error));

      expect(parsed.name).toBe("Error");
      expect(parsed.message).toBe("boom");
      expect(typeof parsed.stack).toBe("string");
      expect(parsed.stack.length).toBeGreaterThan(0);
    });

    it("surfaces an Error nested inside an object (e.g. log context)", () => {
      const context = { failure: new Error("nested failure"), userId: 7 };
      const parsed = JSON.parse(safeJsonStringify(context));

      expect(parsed.userId).toBe(7);
      expect(parsed.failure.message).toBe("nested failure");
      expect(parsed.failure.name).toBe("Error");
      expect(typeof parsed.failure.stack).toBe("string");
    });

    it("preserves custom enumerable properties attached to an Error", () => {
      const error = new Error("with code") as Error & { code: string; statusCode: number };
      error.code = "E_CONFLICT";
      error.statusCode = 409;

      const parsed = JSON.parse(safeJsonStringify(error));

      expect(parsed.message).toBe("with code");
      expect(parsed.code).toBe("E_CONFLICT");
      expect(parsed.statusCode).toBe(409);
    });

    it("retains the subclass name for a custom Error", () => {
      class CustomError extends Error {
        public constructor(message: string) {
          super(message);
          this.name = "CustomError";
        }
      }

      const parsed = JSON.parse(safeJsonStringify(new CustomError("custom")));

      expect(parsed.name).toBe("CustomError");
      expect(parsed.message).toBe("custom");
    });

    it("emits exact, key-sorted bytes for an Error with custom enumerable props", () => {
      // Pin the serialized output byte-for-byte. The replacer spreads the
      // Error first, then sets name/message/stack explicitly; because
      // `safe-stable-stringify` sorts keys, the result is fully deterministic.
      // A fixed stack removes the only environment-dependent field. This is
      // the regression guard for the spread-ordering fix (TS2783): the bytes
      // must not change.
      const error = new Error("with code") as Error & { code: string };
      error.code = "E_CONFLICT";
      error.stack = "Error: with code\n    at fixed (file.ts:1:1)";

      const result = safeJsonStringify(error, 2);

      expect(result).toBe(
        [
          "{",
          '  "code": "E_CONFLICT",',
          '  "message": "with code",',
          '  "name": "Error",',
          '  "stack": "Error: with code\\n    at fixed (file.ts:1:1)"',
          "}",
        ].join("\n"),
      );
    });

    it("the explicit name/message/stack win over enumerable same-named props", () => {
      // A subclass that makes `message` enumerable is the exact hazard the
      // duplicate-key warning flagged. The spread carries the enumerable
      // `message`, but the explicit `value.message` assignment that follows it
      // takes precedence — here both hold the same string, so the output stays
      // byte-identical to a plain Error's `message` field.
      class Weird extends Error {
        public constructor(message: string) {
          super(message);
          Object.defineProperty(this, "message", {
            value: message,
            enumerable: true,
            writable: true,
            configurable: true,
          });
          this.name = "Weird";
        }
      }

      const parsed = JSON.parse(safeJsonStringify(new Weird("weird")));

      expect(parsed.name).toBe("Weird");
      expect(parsed.message).toBe("weird");
    });
  });

  describe("hostile inputs", () => {
    it("does not throw on circular references", () => {
      const node: Record<string, unknown> = { name: "root" };
      node.self = node;

      expect(() => safeJsonStringify(node)).not.toThrow();

      const parsed = JSON.parse(safeJsonStringify(node));

      expect(parsed.name).toBe("root");
    });

    it("serializes BigInt as a plain number without throwing", () => {
      expect(() => safeJsonStringify({ big: 10n })).not.toThrow();
      expect(safeJsonStringify({ big: 10n })).toBe('{"big":10}');
    });

    it("drops functions, symbols, and undefined props (standard JSON behavior)", () => {
      const result = safeJsonStringify({
        a: 1,
        fn: () => {},
        sym: Symbol("x"),
        undef: undefined,
        b: 2,
      });

      expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
    });

    it("preserves nested arrays and objects", () => {
      const result = safeJsonStringify({ arr: [1, [2, 3], { c: 4 }] });

      expect(JSON.parse(result)).toEqual({ arr: [1, [2, 3], { c: 4 }] });
    });

    it("renders a repeated (non-circular) reference fully at each occurrence", () => {
      // Only true cycles are collapsed; a child shared between two sibling keys
      // is serialized in full both times.
      const shared = { id: 1 };
      const result = safeJsonStringify({ first: shared, second: shared });

      expect(JSON.parse(result)).toEqual({ first: { id: 1 }, second: { id: 1 } });
    });

    it("produces deterministic key ordering", () => {
      const first = safeJsonStringify({ b: 2, a: 1, c: 3 });
      const second = safeJsonStringify({ c: 3, a: 1, b: 2 });

      expect(first).toBe(second);
      expect(first).toBe('{"a":1,"b":2,"c":3}');
    });
  });
});
