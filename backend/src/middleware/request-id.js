import crypto from "node:crypto";

const HEADER = "x-request-id";

export function requestId(request, response, next) {
  const incoming = request.get(HEADER);
  const id =
    incoming && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  request.id = id;
  response.setHeader(HEADER, id);
  next();
}
