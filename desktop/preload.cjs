const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("borad", {
  state: () => ipcRenderer.invoke("borad:state"),
  open: (view) => ipcRenderer.invoke("borad:open", view),
  share: (enabled) => ipcRenderer.invoke("borad:share", enabled),
  startup: (enabled) => ipcRenderer.invoke("borad:startup", enabled),
  autoShare: (enabled) => ipcRenderer.invoke("borad:auto-share", enabled),
  configurePush: (options) => ipcRenderer.invoke("borad:configure-push", options),
  clearPush: () => ipcRenderer.invoke("borad:clear-push"),
  sendLink: () => ipcRenderer.invoke("borad:send-link"),
  copy: () => ipcRenderer.invoke("borad:copy"),
  theme: (theme) => ipcRenderer.invoke("borad:theme", theme),
  subscribe: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("borad:update", handler);
    return () => ipcRenderer.removeListener("borad:update", handler);
  },
});
