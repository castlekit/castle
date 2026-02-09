import { describe, it, expect } from "vitest";
import { cn } from "../utils";

describe("cn (classname merging)", () => {
  it("should merge simple class strings", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("should handle conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("should merge tailwind classes correctly", () => {
    // twMerge should resolve conflicts: later classes win
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("should handle undefined and null inputs", () => {
    expect(cn("base", undefined, null, "end")).toBe("base end");
  });

  it("should handle empty call", () => {
    expect(cn()).toBe("");
  });

  it("should handle array inputs", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("should handle object inputs", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });
});
