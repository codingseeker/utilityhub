import { config } from "../../config/env.js";
import { LocalObjectStore } from "./local.js";

let singleton = null;

export async function createObjectStore() {
  if (singleton) return singleton;
  if (config.storageDriver === "gcs") {
    const { GcsObjectStore } = await import("./gcs.js");
    singleton = new GcsObjectStore();
  } else {
    singleton = new LocalObjectStore();
  }
  await singleton.init();
  return singleton;
}

export function resetObjectStoreForTests() {
  singleton = null;
}
