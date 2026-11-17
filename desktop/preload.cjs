const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("borad", {
  state: () => ipcRenderer.invoke("borad:state"),
  open: (view) => ipcRenderer.invoke("borad:open", view),
  share: (enabled) => ipcRenderer.invoke("borad:share", enabled),
  startup: (enabled) => ipcRenderer.invoke("borad:startup", enabled),
  autoShare: (enabled) => ipcRenderer.invoke("borad:auto-share", enabled),
  background: (enabled) => ipcRenderer.invoke("borad:background", enabled),
  copy: () => ipcRenderer.invoke("borad:copy"),
  theme: (theme) => ipcRenderer.invoke("borad:theme", theme),
  subscribe: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("borad:update", handler);
    return () => ipcRenderer.removeListener("borad:update", handler);
  },
});
