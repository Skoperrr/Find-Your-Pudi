import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function appShellPrecache(): Plugin {
  return {
    name: "pudi-app-shell-precache",
    apply: "build",
    generateBundle(_options, bundle) {
      // Enumerate actual hashed output, including lazy chunks; no hard-coded bundle names.
      const publicPaths = [
        "/index.html",
        "/offline.html",
        "/manifest.json",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/maskable-512.png",
      ];
      const emitted = Object.keys(bundle)
        .filter((name) => !name.endsWith(".map"))
        .map((name) => "/" + name);
      const urls = [...new Set([...publicPaths, ...emitted])];
      const hash = createHash("sha256");
      for (const item of Object.values(bundle))
        hash.update(item.type === "chunk" ? item.code : item.source);
      for (const name of ["sw.js", ...publicPaths.map((p) => p.slice(1))]) {
        hash.update(
          readFileSync(
            fileURLToPath(
              new URL(
                name === "index.html" ? "./index.html" : `./public/${name}`,
                import.meta.url,
              ),
            ),
          ),
        );
      }
      this.emitFile({
        type: "asset",
        fileName: "precache-manifest.js",
        source: `self.PUDI_PRECACHE=${JSON.stringify({ version: hash.digest("hex").slice(0, 16), urls })};`,
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), tailwindcss(), appShellPrecache()],
  server: { proxy: { "/api": { target: "http://127.0.0.1:8000", ws: true } } },
});
