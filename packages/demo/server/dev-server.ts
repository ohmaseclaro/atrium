import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer as createViteServer } from "vite";
import { createAtriumDemoApp } from "./createApp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(__dirname, "..");

const { app, handleViewerUpgrade } = createAtriumDemoApp();

const vite = await createViteServer({
  configFile: false,
  root: path.join(demoRoot, "client"),
  server: { middlewareMode: true },
  appType: "spa",
  plugins: [react()],
  build: { outDir: path.join(demoRoot, "dist/client") },
});

app.use(vite.middlewares);

const port = Number(process.env.PORT ?? "3333");
const server = createServer(app);

server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/atrium/sessions/")) return;
  handleViewerUpgrade(req, socket, head);
});

server.listen(port, () => {
  console.log(`[atrium-demo] http://127.0.0.1:${port}`);
});
