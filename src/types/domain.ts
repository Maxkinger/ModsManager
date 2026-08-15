export interface ManagedGame {
  id: string;
  presetId: string;
  glossGameId: number;
  steamAppId: number;
  nexusDomain: string;
  nexusGameId: number;
  name: string;
  path: string;
  installPath: string;
  launchArgs: string;
  exeNames: string[];
  coverUrl: string;
  typeNames: string[];
  customAdapterRules: CustomAdapterRule[];
  adapterStatus: "catalogued" | "implemented" | "custom";
  createdAt: number;
}

export type InstallTargetScope = "game" | "documents" | "appData";

export type InstallStrategy =
  | {
      kind: "general";
      installPath: string;
      keepPath?: boolean;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "folder";
      installPath: string;
      folderName: string | string[];
      include?: boolean;
      spare?: boolean;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "folderRoot";
      installPath: string;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "file";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      commonParent?: boolean;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "fileSibling";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      pass?: string[];
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "fileOnly";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "folderParent";
      installPath: string;
      folderName: string | string[];
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "fileMap";
      installPath: string;
      dictionaryFile: string;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "fileIntoParentFolder";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      requireParent?: boolean;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "bethesdaData";
      installPath: string;
      folderName: string | string[];
      documentsGameFolder: string;
      iniFileName: string;
      localAppDataGameFolder: string;
      pluginsHeader?: string;
      updateGeneralTestFiles?: boolean;
    }
  | {
      kind: "bethesdaPluginFiles";
      installPath: string;
      documentsGameFolder: string;
      iniFileName: string;
      localAppDataGameFolder: string;
      pluginsHeader?: string;
      updateGeneralTestFiles?: boolean;
    }
  | {
      kind: "oblivionPlugins";
      installPath: string;
    }
  | {
      kind: "noMansSkyMods";
      installPath: string;
      keepPath?: boolean;
    }
  | {
      kind: "numberedPak";
      installPath: string;
      extension: string;
      prefix: string;
      startIndex: number;
      listFileName: string;
    }
  | {
      kind: "watchDogsPatch";
      installPath: string;
      listFileName: string;
    }
  | {
      kind: "michangshengLinkedFolder";
      installPath: string;
      rootFile: string;
    }
  | {
      kind: "michangshengDllPlugins";
      installPath: string;
    }
  | {
      kind: "legendPortraits";
      installPath: string;
      portraitFolders: string[];
    }
  | {
      kind: "inzoiModKit";
      installPath: string;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "bg3Pak";
      installPath: string;
      targetScope: "appData";
      managedToolFileName: string;
    }
  | {
      kind: "redDeadAsi";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
    }
  | {
      kind: "redDeadLml";
      installPath: string;
    }
  | {
      kind: "manual";
      reason: string;
    };

export interface ModTypeRule {
  id: string;
  name: string;
  install: InstallStrategy;
  uninstall?: InstallStrategy;
  requiredModNames?: string[];
}

export interface CustomAdapterRule {
  id: string;
  name: string;
  detect: {
    kind: "always" | "fileName" | "extension" | "pathPart";
    value: string;
  };
  install: InstallStrategy;
}

export interface GameAdapter {
  presetId: string;
  name: string;
  modTypes: ModTypeRule[];
  checkModType: (files: string[]) => string;
}

export interface GamePreset {
  id: string;
  name: string;
  sourceFile: string;
  glossGameId: number;
  steamAppId: number;
  nexusDomain: string;
  nexusGameId: number;
  exeNames: string[];
  coverUrl: string;
  typeNames: string[];
  adapterStatus: "catalogued" | "implemented";
}

export interface LocalMod {
  id: string;
  gameId: string;
  sortIndex: number;
  name: string;
  sourcePath: string;
  rootPath: string;
  version: string;
  author: string;
  website: string;
  description: string;
  coverImage: string;
  tags: string[];
  requirements: string[];
  files: string[];
  modTypeId: string;
  modTypeName: string;
  installed: boolean;
  deployedFiles: string[];
  updateSource?: ModUpdateSource;
  createdAt: number;
  updatedAt: number;
}

export interface ModProfile {
  id: string;
  gameId: string;
  name: string;
  enabledModIds: string[];
  modOrder: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ModUpdateCheck {
  status: "unknown" | "latest" | "available" | "unsupported" | "failed";
  checkedAt: number;
  message: string;
  latestFileId: string;
  latestFileName: string;
  latestVersion: string;
  latestUploadedAt: string;
  detailsUrl: string;
}

export interface ModUpdateSource {
  type: "nexus";
  gameDomain: string;
  gameName: string;
  modId: string;
  fileId: string;
  fileName: string;
  fileVersion: string;
  modVersion: string;
  categoryName: string;
  modPageUrl: string;
  filePageUrl: string;
  coverImage?: string;
  downloadedAt: number;
  check?: ModUpdateCheck;
}

export interface InstallPlan {
  targetFiles: string[];
  conflicts: string[];
}

export interface CustomAdapterTestResult {
  sourcePath: string;
  files: string[];
  modTypeId: string;
  modTypeName: string;
  strategyKind: InstallStrategy["kind"];
  plan: InstallPlan;
  manualReason: string;
}

export interface NexusUser {
  key: string;
  name: string;
  email: string;
  profileUrl: string;
  avatar?: string;
  isPremium: boolean;
  isSupporter: boolean;
}

export interface NexusModFile {
  id: string;
  name: string;
  version: string;
  size: number;
  createdAt: string;
  categoryName: string;
  downloadUrl: string;
  detailsUrl: string;
}

export interface NexusModItem {
  id: string;
  title: string;
  summary: string;
  author: string;
  version: string;
  website: string;
  cover: string;
  downloads: number;
  likes: number;
  categories: string[];
  createdAt: string;
  updatedAt: string;
  nsfw: boolean;
  filesCount: number;
  primaryFile: NexusModFile | null;
}

export interface NexusModImage {
  id: string;
  title: string;
  thumbnailUrl: string;
  imageUrl: string;
}

export interface NexusModDetail extends NexusModItem {
  description: string;
  descriptionFormat: "html" | "text";
  images: NexusModImage[];
  files: NexusModFile[];
}

export interface NexusModListResult {
  items: NexusModItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  facets: {
    categoryName: Array<{ label: string; value: string; count: number }>;
    languageName: Array<{ label: string; value: string; count: number }>;
    tag: Array<{ label: string; value: string; count: number }>;
  };
}

export interface DownloadTask {
  id: string;
  gameId: string;
  gameName: string;
  source: "NexusMods" | "Custom";
  modId: string;
  modName: string;
  fileId: string;
  fileName: string;
  url: string;
  outputPath: string;
  coverImage?: string;
  updateSource?: ModUpdateSource;
  updateTargetModId?: string;
  status: "queued" | "downloading" | "paused" | "completed" | "failed" | "external";
  receivedBytes: number;
  totalBytes: number;
  speed?: number;
  error: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppLogEntry {
  id: string;
  level: "info" | "error";
  source: string;
  message: string;
  detail: string;
  createdAt: number;
}

export interface BackupEntry {
  id: string;
  gameId: string;
  gameName: string;
  name: string;
  sourcePath: string;
  outputPath: string;
  size: number;
  filesCount: number;
  createdAt: number;
}

export interface DataBackupEntry {
  id: string;
  name: string;
  outputPath: string;
  size: number;
  createdAt: number;
}

export interface AppSettings {
  storagePath: string;
  tagColors: Record<string, string>;
  useSymlinkInstall: boolean;
  nexusApiKey: string;
  nexusAccessToken: string;
  nexusRefreshToken: string;
  nexusTokenExpiresAt: number;
  nexusUser: NexusUser | null;
  translationProvider: "off" | "google-gtx" | "baidu" | "youdao" | "tencent" | "volcengine" | "ollama";
  translationTargetLang: "zh-CN";
  baiduTranslateAppId: string;
  baiduTranslateSecret: string;
  youdaoTranslateAppKey: string;
  youdaoTranslateSecret: string;
  tencentTranslateSecretId: string;
  tencentTranslateSecretKey: string;
  tencentTranslateRegion: string;
  volcengineTranslateAccessKeyId: string;
  volcengineTranslateSecretAccessKey: string;
  volcengineTranslateRegion: string;
  ollamaTranslateBaseUrl: string;
  ollamaTranslateModel: string;
  ollamaTranslateTimeoutMs: number;
  theme: "dark" | "light";
  language: "zh-CN" | "en-US";
  defaultTab: "games" | "manager" | "nexus" | "download" | "logs" | "backup" | "settings" | "about";
  autoImportAfterDownload: boolean;
  downloadEngine: "builtin" | "aria2";
  aria2ExecutablePath: string;
  aria2MaxConnections: number;
  proxyEnabled: boolean;
  proxyUrl: string;
  preferDirectoryGamePicker: boolean;
  launchAtStartup: boolean;
  allowGameRunningChanges: boolean;
  debugMode: boolean;
  showDebugInfo: boolean;
  autoCheckUpdates: boolean;
  appUpdateUrl: string;
  lastAppUpdateCheckAt: number;
  lastAutoUpdateCheckAt: number;
}

export interface AppUpdateInfo {
  versionName: string;
  downloadUrl: string;
  updateLog: string;
  forceUpdate: boolean;
}

export interface AppUpdateCheckResult {
  hasUpdate: boolean;
  versionCompare: number;
  currentVersionName: string;
  remote: AppUpdateInfo;
}

export interface AppData {
  dataVersion: number;
  settings: AppSettings;
  games: ManagedGame[];
  activeGameId: string;
  modProfiles: ModProfile[];
  mods: LocalMod[];
  downloads: DownloadTask[];
  logs: AppLogEntry[];
  backups: BackupEntry[];
  dataBackups: DataBackupEntry[];
  translationCache: Record<string, {
    text: string;
    createdAt: number;
  }>;
}
