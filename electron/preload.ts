import * as electron from "electron";

electron.contextBridge.exposeInMainWorld("mayfly", {
  openDirectory: () => electron.ipcRenderer.invoke("dialog:openDirectory") as Promise<string>,
  openExecutable: () => electron.ipcRenderer.invoke("dialog:openExecutable") as Promise<string>,
  openImage: () => electron.ipcRenderer.invoke("dialog:openImage") as Promise<string>,
  openArchive: () => electron.ipcRenderer.invoke("dialog:openArchive") as Promise<string[]>,
  openModSource: () => electron.ipcRenderer.invoke("dialog:openModSource") as Promise<string[]>,
  openJson: () => electron.ipcRenderer.invoke("dialog:openJson") as Promise<string>,
  saveJson: (defaultPath: string) =>
    electron.ipcRenderer.invoke("dialog:saveJson", defaultPath) as Promise<string>,
  saveFile: (options: {
    defaultPath: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => electron.ipcRenderer.invoke("dialog:saveFile", options) as Promise<string>,
  getPathForFile: (file: File) => electron.webUtils.getPathForFile(file),
  openPath: (targetPath: string) =>
    electron.ipcRenderer.invoke("shell:openPath", targetPath) as Promise<boolean>,
  openExternal: (targetUrl: string) =>
    electron.ipcRenderer.invoke("shell:openExternal", targetUrl) as Promise<boolean>,
  fileUrl: (targetPath: string) =>
    electron.ipcRenderer.invoke("shell:fileUrl", targetPath) as Promise<string>,
  launchExecutable: (options: {
    executablePath: string;
    cwd?: string;
    args?: string[];
  }) => electron.ipcRenderer.invoke("app:launchExecutable", options) as Promise<boolean>,
  openDevTools: () => electron.ipcRenderer.invoke("app:openDevTools") as Promise<void>,
  setLaunchAtStartup: (enabled: boolean) =>
    electron.ipcRenderer.invoke("app:setLaunchAtStartup", enabled) as Promise<boolean>,
  checkAppUpdate: (options: {
    updateUrl: string;
    currentVersion?: string;
    proxyUrl?: string;
  }) => electron.ipcRenderer.invoke("app:checkUpdate", options) as Promise<unknown>,
  readStore: <T>(fileName: string, fallback: T) =>
    electron.ipcRenderer.invoke("store:read", fileName, fallback) as Promise<T>,
  writeStore: (fileName: string, value: unknown) =>
    electron.ipcRenderer.invoke("store:write", fileName, value) as Promise<boolean>,
  exists: (targetPath: string) =>
    electron.ipcRenderer.invoke("fs:exists", targetPath) as Promise<boolean>,
  stat: (targetPath: string) =>
    electron.ipcRenderer.invoke("fs:stat", targetPath) as Promise<{
      isDirectory: boolean;
      size: number;
      mtimeMs: number;
    }>,
  remove: (targetPath: string) =>
    electron.ipcRenderer.invoke("fs:remove", targetPath) as Promise<boolean>,
  listFiles: (targetPath: string) =>
    electron.ipcRenderer.invoke("fs:listFiles", targetPath) as Promise<string[]>,
  readJsonFile: <T>(targetPath: string) =>
    electron.ipcRenderer.invoke("fs:readJsonFile", targetPath) as Promise<T>,
  writeJsonFile: (targetPath: string, value: unknown) =>
    electron.ipcRenderer.invoke("fs:writeJsonFile", targetPath, value) as Promise<boolean>,
  findFileByName: (options: {
    rootPath: string;
    fileNames: string[];
    maxDepth?: number;
  }) => electron.ipcRenderer.invoke("fs:findFileByName", options) as Promise<string>,
  findSteamGamePath: (steamAppId: number) =>
    electron.ipcRenderer.invoke("steam:findGamePath", steamAppId) as Promise<string>,
  startNexusOAuthLogin: (options?: { proxyUrl?: string }) =>
    electron.ipcRenderer.invoke("nexus:startOAuthLogin", options) as Promise<{
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      user: {
        key: string;
        name: string;
        email: string;
        profileUrl: string;
        avatar?: string;
        isPremium: boolean;
        isSupporter: boolean;
      };
    }>,
  cancelNexusOAuthLogin: () =>
    electron.ipcRenderer.invoke("nexus:cancelOAuthLogin") as Promise<boolean>,
  validateNexusApiKey: (options: string | { apiKey: string; proxyUrl?: string }) =>
    electron.ipcRenderer.invoke("nexus:validateApiKey", options) as Promise<unknown>,
  listNexusMods: (options: unknown) =>
    electron.ipcRenderer.invoke("nexus:listMods", options) as Promise<unknown>,
  getNexusModDetail: (options: unknown) =>
    electron.ipcRenderer.invoke("nexus:getModDetail", options) as Promise<unknown>,
  getNexusDownloadUrl: (options: unknown) =>
    electron.ipcRenderer.invoke("nexus:getDownloadUrl", options) as Promise<string>,
  translateText: (options: {
    text: string;
    provider: string;
    targetLang: "zh-CN";
    sourceLang?: string;
    proxyUrl?: string;
    baiduAppId?: string;
    baiduSecret?: string;
    youdaoAppKey?: string;
    youdaoSecret?: string;
    tencentSecretId?: string;
    tencentSecretKey?: string;
    tencentRegion?: string;
    volcengineAccessKeyId?: string;
    volcengineSecretAccessKey?: string;
    volcengineRegion?: string;
    ollamaBaseUrl?: string;
    ollamaModel?: string;
    ollamaTimeoutMs?: number;
  }) => electron.ipcRenderer.invoke("translate:text", options) as Promise<string>,
  downloadFile: (options: {
    taskId?: string;
    url: string;
    outputPath: string;
    resume?: boolean;
    proxyUrl?: string;
    engine?: "builtin" | "aria2";
    aria2ExecutablePath?: string;
    aria2MaxConnections?: number;
  }) => electron.ipcRenderer.invoke("downloads:downloadFile", options) as Promise<{
    outputPath: string;
    receivedBytes: number;
    totalBytes: number;
  }>,
  cancelDownload: (taskId: string) =>
    electron.ipcRenderer.invoke("downloads:cancel", taskId) as Promise<boolean>,
  onDownloadProgress: (callback: (data: { taskId: string; receivedBytes: number; totalBytes: number }) => void) => {
    electron.ipcRenderer.on("downloads:progress", (_event, data) => callback(data as any));
  },
  createBackupZip: (options: {
    sourcePath: string;
    outputPath: string;
  }) => electron.ipcRenderer.invoke("backups:createZip", options) as Promise<{
    outputPath: string;
    size: number;
    filesCount: number;
  }>,
  restoreBackupZip: (options: {
    backupPath: string;
    targetPath: string;
  }) => electron.ipcRenderer.invoke("backups:restoreZip", options) as Promise<boolean>,
  listBackupZip: (backupPath: string) =>
    electron.ipcRenderer.invoke("backups:listZip", backupPath) as Promise<Array<{
      path: string;
      isDirectory: boolean;
      size: number;
    }>>,
  exportGmm: (options: {
    mods: Array<{
      rootPath: string;
      folderName: string;
    }>;
    manifest: Record<string, unknown>;
    outputPath: string;
    operationId?: string;
  }) => electron.ipcRenderer.invoke("gmm:exportMods", options) as Promise<{
    outputPath: string;
    size: number;
  }>,
  onGmmProgress: (callback: (data: {
    operationId: string;
    operation: "import" | "export";
    phase: string;
    current: number;
    total: number;
    message: string;
  }) => void) => {
    electron.ipcRenderer.on("gmm:progress", (_event, data) => callback(data as {
      operationId: string;
      operation: "import" | "export";
      phase: string;
      current: number;
      total: number;
      message: string;
    }));
  },
  readGmmManifest: (packagePath: string) =>
    electron.ipcRenderer.invoke("gmm:readManifest", packagePath) as Promise<Record<string, unknown>>,
  importGamePack: (options: {
    packagePath: string;
    storagePath: string;
    gameName: string;
    overwrite?: boolean;
    operationId?: string;
  }) => electron.ipcRenderer.invoke("gmm:importGamePack", options) as Promise<{
    manifest: Record<string, unknown>;
    mods: Array<{ folder: string; rootPath: string; files: string[]; coverImage?: string }>;
  }>,
  importModFolder: (options: {
    sourcePath: string;
    storagePath: string;
    gameId: string;
    gameName?: string;
    modId: string;
  }) =>
    electron.ipcRenderer.invoke("mods:importFolder", options) as Promise<{
      rootPath: string;
      files: string[];
      coverImage?: string;
      manifest?: {
        name?: string;
        version?: string;
        author?: string;
        website?: string;
        description?: string;
        tags?: string[];
        requirements?: string[];
      };
    }>,
  copyModCoverImage: (options: {
    sourcePath: string;
    modRoot: string;
  }) => electron.ipcRenderer.invoke("mods:copyCoverImage", options) as Promise<{
    coverImage: string;
  }>,
  migrateModCoverImage: (options: {
    modRoot: string;
    coverImage: string;
  }) => electron.ipcRenderer.invoke("mods:migrateCoverImage", options) as Promise<{
    coverImage: string;
  }>,
  migrateModCacheFolder: (options: {
    sourcePath: string;
    storagePath: string;
    gameName: string;
    folderName: string;
  }) =>
    electron.ipcRenderer.invoke("mods:migrateCacheFolder", options) as Promise<{
      rootPath: string;
      files: string[];
      coverImage?: string;
      manifest?: {
        name?: string;
        version?: string;
        author?: string;
        website?: string;
        description?: string;
        tags?: string[];
        requirements?: string[];
      };
    }>,
  installMod: (options: {
    modRoot: string;
    gamePath: string;
    installPath: string;
  }) => electron.ipcRenderer.invoke("mods:install", options) as Promise<boolean>,
  uninstallMod: (options: {
    modRoot: string;
    gamePath: string;
    installPath: string;
  }) => electron.ipcRenderer.invoke("mods:uninstall", options) as Promise<boolean>,
  applyModStrategy: (options: {
    modRoot: string;
    gamePath: string;
    targetFolderName?: string;
    strategy: unknown;
    isInstall: boolean;
    useSymlink?: boolean;
    managedToolCandidates?: string[];
  }) => electron.ipcRenderer.invoke("mods:applyStrategy", options) as Promise<{
    deployedFiles: string[];
  }>,
  createInstallPlan: (options: {
    modRoot: string;
    gamePath: string;
    targetFolderName?: string;
    strategy: unknown;
    useSymlink?: boolean;
  }) => electron.ipcRenderer.invoke("mods:createInstallPlan", options) as Promise<{
    targetFiles: string[];
    conflicts: string[];
  }>,
  removeDeployedFiles: (options: {
    gamePath: string;
    deployedFiles: string[];
  }) => electron.ipcRenderer.invoke("mods:removeDeployedFiles", options) as Promise<boolean>,
  onNxmOpen: (handler: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => handler(url);
    electron.ipcRenderer.on("nxm:open", listener);

    return () => electron.ipcRenderer.removeListener("nxm:open", listener);
  }
});
