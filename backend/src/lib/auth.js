import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { OAuth2Client } from "google-auth-library";
import { config } from "../config/env.js";
import { AppError } from "./errors.js";

let firebaseReady = false;

function ensureFirebase() {
  if (firebaseReady) return;
  if (config.firebaseAuthEmulatorHost) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = config.firebaseAuthEmulatorHost;
  }
  if (getApps().length === 0) {
    initializeApp({
      projectId: config.gcpProjectId,
      credential: applicationDefault(),
    });
  }
  firebaseReady = true;
}

function bearerToken(request) {
  const header = request.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

export class AuthService {
  constructor() {
    this.mode = config.authMode;
    this.oidc = new OAuth2Client();
  }

  async verifyRequest(request) {
    if (this.mode === "dev") {
      // Development-only identity. Production startup refuses AUTH_MODE=dev.
      const uid = request.get("x-dev-user");
      if (!uid || !/^[A-Za-z0-9._:-]{1,128}$/.test(uid)) {
        return null;
      }
      return {
        uid,
        email: `${uid}@dev.utilityhub.local`,
        displayName: `Dev ${uid}`,
        photoURL: null,
        dev: true,
      };
    }

    const token = bearerToken(request);
    if (!token) return null;
    ensureFirebase();
    try {
      const decoded = await getAuth().verifyIdToken(token, true);
      return {
        uid: decoded.uid,
        email: decoded.email || null,
        displayName: decoded.name || null,
        photoURL: decoded.picture || null,
        emailVerified: Boolean(decoded.email_verified),
        dev: false,
      };
    } catch {
      return null;
    }
  }

  async verifyWorkerRequest(request) {
    if (this.mode === "dev") {
      if (config.worker.sharedSecret) {
        const provided = request.get("x-worker-secret") || "";
        if (provided !== config.worker.sharedSecret) {
          throw new AppError("FORBIDDEN", 403, "The worker credential is invalid.");
        }
      }
      return { service: "worker-dev" };
    }

    const token = bearerToken(request);
    if (!token || !config.worker.url) {
      throw new AppError("FORBIDDEN", 403, "The worker credential is invalid.");
    }
    if (config.worker.sharedSecret) {
      const provided = request.get("x-worker-secret") || "";
      if (provided !== config.worker.sharedSecret) {
        throw new AppError("FORBIDDEN", 403, "The worker credential is invalid.");
      }
    }

    try {
      const ticket = await this.oidc.verifyIdToken({
        idToken: token,
        audience: config.worker.url,
      });
      return ticket.getPayload();
    } catch {
      throw new AppError("FORBIDDEN", 403, "The worker credential is invalid.");
    }
  }
}

export function requireUser(request, _response, next) {
  if (!request.user) {
    next(new AppError("UNAUTHORIZED", 401, "Sign in to use cloud tools."));
    return;
  }
  next();
}

export function createAuthService() {
  return new AuthService();
}
