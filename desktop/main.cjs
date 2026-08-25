const { app, BrowserWindow, Menu, ipcMain, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LAN_PORT = 3010;
let mainWindow = null;
let localServer = null;

function configPath() { return path.join(app.getPath("userData"), "desktop-settings.json"); }
function readConfig() { try { return JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { return null; } }
function writeConfig(config) { fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8"); }
function applicationServerPath() { return path.join(__dirname, "..", "dist", "index.js"); }
function offlineAssetsPath() { return app.isPackaged ? path.join(process.resourcesPath, "offline-assets") : path.resolve(__dirname, "../../desktop-assets"); }
function localhostUrl() { return `http://127.0.0.1:${LAN_PORT}`; }

function startHost(config) {
  if (localServer) return Promise.resolve(localhostUrl());
  return new Promise((resolve, reject) => {
    const environment = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --experimental-sqlite`.trim(),
      NODE_ENV: "production",
      QC_STORAGE_MODE: "local",
      QC_LAN_HOST: "true",
      PORT: String(LAN_PORT),
      QC_LOCAL_DB_PATH: path.join(app.getPath("userData"), "miayar-offline.sqlite"),
      QC_DESKTOP_ASSETS_DIR: offlineAssetsPath(),
      QC_INITIAL_ADMIN_PASSWORD: config.initialAdminPassword,
    };
    const server = spawn(process.execPath, [applicationServerPath()], { env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    localServer = server;
    let settled = false;
    let startupTimer = null;
    const fail = (reason) => {
      if (settled) return;
      settled = true;
      if (startupTimer) clearTimeout(startupTimer);
      if (localServer === server) localServer = null;
      if (!server.killed) server.kill();
      reject(new Error(reason));
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      if (startupTimer) clearTimeout(startupTimer);
      resolve(localhostUrl());
    };
    server.once("error", (error) => fail(error.message));
    server.once("exit", (code, signal) => {
      if (!settled) fail(`تعذر تشغيل المضيف المحلي (رمز الخروج: ${code ?? "غير معروف"}${signal ? `، الإشارة: ${signal}` : ""}).`);
      if (localServer === server) localServer = null;
    });
    server.stderr.on("data", (chunk) => console.error("[Miayar offline host]", chunk.toString()));
    server.stdout.on("data", (chunk) => {
      const output = chunk.toString();
      console.log("[Miayar offline host]", output.trim());
      if (output.includes("Server running on")) succeed();
    });
    startupTimer = setTimeout(() => fail("انتهت مهلة انتظار بدء المضيف المحلي."), 12_000);
  });
}

async function loadConfiguredApp(config) {
  if (!config) return mainWindow.loadFile(path.join(__dirname, "launcher.html"));
  if (config.mode === "host") return mainWindow.loadURL(await startHost(config));
  return mainWindow.loadURL(config.hostUrl);
}

function openWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    title: "مِعيار — نظام التحقق المخبري",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  loadConfiguredApp(readConfig()).catch(error => {
    dialog.showErrorBox("تعذر تشغيل مِعيار", error.message);
    mainWindow.loadFile(path.join(__dirname, "launcher.html"));
  });
}

ipcMain.handle("desktop:configure", async (_event, request) => {
  if (!request || !["host", "client"].includes(request.mode)) throw new Error("Invalid desktop mode.");
  const config = request.mode === "host"
    ? { mode: "host", initialAdminPassword: String(request.initialAdminPassword || "") }
    : { mode: "client", hostUrl: String(request.hostUrl || "").replace(/\/$/, "") };
  if (config.mode === "host" && config.initialAdminPassword.length < 8) throw new Error("اختر كلمة مرور مدير مكونة من 8 أحرف على الأقل.");
  if (config.mode === "client" && !/^http:\/\/(?:[\w.-]+)(?::\d+)?$/.test(config.hostUrl)) throw new Error("أدخل عنوان المضيف الداخلي بصيغة http://192.168.x.x:3010");
  writeConfig(config);
  await loadConfiguredApp(config);
  return { success: true };
});

function desktopMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "مِعيار", submenu: [
    { label: "إعداد اتصال الشبكة", click: () => { fs.rmSync(configPath(), { force: true }); mainWindow.loadFile(path.join(__dirname, "launcher.html")); } },
    { type: "separator" }, { role: "quit", label: "خروج" },
  ] }]));
}

app.whenReady().then(() => { desktopMenu(); openWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (localServer) localServer.kill(); });
