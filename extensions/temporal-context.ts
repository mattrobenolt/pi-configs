import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function getMessageTimestamp(message: AgentMessage): number {
  const timestamp = (message as { timestamp?: number | string }).timestamp;
  if (typeof timestamp === "number") return timestamp;
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function injectEphemeralContextMessage(
  messages: AgentMessage[],
  customType: string,
  content: string,
): AgentMessage[] {
  const nextMessages = messages.filter(
    (message) => !(message.role === "custom" && message.customType === customType),
  );

  let insertAt = nextMessages.length;
  for (let i = nextMessages.length - 1; i >= 0; i--) {
    if (nextMessages[i].role === "user") {
      insertAt = i;
      break;
    }
  }

  const timestamp =
    insertAt < nextMessages.length ? getMessageTimestamp(nextMessages[insertAt]) : Date.now();

  nextMessages.splice(insertAt, 0, {
    role: "custom",
    customType,
    content,
    display: false,
    timestamp,
  });

  return nextMessages;
}

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

  const lines = ["<temporal>", `current_time: ${formatIsoWithOffset(new Date(currentTimestamp))}`];

  if (previousMessage) {
    const previousTimestamp = getMessageTimestamp(previousMessage);
    const deltaSeconds = Math.max(0, Math.floor((currentTimestamp - previousTimestamp) / 1000));
    lines.push(`previous_message_role: ${previousMessage.role}`);
    lines.push(`seconds_since_previous_message: ${deltaSeconds}`);
  } else {
    lines.push("previous_message_role: none");
    lines.push("seconds_since_previous_message: session-start");
  }

  lines.push("</temporal>");
  return lines.join("\n");
}

export default function temporalContextExtension(pi: ExtensionAPI) {
  pi.on("context", async (event) => {
    const temporalBlock = buildTemporalBlock(event.messages);
    if (!temporalBlock) return;

    return {
      messages: injectEphemeralContextMessage(event.messages, "temporal-context", temporalBlock),
    };
  });
}
