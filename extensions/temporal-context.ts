import {
  getMessageTimestamp,
  injectEphemeralUserContextMessage,
} from "@mattrobenolt/pi-core/context";
import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

type AgentMessage = ContextEvent["messages"][number];

const TEMPORAL_CONTEXT_PREFIX = "Time context:";

function formatIsoWithOffset(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}

const MIN_TIME_GAP_SECONDS = 30 * 60;

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;

  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours`;

  const days = Math.round(hours / 24);
  return `${days} days`;
}

function buildTemporalBlock(messages: AgentMessage[]): string | null {
  let currentUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      currentUserIndex = i;
      break;
    }
  }
  if (currentUserIndex === -1) return null;

  const currentUserMessage = messages[currentUserIndex];
  const currentTimestamp = getMessageTimestamp(currentUserMessage);

  let previousMessage: AgentMessage | null = null;
  for (let i = currentUserIndex - 1; i >= 0; i--) {
    const role = messages[i].role;
    if (role === "user" || role === "assistant") {
      previousMessage = messages[i];
      break;
    }
  }
  if (!previousMessage) return null;

  const previousTimestamp = getMessageTimestamp(previousMessage);
  const deltaSeconds = Math.max(0, Math.floor((currentTimestamp - previousTimestamp) / 1000));
  if (deltaSeconds < MIN_TIME_GAP_SECONDS) return null;

  return `${TEMPORAL_CONTEXT_PREFIX} the previous ${previousMessage.role} message was about ${formatDuration(deltaSeconds)} ago. Current local time is ${formatIsoWithOffset(new Date(currentTimestamp))}.`;
}

export default function temporalContextExtension(pi: ExtensionAPI) {
  pi.on("context", async (event) => {
    const temporalBlock = buildTemporalBlock(event.messages);
    if (!temporalBlock) return;

    return {
      messages: injectEphemeralUserContextMessage(event.messages, temporalBlock),
    };
  });
}
