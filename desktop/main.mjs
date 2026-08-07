import { app, BrowserWindow, dialog, shell } from "electron";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createViewerServer } from "../server.mjs";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(desktopRoot);
const lockAcquired = app.requestSingleInstanceLock();

let viewerServer;
let mainWindow;
let shuttingDown = false;

if (!lockAcquired) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktopApp).catch(handleStartupError);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (!mainWindow) startDesktopApp().catch(handleStartupError);
  });

  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    closeViewerServer().finally(() => app.exit(0));
  });
}

async function startDesktopApp() {
  if (mainWindow) {
    mainWindow.show();
    return;
  }
  const options = desktopOptions(process.argv.slice(1));
  viewerServer = createViewerServer({
    ...options,
    host: "127.0.0.1",
    port: 0,
  });
  const port = await listenOnEphemeralPort(viewerServer);
  const url = `http://127.0.0.1:${port}/`;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: "Codex Trace Viewer",
    backgroundColor: "#101114",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  await mainWindow.loadURL(url);
  mainWindow.show();
}

function desktopOptions(argv) {
  const options = {
    traceRoot: process.env.CODEX_ROLLOUT_TRACE_ROOT || path.join(app.getPath("userData"), "traces"),
    dataRoot: process.env.CODEX_INSIGHTS_ROOT || path.join(app.getPath("userData"), "insights"),
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    codex: process.env.CODEX_TRACE_VIEWER_CODEX || "codex",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--trace-root") options.traceRoot = argv[++index];
    else if (value === "--data-root") options.dataRoot = argv[++index];
    else if (value === "--codex-home") options.codexHome = argv[++index];
    else if (value === "--codex") options.codex = argv[++index];
  }
  return {
    traceRoot: path.resolve(options.traceRoot),
    dataRoot: path.resolve(options.dataRoot),
    codexHome: path.resolve(options.codexHome),
    codex: options.codex,
  };
}

function listenOnEphemeralPort(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Electron 本地服务没有返回有效端口"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeViewerServer() {
  if (!viewerServer?.listening) return Promise.resolve();
  return new Promise((resolve) => viewerServer.close(resolve));
}

function handleStartupError(error) {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox("Codex Trace Viewer 无法启动", message);
  app.quit();
}
