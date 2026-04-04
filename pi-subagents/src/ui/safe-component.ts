import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";

export type DisposableComponent = Component & {
  dispose?(): void;
};

function formatErrorMessage(label: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `[${label} failed: ${detail}]`;
}

function fallbackLines(width: number, label: string, error: unknown): string[] {
  const safeWidth = Math.max(1, width);
  return [truncateToWidth(formatErrorMessage(label, error), safeWidth)];
}

function sanitizeLines(lines: string[] | undefined, width: number): string[] {
  const safeWidth = Math.max(1, width);
  return (lines ?? []).map((line) => truncateToWidth(String(line ?? ""), safeWidth));
}

export function wrapComponentSafely(
  component: DisposableComponent,
  options: {
    label: string;
    onError?: (error: unknown) => void;
  },
): DisposableComponent {
  let renderFailed = false;

  return {
    render(width: number): string[] {
      try {
        return sanitizeLines(component.render(width), width);
      } catch (error) {
        if (!renderFailed) {
          renderFailed = true;
          options.onError?.(error);
        }
        return fallbackLines(width, options.label, error);
      }
    },

    handleInput(data: string): void {
      if (typeof component.handleInput !== "function") return;
      try {
        component.handleInput(data);
      } catch (error) {
        if (!renderFailed) {
          renderFailed = true;
          options.onError?.(error);
        }
      }
    },

    invalidate(): void {
      try {
        component.invalidate();
      } catch (error) {
        if (!renderFailed) {
          renderFailed = true;
          options.onError?.(error);
        }
      }
    },

    dispose(): void {
      if (typeof component.dispose !== "function") return;
      try {
        component.dispose();
      } catch (error) {
        if (!renderFailed) {
          renderFailed = true;
          options.onError?.(error);
        }
      }
    },
  };
}
