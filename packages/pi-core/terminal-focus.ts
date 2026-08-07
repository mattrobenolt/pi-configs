import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Terminal pane focus contract for extensions.
 *
 * The producer extension (extensions/terminal-focus.ts) owns the focus
 * reporting escape sequences and broadcasts changes here. Consumers call
 * onTerminalFocusChange() and keep their own focused state, defaulting to
 * true. The producer emits a snapshot on session_start, so subscribers that
 * register at factory time always learn the current state.
 *
 * This wrapper exists to keep the channel name and payload in one typed
 * place; the bus itself is shared process-wide by the extension loader.
 */
export const TERMINAL_FOCUS_CHANNEL = "terminal:focus";

export interface TerminalFocusEvent {
  focused: boolean;
}

export function emitTerminalFocus(pi: ExtensionAPI, focused: boolean): void {
  pi.events.emit(TERMINAL_FOCUS_CHANNEL, { focused });
}

export function onTerminalFocusChange(
  pi: ExtensionAPI,
  handler: (focused: boolean) => void,
): () => void {
  return pi.events.on(TERMINAL_FOCUS_CHANNEL, (data) => {
    handler((data as TerminalFocusEvent).focused);
  });
}
