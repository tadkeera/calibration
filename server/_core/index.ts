import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  if (process.env.QC_STORAGE_MODE === "local") {
    const assetDirectory = process.env.QC_DESKTOP_ASSETS_DIR;
    if (assetDirectory) {
      const resolvedAssetDirectory = path.resolve(assetDirectory);
      app.get("/api/trpc/official-report-header", (_req, res) => {
        res.sendFile(path.join(resolvedAssetDirectory, "yemen-qc-official-report-header_14217543.png"));
      });
      app.use("/manus-storage", express.static(resolvedAssetDirectory, { fallthrough: false, maxAge: "7d" }));
    }
  } else {
    registerStorageProxy(app);
  }
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  const host = process.env.QC_LAN_HOST === "true" ? "0.0.0.0" : undefined;
  server.listen(port, host, () => {
    console.log(`Server running on http://${host ?? "localhost"}:${port}/`);
  });
}

startServer().catch(console.error);
