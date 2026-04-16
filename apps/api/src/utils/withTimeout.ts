export class OperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationTimeoutError";
  }
}

export const isOperationTimeoutError = (
  error: unknown,
): error is OperationTimeoutError => error instanceof OperationTimeoutError;

export const withPromiseTimeout = async <T>(
  timeoutMs: number,
  execute: () => Promise<T>,
  timeoutMessage?: string,
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return execute();
  }

  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      Promise.resolve().then(execute),
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new OperationTimeoutError(
              timeoutMessage ?? `Operation timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export const withTimeout = async <T>(
  timeoutMs: number,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await execute(controller.signal);
  } finally {
    clearTimeout(timeoutHandle);
  }
};
