import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    cors: true,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        extension: "extension.html",
      },
    },
  },
});
