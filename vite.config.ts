import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use the PORT environment variable provided by the platform, or default to 5173
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5173;

// The backend server will run on a fixed port
const backendPort = 3002;

export default defineConfig(async () => ({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    // These plugins are only used in development on Replit, so we can conditionally import them
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          (await import("@replit/vite-plugin-cartographer")).cartographer(),
          (await import("@replit/vite-plugin-dev-banner")).devBanner(),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    // Run on the port specified by the environment variable
    port: port,
    // Listen on all network interfaces, which is required for previews to work
    host: "0.0.0.0",
    proxy: {
      // Proxy API requests to the backend server
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
}));
