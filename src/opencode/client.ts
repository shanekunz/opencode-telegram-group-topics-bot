import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { Agent } from "undici";
import { config } from "../config.js";

const opencodeDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

const getAuth = () => {
  if (!config.opencode.password) {
    return undefined;
  }
  const credentials = `${config.opencode.username}:${config.opencode.password}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
};

export const opencodeClient = createOpencodeClient({
  baseUrl: config.opencode.apiUrl,
  headers: config.opencode.password ? { Authorization: getAuth() } : undefined,
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      dispatcher: opencodeDispatcher as never,
    } as RequestInit),
});
