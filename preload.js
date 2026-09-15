const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),

  // Data
  loadDevices:  () => ipcRenderer.invoke('devices:load'),
  loadProfiles: () => ipcRenderer.invoke('profiles:load'),
  saveProfiles: (p) => ipcRenderer.invoke('profiles:save', p),
  deleteProfile: (id) => ipcRenderer.invoke('profile:delete', id),
  clearProfileCache: (id) => ipcRenderer.invoke('profile:clearCache', id),
  showConfirm: (opts) => ipcRenderer.invoke('dialog:confirm', opts),

  // Browser
  launchBrowser: (profile) => ipcRenderer.invoke('browser:launch', profile),
  closeBrowser:  (id)      => ipcRenderer.invoke('browser:close', id),
  getBrowserStatus: ()     => ipcRenderer.invoke('browser:status'),
  arrangeWindows: (opts)   => ipcRenderer.invoke('browser:arrangeWindows', opts),
  getDisplays: ()          => ipcRenderer.invoke('displays:get'),

  // Extensions
  loadExtensions:  () => ipcRenderer.invoke('extensions:load'),
  saveExtensions:  (exts) => ipcRenderer.invoke('extensions:save', exts),
  selectExtension: () => ipcRenderer.invoke('extensions:select'),

  // Settings
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),

  // Supabase Auth & Cloud Sync
  supabaseGetConfig:      ()            => ipcRenderer.invoke('supabase:getConfig'),
  supabaseSaveConfig:     (cfg)         => ipcRenderer.invoke('supabase:saveConfig', cfg),
  supabaseTestConnection: (cfg)         => ipcRenderer.invoke('supabase:testConnection', cfg),
  authLoginWithPin:       (pin)         => ipcRenderer.invoke('auth:loginWithPin', pin),
  authSignUp:             (email, pass) => ipcRenderer.invoke('auth:signUp', email, pass),
  authSignIn:             (email, pass) => ipcRenderer.invoke('auth:signIn', email, pass),
  authSignOut:            ()            => ipcRenderer.invoke('auth:signOut'),
  authGetSession:         ()            => ipcRenderer.invoke('auth:getSession'),
  syncPullProfiles:       ()            => ipcRenderer.invoke('sync:pullProfiles'),
  syncPushProfiles:       ()            => ipcRenderer.invoke('sync:pushProfiles'),
  syncProfileCookies:     (id)          => ipcRenderer.invoke('cookies:syncProfile', id),
  syncAllCookies:         ()            => ipcRenderer.invoke('cookies:syncAll'),

  // Utilities
  saveScript: (data) => ipcRenderer.invoke('script:save', data),
  openUrl:    (url)  => ipcRenderer.send('shell:open', url),
  getAppInfo: ()     => ipcRenderer.invoke('app:info'),

  // Hot-Patch OTA Updater
  updaterGetPatchInfo: ()          => ipcRenderer.invoke('updater:getPatchInfo'),
  updaterCheckPatch:   (customUrl) => ipcRenderer.invoke('updater:checkPatch', customUrl),
  updaterApplyPatch:   (patchData) => ipcRenderer.invoke('updater:applyPatch', patchData),
  updaterRelaunch:     ()          => ipcRenderer.invoke('updater:relaunch'),
  updaterResetPatches: ()          => ipcRenderer.invoke('updater:resetPatches'),

  // Trash Bin (Thùng Rác)
  trashList:    ()   => ipcRenderer.invoke('trash:list'),
  trashRestore: (id) => ipcRenderer.invoke('trash:restore', id),
  trashDelete:  (id) => ipcRenderer.invoke('trash:delete', id),
  trashClear:   ()   => ipcRenderer.invoke('trash:clear'),

  // Proxy Check
  proxyCheck: (cfg) => ipcRenderer.invoke('proxy:check', cfg),

  // API Server events - tu reload khi profile duoc tao/xoa qua HTTP API
  onProfilesReload: (callback) => ipcRenderer.on('profiles:reload', () => callback()),
});
