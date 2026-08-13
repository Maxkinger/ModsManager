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
  adapterStatus: "catalogued" | "implemented" | "custom";
  createdAt: number;
}

export type InstallStrategy =
  | {
      kind: "general";
      installPath: string;
      keepPath?: boolean;
    }
  | {
      kind: "folder";
      installPath: string;
      folderName: string | string[];
      include?: boolean;
      spare?: boolean;
    }
  | {
      kind: "file";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      commonParent?: boolean;
    }
  | {
      kind: "fileSibling";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      pass?: string[];
    }
  | {
      kind: "folderParent";
      installPath: string;
      folderName: string;
    }
  | {
      kind: "fileMap";
      installPath: string;
      dictionaryFile: string;
    }
  | {
      kind: "fileIntoParentFolder";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      requireParent?: boolean;
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
  createdAt: number;
  updatedAt: number;
}

export interface InstallPlan {
  targetFiles: string[];
  conflicts: string[];
}

export interface NexusUser {
  key: string;
  name: string;
  email: string;
  profileUrl: string;
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

export interface NexusModDetail extends NexusModItem {
  description: string;
  descriptionFormat: "html" | "text";
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
  status: "queued" | "downloading" | "completed" | "failed" | "external";
  receivedBytes: number;
  totalBytes: number;
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

export interface AppSettings {
  storagePath: string;
  tagColors: Record<string, string>;
  useSymlinkInstall: boolean;
  nexusApiKey: string;
  nexusUser: NexusUser | null;
  theme: "dark" | "light";
  language: "zh-CN" | "en-US";
  defaultTab: "games" | "manager" | "nexus" | "download" | "logs" | "backup" | "settings" | "about";
  autoImportAfterDownload: boolean;
  preferDirectoryGamePicker: boolean;
  launchAtStartup: boolean;
  allowGameRunningChanges: boolean;
  debugMode: boolean;
  showDebugInfo: boolean;
  autoCheckUpdates: boolean;
}

export interface AppData {
  dataVersion: number;
  settings: AppSettings;
  games: ManagedGame[];
  activeGameId: string;
  mods: LocalMod[];
  downloads: DownloadTask[];
  logs: AppLogEntry[];
  backups: BackupEntry[];
}
