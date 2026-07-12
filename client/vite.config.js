import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// host: true lets you open the app from another device on your LAN.
// viteStaticCopy publishes MediaPipe's model/wasm files at /mediapipe/* so the
// virtual-background feature is fully self-hosted (no external CDN needed).
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@mediapipe/selfie_segmentation/*",
          dest: "mediapipe",
        },
      ],
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
