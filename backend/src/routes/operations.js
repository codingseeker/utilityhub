import { Router } from "express";
import { operationsPayload } from "../lib/services/jobs.js";
import { sendData } from "../lib/http.js";

export function createOperationsRouter() {
  const router = Router();
  router.get("/", (request, response) => {
    sendData(response, operationsPayload());
  });
  return router;
}
