const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("miayarDesktop", { configure: (config) => ipcRenderer.invoke("desktop:configure", config) });
