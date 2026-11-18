import { config } from "../../config/env.js";
import { MemoryStore } from "./memory.js";

let singleton = null;

export async function createStore() {
  if (singleton) return singleton;
  if (config.dbDriver === "firestore") {
    const { FirestoreStore } = await import("./firestore.js");
    singleton = new FirestoreStore();
  } else {
    singleton = new MemoryStore();
  }
  await singleton.init();
  return singleton;
}

export function resetStoreForTests() {
  singleton = null;
}
