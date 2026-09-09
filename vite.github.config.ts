import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "static-pages",
  base: "/pandemicatlas/",
  publicDir: "../public",
  plugins: [react()],
  define: {
    __ATLAS_BASE_PATH__: JSON.stringify("/pandemicatlas/"),
  },
  build: {
    outDir: "../dist-github",
    emptyOutDir: true,
  },
});
