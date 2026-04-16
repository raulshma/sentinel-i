import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("maplibre-gl") ||
            id.includes("supercluster") ||
            id.includes("@turf")
          ) {
            return "vendor-map";
          }

          if (
            id.includes("react-dom") ||
            id.includes("react/") ||
            id.includes("scheduler")
          ) {
            return "vendor-react";
          }

          if (id.includes("socket.io-client")) {
            return "vendor-realtime";
          }

          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }

          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on("error", (err: unknown) => {
            if (
              typeof err === "object" &&
              err !== null &&
              "code" in err &&
              (err as { code?: string }).code === "ECONNABORTED"
            ) {
              return;
            }
          });
        },
      },
    },
  },
});
