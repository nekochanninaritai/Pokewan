import { resolve } from "node:path";
import { build } from "vite";

await build({
  base: "./",
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve("index.html"),
        online: resolve("online.html"),
      },
    },
  },
});
