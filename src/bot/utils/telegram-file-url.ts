import { config } from "../../config.js";

const DEFAULT_TELEGRAM_API_ROOT = "https://api.telegram.org";

export function telegramFileUrlBase(): string {
  const apiRoot = config.telegram.apiRoot || DEFAULT_TELEGRAM_API_ROOT;
  return `${apiRoot}/file/bot`;
}

export function buildTelegramFileUrl(filePath: string, token: string = config.telegram.token): string {
  return `${telegramFileUrlBase()}${token}/${filePath}`;
}
