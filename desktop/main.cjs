const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  Tray,
  ipcMain,
  clipboard,
  dialog,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { createApp } = require("../server.cjs");
const { credentialsPath } = require("../credentials.cjs");
const { appId, createDesktopSettings } = require("./settings.cjs");
const { ensureCloudflared } = require("./cloudflared.cjs");

const port = 18790;
const origin = `http://127.0.0.1:${port}`;
const home = pathToFileURL(path.join(__dirname, "ui", "index.html")).href;
const views = new Set(["requests", "tokens", "quota", "settings"]);
let window,
  dashboard,
  service,
  settings,
  tray,
  ready = false,
  error = "",
  active = "home",
  quitting = false;
let tunnel,
  downloadController,
  address = "",
  shareError = "",
  deadline;
let theme = "claude";
let startupError = "";

function status() {
  return {
    ready,
    error,
    active,
    address,
    sharing: Boolean(tunnel || downloadController),
    downloading: Boolean(downloadController),
    shareError,
    startup: settings.startup,
    startupError,
    autoShare: settings.autoShare,
    background: settings.background,
    version: app.getVersion(),
    records: service?.source?.history?.length || 0,
    sourceReady: service?.source?.meta?.history?.ok === true,
  };
}
function loginOptions() {
  return { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] };
}
function notify() {
  if (window && !window.isDestroyed())
    window.webContents.send("borad:update", status());
}
function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function createTray() {
  if (tray) return;
  const icon = app.isPackaged
    ? path.join(process.resourcesPath, "borad.ico")
    : path.join(__dirname, "..", "assets", "borad.ico");
  const created = new Tray(icon);
  created.setToolTip("Borad");
  created.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 Borad", click: showWindow },
    { type: "separator" },
    { label: "退出 Borad", click: () => app.quit() },
  ]));
  created.on("click", showWindow);
  tray = created;
}
function secure(contents, allowed) {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });
  contents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
}
function resize() {
  if (!dashboard || active === "home") return;
  const [width, height] = window.getContentSize();
  dashboard.setBounds({ x: 0, y: 64, width, height: Math.max(0, height - 64) });
}
async function navigate(view) {
  if (view === "home") {
    if (dashboard) dashboard.setVisible(false);
    active = view;
    window.webContents.focus();
  } else {
    if (!ready || !views.has(view)) throw new Error("数据服务尚未就绪");
    if (!dashboard) {
      dashboard = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, "dashboard-preload.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: "persist:borad-dashboard",
        },
      });
      secure(dashboard.webContents, (url) => new URL(url).origin === origin);
      dashboard.webContents.on("did-navigate-in-page", (_event, url) => {
        const view = new URL(url).hash.slice(1);
        if (active !== "home" && views.has(view)) {
          active = view;
          notify();
        }
      });
      window.contentView.addChildView(dashboard);
    }
    await dashboard.webContents.session.cookies.set({
      url: origin,
      name: "_mpr",
      value: service.createDesktopSession(),
      httpOnly: true,
      sameSite: "strict",
    });
    active = view;
    resize();
    dashboard.setVisible(true);
    await dashboard.webContents.loadURL(
      `${origin}/?desktop=1&theme=${theme}#${view}`,
    );
    dashboard.webContents.focus();
  }
  notify();
}
function stopShare() {
  clearTimeout(deadline);
  if (downloadController) downloadController.abort();
  downloadController = null;
  const child = tunnel;
  tunnel = null;
  address = "";
  if (child) child.kill();
  notify();
}
async function startShare() {
  if (tunnel || downloadController || !ready) return;
  shareError = "";
  const controller = new AbortController();
  downloadController = controller;
  notify();
  let binary;
  try {
    binary = await ensureCloudflared({
      directory: path.join(app.getPath("userData"), "components"),
      signal: controller.signal,
      candidates: [
        path.join(process.resourcesPath, "cloudflared.exe"),
        path.join(__dirname, "bin", "cloudflared.exe"),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "cloudflared.exe"),
      ].filter(Boolean),
    });
  } catch (cause) {
    if (downloadController === controller) {
      downloadController = null;
      shareError = `公网组件下载失败：${cause.message}。请检查网络后重试。`;
      notify();
    }
    return;
  }
  if (downloadController !== controller || quitting) return;
  downloadController = null;
  const child = spawn(binary, ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", origin], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  tunnel = child;
  let buffer = "", candidate = "", registered = false;
  const fail = (message) => {
    if (tunnel === child) {
      shareError = message;
      stopShare();
    }
  };
  deadline = setTimeout(
    () => fail("未能建立公网连接，请检查网络后重试。"),
    60000,
  );
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (child !== tunnel || address) return;
    buffer = (buffer + chunk).slice(-8192);
    const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=[\s|])/i.exec(
      buffer,
    );
    if (match) candidate = match[0];
    if (buffer.includes("Registered tunnel connection")) registered = true;
    if (candidate && registered) {
      address = candidate;
      clearTimeout(deadline);
      notify();
    }
  });
  child.on("error", () => fail("分享组件启动失败，请重新安装 Borad。"));
  child.on("exit", () => fail("公网连接已关闭，可以重新开启。"));
  notify();
}
function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== home
    )
      throw new Error("请求来源无效");
    return callback(...args);
  });
}
async function launch() {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId(appId);
  settings = createDesktopSettings({
    directory: app.getPath("userData"),
    loginOptions: loginOptions(),
    getLogin: options => app.getLoginItemSettings(options),
    setLogin: options => app.setLoginItemSettings(options),
  });
  try { settings.restoreStartup(); } catch { startupError = "未能恢复开机启动，请在首页重新设置。"; }
  window = new BrowserWindow({
    width: 1160,
    height: 900,
    minWidth: 640,
    minHeight: 520,
    backgroundColor: "#f7f5f0",
    title: "Borad · 用量工作台",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f7f5f0", symbolColor: "#343a34", height: 48 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  secure(window.webContents, (url) => url === home);
  if (settings.background) {
    try { createTray(); } catch { startupError = "系统托盘初始化失败，关闭窗口将退出程序。"; }
  }
  handle("borad:state", status);
  handle("borad:open", navigate);
  handle("borad:share", (enabled) => {
    if (enabled === true) void startShare();
    else stopShare();
    return status();
  });
  handle("borad:copy", () => {
    if (!address) throw new Error("分享地址尚未就绪");
    clipboard.writeText(address);
  });
  ipcMain.on("borad:dashboard-home", (event) => {
    if (dashboard && event.sender === dashboard.webContents && event.senderFrame === dashboard.webContents.mainFrame && new URL(event.senderFrame.url).origin === origin) navigate("home");
  });
  handle("borad:startup", (enabled) => {
    settings.setStartup(enabled);
    startupError = "";
    return status();
  });
  handle("borad:auto-share", enabled => {
    settings.setAutoShare(enabled);
    return status();
  });
  handle("borad:background", enabled => {
    if (enabled === true) createTray();
    settings.setBackground(enabled);
    if (enabled !== true && tray) {
      tray.destroy();
      tray = null;
    }
    return status();
  });
  handle("borad:theme", (value) => {
    const colors = {
      claude: ["#f7f5f0", "#343a34"],
      github: ["#f6f8fa", "#253044"],
      google: ["#f5f8ff", "#25364e"],
      forest: ["#f4f7f1", "#273d33"],
    };
    if (!Object.hasOwn(colors, value)) throw new Error("未知主题");
    theme = value;
    if (dashboard && !dashboard.webContents.isDestroyed())
      dashboard.webContents.send("borad:dashboard-theme", value);
    window.setTitleBarOverlay({
      color: colors[value][0],
      symbolColor: colors[value][1],
      height: 48,
    });
  });
  window.on("resize", resize);
  window.on("close", event => {
    if (!quitting && settings.background && tray) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (dashboard && !dashboard.webContents.isDestroyed())
      dashboard.webContents.close();
    app.quit();
  });
  await window.loadURL(home);
  if (quitting || window.isDestroyed()) return;
  service = createApp({
    port,
    password: "jbc",
    credentialsFile: credentialsPath(),
    publicHost: () => (address ? new URL(address).host : null),
  });
  try {
    await service.start();
    ready = true;
  } catch (cause) {
    error =
      cause.code === "EADDRINUSE"
        ? `端口 ${port} 正在使用，请关闭占用程序并重新打开 Borad。`
        : "本机数据服务启动失败，请重新打开 Borad。";
  }
  notify();
  if (ready && !quitting) {
    if (settings.autoShare) void startShare();
    await navigate("requests");
  }
}
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", () => {
    showWindow();
  });
  app.on("before-quit", () => {
    quitting = true;
    stopShare();
    if (ready) {
      ready = false;
      service.stop();
    }
  });
  app
    .whenReady()
    .then(launch)
    .catch((cause) => {
      if (!quitting) dialog.showErrorBox("Borad 启动失败", cause.message);
      app.quit();
    });
} else app.quit();
