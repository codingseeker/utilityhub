import { config } from "../config/env.js";
import { AppError, toPublicError } from "../lib/errors.js";

export function notFoundHandler(request, _response, next) {
  next(new AppError("NOT_FOUND", 404, "The requested resource was not found."));
}

export function errorHandler(error, request, response, _next) {
  const publicError = toPublicError(error);
  const status = publicError.status || 500;

  if (status >= 500) {
    request.log?.error({ err: error }, "request failed");
  } else if (!config.isTest) {
    request.log?.warn({ code: publicError.code }, "request rejected");
  }

  const body = {
    error: {
      code: publicError.code,
      message: publicError.message,
      ...(publicError.details ? { details: publicError.details } : {}),
    },
    requestId: request.id,
  };

  if (config.nodeEnv === "development" && status >= 500 && error?.stack) {
    body.error.stack = error.stack;
  }

  response.status(status).json(body);
}
