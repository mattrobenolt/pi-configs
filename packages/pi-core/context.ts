type TimestampedMessage = {
  timestamp?: number | string;
};

type RoleMessage = TimestampedMessage & {
  role: string;
  content?: unknown;
};

type CustomContextMessage = {
  role: "custom";
  customType: string;
  content: string;
  display: false;
  timestamp: number;
};

type UserContextMessage = {
  role: "user";
  content: string;
  timestamp: number;
};

export function getMessageTimestamp(message: TimestampedMessage): number {
  const { timestamp } = message;
  if (typeof timestamp === "number") return timestamp;
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function lastUserIndex(messages: RoleMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

function insertionTimestamp(messages: RoleMessage[], insertAt: number): number {
  return insertAt < messages.length ? getMessageTimestamp(messages[insertAt]) : Date.now();
}

export function injectEphemeralUserContextMessage<T extends RoleMessage>(
  messages: T[],
  content: string,
): T[] {
  const nextMessages = messages.filter(
    (message) => !(message.role === "user" && message.content === content),
  );

  const lastUser = lastUserIndex(nextMessages);
  const insertAt = lastUser === -1 ? nextMessages.length : lastUser;
  const timestamp = insertionTimestamp(nextMessages, insertAt);

  nextMessages.splice(insertAt, 0, { role: "user", content, timestamp } as unknown as T);
  return nextMessages;
}

export function injectEphemeralCustomContextMessage<T extends RoleMessage>(
  messages: T[],
  customType: string,
  content: string,
): T[] {
  const nextMessages = messages.filter(
    (message) =>
      !(message.role === "custom" && "customType" in message && message.customType === customType),
  );

  const lastUser = lastUserIndex(nextMessages);
  const insertAt = lastUser === -1 ? nextMessages.length : lastUser;
  const timestamp = insertionTimestamp(nextMessages, insertAt);

  nextMessages.splice(insertAt, 0, {
    role: "custom",
    customType,
    content,
    display: false,
    timestamp,
  } as unknown as T);
  return nextMessages;
}
