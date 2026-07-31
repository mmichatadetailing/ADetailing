import { describe, expect, it } from "vitest";
import { statusVariant } from "./status-badge";

describe("statusVariant", () => {
  it("ne confond pas impayé et payé", () => {
    expect(statusVariant("unpaid")).toBe("yellow");
    expect(statusVariant("paid")).toBe("green");
  });

  it("distingue les paiements partiels et en retard", () => {
    expect(statusVariant("partial")).toBe("yellow");
    expect(statusVariant("overdue")).toBe("red");
  });
});
