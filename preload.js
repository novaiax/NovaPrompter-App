const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, message) => callback(message);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('nova', {
  openReader: () => ipcRenderer.invoke('reader:open'),
  readerCommand: action => ipcRenderer.invoke('reader:command', action),
  resizeReader: (action, axis) => ipcRenderer.send('reader:resize', { action, axis }),
  snapshot: () => ipcRenderer.invoke('reader:snapshot'),
  sync: message => ipcRenderer.send('reader:sync', message),
  onSync: callback => subscribe('reader:sync', callback),
  onReaderStatus: callback => subscribe('reader:status', callback),
  startSpeech: options => ipcRenderer.invoke('speech:start', options),
  seekSpeech: value => ipcRenderer.send('speech:seek', value),
  sendAudio: value => ipcRenderer.send('speech:audio', value),
  stopSpeech: id => ipcRenderer.send('speech:stop', id),
  onSpeech: callback => subscribe('speech:event', callback),
  importFiles: () => ipcRenderer.invoke('files:import'),
  exportFile: options => ipcRenderer.invoke('files:export', options),
  microphonePrivacy: () => ipcRenderer.invoke('microphone:privacy'),
  connectObs: options => ipcRenderer.invoke('obs:connect', options),
  setObsScene: scene => ipcRenderer.invoke('obs:scene', scene),
  disconnectObs: () => ipcRenderer.invoke('obs:disconnect'),
  onObsClose: callback => subscribe('obs:closed', callback)
});
