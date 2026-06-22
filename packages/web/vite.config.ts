import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy API + WS to the Fastify server on :4420.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4420", changeOrigin: true, ws: true },
      "/healthz": "http://localhost:4420",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
