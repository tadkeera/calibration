#!/usr/bin/env node
/**
 * Produces a Vercel "Build Output API" (v3) bundle in .vercel/output:
 *
 *   .vercel/output/
 *     config.json                     routing table
 *     static/                         the Vite client build (dist/public)
 *     functions/api/index.func/       one Node.js serverless function that runs
 *       index.mjs                     the whole Express + tRPC API (self-contained bundle)
 *       .vc-config.json
 *
 * Run after `vite build` (see the "build:vercel" script in package.json).
 * Vercel picks up .vercel/output automatically when the build command creates it.
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(root, "dist", "public");
const outputDir = path.join(root, ".vercel", "output");
const staticDir = path.join(outputDir, "static");
const functionDir = path.join(outputDir, "functions", "api", "index.func");
const nodeRuntime = process.env.QC_VERCEL_NODE_RUNTIME || "nodejs22.x";

if (!fs.existsSync(path.join(clientDir, "index.html"))) {
  console.error(`[build-vercel] ${clientDir}/index.html not found. Run "vite build" first.`);
  process.exit(1);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(functionDir, { recursive: true });

// 1) Static client
fs.cpSync(clientDir, staticDir, { recursive: true });

// 2) Serverless API function (all dependencies bundled — no node_modules at runtime)
await build({
  entryPoints: [path.join(root, "server", "vercel", "handler.ts")],
  outfile: path.join(functionDir, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
  alias: {
    "@shared": path.join(root, "shared"),
    "@": path.join(root, "client", "src"),
  },
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: {
    js: [
      'import { createRequire as __qcCreateRequire } from "node:module";',
      "const require = __qcCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});

fs.writeFileSync(
  path.join(functionDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: nodeRuntime,
      handler: "index.mjs",
      launcherType: "Nodejs",
      // Express parses the body itself; Vercel's helpers would conflict with req.body.
      shouldAddHelpers: false,
      maxDuration: 30,
    },
    null,
    2
  )
);

// 3) Routing: static files first, API → function, everything else → SPA index.html
fs.writeFileSync(
  path.join(outputDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: "^/assets/(.*)$",
          headers: { "cache-control": "public, max-age=31536000, immutable" },
          continue: true,
        },
        { handle: "filesystem" },
        { src: "^/api(?:/.*)?$", dest: "/api/index" },
        { src: "^/manus-storage/(.*)$", dest: "/api/index" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2
  )
);

const size = (fs.statSync(path.join(functionDir, "index.mjs")).size / 1024 / 1024).toFixed(2);
console.log(`[build-vercel] .vercel/output ready (function bundle ${size} MB, runtime ${nodeRuntime})`);
