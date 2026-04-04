import { describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";
import { wrapComponentSafely } from "./safe-component.js";

function assertAllLinesFit(lines: string[], width: number) {
  for (let i = 0; i < lines.length; i++) {
    const vw = visibleWidth(lines[i]);
    expect(vw, `line ${i} exceeds width (${vw} > ${width}): ${JSON.stringify(lines[i])}`).toBeLessThanOrEqual(width);
  }
}

describe("wrapComponentSafely", () => {
  it("truncates overwidth lines from wrapped render output", () => {
    const component = wrapComponentSafely({
      render: () => ["X".repeat(200)],
      invalidate: () => {},
    }, { label: "test component" });

    const lines = component.render(40);
    assertAllLinesFit(lines, 40);
  });

  it("returns a safe fallback line when render throws", () => {
    const onError = vi.fn();
    const component = wrapComponentSafely({
      render: () => {
        throw new Error("boom");
      },
      invalidate: () => {},
    }, { label: "test component", onError });

    const lines = component.render(30);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("test component failed");
    assertAllLinesFit(lines, 30);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("suppresses repeated onError calls after the first failure", () => {
    const onError = vi.fn();
    const component = wrapComponentSafely({
      render: () => {
        throw new Error("boom");
      },
      invalidate: () => {},
    }, { label: "test component", onError });

    component.render(30);
    component.render(30);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
