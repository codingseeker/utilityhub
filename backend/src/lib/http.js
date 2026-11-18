export function sendData(response, data, status = 200) {
  response.status(status).json({ data, requestId: response.req.id });
}

export function asyncRoute(handler) {
  return function wrapped(request, response, next) {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}
