import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ["../.."] } },
  resolve: { dedupe: ["react", "react-dom", "decimal.js", "zod"] },
});
