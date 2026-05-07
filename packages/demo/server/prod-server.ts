import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createAtriumDemoApp } from "./createApp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, "../client");

const { app, handleViewerUpgrade } = createAtriumDemoApp();

app.use(express.static(clientDir, { index: false }));

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }
  if (req.path.startsWith("/atrium")) {
    next();
    return;
  }
  res.sendFile(path.join(clientDir, "index.html"));
});

const port = Number(process.env.PORT ?? "3333");
const server = createServer(app);

server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/atrium/sessions/")) return;
  handleViewerUpgrade(req, socket, head);
});

server.listen(port, () => {
  console.log(`[atrium-demo] production http://127.0.0.1:${port}`);
});
