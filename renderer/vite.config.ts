import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { copyFileSync, existsSync, mkdirSync } from "fs";

// Plugin to copy static files that aren't processed by Vite
const copyStaticFiles = () => ({
  name: "copy-static-files",
  closeBundle() {
    const destDir = path.resolve(__dirname, "..", "dist", "renderer");
    const captureHtmlSrc = path.resolve(__dirname, "capture.html");
    const captureHtmlDest = path.resolve(destDir, "capture.html");

    if (existsSync(captureHtmlSrc)) {
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }
      copyFileSync(captureHtmlSrc, captureHtmlDest);
      console.log("Copied capture.html to dist/renderer");
    }
  },
});

export default defineConfig({
  root: path.resolve(__dirname),
  envDir: path.resolve(__dirname, ".."),
  // Ensure built asset URLs are relative so Electron can load them from file://
  base: "./",
  plugins: [react(), copyStaticFiles()],
  build: {
    outDir: path.resolve(__dirname, "..", "dist", "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          markdown: [
            "react-markdown",
            "remark-gfm",
            "react-syntax-highlighter",
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
