"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("khutbah", {
  getObsUrl: () => electron.ipcRenderer.invoke("obs:getUrl"),
  copyObsUrl: (url) => electron.ipcRenderer.invoke("obs:copyUrl", url),
  listDisplays: () => electron.ipcRenderer.invoke("displays:list"),
  openProjector: (displayId) => electron.ipcRenderer.invoke("projector:open", displayId),
  closeProjector: () => electron.ipcRenderer.invoke("projector:close"),
  isProjectorOpen: () => electron.ipcRenderer.invoke("projector:isOpen"),
  getInitialContent: () => electron.ipcRenderer.invoke("content:getInitial"),
  publishContent: (payload) => electron.ipcRenderer.send("content:update", payload),
  onContent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    electron.ipcRenderer.on("content:update", listener);
    return () => electron.ipcRenderer.removeListener("content:update", listener);
  },
  onProjectorStatus: (callback) => {
    const listener = (_event, isOpen) => callback(isOpen);
    electron.ipcRenderer.on("projector:status", listener);
    return () => electron.ipcRenderer.removeListener("projector:status", listener);
  },
  onDisplaysChanged: (callback) => {
    const listener = (_event, displays) => callback(displays);
    electron.ipcRenderer.on("displays:changed", listener);
    return () => electron.ipcRenderer.removeListener("displays:changed", listener);
  },
  loadSettings: () => electron.ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => electron.ipcRenderer.invoke("settings:save", settings),
  verifyApiKey: (apiKey) => electron.ipcRenderer.invoke("cloud:verifyKey", apiKey),
  processAudioSegment: (wavArrayBuffer, meta) => electron.ipcRenderer.invoke("cloud:processAudioSegment", wavArrayBuffer, meta),
  translateText: (arabicText) => electron.ipcRenderer.invoke("cloud:translateText", arabicText)
});
