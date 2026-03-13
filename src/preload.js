'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Typed, minimal bridge — only expose what the UI needs
contextBridge.exposeInMainWorld('ss', {

  scale: {
    listPorts:    ()      => ipcRenderer.invoke('scale:list-ports'),
    connect:      (port)  => ipcRenderer.invoke('scale:connect',     { portPath: port }),
    disconnect:   ()      => ipcRenderer.invoke('scale:disconnect'),
    tare:         ()      => ipcRenderer.invoke('scale:tare'),
    zero:         ()      => ipcRenderer.invoke('scale:zero'),
    print:        ()      => ipcRenderer.invoke('scale:print'),
    lastPort:     ()      => ipcRenderer.invoke('scale:last-port'),
    // event listeners
    onData:         cb => ipcRenderer.on('scale:data',         (_, d) => cb(d)),
    onError:        cb => ipcRenderer.on('scale:error',        (_, m) => cb(m)),
    onDisconnected: cb => ipcRenderer.on('scale:disconnected', ()     => cb()),
    offAll: () => {
      ipcRenderer.removeAllListeners('scale:data');
      ipcRenderer.removeAllListeners('scale:error');
      ipcRenderer.removeAllListeners('scale:disconnected');
    }
  },

  db: {
    getProducts:       search  => ipcRenderer.invoke('db:get-products',       search),
    upsertProducts:    prods   => ipcRenderer.invoke('db:upsert-products',    prods),
    updateWeight:      payload => ipcRenderer.invoke('db:update-product-weight', payload),
    getProductCount:   ()      => ipcRenderer.invoke('db:get-product-count'),
    getTares:          ()      => ipcRenderer.invoke('db:get-tares'),
    addTare:           tare    => ipcRenderer.invoke('db:add-tare',           tare),
    createSession:     s       => ipcRenderer.invoke('db:create-session',     s),
    getSessions:       ()      => ipcRenderer.invoke('db:get-sessions'),
    getSession:        id      => ipcRenderer.invoke('db:get-session',        id),
    completeSession:   id      => ipcRenderer.invoke('db:complete-session',   { session_id: id }),
    saveItem:          item    => ipcRenderer.invoke('db:save-item',          item),
    getSessionItems:   id      => ipcRenderer.invoke('db:get-session-items',  id),
    markPushed:        id      => ipcRenderer.invoke('db:mark-pushed',        id),
    markItemPushed:    payload => ipcRenderer.invoke('db:mark-item-pushed',   payload),
    saveCalibration:   rec     => ipcRenderer.invoke('db:save-calibration',   rec),
    getCalibrations:   ()      => ipcRenderer.invoke('db:get-calibrations'),
  },

  settings: {
    getAll:   ()        => ipcRenderer.invoke('settings:get-all'),
    get:      key       => ipcRenderer.invoke('settings:get',      key),
    set:      (key,val) => ipcRenderer.invoke('settings:set',      { key, val }),
    setMany:  obj       => ipcRenderer.invoke('settings:set-many', obj),
    delete:   key       => ipcRenderer.invoke('settings:delete',   key),
  },

  report: {
    saveCsv: (filename, csv) => ipcRenderer.invoke('report:save-csv', { filename, csv }),
  }
});
