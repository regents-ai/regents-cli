export class RegentError extends Error {
  readonly code: string;
  override readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, withCause(cause));
    this.name = new.target.name;
    this.code = code;
    this.cause = cause;
  }
}

const withCause = (cause: unknown): ErrorOptions | undefined => (cause === undefined ? undefined : { cause });

const messageFromUnknown = (error: { message?: unknown }): string | null =>
  typeof error.message === "string" ? error.message : null;

export class ConfigError extends RegentError {
  constructor(message: string, cause?: unknown) {
    super("config_error", message, cause);
  }
}

export class AuthError extends RegentError {
  readonly status?: number;

  constructor(code: string, message: string, cause?: unknown, options?: { status?: number }) {
    super(code, message, cause);
    this.status = options?.status;
  }
}

export class TechtreeApiError extends RegentError {
  readonly status?: number;
  readonly payload?: unknown;

  constructor(message: string, options?: { code?: string; status?: number; payload?: unknown; cause?: unknown }) {
    super(options?.code ?? "techtree_api_error", message, options?.cause);
    this.status = options?.status;
    this.payload = options?.payload;
  }
}

export class JsonRpcError extends RegentError {
  readonly rpcCode?: number;

  constructor(message: string, options?: { code?: string; rpcCode?: number; cause?: unknown }) {
    super(options?.code ?? "jsonrpc_error", message, options?.cause);
    this.rpcCode = options?.rpcCode;
  }
}

export class DoctorInternalError extends RegentError {
  constructor(message: string, cause?: unknown) {
    super("doctor_internal_error", message, cause);
  }
}

export class CommandExitError extends RegentError {
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, exitCode: number, options?: { cause?: unknown; details?: unknown }) {
    super(code, message, options?.cause);
    this.exitCode = exitCode;
    this.details = options?.details;
  }
}

export class NotImplementedYetError extends RegentError {
  constructor(message: string) {
    super("not_implemented_yet", message);
  }
}

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error
  ) {
    return messageFromUnknown(error as { message?: unknown }) ?? "unknown error";
  }

  return "unknown error";
};
