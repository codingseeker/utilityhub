import { createLogger } from "./logger.js";
import { createAuthService } from "./auth.js";
import { createObjectStore } from "./storage/index.js";
import { createStore } from "./store/index.js";

export async function createContext(overrides = {}) {
  const store = overrides.store || (await createStore());
  const storage = overrides.storage || (await createObjectStore());
  const auth = overrides.auth || createAuthService();
  const logger = overrides.logger || createLogger("api");
  return { store, storage, auth, logger, ...overrides };
}
