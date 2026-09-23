export {};

declare global {
  interface Window {
    mayfly: {
      platform: string;
      securityNotice?: string;
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
      openDevTools: () => Promise<void>;
      setLaunchAtStartup: (enabled: boolean) => Promise<boolean>;
      fetchRemoteJson: (options: {
        url: string;
        proxyUrl?: string;
      }) => Promise<Record<string, unknown>>;
      checkAppUpdate: (options: {
        updateUrl: string;
        currentVersion?: string;
        proxyUrl?: string;
      }) => Promise<import("./domain").AppUpdateCheckResult>;
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
      validateNexusApiKey: (options: string | {
        apiKey: string;
        proxyUrl?: string;
      }) => Promise<import("./domain").NexusUser>;
      startNexusOAuthLogin: (options?: { proxyUrl?: string }) => Promise<{
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        user: import("./domain").NexusUser;
      }>;
      cancelNexusOAuthLogin: () => Promise<boolean>;
      listNexusMods: (options: {
        apiKey: string;
        accessToken?: string;
        gameDomain: string;
        page: number;
        pageSize: number;
        proxyUrl?: string;
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
        accessToken?: string;
        gameDomain: string;
        modId: string;
        proxyUrl?: string;
      }) => Promise<import("./domain").NexusModDetail>;
      getNexusDownloadUrl: (options: {
        apiKey: string;
        accessToken?: string;
        gameDomain: string;
        modId: string;
        fileId: string;
        proxyUrl?: string;
        key?: string;
        expires?: string;
      }) => Promise<string>;
      translateText: (options: {
        text: string;
        provider: import("./domain").AppSettings["translationProvider"];
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
      }) => Promise<string>;
      downloadFile: (options: {
        taskId?: string;
        url: string;
        outputPath: string;
        resume?: boolean;
        proxyUrl?: string;
        engine?: import("./domain").AppSettings["downloadEngine"];
        aria2ExecutablePath?: string;
        aria2MaxConnections?: number;
      }) => Promise<{
        outputPath: string;
        receivedBytes: number;
        totalBytes: number;
      }>;
      cancelDownload: (taskId: string) => Promise<boolean>;
      onDownloadProgress: (callback: (data: { taskId: string; receivedBytes: number; totalBytes: number }) => void) => void;
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
      exportModPackage: (options: {
        mods: Array<{
          rootPath: string;
          folderName: string;
        }>;
        manifest: Record<string, unknown>;
        outputPath: string;
        operationId?: string;
      }) => Promise<{
        outputPath: string;
        size: number;
      }>;
      onPackageProgress: (callback: (data: {
        operationId: string;
        operation: "import" | "export";
        phase: string;
        current: number;
        total: number;
        message: string;
      }) => void) => void;
      readPackageManifest: (packagePath: string) => Promise<Record<string, unknown>>;
      importGamePack: (options: {
        packagePath: string;
        storagePath: string;
        gameName: string;
        overwrite?: boolean;
        operationId?: string;
      }) => Promise<{
        manifest: Record<string, unknown>;
        mods: Array<{ folder: string; rootPath: string; files: string[]; coverImage?: string }>;
      }>;
      importModFolder: (options: {
        sourcePath: string;
        storagePath: string;
        gameId: string;
        gameName?: string;
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
      copyModCoverImage: (options: {
        sourcePath: string;
        modRoot: string;
      }) => Promise<{
        coverImage: string;
      }>;
      migrateModCoverImage: (options: {
        modRoot: string;
        coverImage: string;
      }) => Promise<{
        coverImage: string;
      }>;
      migrateModCacheFolder: (options: {
        sourcePath: string;
        storagePath: string;
        gameName: string;
        folderName: string;
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
        targetFolderName?: string;
        strategy: import("./domain").InstallStrategy;
        isInstall: boolean;
        useSymlink?: boolean;
        managedToolCandidates?: string[];
      }) => Promise<{
        deployedFiles: string[];
      }>;
      createInstallPlan: (options: {
        modRoot: string;
        gamePath: string;
        targetFolderName?: string;
        strategy: import("./domain").InstallStrategy;
        useSymlink?: boolean;
      }) => Promise<import("./domain").InstallPlan>;
      removeDeployedFiles: (options: {
        gamePath: string;
        deployedFiles: string[];
      }) => Promise<boolean>;
      onNxmOpen: (handler: (url: string) => void) => () => void;
    };
  }
}
