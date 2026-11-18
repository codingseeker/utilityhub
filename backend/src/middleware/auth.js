import { requireUser } from "../lib/auth.js";

export function attachUser(auth) {
  return async function attachUserMiddleware(request, _response, next) {
    try {
      request.user = await auth.verifyRequest(request);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export { requireUser };
