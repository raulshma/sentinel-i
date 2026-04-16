import { Redis } from "ioredis";

import { env } from "./env.js";
import { logger } from "./logger.js";
import {
  isOperationTimeoutError,
  withPromiseTimeout,
} from "../utils/withTimeout.js";

let valkey: Redis | null = null;

export class ValkeyCommandTimeoutError extends Error {
  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`Valkey command "${operation}" timed out after ${timeoutMs}ms`);
    this.name = "ValkeyCommandTimeoutError";
  }
}

export const isValkeyCommandTimeoutError = (
  error: unknown,
): error is ValkeyCommandTimeoutError =>
  error instanceof ValkeyCommandTimeoutError;

export const withValkeyCommandTimeout = async <T>(
  operation: string,
  execute: () => Promise<T>,
): Promise<T> => {
  try {
    return await withPromiseTimeout(
      env.VALKEY_COMMAND_TIMEOUT_MS,
      execute,
      `Valkey command "${operation}" timed out after ${env.VALKEY_COMMAND_TIMEOUT_MS}ms`,
    );
  } catch (error) {
    if (isOperationTimeoutError(error)) {
      throw new ValkeyCommandTimeoutError(
        operation,
        env.VALKEY_COMMAND_TIMEOUT_MS,
      );
    }

    throw error;
  }
};

export const getValkey = (): Redis => {
  if (valkey) {
    return valkey;
  }

  const client = new Redis(env.VALKEY_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  });

  client.on("error", (error: Error) => {
    logger.error({ error }, "Valkey connection error");
  });

  valkey = client;

  return client;
};

export const pingValkey = async (): Promise<boolean> => {
  try {
    return (
      (await withValkeyCommandTimeout("PING", () => getValkey().ping())) ===
      "PONG"
    );
  } catch (error) {
    logger.warn({ error }, "Valkey health check failed");
    return false;
  }
};

export const closeValkey = async (): Promise<void> => {
  if (valkey) {
    await valkey.quit();
    valkey = null;
  }
};
