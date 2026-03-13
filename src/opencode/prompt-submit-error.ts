type PlainObject = Record<string, unknown>;

function asObject(value: unknown): PlainObject | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as PlainObject;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStatusCode(error: unknown): number | null {
  const root = asObject(error);
  if (!root) {
    return null;
  }

  const direct = root.statusCode ?? root.status;
  if (typeof direct === "number") {
    return direct;
  }

  const data = asObject(root.data);
  if (data) {
    const fromData = data.statusCode ?? data.status;
    if (typeof fromData === "number") {
      return fromData;
    }
  }

  const response = asObject(root.response);
  if (response && typeof response.status === "number") {
    return response.status;
  }

  return null;
}

function collectErrorTexts(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  const root = asObject(error);
  if (!root) {
    return "";
  }

  const parts: string[] = [];
  const directMessage = readString(root.message);
  const directError = readString(root.error);
  if (directMessage) {
    parts.push(directMessage);
  }
  if (directError) {
    parts.push(directError);
  }

  const data = asObject(root.data);
  if (data) {
    const dataMessage = readString(data.message);
    const responseBody = readString(data.responseBody);
    if (dataMessage) {
      parts.push(dataMessage);
    }
    if (responseBody) {
      parts.push(responseBody);
    }
  }

  if (Array.isArray(root.errors)) {
    for (const item of root.errors) {
      const itemObject = asObject(item);
      if (!itemObject) {
        continue;
      }

      const itemMessage = readString(itemObject.message) ?? readString(itemObject.error);
      if (itemMessage) {
        parts.push(itemMessage);
      }
    }
  }

  if (parts.length > 0) {
    return parts.join(" ");
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function looksBusyText(text: string): boolean {
  return /(\bbusy\b|already running|currently running|still running|in progress|another run|another task|please wait)/i.test(
    text,
  );
}

function looksMissingSessionText(text: string): boolean {
  return /(session.*not found|not found.*session|unknown session)/i.test(text);
}

export type PromptSubmitErrorType = "busy" | "session_not_found" | "other";

export function classifyPromptSubmitError(error: unknown): PromptSubmitErrorType {
  const statusCode = readStatusCode(error);
  const text = collectErrorTexts(error);

  if (statusCode === 409 || looksBusyText(text)) {
    return "busy";
  }

  if (statusCode === 404 || looksMissingSessionText(text)) {
    return "session_not_found";
  }

  return "other";
}
