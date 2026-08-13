export {};

declare global {
  interface Window {
    mayfly: {
      openDirectory: () => Promise<string>;
      openExecutable: () => Promise<string>;
      openImage: () => Promise<string>;
      openArchive: () => Promise<string[]>;
      openModSource: () => Promise<string[]>;
      openJson: () => Promise<string>;
      saveJson: (defaultPath: string) => Promise<string>;
      saveFile: (options: {
        defaultPath: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<string>;
      getPathForFile: (file: File) => string;
      openPath: (targetPath: string) => Promise<boolean>;
      openExternal: (targetUrl: string) => Promise<boolean>;
      fileUrl: (targetPath: string) => Promise<string>;
      launchExecutable: (options: {
        executablePath: string;
        cwd?: string;
        args?: string[];
      }) => Promise<boolean>;
      setLaunchAtStartup: (enabled: boolean) => Promise<boolean>;
      readStore: <T>(fileName: string, fallback: T) => Promise<T>;
      writeStore: (fileName: string, value: unknown) => Promise<boolean>;
      exists: (targetPath: string) => Promise<boolean>;
      stat: (targetPath: string) => Promise<{
        isDirectory: boolean;
        size: number;
        mtimeMs: number;
      }>;
      remove: (targetPath: string) => Promise<boolean>;
      listFiles: (targetPath: string) => Promise<string[]>;
      readJsonFile: <T>(targetPath: string) => Promise<T>;
      writeJsonFile: (targetPath: string, value: unknown) => Promise<boolean>;
      findFileByName: (options: {
        rootPath: string;
        fileNames: string[];
        maxDepth?: number;
      }) => Promise<string>;
      findSteamGamePath: (steamAppId: number) => Promise<string>;
      validateNexusApiKey: (apiKey: string) => Promise<import("./domain").NexusUser>;
      listNexusMods: (options: {
        apiKey: string;
        gameDomain: string;
        page: number;
        pageSize: number;
        searchText?: string;
        sort?: "default" | "updatedAt" | "createdAt" | "downloads";
        facets?: {
          categoryName?: string;
          languageName?: string;
          tag?: string;
        };
      }) => Promise<import("./domain").NexusModListResult>;
      getNexusModDetail: (options: {
        apiKey: string;
        gameDomain: string;
        modId: string;
      }) => Promise<import("./domain").NexusModDetail>;
      getNexusDownloadUrl: (options: {
        apiKey: string;
        gameDomain: string;
        modId: string;
        fileId: string;
      }) => Promise<string>;
      downloadFile: (options: {
        url: string;
        outputPath: string;
      }) => Promise<{
        outputPath: string;
        receivedBytes: number;
        totalBytes: number;
      }>;
      createBackupZip: (options: {
        sourcePath: string;
        outputPath: string;
      }) => Promise<{
        outputPath: string;
        size: number;
        filesCount: number;
      }>;
      restoreBackupZip: (options: {
        backupPath: string;
        targetPath: string;
      }) => Promise<boolean>;
      listBackupZip: (backupPath: string) => Promise<Array<{
        path: string;
        isDirectory: boolean;
        size: number;
      }>>;
      exportGmm: (options: {
        mods: Array<{
          rootPath: string;
          folderName: string;
        }>;
        manifest: Record<string, unknown>;
        outputPath: string;
      }) => Promise<{
        outputPath: string;
        size: number;
      }>;
      importModFolder: (options: {
        sourcePath: string;
        storagePath: string;
        gameId: string;
        modId: string;
      }) => Promise<{
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
      }>;
      installMod: (options: {
        modRoot: string;
        gamePath: string;
        installPath: string;
      }) => Promise<boolean>;
      uninstallMod: (options: {
        modRoot: string;
        gamePath: string;
        installPath: string;
      }) => Promise<boolean>;
      applyModStrategy: (options: {
        modRoot: string;
        gamePath: string;
        strategy: import("./domain").InstallStrategy;
        isInstall: boolean;
        useSymlink?: boolean;
      }) => Promise<{
        deployedFiles: string[];
      }>;
      createInstallPlan: (options: {
        modRoot: string;
        gamePath: string;
        strategy: import("./domain").InstallStrategy;
      }) => Promise<import("./domain").InstallPlan>;
      removeDeployedFiles: (options: {
        gamePath: string;
        deployedFiles: string[];
      }) => Promise<boolean>;
      onNxmOpen: (handler: (url: string) => void) => () => void;
    };
  }
}
