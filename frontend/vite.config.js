import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.API_PROXY_TARGET || "http://localhost:4000";

const proxy = {
  "/api": {
    target,
    changeOrigin: false,
  },
};

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy,
    headers: securityHeaders,
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy,
    headers: securityHeaders,
  },
});
