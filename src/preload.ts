import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Exemple générique : invoquer une requête
  invoke: (channel: string, data?: any) => ipcRenderer.invoke(channel, data),

  // Exemple générique : écouter un événement
  on: (channel: string, callback: (event: any, ...args: any[]) => void) => {
    ipcRenderer.on(channel, (event, ...args) => callback(event, ...args));
  },

  // Exemple générique : envoyer un message
  send: (channel: string, data?: any) => ipcRenderer.send(channel, data)
});
