import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.HUB_INTERNAL_URL ?? "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
