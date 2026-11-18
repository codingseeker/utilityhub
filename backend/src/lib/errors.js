export class AppError extends Error {
  constructor(code, status, message, details = undefined, options = {}) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

export class ProcessingError extends Error {
  constructor(code, publicMessage, { cause, retryable = false, internal = null } = {}) {
    super(internal || publicMessage, cause ? { cause } : undefined);
    this.name = "ProcessingError";
    this.code = code;
    this.publicMessage = publicMessage;
    this.retryable = retryable;
  }
}

export class LeaseLostError extends Error {
  constructor() {
    super("The job lease was lost.");
    this.name = "LeaseLostError";
    this.code = "LEASE_LOST";
    this.retryable = true;
  }
}

export function toPublicError(error, fallback = "The request could not be completed.") {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      status: error.status,
    };
  }
  return { code: "INTERNAL_ERROR", message: fallback, status: 500 };
}
