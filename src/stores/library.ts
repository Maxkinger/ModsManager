/**
 * mayflyMods - 核心 Mod 管理仓库
 * 【防伪声明】b战：清梦与狗不得使用，其他人随意使用，不过分抄袭套壳即可
 */
import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { getGameAdapter, getModType } from "@/adapters";
import gamePresetsFromJson from "@/data/game-presets.json";
const gamePresets = gamePresetsFromJson as GamePreset[];
import type {
  AppData,
  AppLogEntry,
  BackupEntry,
  DataBackupEntry,
  DownloadTask,
  CustomAdapterRule,
  GameAdapter,
  GamePreset,
  InstallPlan,
  LocalMod,
  ManagedGame,
  AppSettings,
  AppUpdateInfo,
  AppUpdateCheckResult,
  NexusModDetail,
  NexusModFile,
  NexusModItem,
  NexusModListResult,
  ModUpdateCheck,
  ModUpdateSource,
  ModProfile
} from "@/types/domain";

const DATA_FILE = "mayfly-library.json";
const DATA_VERSION = 9;
const HIDDEN_PRESET_IDS = new Set(["gta5", "gta5enhanced"]);
const LEGACY_PACKAGE_EXTENSION = ["g", "m", "m"].join("");
type PackageProgress = {
  visible: boolean;
  operation: "import" | "export" | "";
  phase: string;
  current: number;
  total: number;
  message: string;
};
type UpdateBatchProgress = {
  visible: boolean;
  current: number;
  total: number;
  message: string;
};

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function baseName(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function modNameFromPath(path: string) {
  const packagePattern = new RegExp(`\\.(zip|rar|7z|mmp|${LEGACY_PACKAGE_EXTENSION})$`, "i");
  return baseName(path).replace(packagePattern, "");
}

function isPackageArchive(path: string) {
  const lowerPath = path.toLowerCase();
  return [".zip", ".mmp", `.${LEGACY_PACKAGE_EXTENSION}`].some((extension) => lowerPath.endsWith(extension));
}

function normalizeText(value: string) {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nextDuplicateName(name: string, existingNames: Set<string>) {
  let index = 2;
  let candidate = `${name} 副本`;

  while (existingNames.has(normalizeText(candidate))) {
    candidate = `${name} 副本 ${index}`;
    index += 1;
  }

  return candidate;
}

function dirName(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  const prefix = /^[a-z]:/i.test(parts[0] ?? "") ? "" : "/";
  return `${prefix}${parts.join("/")}`.replace(/\//g, "\\");
}

function joinGameRelativePath(gamePath: string, relativePath: string) {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);

  if (parts.length === 0 || parts.some((part) => part === ".." || /^[a-z]:$/i.test(part))) {
    return "";
  }

  return `${gamePath.replace(/[\\/]+$/u, "")}\\${parts.join("\\")}`;
}

function joinRelativePath(rootPath: string, relativePath: string) {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);

  if (parts.length === 0 || parts.some((part) => part === ".." || /^[a-z]:$/i.test(part))) {
    return "";
  }

  return `${rootPath.replace(/[\\/]+$/u, "")}\\${parts.join("\\")}`;
}

function fileName(path: string) {
  return baseName(path);
}

function sanitizeFileName(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "-").trim() || "download.bin";
}

function nexusModWebsite(gameDomain: string, modId: string, fileId = "") {
  const domain = gameDomain.trim();
  const id = modId.trim();
  if (!domain || !id) return "";

  const url = new URL(`https://www.nexusmods.com/${domain}/mods/${id}`);
  if (fileId.trim()) {
    url.searchParams.set("tab", "files");
    url.searchParams.set("file_id", fileId.trim());
  }

  return url.toString();
}

function hashText(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function stripHtmlText(value: string) {
  return value
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function stripBbCodeText(value: string) {
  return value
    .replace(/\[(\/)?(b|i|u|s|center|left|right|size|color|font|url|img|spoiler|quote|list|\\*)[^\]]*\]/giu, "")
    .replace(/\[\*\]/gu, "- ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function nexusTranslationSource(detail: NexusModDetail) {
  const description = detail.descriptionFormat === "html"
    ? stripHtmlText(detail.description)
    : stripBbCodeText(detail.description);

  return {
    summary: detail.summary.trim(),
    description
  };
}

function stringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return String(record.value || record.label || record.name || record.title || "").trim();
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(/[,，\s]+/u).map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function groupIdList(value: unknown) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
  }

  const single = String(value ?? "").trim();
  return single ? [single] : [];
}

const legacyTypeIdMap: Record<string, Record<string, string>> = {
  stardewvalley: {
    "1": "smapi",
    "2": "mods",
    "99": "unknown"
  },
  monsterhunterworld: {
    "1": "stracker",
    "2": "nativePc",
    "3": "plugins",
    "4": "unknown",
    "99": "unknown"
  },
  taleofimmortal: {
    "1": "modExportData",
    "2": "unknown",
    "99": "unknown"
  },
  stellarblade: {
    "1": "pak",
    "2": "ue4ss",
    "3": "mods",
    "4": "logicMods",
    "5": "scripts",
    "6": "root",
    "99": "unknown"
  }
};

function normalizeTypeName(value: string) {
  return value.trim().replace(/\s+/gu, "").toLowerCase();
}

function resolveStoredModType(
  adapter: GameAdapter,
  presetId: string,
  rawTypeId: unknown,
  rawTypeName: unknown,
  files: string[]
) {
  const rawId = String(rawTypeId ?? "").trim();
  const directType = adapter.modTypes.find((type) => type.id === rawId);
  if (directType) return directType;

  const mappedId = legacyTypeIdMap[presetId]?.[rawId];
  const mappedType = mappedId ? adapter.modTypes.find((type) => type.id === mappedId) : undefined;
  if (mappedType) return mappedType;

  const name = normalizeTypeName(String(rawTypeName ?? ""));
  if (name) {
    const namedType = adapter.modTypes.find((type) => normalizeTypeName(type.name) === name);
    if (namedType) return namedType;
  }

  const detectedId = adapter.checkModType(files);
  return adapter.modTypes.find((type) => type.id === detectedId) ?? adapter.modTypes[0];
}

function modInstallPriority(mod: Pick<LocalMod, "modTypeId" | "modTypeName" | "name">) {
  const text = `${mod.modTypeId} ${mod.modTypeName} ${mod.name}`.toLowerCase();
  const rules: Array<[RegExp, number]> = [
    [/(smapi|stracker|bepinex|melonloader|modengine|mod enabler|northstar|redhook)/u, 10],
    [/(reframework|ue4ss|script ?hook|cet|f4se|skse|sfse|bg3se)/u, 20],
    [/(nativepc|natives|data|archive|pak|mods|通用)/u, 50],
    [/(plugin|plugins|autorun|scripts|脚本)/u, 70],
    [/(patch|补丁|dlc|ui|model|模型|texture|材质)/u, 90],
    [/(unknown|未知|manual)/u, 200]
  ];

  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? 100;
}

function compareGameInstallOrder(left: LocalMod, right: LocalMod) {
  return modInstallPriority(left) - modInstallPriority(right) ||
    left.sortIndex - right.sortIndex ||
    left.createdAt - right.createdAt;
}

function strategyNeedsManagedUninstall(kind: string) {
  return [
    "bethesdaData",
    "bethesdaPluginFiles",
    "oblivionPlugins",
    "numberedPak",
    "watchDogsPatch",
    "bg3Pak",
    "redDeadAsi",
    "redDeadLml",
    "michangshengLinkedFolder",
    "michangshengDllPlugins",
    "legendPortraits",
    "inzoiModKit"
  ].includes(kind);
}

function normalizeInstallStrategy(value: unknown): CustomAdapterRule["install"] {
  if (!value || typeof value !== "object") {
    return { kind: "general", installPath: "", keepPath: true };
  }

  const strategy = value as Partial<CustomAdapterRule["install"]> & Record<string, unknown>;
  const installPath = String(strategy.installPath ?? "");
  const targetScope = strategy.targetScope === "documents" || strategy.targetScope === "appData"
    ? strategy.targetScope
    : undefined;

  switch (strategy.kind) {
    case "folder":
      return {
        kind: "folder",
        installPath,
        folderName: Array.isArray(strategy.folderName)
          ? strategy.folderName.map(String).filter(Boolean)
          : String(strategy.folderName || "mods"),
        include: Boolean(strategy.include),
        spare: strategy.spare !== false,
        targetScope
      };
    case "folderRoot":
      return { kind: "folderRoot", installPath, targetScope };
    case "file":
      return {
        kind: "file",
        installPath,
        fileName: String(strategy.fileName || ""),
        isExtname: Boolean(strategy.isExtname),
        commonParent: Boolean(strategy.commonParent),
        targetScope
      };
    case "fileSibling":
      return {
        kind: "fileSibling",
        installPath,
        fileName: String(strategy.fileName || ""),
        isExtname: Boolean(strategy.isExtname),
        targetScope
      };
    case "fileOnly":
      return {
        kind: "fileOnly",
        installPath,
        fileName: String(strategy.fileName || ""),
        isExtname: Boolean(strategy.isExtname),
        targetScope
      };
    case "fileMap":
      return {
        kind: "fileMap",
        installPath,
        dictionaryFile: String(strategy.dictionaryFile || "")
      };
    case "legendPortraits":
      return {
        kind: "legendPortraits",
        installPath,
        portraitFolders: Array.isArray(strategy.portraitFolders)
          ? strategy.portraitFolders.map(String).filter(Boolean)
          : []
      };
    case "manual":
      return { kind: "manual", reason: String(strategy.reason || "该自定义类型需要手动安装。") };
    case "general":
    default:
      return {
        kind: "general",
        installPath,
        keepPath: strategy.keepPath !== false,
        targetScope
      };
  }
}

function normalizeCustomAdapterRules(value: unknown): CustomAdapterRule[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((rule, index) => {
      if (!rule || typeof rule !== "object") return null;

      const record = rule as Record<string, unknown>;
      const detect = record.detect && typeof record.detect === "object"
        ? record.detect as Record<string, unknown>
        : {};
      const detectKind = ["always", "fileName", "extension", "pathPart"].includes(String(detect.kind))
        ? String(detect.kind) as CustomAdapterRule["detect"]["kind"]
        : "always";
      const name = String(record.name || `自定义类型 ${index + 1}`).trim();

      return {
        id: String(record.id || `custom-${index + 1}`),
        name,
        detect: {
          kind: detectKind,
          value: String(detect.value || "").trim()
        },
        install: normalizeInstallStrategy(record.install)
      };
    })
    .filter((rule): rule is CustomAdapterRule => Boolean(rule?.name));
}

function createCustomGameAdapter(game: ManagedGame): GameAdapter {
  const customTypes = normalizeCustomAdapterRules(game.customAdapterRules);
  const modTypes = customTypes.map((rule) => ({
    id: rule.id,
    name: rule.name,
    install: rule.install
  }));
  const fallbackType = {
    id: "custom-root",
    name: "游戏根目录",
    install: {
      kind: "general",
      installPath: game.installPath || "",
      keepPath: true
    } as const
  };
  const finalTypes = modTypes.length > 0 ? modTypes : [fallbackType];

  return {
    presetId: game.presetId || game.id,
    name: game.name,
    modTypes: finalTypes,
    checkModType(files) {
      for (const rule of customTypes) {
        const value = rule.detect.value.toLowerCase().replace(/^\./u, "");

        if (rule.detect.kind === "always") return rule.id;
        if (!value) continue;
        if (rule.detect.kind === "fileName" && files.some((file) => baseName(file).toLowerCase() === value)) return rule.id;
        if (rule.detect.kind === "extension" && files.some((file) => baseName(file).toLowerCase().endsWith(`.${value}`))) return rule.id;
        if (rule.detect.kind === "pathPart" && files.some((file) =>
          file.replace(/\\/g, "/").split("/").some((part) => part.toLowerCase() === value)
        )) {
          return rule.id;
        }
      }

      return finalTypes[0]?.id ?? fallbackType.id;
    }
  };
}

function adapterForGame(game: ManagedGame) {
  return game.customAdapterRules.length > 0
    ? createCustomGameAdapter(game)
    : getGameAdapter(game.presetId);
}

function modFolderName(rootPath: string, fallback: string) {
  const folder = baseName(rootPath);
  return /^\d+$/u.test(folder) ? folder : fallback;
}

function isExternalUrl(url: string) {
  return /^https?:\/\/www\.nexusmods\.com\//i.test(url);
}

function isNexusUpdateSource(value: unknown): value is ModUpdateSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<ModUpdateSource>;

  return source.type === "nexus" &&
    typeof source.gameDomain === "string" &&
    typeof source.modId === "string" &&
    typeof source.fileId === "string";
}

function normalizeModUpdateSource(value: unknown): ModUpdateSource | undefined {
  if (!isNexusUpdateSource(value)) return undefined;
  const check = value.check && typeof value.check === "object"
    ? value.check as Partial<ModUpdateCheck>
    : undefined;

  return {
    type: "nexus",
    gameDomain: value.gameDomain,
    gameName: String(value.gameName || ""),
    modId: value.modId,
    fileId: value.fileId,
    fileName: String(value.fileName || ""),
    fileVersion: String(value.fileVersion || ""),
    modVersion: String(value.modVersion || ""),
    categoryName: String(value.categoryName || ""),
    modPageUrl: String(value.modPageUrl || nexusModWebsite(value.gameDomain, value.modId)),
    filePageUrl: String(value.filePageUrl || nexusModWebsite(value.gameDomain, value.modId, value.fileId)),
    coverImage: String(value.coverImage || "") || undefined,
    downloadedAt: Number(value.downloadedAt) || Date.now(),
    check: check
      ? {
        status: ["latest", "available", "unsupported", "failed"].includes(String(check.status))
          ? check.status as ModUpdateCheck["status"]
          : "unknown",
        checkedAt: Number(check.checkedAt) || 0,
        message: String(check.message || ""),
        latestFileId: String(check.latestFileId || ""),
        latestFileName: String(check.latestFileName || ""),
        latestVersion: String(check.latestVersion || ""),
        latestUploadedAt: String(check.latestUploadedAt || ""),
        detailsUrl: String(check.detailsUrl || "")
      }
      : undefined
  };
}

interface NexusDownloadAuthorization {
  key?: string;
  expires?: string;
}

interface CustomGameInput {
  name: string;
  path: string;
  exeNames: string[];
  installPath: string;
  launchArgs: string;
  coverUrl: string;
}

interface CustomAdapterRuleInput {
  name: string;
  detectKind: CustomAdapterRule["detect"]["kind"];
  detectValue: string;
  installKind: "general" | "folderRoot" | "folder" | "file" | "fileSibling" | "manual";
  installPath: string;
  installName: string;
  keepPath: boolean;
}

const fallbackData: AppData = {
  dataVersion: DATA_VERSION,
  settings: {
    storagePath: "",
    tagColors: {},
    useSymlinkInstall: true,
    nexusApiKey: "",
    nexusAccessToken: "",
    nexusRefreshToken: "",
    nexusTokenExpiresAt: 0,
    nexusUser: null,
    translationProvider: "off",
    translationTargetLang: "zh-CN",
    baiduTranslateAppId: "",
    baiduTranslateSecret: "",
    youdaoTranslateAppKey: "",
    youdaoTranslateSecret: "",
    tencentTranslateSecretId: "",
    tencentTranslateSecretKey: "",
    tencentTranslateRegion: "ap-guangzhou",
    volcengineTranslateAccessKeyId: "",
    volcengineTranslateSecretAccessKey: "",
    volcengineTranslateRegion: "cn-north-1",
    ollamaTranslateBaseUrl: "http://127.0.0.1:11434",
    ollamaTranslateModel: "",
    ollamaTranslateTimeoutMs: 120000,
    theme: "dark",
    language: "zh-CN",
    defaultTab: "manager",
    autoImportAfterDownload: true,
    downloadEngine: "builtin",
    aria2ExecutablePath: "",
    aria2MaxConnections: 4,
    proxyEnabled: false,
    proxyUrl: "",
    preferDirectoryGamePicker: false,
    launchAtStartup: false,
    allowGameRunningChanges: false,
    debugMode: false,
    showDebugInfo: false,
    autoCheckUpdates: false,
    appUpdateUrl: "https://version.mayflyyx.com/mayflyModsVersion.json",//更新文件域名
    lastAppUpdateCheckAt: 0,
    lastAutoUpdateCheckAt: 0
  },
  games: [],
  activeGameId: "",
  modProfiles: [],
  mods: [],
  downloads: [],
  logs: [],
  backups: [],
  dataBackups: [],
  translationCache: {}
};

function normalizeAppData(rawData: Partial<AppData> | null | undefined): AppData {
  const data = rawData ?? {};
  const settings = (data.settings ?? {}) as Partial<AppSettings>;
  const games = Array.isArray(data.games) ? data.games : [];
  const rawModProfiles = Array.isArray(data.modProfiles) ? data.modProfiles : [];
  const mods = Array.isArray(data.mods) ? data.mods : [];
  const downloads = Array.isArray(data.downloads) ? data.downloads : [];
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const backups = Array.isArray(data.backups) ? data.backups : [];
  const dataBackups = Array.isArray(data.dataBackups) ? data.dataBackups : [];
  const rawTranslationCache = data.translationCache && typeof data.translationCache === "object"
    ? data.translationCache
    : {};
  const modProfiles: ModProfile[] = rawModProfiles
    .filter((profile) => profile && typeof profile === "object")
    .map((profile, index) => ({
      id: String(profile.id || `profile_${profile.gameId || "game"}_${index + 1}`),
      gameId: String(profile.gameId || ""),
      name: String(profile.name || `配置档案 ${index + 1}`).trim() || `配置档案 ${index + 1}`,
      enabledModIds: groupIdList(profile.enabledModIds),
      modOrder: groupIdList(profile.modOrder),
      createdAt: Number(profile.createdAt) || Date.now(),
      updatedAt: Number(profile.updatedAt) || Date.now()
    }))
    .filter((profile) => profile.gameId);

  return {
    dataVersion: Number(data.dataVersion) || DATA_VERSION,
    settings: {
      ...fallbackData.settings,
      ...settings,
      tagColors: settings.tagColors ?? {},
      useSymlinkInstall: Number(data.dataVersion) < 3 ? true : settings.useSymlinkInstall ?? true,
      nexusApiKey: settings.nexusApiKey ?? "",
      nexusAccessToken: settings.nexusAccessToken ?? "",
      nexusRefreshToken: settings.nexusRefreshToken ?? "",
      nexusTokenExpiresAt: Number(settings.nexusTokenExpiresAt) || 0,
      nexusUser: settings.nexusUser ?? null,
      translationProvider: ["google-gtx", "baidu", "youdao", "tencent", "volcengine", "ollama"].includes(String(settings.translationProvider))
        ? settings.translationProvider as AppSettings["translationProvider"]
        : "off",
      translationTargetLang: "zh-CN",
      baiduTranslateAppId: settings.baiduTranslateAppId ?? "",
      baiduTranslateSecret: settings.baiduTranslateSecret ?? "",
      youdaoTranslateAppKey: settings.youdaoTranslateAppKey ?? "",
      youdaoTranslateSecret: settings.youdaoTranslateSecret ?? "",
      tencentTranslateSecretId: settings.tencentTranslateSecretId ?? "",
      tencentTranslateSecretKey: settings.tencentTranslateSecretKey ?? "",
      tencentTranslateRegion: settings.tencentTranslateRegion ?? "ap-guangzhou",
      volcengineTranslateAccessKeyId: settings.volcengineTranslateAccessKeyId ?? "",
      volcengineTranslateSecretAccessKey: settings.volcengineTranslateSecretAccessKey ?? "",
      volcengineTranslateRegion: settings.volcengineTranslateRegion ?? "cn-north-1",
      ollamaTranslateBaseUrl: settings.ollamaTranslateBaseUrl ?? "http://127.0.0.1:11434",
      ollamaTranslateModel: settings.ollamaTranslateModel ?? "",
      ollamaTranslateTimeoutMs: Number(settings.ollamaTranslateTimeoutMs) || 120000,
      theme: settings.theme ?? "dark",
      language: settings.language ?? "zh-CN",
      defaultTab: settings.defaultTab === "backup"
        ? "manager"
        : settings.defaultTab ?? "manager",
      autoImportAfterDownload: settings.autoImportAfterDownload ?? true,
      downloadEngine: settings.downloadEngine === "aria2" ? "aria2" : "builtin",
      aria2ExecutablePath: settings.aria2ExecutablePath ?? "",
      aria2MaxConnections: Math.max(1, Math.min(16, Number(settings.aria2MaxConnections) || 4)),
      proxyEnabled: settings.proxyEnabled ?? false,
      proxyUrl: settings.proxyUrl ?? "",
      preferDirectoryGamePicker: settings.preferDirectoryGamePicker ?? false,
      launchAtStartup: settings.launchAtStartup ?? false,
      allowGameRunningChanges: settings.allowGameRunningChanges ?? false,
      debugMode: settings.debugMode ?? false,
      showDebugInfo: settings.showDebugInfo ?? false,
      autoCheckUpdates: settings.autoCheckUpdates ?? false,
      appUpdateUrl: settings.appUpdateUrl || fallbackData.settings.appUpdateUrl,
      lastAppUpdateCheckAt: Number(settings.lastAppUpdateCheckAt || settings.lastAutoUpdateCheckAt) || 0,
      lastAutoUpdateCheckAt: Number(settings.lastAutoUpdateCheckAt) || 0
    },
    games: games.map((game) => ({
      ...game,
      launchArgs: game.launchArgs ?? "",
      coverUrl: game.coverUrl ?? "",
      typeNames: Array.isArray(game.typeNames) ? game.typeNames : [],
      customAdapterRules: normalizeCustomAdapterRules((game as Partial<ManagedGame>).customAdapterRules)
    })),
    activeGameId: typeof data.activeGameId === "string" ? data.activeGameId : "",
    modProfiles,
    mods: mods.map((mod, index) => ({
      ...mod,
      sortIndex: Number.isFinite(Number(mod.sortIndex)) ? Number(mod.sortIndex) : index,
      modTypeId: mod.modTypeId ?? "root",
      modTypeName: mod.modTypeName ?? "游戏根目录",
      deployedFiles: mod.deployedFiles ?? [],
      website: mod.website ?? "",
      description: mod.description ?? "",
      coverImage: mod.coverImage ?? "",
      requirements: stringList(mod.requirements),
      tags: stringList(mod.tags),
      updateSource: normalizeModUpdateSource((mod as Partial<LocalMod>).updateSource)
    })),
    downloads: downloads.map((task) => ({
      ...task,
      status: task.status ?? "queued",
      receivedBytes: task.receivedBytes ?? 0,
      totalBytes: task.totalBytes ?? 0,
      coverImage: task.coverImage ?? "",
      updateSource: normalizeModUpdateSource((task as Partial<DownloadTask>).updateSource),
      updateTargetModId: typeof task.updateTargetModId === "string" ? task.updateTargetModId : "",
      error: task.error ?? ""
    })),
    logs: logs
      .filter((entry) => entry && typeof entry.message === "string")
      .slice(-300)
      .map((entry) => ({
        id: entry.id || createId("log"),
        level: entry.level === "info" ? "info" : "error",
        source: entry.source || "app",
        message: entry.message,
        detail: entry.detail || "",
        createdAt: Number(entry.createdAt) || Date.now()
      })),
    backups: backups
      .filter((backup) => backup && typeof backup.outputPath === "string")
      .map((backup) => ({
        id: backup.id || createId("backup"),
        gameId: backup.gameId || "",
        gameName: backup.gameName || "",
        name: backup.name || baseName(backup.outputPath),
        sourcePath: backup.sourcePath || "",
        outputPath: backup.outputPath,
        size: Number(backup.size) || 0,
        filesCount: Number(backup.filesCount) || 0,
        createdAt: Number(backup.createdAt) || Date.now()
      })),
    dataBackups: dataBackups
      .filter((backup) => backup && typeof backup.outputPath === "string")
      .map((backup) => ({
        id: backup.id || createId("data_backup"),
        name: backup.name || baseName(backup.outputPath),
        outputPath: backup.outputPath,
        size: Number(backup.size) || 0,
        createdAt: Number(backup.createdAt) || Date.now()
      })),
    translationCache: Object.fromEntries(
      Object.entries(rawTranslationCache)
        .filter(([, entry]) => entry && typeof entry === "object" && typeof entry.text === "string")
        .slice(-300)
        .map(([key, entry]) => {
          const record = entry as { text: string; createdAt?: number };
          return [key, {
            text: record.text,
            createdAt: Number(record.createdAt) || Date.now()
          }];
        })
    )
  };
}

export const useLibraryStore = defineStore("library", () => {
  const securityNotice = ref("b战：清梦与狗不得使用，其他人随意使用，不过分抄袭套壳即可");
  const initialized = ref(false);
  const busy = ref(false);
  const error = ref("");
  const updateCheckResult = ref({ visible: false, available: 0, failed: 0 });
  const packageProgress = ref<PackageProgress>({
    visible: false,
    operation: "",
    phase: "",
    current: 0,
    total: 0,
    message: ""
  });
  const updateBatchProgress = ref<UpdateBatchProgress>({
    visible: false,
    current: 0,
    total: 0,
    message: ""
  });
  const appUpdateChecking = ref(false);
  const appUpdateDialogVisible = ref(false);
  const appUpdateInfo = ref<AppUpdateInfo | null>(null);
  const appUpdateCurrentVersion = ref("");
  const appUpdateMessage = ref("");
  const settings = ref({ ...fallbackData.settings });
  const games = ref<ManagedGame[]>([]);
  const activeGameId = ref("");
  const modProfiles = ref<ModProfile[]>([]);
  const nexusPresetId = ref("");
  const mods = ref<LocalMod[]>([]);
  const downloads = ref<DownloadTask[]>([]);
  const logs = ref<AppLogEntry[]>([]);
  const backups = ref<BackupEntry[]>([]);
  const dataBackups = ref<DataBackupEntry[]>([]);
  const translationCache = ref<AppData["translationCache"]>({});
  const backupContents = ref<Record<string, Array<{ path: string; isDirectory: boolean; size: number }>>>({});
  const search = ref("");
  const selectedTypeId = ref("all");
  const selectedTag = ref("all");
  const sortMode = ref<"custom" | "createdDesc" | "createdAsc" | "nameAsc" | "nameDesc" | "installedFirst">("createdDesc");
  const selectedModIds = ref<string[]>([]);
  const selectedProfileId = ref("");
  const profileApplying = ref(false);
  const updateCheckingIds = ref<string[]>([]);
  const presetSearch = ref("");
  const installPlans = ref<Record<string, InstallPlan>>({});
  const nexusSearch = ref("");
  const nexusPage = ref(1);
  const nexusPageSize = ref(20);
  const nexusSort = ref<"default" | "updatedAt" | "createdAt" | "downloads">("downloads");
  const nexusCategory = ref("");
  const nexusLanguage = ref("");
  const nexusTag = ref("");
  const nexusFacets = ref<NexusModListResult["facets"]>({
    categoryName: [],
    languageName: [],
    tag: []
  });
  const nexusMods = ref<NexusModItem[]>([]);
  const nexusTotalCount = ref(0);
  const nexusTotalPages = ref(0);
  const nexusLoading = ref(false);
  const nexusDetailLoading = ref(false);
  const nexusLoginLoading = ref(false);
  const nexusTranslationLoading = ref(false);
  const nexusTranslationVisible = ref(false);
  const nexusTranslationError = ref("");
  const nexusTranslatedSummary = ref("");
  const nexusTranslatedDescription = ref("");
  const selectedNexusMod = ref<NexusModDetail | null>(null);
  const tagPalette = ["#4f8cff", "#65d6ad", "#f5b85c", "#ff8ea3", "#b58cff", "#8bd3ff"];

  const activeGame = computed(() =>
    games.value.find((game) => game.id === activeGameId.value) ?? null
  );

  const visibleGamePresets = computed(() =>
    gamePresets.filter((preset) => !HIDDEN_PRESET_IDS.has(preset.id))
  );

  const nexusPresets = computed(() =>
    visibleGamePresets.value
  );

  const nexusPreset = computed(() =>
    nexusPresets.value.find((preset) => preset.id === nexusPresetId.value) ??
    nexusPresets.value[0] ??
    null
  );

  const presetList = computed(() => {
    const keyword = presetSearch.value.trim().toLowerCase();

    if (!keyword) {
      return visibleGamePresets.value;
    }

    return visibleGamePresets.value.filter((preset) =>
      JSON.stringify(preset).toLowerCase().includes(keyword)
    );
  });

  const presetCount = computed(() => visibleGamePresets.value.length);

  const activeMods = computed(() => {
    const keyword = search.value.trim().toLowerCase();
    let list = mods.value.filter((mod) => mod.gameId === activeGameId.value);

    if (selectedProfileId.value) {
      const profile = activeProfiles.value.find((p) => p.id === selectedProfileId.value);
      if (profile) {
        list = list.filter((mod) => profile.enabledModIds.includes(mod.id));
      }
    }

    if (selectedTypeId.value !== "all") {
      list = list.filter((mod) => mod.modTypeId === selectedTypeId.value);
    }

    if (selectedTag.value !== "all") {
      list = list.filter((mod) => mod.tags.includes(selectedTag.value));
    }

    if (!keyword) {
      return sortMods(list);
    }

    return sortMods(list.filter((mod) =>
      [mod.name, mod.author, mod.version, mod.sourcePath, mod.modTypeName, mod.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    ));
  });

  const activeTags = computed(() => {
    const tags = mods.value
      .filter((mod) => mod.gameId === activeGameId.value)
      .flatMap((mod) => mod.tags);

    return [...new Set(tags)].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  });

  const activeProfiles = computed(() =>
    modProfiles.value
      .filter((profile) => profile.gameId === activeGameId.value)
      .sort((left, right) => left.createdAt - right.createdAt)
  );

  const installedCount = computed(
    () => activeMods.value.filter((mod) => mod.installed).length
  );

  const canReorderMods = computed(() =>
    !search.value.trim() &&
    selectedTypeId.value === "all" &&
    selectedTag.value === "all" &&
    !selectedProfileId.value
  );

  const selectedMods = computed(() =>
    activeMods.value.filter((mod) => selectedModIds.value.includes(mod.id))
  );

  const activeUpdateAvailableCount = computed(() =>
    mods.value.filter((mod) =>
      mod.gameId === activeGameId.value &&
      mod.updateSource?.check?.status === "available"
    ).length
  );

  const activeAdapter = computed(() =>
    activeGame.value ? adapterForGame(activeGame.value) : null
  );

  const activeDownloads = computed(() =>
    [...downloads.value]
      .sort((a, b) => b.createdAt - a.createdAt)
  );

  const nexusAuthorized = computed(() =>
    Boolean(
      settings.value.nexusAccessToken?.trim() ||
      settings.value.nexusApiKey?.trim() ||
      settings.value.nexusUser?.key?.trim()
    )
  );

  function nexusRequestAuth() {
    return {
      apiKey: settings.value.nexusApiKey,
      accessToken: settings.value.nexusAccessToken
    };
  }

  function activeProxyUrl() {
    return settings.value.proxyEnabled ? settings.value.proxyUrl.trim() : "";
  }

  function managedToolCandidates(fileNameValue: string) {
    const normalizedFileName = fileNameValue.toLowerCase();

    return activeMods.value
      .flatMap((mod) => mod.files
        .filter((file) => fileName(file).toLowerCase() === normalizedFileName)
        .map((file) => joinRelativePath(mod.rootPath, file))
      )
      .filter(Boolean);
  }

  function managedToolCandidatesForStrategy(strategy: { kind: string; managedToolFileName?: string }) {
    return strategy.kind === "bg3Pak" && strategy.managedToolFileName
      ? managedToolCandidates(strategy.managedToolFileName)
      : [];
  }

  function toData(): AppData {
    const data = {
      dataVersion: DATA_VERSION,
      settings: settings.value,
      games: games.value,
      activeGameId: activeGameId.value,
      modProfiles: modProfiles.value,
      mods: mods.value,
      downloads: downloads.value,
      logs: logs.value,
      backups: backups.value,
      dataBackups: dataBackups.value,
      translationCache: translationCache.value
    };

    return JSON.parse(JSON.stringify(data)) as AppData;
  }

  function getGameModRoot(game: ManagedGame) {
    return `${settings.value.storagePath}\\mods\\${sanitizeFileName(game.name)}`;
  }

  function toPortableModInfo(mod: LocalMod, index: number) {
    return {
      id: Number(modFolderName(mod.rootPath, String(index + 1))) || index + 1,
      modName: mod.name,
      fileName: baseName(mod.sourcePath),
      modFiles: mod.files,
      modVersion: mod.version || "1.0.0",
      modAuthor: mod.author,
      modWebsite: mod.website,
      modDesc: mod.description,
      cover: mod.coverImage,
      weight: index + 1,
      isInstalled: mod.installed,
      from: "Customize",
      tags: mod.tags,
      modType: mod.modTypeId,
      advanced: {
        deployedFiles: mod.deployedFiles,
        updateSource: mod.updateSource
      }
    };
  }

  async function syncGameModFiles() {
    if (!settings.value.storagePath) return;

    for (const game of games.value) {
      const gameMods = mods.value
        .filter((mod) => mod.gameId === game.id)
        .sort((left, right) => left.sortIndex - right.sortIndex || left.createdAt - right.createdAt);
      const gameRoot = getGameModRoot(game);
      const tags = [...new Set(gameMods.flatMap((mod) => mod.tags))]
        .filter(Boolean)
        .map((tag, index) => ({
          id: index + 1,
          name: tag,
          label: tag,
          value: tag,
          color: settings.value.tagColors[tag] ?? ""
        }));

      await window.mayfly.writeJsonFile(`${gameRoot}\\mod.json`, toPlain(gameMods.map(toPortableModInfo)));
      await window.mayfly.writeJsonFile(`${gameRoot}\\tags.json`, toPlain(tags));
    }
  }

  async function persist() {
    await window.mayfly.writeStore(DATA_FILE, toData());
    await syncGameModFiles();
  }

  async function migrateModCachesToGameLayout() {
    if (!settings.value.storagePath) return;

    const nextFolderByGame = new Map<string, number>();
    const nextFolder = (game: ManagedGame) => {
      const current = nextFolderByGame.get(game.id);
      if (current) {
        nextFolderByGame.set(game.id, current + 1);
        return current;
      }

      const maxFolder = Math.max(
        0,
        ...mods.value
          .filter((mod) => mod.gameId === game.id)
          .map((mod) => Number(modFolderName(mod.rootPath, "0")) || 0)
      );
      nextFolderByGame.set(game.id, maxFolder + 2);
      return maxFolder + 1;
    };
    const migrated: LocalMod[] = [];

    for (const mod of mods.value) {
      const game = games.value.find((item) => item.id === mod.gameId);
      if (!game || mod.installed) {
        migrated.push(mod);
        continue;
      }

      const alreadyGameLayout =
        mod.rootPath.startsWith(`${getGameModRoot(game)}\\`) &&
        /^\d+$/u.test(baseName(mod.rootPath));

      if (alreadyGameLayout || !(await window.mayfly.exists(mod.rootPath))) {
        migrated.push(mod);
        continue;
      }

      try {
        const result = await window.mayfly.migrateModCacheFolder({
          sourcePath: mod.rootPath,
          storagePath: settings.value.storagePath,
          gameName: game.name,
          folderName: String(nextFolder(game))
        });

        migrated.push({
          ...mod,
          rootPath: result.rootPath,
          files: result.files,
          coverImage: result.coverImage ?? mod.coverImage,
          updatedAt: Date.now()
        });
      } catch (caught) {
        await recordLog(
          "error",
          "migration",
          `迁移 Mod 缓存失败：${mod.name}`,
          caught instanceof Error ? caught.message : String(caught)
        );
        migrated.push(mod);
      }
    }

    mods.value = migrated;
  }

  async function loadModsFromGameFiles() {
    if (!settings.value.storagePath) return;

    const nextModsByGame = new Map<string, LocalMod[]>();
    let nextTagColors = { ...settings.value.tagColors };

    for (const game of games.value) {
      const gameRoot = getGameModRoot(game);
      const modJsonPath = `${gameRoot}\\mod.json`;

      if (!(await window.mayfly.exists(modJsonPath))) {
        continue;
      }

      try {
        const rawMods = await window.mayfly.readJsonFile<Array<Record<string, unknown>>>(modJsonPath);
        const rawTagsPath = `${gameRoot}\\tags.json`;

        if (await window.mayfly.exists(rawTagsPath)) {
          const rawTags = await window.mayfly.readJsonFile<Array<Record<string, unknown>>>(rawTagsPath);
          for (const tag of Array.isArray(rawTags) ? rawTags : []) {
            const value = String(tag.value || tag.label || tag.name || tag.title || "").trim();
            const color = String(tag.color || "").trim();
            if (value && color) {
              nextTagColors[value] = color;
            }
          }
        }

        if (!Array.isArray(rawMods)) continue;

        const adapter = adapterForGame(game);
        const parsedMods: LocalMod[] = rawMods.map((item, index) => {
          const numericId = String(item.id || index + 1);
          const rootPath = `${gameRoot}\\${sanitizeFileName(numericId)}`;
          const advanced = item.advanced && typeof item.advanced === "object"
            ? item.advanced as Record<string, unknown>
            : {};
          const tags = stringList(item.tags);
          const files = Array.isArray(item.modFiles) ? item.modFiles.map(String) : [];
          const modType = resolveStoredModType(
            adapter,
            game.presetId,
            item.modType ?? item.modTypeId,
            item.modTypeName,
            files
          );

          return {
            id: `legacy_${game.id}_${numericId}`,
            gameId: game.id,
            sortIndex: Number(item.weight) || index + 1,
            name: String(item.modName || item.name || `Mod ${numericId}`),
            sourcePath: String(item.fileName || rootPath),
            rootPath,
            version: String(item.modVersion || item.version || "1.0.0"),
            author: String(item.modAuthor || item.author || ""),
            website: String(item.modWebsite || item.website || ""),
            description: String(item.modDesc || item.description || ""),
            coverImage: String(item.cover || ""),
            tags,
            requirements: stringList(item.requirements),
            files,
            modTypeId: modType.id,
            modTypeName: modType.name,
            installed: Boolean(item.isInstalled),
            deployedFiles: Array.isArray(advanced.deployedFiles) ? advanced.deployedFiles.map(String) : [],
            updateSource: normalizeModUpdateSource(advanced.updateSource),
            createdAt: Number(item.createdAt) || Date.now(),
            updatedAt: Number(item.updatedAt) || Date.now()
          };
        });

        nextModsByGame.set(game.id, parsedMods);
      } catch (caught) {
        await recordLog(
          "error",
          "legacy-data",
          `读取历史 Mod 数据失败：${game.name}`,
          caught instanceof Error ? caught.message : String(caught)
        );
      }
    }

    if (nextModsByGame.size === 0) return;

    mods.value = [
      ...mods.value.filter((mod) => !nextModsByGame.has(mod.gameId)),
      ...[...nextModsByGame.values()].flat()
    ];
    settings.value = {
      ...settings.value,
      tagColors: nextTagColors
    };
  }

  function normalizeStoredModTypes() {
    const gameMap = new Map(games.value.map((game) => [game.id, game]));

    mods.value = mods.value.map((mod) => {
      const game = gameMap.get(mod.gameId);
      if (!game) return mod;

      const adapter = adapterForGame(game);
      if (adapter.modTypes.some((type) => type.id === mod.modTypeId)) {
        const modType = getModType(adapter, mod.modTypeId);
        return mod.modTypeName === modType.name ? mod : { ...mod, modTypeName: modType.name };
      }

      const modType = resolveStoredModType(adapter, game.presetId, mod.modTypeId, mod.modTypeName, mod.files);
      return {
        ...mod,
        modTypeId: modType.id,
        modTypeName: modType.name,
        updatedAt: Date.now()
      };
    });
  }

  async function initialize() {
    if (initialized.value) return;

    busy.value = true;
    error.value = "";

    try {
      const data = normalizeAppData(await window.mayfly.readStore<AppData>(DATA_FILE, fallbackData));
      const previousDataVersion = data.dataVersion;
      if (data.dataVersion < DATA_VERSION) {
        data.dataVersion = DATA_VERSION;
      }
      settings.value = data.settings;
      games.value = data.games;
      modProfiles.value = data.modProfiles;
      activeGameId.value = data.activeGameId || games.value[0]?.id || "";
      const activePresetId = games.value.find((game) => game.id === activeGameId.value)?.presetId;
      nexusPresetId.value = nexusPresets.value.some((preset) => preset.id === activePresetId)
        ? activePresetId ?? ""
        : nexusPresets.value[0]?.id ?? "";
      mods.value = data.mods;
      normalizeStoredModTypes();
      downloads.value = data.downloads;
      logs.value = data.logs;
      backups.value = data.backups;
      dataBackups.value = data.dataBackups;
      translationCache.value = data.translationCache;
      initialized.value = true;
      if (previousDataVersion < 4) {
        await migrateModCachesToGameLayout();
      }
      await loadModsFromGameFiles();
      await migrateLegacyModCoverImages();
      await persist();
      if (settings.value.appUpdateUrl.trim()) {
        settings.value.lastAppUpdateCheckAt = Date.now();
        await persist();
        window.setTimeout(() => {
          void checkAppUpdate({ silent: true });
        }, 1500);
      }
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "读取本地数据失败";
    } finally {
      busy.value = false;
    }
  }

  async function chooseStoragePath() {
    const selected = await window.mayfly.openDirectory();
    if (!selected) return;

    settings.value.storagePath = selected;
    await persist();
  }

  async function addGame(preset?: GamePreset) {
    let resolvedPath = "";
    let finalExeNames = preset?.exeNames ?? [];

    if (!settings.value.preferDirectoryGamePicker) {
      const selectedExe = await window.mayfly.openExecutable();
      if (!selectedExe) return;

      resolvedPath = dirName(selectedExe);
      const exeName = fileName(selectedExe);

      if (preset?.exeNames.length && !preset.exeNames.includes(exeName)) {
        finalExeNames = [exeName, ...preset.exeNames];
      } else if (!preset) {
        finalExeNames = [exeName];
      }
    } else {
      const selected = await window.mayfly.openDirectory();
      if (!selected) return;

      resolvedPath = selected;

      if (preset?.exeNames.length) {
        const foundExe = await window.mayfly.findFileByName({
          rootPath: selected,
          fileNames: [...preset.exeNames],
          maxDepth: 5
        });

        if (!foundExe) {
          error.value = `所选目录没有找到预期主程序：${preset.exeNames.join(", ")}`;
          return;
        }

        resolvedPath = dirName(foundExe);
      }
    }

    const now = Date.now();
    const game: ManagedGame = {
      id: createId("game"),
      presetId: preset?.id ?? "",
      catalogGameId: preset?.catalogGameId ?? 0,
      steamAppId: preset?.steamAppId ?? 0,
      nexusDomain: preset?.nexusDomain ?? "",
      nexusGameId: preset?.nexusGameId ?? 0,
      name: preset?.name ?? baseName(resolvedPath),
      path: resolvedPath,
      installPath: "",
      launchArgs: "",
      exeNames: finalExeNames,
      coverUrl: preset?.coverUrl ?? "",
      typeNames: preset ? getGameAdapter(preset.id).modTypes.map((type) => type.name) : ["游戏根目录"],
      customAdapterRules: [],
      adapterStatus: preset?.adapterStatus ?? "custom",
      createdAt: now
    };

    games.value = [...games.value, game];
    activeGameId.value = game.id;
    if (preset?.nexusDomain) {
      nexusPresetId.value = preset.id;
    }
    await persist();
  }

  async function openActiveGameModFolder() {
    if (!activeGame.value || !settings.value.storagePath) return;

    const modPath = `${settings.value.storagePath}\\mods\\${activeGame.value.id}`;
    await window.mayfly.openPath(modPath);
  }

  async function setActiveGame(gameId: string) {
    activeGameId.value = gameId;
    error.value = "";
    selectedModIds.value = [];
    selectedTypeId.value = "all";
    selectedTag.value = "all";
    selectedNexusMod.value = null;
    resetNexusTranslation();
    nexusMods.value = [];
    nexusPage.value = 1;
    nexusTotalCount.value = 0;
    nexusTotalPages.value = 0;
    await persist();
  }

  function setNexusPreset(presetId: string) {
    if (!nexusPresets.value.some((preset) => preset.id === presetId)) return;

    nexusPresetId.value = presetId;
    nexusSearch.value = "";
    nexusCategory.value = "";
    nexusLanguage.value = "";
    nexusTag.value = "";
    nexusPage.value = 1;
    nexusMods.value = [];
    nexusTotalCount.value = 0;
    nexusTotalPages.value = 0;
    nexusMods.value = [];
    nexusTotalCount.value = 0;
    nexusTotalPages.value = 0;
    nexusFacets.value = { categoryName: [], languageName: [], tag: [] };
    selectedNexusMod.value = null;
    error.value = "";
  }

  async function updateGame(gameId: string, patch: Partial<ManagedGame>) {
    games.value = games.value.map((game) =>
      game.id === gameId ? { ...game, ...patch } : game
    );
    await persist();
  }

  function customRuleInputToRule(input: CustomAdapterRuleInput): CustomAdapterRule {
    const name = input.name.trim() || "自定义类型";
    const detectValue = input.detectValue.trim();
    const installPath = input.installPath.trim();
    const installName = input.installName.trim() || detectValue || name;

    const install: CustomAdapterRule["install"] = (() => {
      switch (input.installKind) {
        case "folderRoot":
          return { kind: "folderRoot", installPath };
        case "folder":
          return { kind: "folder", installPath, folderName: installName, spare: true };
        case "file":
          return {
            kind: "file",
            installPath,
            fileName: installName,
            isExtname: input.detectKind === "extension",
            commonParent: true
          };
        case "fileSibling":
          return {
            kind: "fileSibling",
            installPath,
            fileName: installName,
            isExtname: input.detectKind === "extension"
          };
        case "manual":
          return { kind: "manual", reason: `${name} 需要手动安装。` };
        case "general":
        default:
          return { kind: "general", installPath, keepPath: input.keepPath };
      }
    })();

    return {
      id: createId("custom_type"),
      name,
      detect: {
        kind: input.detectKind,
        value: detectValue
      },
      install
    };
  }

  async function addCustomAdapterRule(input: CustomAdapterRuleInput) {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return;
    }

    const rule = customRuleInputToRule(input);
    const nextRules = [...activeGame.value.customAdapterRules, rule];

    await updateGame(activeGame.value.id, {
      customAdapterRules: nextRules,
      typeNames: nextRules.map((item) => item.name),
      adapterStatus: "custom"
    });
  }

  async function removeCustomAdapterRule(ruleId: string) {
    if (!activeGame.value) return;

    const nextRules = activeGame.value.customAdapterRules.filter((rule) => rule.id !== ruleId);
    const fallbackTypeId = nextRules[0]?.id || "custom-root";
    const presetStatus = gamePresets.find((preset) => preset.id === activeGame.value?.presetId)?.adapterStatus ?? "custom";
    await updateGame(activeGame.value.id, {
      customAdapterRules: nextRules,
      typeNames: nextRules.length > 0 ? nextRules.map((item) => item.name) : ["游戏根目录"],
      adapterStatus: nextRules.length > 0 ? "custom" : presetStatus
    });
    mods.value = mods.value.map((mod) =>
      mod.gameId === activeGame.value?.id && mod.modTypeId === ruleId
        ? { ...mod, modTypeId: fallbackTypeId, modTypeName: nextRules[0]?.name || "游戏根目录", updatedAt: Date.now() }
        : mod
    );
    await persist();
  }

  async function addCustomGameFromInput(input: CustomGameInput) {
    const now = Date.now();
    const game: ManagedGame = {
      id: createId("game"),
      presetId: "",
      catalogGameId: 0,
      steamAppId: 0,
      nexusDomain: "",
      nexusGameId: 0,
      name: input.name.trim() || baseName(input.path),
      path: input.path.trim(),
      installPath: input.installPath.trim(),
      launchArgs: input.launchArgs.trim(),
      exeNames: input.exeNames,
      coverUrl: input.coverUrl.trim(),
      typeNames: ["游戏根目录", "mods"],
      customAdapterRules: [
        {
          id: "custom-root",
          name: "游戏根目录",
          detect: { kind: "always", value: "" },
          install: {
            kind: "general",
            installPath: input.installPath.trim(),
            keepPath: true
          }
        }
      ],
      adapterStatus: "custom",
      createdAt: now
    };

    games.value = [...games.value, game];
    activeGameId.value = game.id;
    await persist();
  }

  async function locateActiveGameFromSteam() {
    if (!activeGame.value?.steamAppId) {
      error.value = "当前游戏没有 Steam AppID，无法自动定位。";
      return;
    }

    const foundPath = await window.mayfly.findSteamGamePath(activeGame.value.steamAppId);
    if (!foundPath) {
      error.value = `没有在 Steam 库中找到 AppID ${activeGame.value.steamAppId}。`;
      return;
    }

    await updateGame(activeGame.value.id, {
      path: foundPath
    });
  }

  async function chooseActiveGamePath() {
    if (!activeGame.value) return;

    const selected = await window.mayfly.openDirectory();
    if (!selected) return;

    await updateGame(activeGame.value.id, {
      path: selected
    });
  }

  async function chooseActiveGameExecutable() {
    if (!activeGame.value) return;

    const selected = await window.mayfly.openExecutable();
    if (!selected) return;

    const exeName = fileName(selected);
    const exeNames = [...new Set([exeName, ...activeGame.value.exeNames])];

    await updateGame(activeGame.value.id, {
      path: dirName(selected),
      exeNames
    });
  }

  async function launchActiveGame() {
    if (!activeGame.value) return;

    if (!activeGame.value.path) {
      error.value = "请先在左侧游戏列表右键，进入“高级设置”配置游戏目录。";
      return;
    }

    try {
      const exeNames = activeGame.value.exeNames.length > 0
        ? [...activeGame.value.exeNames]
        : [`${activeGame.value.name}.exe`];
      const executablePath = await window.mayfly.findFileByName({
        rootPath: activeGame.value.path,
        fileNames: exeNames,
        maxDepth: 3
      });

      if (!executablePath) {
        error.value = `没有找到可启动文件：${exeNames.join(", ")}。请检查游戏目录是否正确。`;
        return;
      }

      await window.mayfly.launchExecutable({
        executablePath,
        cwd: dirName(executablePath),
        args: activeGame.value.launchArgs
          .split(/\s+/u)
          .map((arg) => arg.trim())
          .filter(Boolean)
      });
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "启动游戏失败";
    }
  }

  async function removeGame(gameId: string) {
    games.value = games.value.filter((game) => game.id !== gameId);
    mods.value = mods.value.filter((mod) => mod.gameId !== gameId);

    if (activeGameId.value === gameId) {
      activeGameId.value = games.value[0]?.id ?? "";
    }

    await persist();
  }

  async function importLocalMods() {
    const sources = await window.mayfly.openModSource();
    await importLocalModsFromPaths(sources);
  }

  async function chooseModCoverImage(modId: string) {
    const mod = mods.value.find((item) => item.id === modId);
    if (!mod) return;

    const sourcePath = await window.mayfly.openImage();
    if (!sourcePath) return;

    try {
      const result = await window.mayfly.copyModCoverImage({
        sourcePath,
        modRoot: mod.rootPath
      });
      await updateMod(modId, {
        coverImage: result.coverImage,
        updatedAt: Date.now()
      });
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "保存 Mod 预览图失败";
    }
  }

  async function migrateLegacyModCoverImages() {
    let changed = false;
    const migratedMods: LocalMod[] = [];

    for (const mod of mods.value) {
      if (!/^\.mayfly[\\/]+preview\./iu.test(mod.coverImage)) {
        migratedMods.push(mod);
        continue;
      }

      try {
        const result = await window.mayfly.migrateModCoverImage({
          modRoot: mod.rootPath,
          coverImage: mod.coverImage
        });
        if (result.coverImage !== mod.coverImage) {
          changed = true;
          migratedMods.push({
            ...mod,
            coverImage: result.coverImage,
            updatedAt: Date.now()
          });
        } else {
          migratedMods.push(mod);
        }
      } catch (caught) {
        await recordLog(
          "error",
          "preview",
          `迁移 Mod 预览图失败：${mod.name}`,
          caught instanceof Error ? caught.message : String(caught)
        );
        migratedMods.push(mod);
      }
    }

    if (changed) {
      mods.value = migratedMods;
    }
  }

  async function importLocalModsFromPaths(
    sources: string[],
    sourceWebsite = "",
    updateSources: Record<string, ModUpdateSource> = {}
  ) {
    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    if (!activeGame.value) {
      error.value = "请先添加并选择一个游戏。";
      return;
    }

    const uniqueSources = [...new Set(sources.map((source) => source.trim()).filter(Boolean))];
    if (uniqueSources.length === 0) return;

    busy.value = true;
    error.value = "";

    try {
      const imported: LocalMod[] = [];
      const existingSourcePaths = new Set(
        mods.value
          .filter((mod) => mod.gameId === activeGame.value?.id)
          .map((mod) => normalizeText(mod.sourcePath))
      );
      const existingNames = new Set(
        mods.value
          .filter((mod) => mod.gameId === activeGame.value?.id)
          .map((mod) => normalizeText(mod.name))
      );
      let nextSortIndex = Math.max(
        -1,
        ...mods.value
          .filter((mod) => mod.gameId === activeGame.value?.id)
          .map((mod) => mod.sortIndex)
      ) + 1;
      let nextFolderId = Math.max(
        0,
        ...mods.value
          .filter((mod) => mod.gameId === activeGame.value?.id)
          .map((mod) => Number(modFolderName(mod.rootPath, "0")) || 0)
      ) + 1;
      let skipped = 0;
      let keptDuplicates = 0;

      for (const sourcePath of uniqueSources) {
        let modName = modNameFromPath(sourcePath);
        const matchedDownload = downloads.value.find((task) =>
          task.source === "NexusMods" &&
          task.modId &&
          normalizeText(task.outputPath) === normalizeText(sourcePath)
        );
        const matchedGame = matchedDownload
          ? games.value.find((game) => game.presetId === matchedDownload.gameId.replace(/^nexus:/u, ""))
          : null;
        const importedCoverImage = matchedDownload?.coverImage ?? "";
        const importedUpdateSource = updateSources[sourcePath] ??
          updateSources[normalizeText(sourcePath)] ??
          matchedDownload?.updateSource;
        const importedSourceWebsite = sourceWebsite ||
          importedUpdateSource?.modPageUrl ||
          (matchedDownload && matchedGame
            ? nexusModWebsite(matchedGame.nexusDomain, matchedDownload.modId)
            : "");
        const isDuplicate =
          existingSourcePaths.has(normalizeText(sourcePath)) ||
          existingNames.has(normalizeText(modName));

        if (isDuplicate) {
          const keepCopy = window.confirm(`“${modName}”疑似已经导入过。要继续导入并保留为副本吗？`);

          if (!keepCopy) {
            skipped += 1;
            continue;
          }

          modName = nextDuplicateName(modName, existingNames);
          keptDuplicates += 1;
        }

        const now = Date.now();
        const id = createId("mod");
        const folderId = String(nextFolderId);
        const result = await window.mayfly.importModFolder({
          sourcePath,
          storagePath: settings.value.storagePath,
          gameId: activeGame.value.id,
          gameName: activeGame.value.name,
          modId: folderId
        });
        const adapter = adapterForGame(activeGame.value);
        const modTypeId = adapter.checkModType(result.files);
        const modType = getModType(adapter, modTypeId);

        imported.push({
          id,
          gameId: activeGame.value.id,
          sortIndex: nextSortIndex,
          name: result.manifest?.name && !isDuplicate ? result.manifest.name : modName,
          sourcePath,
          rootPath: result.rootPath,
          version: result.manifest?.version ?? "",
          author: result.manifest?.author ?? "",
          website: result.manifest?.website || importedSourceWebsite,
          description: result.manifest?.description ?? "",
          coverImage: importedCoverImage || result.coverImage || "",
          tags: result.manifest?.tags ?? [],
          requirements: result.manifest?.requirements ?? [],
          files: result.files,
          modTypeId: modType.id,
          modTypeName: modType.name,
          installed: false,
          deployedFiles: [],
          updateSource: importedUpdateSource,
          createdAt: now,
          updatedAt: now
        });
        nextFolderId += 1;
        nextSortIndex += 1;
        existingSourcePaths.add(normalizeText(sourcePath));
        existingNames.add(normalizeText(modName));
      }

      if (imported.length > 0) {
        mods.value = [...imported, ...mods.value];
        await persist();
      }

      if (skipped > 0) {
        error.value = `已跳过 ${skipped} 个疑似重复 Mod。`;
      } else if (keptDuplicates > 0) {
        error.value = `已保留 ${keptDuplicates} 个重复 Mod 副本。`;
      }
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导入本地 Mod 失败";
    } finally {
      busy.value = false;
    }
  }

  async function saveNexusApiKey(apiKey: string) {
    settings.value.nexusApiKey = apiKey.trim();
    await persist();
  }

  async function loginNexusWithBrowser() {
    nexusLoginLoading.value = true;
    error.value = "";

    try {
      const result = await window.mayfly.startNexusOAuthLogin({
        proxyUrl: activeProxyUrl()
      });
      settings.value.nexusAccessToken = result.accessToken;
      settings.value.nexusRefreshToken = result.refreshToken;
      settings.value.nexusTokenExpiresAt = result.expiresAt;
      settings.value.nexusUser = result.user;
      await persist();
      return result.user;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "Nexus 网页登录失败";
      return null;
    } finally {
      nexusLoginLoading.value = false;
    }
  }

  async function validateNexusApiKey(apiKey = settings.value.nexusApiKey) {
    const key = apiKey.trim();

    if (!key) {
      error.value = "请先填写 NexusMods API Key。";
      return null;
    }

    busy.value = true;
    error.value = "";

    try {
      const user = await window.mayfly.validateNexusApiKey({
        apiKey: key,
        proxyUrl: activeProxyUrl()
      });
      settings.value.nexusApiKey = user.key || key;
      settings.value.nexusAccessToken = "";
      settings.value.nexusRefreshToken = "";
      settings.value.nexusTokenExpiresAt = 0;
      settings.value.nexusUser = user;
      await persist();
      return user;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "校验 NexusMods API Key 失败";
      return null;
    } finally {
      busy.value = false;
    }
  }

  async function clearNexusAuth() {
    settings.value.nexusApiKey = "";
    settings.value.nexusAccessToken = "";
    settings.value.nexusRefreshToken = "";
    settings.value.nexusTokenExpiresAt = 0;
    settings.value.nexusUser = null;
    await persist();
  }

  async function recordLog(
    level: AppLogEntry["level"],
    source: string,
    message: string,
    detail = ""
  ) {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) return;

    logs.value = [
      ...logs.value,
      {
        id: createId("log"),
        level,
        source: source.trim() || "app",
        message: normalizedMessage,
        detail: String(detail || ""),
        createdAt: Date.now()
      }
    ].slice(-300);

    if (initialized.value) {
      await persist();
    }
  }

  async function clearLogs() {
    logs.value = [];
    await persist();
  }

  async function checkAppUpdate(options: { silent?: boolean } = {}): Promise<AppUpdateCheckResult | null> {
    const updateUrl = settings.value.appUpdateUrl.trim();

    if (!updateUrl) {
      if (!options.silent) {
        appUpdateMessage.value = "";
        error.value = "请先在设置里填写应用更新地址。";
      }
      return null;
    }

    appUpdateChecking.value = true;
    appUpdateMessage.value = options.silent ? "" : "正在检查应用更新...";
    if (!options.silent) {
      error.value = "";
    }

    try {
      const result = await window.mayfly.checkAppUpdate({
        updateUrl,
        proxyUrl: activeProxyUrl()
      });

      settings.value.lastAppUpdateCheckAt = Date.now();
      await persist();
      appUpdateCurrentVersion.value = result.currentVersionName;

      if (result.hasUpdate) {
        appUpdateInfo.value = result.remote;
        appUpdateDialogVisible.value = true;
        appUpdateMessage.value = `发现新版本 ${result.remote.versionName}`;
        await recordLog(
          "info",
          "updater",
          `发现应用新版本：${result.remote.versionName}`,
          result.remote.updateLog
        );
      } else if (!options.silent) {
        appUpdateMessage.value = `已是最新版本 ${result.currentVersionName || ""}`.trim();
        await recordLog("info", "updater", "应用已是最新版本", result.currentVersionName);
      }

      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "检查应用更新失败";
      appUpdateMessage.value = "";
      if (!options.silent) {
        error.value = message;
      }
      await recordLog("error", "updater", "检查应用更新失败", message);
      return null;
    } finally {
      appUpdateChecking.value = false;
    }
  }

  function closeAppUpdateDialog() {
    if (appUpdateInfo.value?.forceUpdate) return;
    appUpdateDialogVisible.value = false;
  }

  async function openAppUpdateDownload() {
    const downloadUrl = appUpdateInfo.value?.downloadUrl.trim() ?? "";

    if (!downloadUrl) {
      error.value = "更新下载地址为空。";
      return;
    }

    await window.mayfly.openExternal(downloadUrl);
  }

  async function loadNexusMods(page = nexusPage.value, append = false) {
    if (!nexusPreset.value?.nexusDomain) {
      error.value = "没有选择带 Nexus 配置的游戏。";
      return;
    }

    if (!nexusAuthorized.value) {
      error.value = "请先登录 NexusMods。";
      return;
    }

    nexusLoading.value = true;
    error.value = "";

    try {
      const _startTime = performance.now();
      const result = await window.mayfly.listNexusMods({
        ...nexusRequestAuth(),
        gameDomain: nexusPreset.value.nexusDomain,
        page,
        pageSize: nexusPageSize.value,
        proxyUrl: activeProxyUrl(),
        searchText: nexusSearch.value,
        sort: nexusSort.value,
        facets: {
          categoryName: nexusCategory.value,
          languageName: nexusLanguage.value,
          tag: nexusTag.value
        }
      });
      const _duration = Math.round(performance.now() - _startTime);
      console.groupCollapsed(`%c🌐 [Nexus API] List Mods - ${_duration}ms`, "color: #1a9fff; font-weight: bold;");
      console.log("Request Page:", page);
      console.log("Response:", result);
      console.groupEnd();
      await recordLog("info", "network", `[API/Nexus] 获取列表耗时 ${_duration}ms`, `第 ${page} 页 / ${nexusPageSize.value} 条`);

      const displayResult = await translateNexusListResult(result);

      if (append) {
        nexusMods.value = [...nexusMods.value, ...displayResult.items];
      } else {
        nexusMods.value = displayResult.items;
      }
      nexusPage.value = displayResult.page;
      nexusTotalCount.value = displayResult.totalCount;
      nexusTotalPages.value = displayResult.totalPages;
      nexusFacets.value = displayResult.facets;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "获取 NexusMods 列表失败";
    } finally {
      nexusLoading.value = false;
    }
  }

  async function openNexusModDetail(item: NexusModItem) {
    if (!nexusPreset.value?.nexusDomain) return;

    if (!nexusAuthorized.value) {
      error.value = "请先登录 NexusMods。";
      return;
    }

    nexusDetailLoading.value = true;
    resetNexusTranslation();
    error.value = "";

    try {
      const detail = await window.mayfly.getNexusModDetail({
        ...nexusRequestAuth(),
        gameDomain: nexusPreset.value.nexusDomain,
        modId: item.id,
        proxyUrl: activeProxyUrl()
      });
      selectedNexusMod.value = await translateNexusDetailData(detail);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "获取 NexusMods 详情失败";
    } finally {
      nexusDetailLoading.value = false;
    }
  }

  function resetNexusTranslation() {
    nexusTranslationVisible.value = false;
    nexusTranslationError.value = "";
    nexusTranslatedSummary.value = "";
    nexusTranslatedDescription.value = "";
  }

  function cacheTranslation(key: string, text: string) {
    const nextEntries = [
      ...Object.entries(translationCache.value).filter(([entryKey]) => entryKey !== key),
      [key, { text, createdAt: Date.now() }] as const
    ].slice(-300);

    translationCache.value = Object.fromEntries(nextEntries);
  }

  async function translateTextCached(text: string, context: string, force = false) {
    const normalized = text.trim();
    if (!normalized) return "";

    const key = [
      settings.value.translationProvider,
      settings.value.translationTargetLang,
      context,
      hashText(normalized)
    ].join(":");
    const cached = translationCache.value[key];

    if (cached && !force) {
      return cached.text;
    }

    const _startTime = performance.now();
    try {
      const translated = await window.mayfly.translateText({
        text: normalized,
        provider: settings.value.translationProvider,
        targetLang: settings.value.translationTargetLang,
        proxyUrl: activeProxyUrl(),
        baiduAppId: settings.value.baiduTranslateAppId,
        baiduSecret: settings.value.baiduTranslateSecret,
        youdaoAppKey: settings.value.youdaoTranslateAppKey,
        youdaoSecret: settings.value.youdaoTranslateSecret,
        tencentSecretId: settings.value.tencentTranslateSecretId,
        tencentSecretKey: settings.value.tencentTranslateSecretKey,
        tencentRegion: settings.value.tencentTranslateRegion,
        volcengineAccessKeyId: settings.value.volcengineTranslateAccessKeyId,
        volcengineSecretAccessKey: settings.value.volcengineTranslateSecretAccessKey,
        volcengineRegion: settings.value.volcengineTranslateRegion,
        ollamaBaseUrl: settings.value.ollamaTranslateBaseUrl,
        ollamaModel: settings.value.ollamaTranslateModel,
        ollamaTimeoutMs: settings.value.ollamaTranslateTimeoutMs
      });
      const _duration = Math.round(performance.now() - _startTime);
      console.groupCollapsed(`%c📝 [Translate API] - ${_duration}ms`, "color: #4cd964; font-weight: bold;");
      console.log("Provider:", settings.value.translationProvider);
      console.log("Original:", normalized);
      console.log("Translated:", translated);
      console.groupEnd();
      await recordLog("info", "network", `[API/翻译] 耗时 ${_duration}ms`, `文本: ${normalized.slice(0, 50)}...\n提供商: ${settings.value.translationProvider}`);

      cacheTranslation(key, translated);
      return translated;
    } catch (error) {
      const _duration = Math.round(performance.now() - _startTime);
      console.groupCollapsed(`%c❌ [Translate API] Failed - ${_duration}ms`, "color: #ff3b30; font-weight: bold;");
      console.log("Provider:", settings.value.translationProvider);
      console.log("Original:", normalized);
      console.error(error);
      console.groupEnd();
      await recordLog("error", "network", `[API/翻译] 请求失败，耗时 ${_duration}ms`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  function canTranslateNexusText() {
    return settings.value.translationProvider !== "off";
  }

  async function translateManyTexts(values: string[], context: string, force = false) {
    const result = new Map<string, string>();
    const uniqueValues = [...new Set(values.map((value) => value.replace(/\r?\n/g, " ").trim()).filter(Boolean))];

    if (uniqueValues.length === 0) return result;

    const missingValues: string[] = [];

    for (const value of uniqueValues) {
      const individualContext = `${context}:${hashText(value)}`;
      const key = [
        settings.value.translationProvider,
        settings.value.translationTargetLang,
        individualContext,
        hashText(value)
      ].join(":");

      const cached = translationCache.value[key];
      if (cached && !force) {
        result.set(value, cached.text);
      } else {
        missingValues.push(value);
      }
    }

    if (missingValues.length > 0) {
      try {
        const combinedText = missingValues.join("\n");
        const translatedCombined = await translateTextCached(combinedText, `${context}:batch`, force);

        const translatedLines = translatedCombined.split("\n").map(line => line.trim());

        for (let i = 0; i < missingValues.length; i++) {
          const original = missingValues[i];
          const translated = translatedLines[i] || original;
          result.set(original, translated);

          const individualContext = `${context}:${hashText(original)}`;
          const key = [
            settings.value.translationProvider,
            settings.value.translationTargetLang,
            individualContext,
            hashText(original)
          ].join(":");
          cacheTranslation(key, translated);
        }
      } catch (caught) {
        for (const value of missingValues) result.set(value, value);
        await recordLog(
          "error",
          "translate",
          `批量翻译失败：${missingValues.length} 项`,
          caught instanceof Error ? caught.message : String(caught)
        );
      }
    }

    return result;
  }

  function translatedValue(map: Map<string, string>, value: string) {
    const normalized = value.trim();
    return normalized ? map.get(normalized) ?? value : value;
  }

  async function translateNexusListResult(result: NexusModListResult) {
    if (!canTranslateNexusText()) return result;

    const facetLabels = [
      ...result.facets.categoryName.map((facet) => facet.label)
    ];
    const itemTexts = result.items.flatMap((item) => [
      item.title
    ]);
    const textMap = await translateManyTexts([...facetLabels, ...itemTexts], "nexus:list");
    const translateFacet = <T extends { label: string }>(facet: T) => ({
      ...facet,
      label: translatedValue(textMap, facet.label)
    });

    await persist();

    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        title: translatedValue(textMap, item.title),
        summary: item.summary,
        categories: item.categories
      })),
      facets: {
        categoryName: result.facets.categoryName.map(translateFacet),
        languageName: [],
        tag: result.facets.tag // return untranslated tags since they are not shown
      }
    };
  }

  async function translateNexusDetailData(detail: NexusModDetail) {
    if (!canTranslateNexusText()) return detail;

    const source = nexusTranslationSource(detail);
    const shortTextMap = await translateManyTexts([
      detail.title,
      ...detail.categories,
      ...detail.images.map((image) => image.title),
      ...detail.files.flatMap((file) => [
        file.name,
        file.categoryName
      ])
    ], `nexus:detail:${detail.id}`);
    try {
      const [translatedSummary, translatedDescription] = await Promise.all([
        translateTextCached(source.summary, `nexus:${detail.id}:summary`),
        translateTextCached(source.description, `nexus:${detail.id}:description`)
      ]);

      nexusTranslatedSummary.value = translatedSummary;
      nexusTranslatedDescription.value = translatedDescription;
      nexusTranslationVisible.value = Boolean(translatedSummary || translatedDescription);
    } catch (caught) {
      nexusTranslationError.value = caught instanceof Error ? caught.message : "翻译 Nexus 说明失败";
      await recordLog("error", "translate", "翻译 Nexus 说明失败", nexusTranslationError.value);
    }

    await persist();

    return {
      ...detail,
      title: translatedValue(shortTextMap, detail.title),
      summary: detail.summary,
      categories: detail.categories.map((category) => translatedValue(shortTextMap, category)),
      images: detail.images.map((image) => ({
        ...image,
        title: translatedValue(shortTextMap, image.title)
      })),
      files: detail.files.map((file) => ({
        ...file,
        name: translatedValue(shortTextMap, file.name),
        categoryName: translatedValue(shortTextMap, file.categoryName)
      }))
    };
  }

  function protectBbCode(text: string) {
    const placeholders: string[] = [];
    let protectedText = text.replace(/\[(img|url|youtube|video|spoiler)(?:=[^\]]+)?\][\s\S]*?\[\/\1\]/gi, (match) => {
      placeholders.push(match);
      return ` MAYFLY_TOKEN_${placeholders.length - 1}_ `;
    });

    protectedText = protectedText.replace(/\[\/?(?:b|i|u|s|size|font|center|left|right|color|quote|hr|br|list|li|\*)(?:=[^\]]*)?\]/gi, (match) => {
      placeholders.push(match);
      return ` MAYFLY_TOKEN_${placeholders.length - 1}_ `;
    });

    return { protectedText, placeholders };
  }

  function restoreBbCode(text: string, placeholders: string[]) {
    return text.replace(/MAYFLY_TOKEN_(\d+)_/gi, (match, index) => {
      return placeholders[Number(index)] || match;
    });
  }

  async function translateSelectedNexusMod(force = false) {
    const detail = selectedNexusMod.value;
    if (!detail) return false;

    if (settings.value.translationProvider === "off") {
      nexusTranslationError.value = "请先在设置里开启实验性 Google 免费翻译。";
      await recordLog("error", "translate", nexusTranslationError.value);
      return false;
    }

    nexusTranslationLoading.value = true;
    nexusTranslationError.value = "";

    try {
      const source = nexusTranslationSource(detail);
      const { protectedText, placeholders } = protectBbCode(source.description);

      const [summary, rawTranslatedDescription] = await Promise.all([
        translateTextCached(source.summary, `nexus:${detail.id}:summary`, force),
        translateTextCached(protectedText, `nexus:${detail.id}:description_v2`, force)
      ]);

      const description = restoreBbCode(rawTranslatedDescription, placeholders);

      nexusTranslatedSummary.value = summary;
      nexusTranslatedDescription.value = description;
      nexusTranslationVisible.value = true;
      await persist();
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "翻译失败";
      nexusTranslationError.value = message;
      await recordLog("error", "translate", "Nexus 内容翻译失败", message);
      return false;
    } finally {
      nexusTranslationLoading.value = false;
    }
  }

  function showOriginalNexusText() {
    nexusTranslationVisible.value = false;
  }

  async function openNexusUrl(url: string) {
    if (!url) return;
    await window.mayfly.openExternal(url);
  }

  function comparableNexusFiles(source: ModUpdateSource, detail: NexusModDetail) {
    const currentFile = detail.files.find((file) => file.id === source.fileId);
    const categoryName = currentFile?.categoryName || source.categoryName;
    const sameCategory = categoryName
      ? detail.files.filter((file) => file.categoryName === categoryName)
      : [];
    const mainFiles = detail.files.filter((file) => file.categoryName === "MAIN");

    return sameCategory.length > 0
      ? sameCategory
      : mainFiles.length > 0
        ? mainFiles
        : detail.primaryFile
          ? [detail.primaryFile]
          : detail.files;
  }

  function buildUpdateCheck(source: ModUpdateSource, detail: NexusModDetail): ModUpdateCheck {
    const latestFile = comparableNexusFiles(source, detail)[0] ?? null;
    const checkedAt = Date.now();

    if (!latestFile) {
      return {
        status: "unsupported",
        checkedAt,
        message: "Nexus 没有返回可比较的文件。",
        latestFileId: "",
        latestFileName: "",
        latestVersion: "",
        latestUploadedAt: "",
        detailsUrl: source.modPageUrl
      };
    }

    const latestVersion = latestFile.version || detail.version || "";
    const currentVersion = source.fileVersion || source.modVersion;
    if (!source.fileId && !currentVersion.trim()) {
      return {
        status: "unsupported",
        checkedAt,
        message: "缺少当前版本，无法和 Nexus 最新版本比较。",
        latestFileId: latestFile.id,
        latestFileName: latestFile.name,
        latestVersion,
        latestUploadedAt: latestFile.createdAt,
        detailsUrl: latestFile.detailsUrl || nexusModWebsite(source.gameDomain, source.modId, latestFile.id)
      };
    }

    const hasNewFile = source.fileId
      ? Boolean(latestFile.id && latestFile.id !== source.fileId)
      : Boolean(currentVersion && latestVersion && currentVersion.trim() !== latestVersion.trim());

    return {
      status: hasNewFile ? "available" : "latest",
      checkedAt,
      message: hasNewFile
        ? `发现新版本：${latestVersion || latestFile.name || latestFile.id}`
        : "已是最新。",
      latestFileId: latestFile.id,
      latestFileName: latestFile.name,
      latestVersion,
      latestUploadedAt: latestFile.createdAt,
      detailsUrl: latestFile.detailsUrl || nexusModWebsite(source.gameDomain, source.modId, latestFile.id)
    };
  }

  async function checkModUpdate(mod: LocalMod) {
    const source = mod.updateSource;
    if (!source || source.type !== "nexus") {
      await updateMod(mod.id, {
        updateSource: source
          ? {
            ...source,
            check: {
              status: "unsupported",
              checkedAt: Date.now(),
              message: "这个 Mod 没有可用的 Nexus 来源信息。",
              latestFileId: "",
              latestFileName: "",
              latestVersion: "",
              latestUploadedAt: "",
              detailsUrl: ""
            }
          }
          : undefined
      });
      return null;
    }

    if (!nexusAuthorized.value) {
      error.value = "请先登录 NexusMods。";
      return null;
    }

    if (updateCheckingIds.value.includes(mod.id)) return source.check ?? null;
    updateCheckingIds.value = [...updateCheckingIds.value, mod.id];
    error.value = "";

    try {
      const detail = await window.mayfly.getNexusModDetail({
        ...nexusRequestAuth(),
        gameDomain: source.gameDomain,
        modId: source.modId,
        proxyUrl: activeProxyUrl()
      });
      const check = buildUpdateCheck(source, detail);
      await updateMod(mod.id, {
        updateSource: {
          ...source,
          modVersion: detail.version || source.modVersion,
          coverImage: detail.cover || source.coverImage,
          check
        },
        updatedAt: Date.now()
      });
      return check;
    } catch (caught) {
      const check: ModUpdateCheck = {
        status: "failed",
        checkedAt: Date.now(),
        message: caught instanceof Error ? caught.message : "检查更新失败",
        latestFileId: "",
        latestFileName: "",
        latestVersion: "",
        latestUploadedAt: "",
        detailsUrl: source.modPageUrl
      };
      await updateMod(mod.id, {
        updateSource: {
          ...source,
          check
        },
        updatedAt: Date.now()
      });
      return check;
    } finally {
      updateCheckingIds.value = updateCheckingIds.value.filter((id) => id !== mod.id);
    }
  }

  async function checkActiveGameUpdates(options: { silent?: boolean } = {}) {
    const targets = mods.value.filter((mod) =>
      mod.gameId === activeGameId.value &&
      mod.updateSource?.type === "nexus"
    );

    if (targets.length === 0) {
      if (!options.silent) {
        error.value = "当前游戏没有可检查更新的 Nexus 来源 Mod。";
      }
      return;
    }

    if (!nexusAuthorized.value) {
      if (!options.silent) {
        error.value = "请先登录 NexusMods。";
      }
      return;
    }

    busy.value = true;
    error.value = "";

    try {
      for (const mod of targets) {
        await checkModUpdate(mod);
      }
      await recordLog("info", "updates", `已检查 ${targets.length} 个 Nexus 来源 Mod 更新。`);

      let availableCount = 0;
      let failedCount = 0;
      for (const mod of targets) {
        const status = mod.updateSource?.check?.status;
        if (status === "available") availableCount++;
        else if (status === "failed") failedCount++;
      }
      updateCheckResult.value = { visible: true, available: availableCount, failed: failedCount };
      setTimeout(() => {
        if (updateCheckResult.value.visible) updateCheckResult.value.visible = false;
      }, 5000);
    } finally {
      busy.value = false;
    }
  }

  async function updateNexusMod(mod: LocalMod, options: { skipConfirm?: boolean } = {}) {
    const source = mod.updateSource;
    if (!source || source.type !== "nexus") {
      error.value = "这个 Mod 没有 Nexus 来源信息，无法自动更新。";
      return;
    }

    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    let check = source.check;
    if (check?.status !== "available") {
      check = await checkModUpdate(mod) ?? undefined;
    }

    const latestSource = mods.value.find((item) => item.id === mod.id)?.updateSource ?? source;
    check = latestSource.check;

    if (check?.status !== "available" || !check.latestFileId) {
      error.value = check?.message || "没有可更新的文件。";
      return;
    }

    if (!options.skipConfirm) {
      const confirmed = window.confirm(`确定更新“${mod.name}”吗？\n\n当前文件：${latestSource.fileName || latestSource.fileId}\n新文件：${check.latestFileName || check.latestFileId}`);
      if (!confirmed) return;
    }

    const now = Date.now();
    const outputFile = sanitizeFileName(`${mod.name}-${check.latestFileName || check.latestFileId}`);
    const extension = /\.[a-z0-9]{2,5}$/i.test(outputFile) ? "" : ".zip";
    const nextUpdateSource: ModUpdateSource = {
      ...latestSource,
      fileId: check.latestFileId,
      fileName: check.latestFileName,
      fileVersion: check.latestVersion,
      filePageUrl: check.detailsUrl || nexusModWebsite(latestSource.gameDomain, latestSource.modId, check.latestFileId),
      downloadedAt: now,
      check
    };
    const game = games.value.find((item) => item.id === mod.gameId);
    const task: DownloadTask = {
      id: createId("download"),
      gameId: `nexus:${game?.presetId || latestSource.gameDomain}`,
      gameName: game?.name || latestSource.gameName,
      source: "NexusMods",
      modId: latestSource.modId,
      modName: mod.name,
      fileId: check.latestFileId,
      fileName: check.latestFileName || check.latestFileId,
      url: "",
      outputPath: `${settings.value.storagePath}\\downloads\\updates\\${outputFile}${extension}`,
      coverImage: latestSource.coverImage || mod.coverImage,
      updateSource: nextUpdateSource,
      updateTargetModId: mod.id,
      status: "queued",
      receivedBytes: 0,
      totalBytes: 0,
      error: "",
      createdAt: now,
      updatedAt: now
    };

    downloads.value = [task, ...downloads.value];
    await persist();

    try {
      const url = await window.mayfly.getNexusDownloadUrl({
        ...nexusRequestAuth(),
        gameDomain: latestSource.gameDomain,
        modId: latestSource.modId,
        fileId: check.latestFileId,
        proxyUrl: activeProxyUrl()
      });

      updateDownloadTask(task.id, { url });
      await persist();

      if (isExternalUrl(url)) {
        updateDownloadTask(task.id, {
          status: "external",
          error: ""
        });
        await persist();
        await window.mayfly.openExternal(url);
        return;
      }

      await runDownloadTask(task.id);
    } catch (caught) {
      updateDownloadTask(task.id, {
        status: "failed",
        error: caught instanceof Error ? caught.message : "下载更新失败"
      });
      await persist();
    }
  }

  async function updateAllAvailableMods() {
    const targets = activeMods.value.filter((mod) =>
      mod.updateSource?.check?.status === "available"
    );

    if (targets.length === 0) {
      error.value = "当前游戏没有已检查出的可更新 Mod。";
      return;
    }

    const confirmed = window.confirm(`确定更新当前游戏的 ${targets.length} 个 Mod 吗？会逐个下载并替换。`);
    if (!confirmed) return;

    updateBatchProgress.value = {
      visible: true,
      current: 0,
      total: targets.length,
      message: "准备批量更新..."
    };

    for (let index = 0; index < targets.length; index += 1) {
      const mod = targets[index];
      updateBatchProgress.value = {
        visible: true,
        current: index + 1,
        total: targets.length,
        message: `正在更新：${mod.name}`
      };

      try {
        await updateNexusMod(mod, { skipConfirm: true });
      } catch (caught) {
        await recordLog(
          "error",
          "updates",
          `批量更新失败：${mod.name}`,
          caught instanceof Error ? caught.message : String(caught)
        );
      }
    }

    updateBatchProgress.value = {
      visible: false,
      current: 0,
      total: 0,
      message: ""
    };
  }

  function parseNxmUrl(url: string) {
    const normalized = url.trim();
    if (!/^nxm:\/\//i.test(normalized)) return null;

    try {
      const parsed = new URL(normalized);
      const gameId = decodeURIComponent(parsed.hostname || "").trim().toLowerCase();
      const segments = parsed.pathname.split("/").filter(Boolean);
      const modIndex = segments.findIndex((segment) => segment.toLowerCase() === "mods");
      const fileIndex = segments.findIndex((segment) => segment.toLowerCase() === "files");
      const modId = modIndex >= 0 ? decodeURIComponent(segments[modIndex + 1] || "").trim() : "";
      const fileId = fileIndex >= 0 ? decodeURIComponent(segments[fileIndex + 1] || "").trim() : "";
      const key = parsed.searchParams.get("key")?.trim() || undefined;
      const expires = parsed.searchParams.get("expires")?.trim() || undefined;

      if (!gameId || !modId) return null;

      return { gameId, modId, fileId, key, expires };
    } catch {
      return null;
    }
  }

  async function handleNxmUrl(url: string) {
    const parsed = parseNxmUrl(url);
    if (!parsed) {
      error.value = "无法识别 NXM 链接。";
      return false;
    }

    const preset = nexusPresets.value.find((item) => item.nexusDomain.toLowerCase() === parsed.gameId);
    if (!preset) {
      error.value = `当前未收录 NXM 游戏：${parsed.gameId}。`;
      return false;
    }

    setNexusPreset(preset.id);

    const linkedGame = games.value.find((game) => game.presetId === preset.id);
    if (linkedGame) {
      activeGameId.value = linkedGame.id;
    }

    if (!nexusAuthorized.value) {
      error.value = "收到 NXM 链接，但还没有填写 NexusMods API Key。";
      return false;
    }

    const item: NexusModItem = {
      id: parsed.modId,
      title: parsed.modId,
      summary: "",
      author: "",
      version: "",
      website: "",
      cover: "",
      downloads: 0,
      likes: 0,
      categories: [],
      createdAt: "",
      updatedAt: "",
      nsfw: false,
      filesCount: 0,
      primaryFile: null
    };

    await openNexusModDetail(item);

    if (selectedNexusMod.value && parsed.fileId) {
      const targetFile = selectedNexusMod.value.files.find((file) => file.id === parsed.fileId);
      if (targetFile) {
        await downloadNexusFile(targetFile, selectedNexusMod.value, {
          key: parsed.key,
          expires: parsed.expires
        });
        return true;
      }
    }

    return Boolean(selectedNexusMod.value);
  }

  function updateDownloadTask(taskId: string, patch: Partial<DownloadTask>) {
    downloads.value = downloads.value.map((task) =>
      task.id === taskId ? { ...task, ...patch, updatedAt: Date.now() } : task
    );
  }

  const speedTracker = new Map<string, { lastTime: number; lastBytes: number }>();
  window.mayfly.onDownloadProgress((data) => {
    const task = downloads.value.find((t) => t.id === data.taskId);
    if (!task || task.status !== "downloading") return;

    const now = Date.now();
    const track = speedTracker.get(data.taskId);
    let speed = task.speed || 0;

    if (track) {
      const timeDiff = (now - track.lastTime) / 1000;
      if (timeDiff > 0) {
        const bytesDiff = Math.max(0, data.receivedBytes - track.lastBytes);
        const currentSpeed = bytesDiff / timeDiff;
        speed = speed ? speed * 0.5 + currentSpeed * 0.5 : currentSpeed;
      }
    }

    speedTracker.set(data.taskId, { lastTime: now, lastBytes: data.receivedBytes });

    updateDownloadTask(data.taskId, {
      receivedBytes: data.receivedBytes,
      totalBytes: data.totalBytes,
      speed
    });
  });

  let packageOperationId = "";
  window.mayfly.onPackageProgress((data) => {
    if (!packageOperationId || data.operationId !== packageOperationId) return;

    packageProgress.value = {
      visible: true,
      operation: data.operation,
      phase: data.phase,
      current: data.current,
      total: data.total,
      message: data.message
    };
  });

  function beginPackageOperation(operation: "import" | "export", message: string) {
    packageOperationId = `${operation}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    packageProgress.value = {
      visible: true,
      operation,
      phase: "准备中",
      current: 0,
      total: 0,
      message
    };
    return packageOperationId;
  }

  function endPackageOperation(operationId: string) {
    if (packageOperationId !== operationId) return;

    packageOperationId = "";
    packageProgress.value = {
      visible: false,
      operation: "",
      phase: "",
      current: 0,
      total: 0,
      message: ""
    };
  }

  function isAbortError(caught: unknown) {
    return caught instanceof Error && (
      caught.name === "AbortError" ||
      /abort|cancel|取消|终止|terminated/iu.test(caught.message)
    );
  }

  async function refreshDownloadSize(task: DownloadTask) {
    if (!task.outputPath || !(await window.mayfly.exists(task.outputPath))) return;

    const fileStat = await window.mayfly.stat(task.outputPath);
    updateDownloadTask(task.id, {
      receivedBytes: fileStat.size,
      totalBytes: Math.max(task.totalBytes, fileStat.size)
    });
  }

  async function replaceModFromDownloadedUpdate(task: DownloadTask, outputPath: string) {
    const targetMod = mods.value.find((mod) => mod.id === task.updateTargetModId);
    if (!targetMod || !task.updateSource) return false;

    const targetGame = games.value.find((game) => game.id === targetMod.gameId);
    if (!targetGame) return false;

    const previousActiveGameId = activeGameId.value;
    const wasInstalled = targetMod.installed;
    const backupPath = `${settings.value.storagePath}\\mod-update-backups\\${sanitizeFileName(targetGame.name)}\\${sanitizeFileName(targetMod.name)}-${Date.now()}.zip`;
    let backupCreated = false;

    try {
      activeGameId.value = targetGame.id;

      if (targetMod.rootPath && await window.mayfly.exists(targetMod.rootPath)) {
        await window.mayfly.createBackupZip({
          sourcePath: targetMod.rootPath,
          outputPath: backupPath
        });
        backupCreated = true;
      }

      if (wasInstalled) {
        const uninstalled = await uninstallMod(targetMod);
        if (!uninstalled) {
          throw new Error(error.value || "更新前卸载旧 Mod 失败。");
        }
      }

      if (targetMod.rootPath && await window.mayfly.exists(targetMod.rootPath)) {
        await window.mayfly.remove(targetMod.rootPath);
      }

      const result = await window.mayfly.importModFolder({
        sourcePath: outputPath,
        storagePath: settings.value.storagePath,
        gameId: targetGame.id,
        gameName: targetGame.name,
        modId: modFolderName(targetMod.rootPath, baseName(targetMod.rootPath))
      });
      const nextUpdateSource: ModUpdateSource = {
        ...task.updateSource,
        downloadedAt: Date.now(),
        check: {
          status: "latest",
          checkedAt: Date.now(),
          message: "已更新到当前文件。",
          latestFileId: task.updateSource.fileId,
          latestFileName: task.updateSource.fileName,
          latestVersion: task.updateSource.fileVersion,
          latestUploadedAt: task.updateSource.check?.latestUploadedAt || "",
          detailsUrl: task.updateSource.filePageUrl
        }
      };
      const updatedMod: LocalMod = {
        ...targetMod,
        sourcePath: outputPath,
        rootPath: result.rootPath,
        version: result.manifest?.version || task.updateSource.fileVersion || targetMod.version,
        website: result.manifest?.website || task.updateSource.modPageUrl || targetMod.website,
        description: targetMod.description || result.manifest?.description || "",
        coverImage: targetMod.coverImage || task.updateSource.coverImage || result.coverImage || "",
        requirements: targetMod.requirements.length > 0 ? targetMod.requirements : result.manifest?.requirements ?? [],
        files: result.files,
        installed: false,
        deployedFiles: [],
        updateSource: nextUpdateSource,
        updatedAt: Date.now()
      };

      mods.value = mods.value.map((mod) => mod.id === targetMod.id ? updatedMod : mod);
      await persist();

      if (wasInstalled) {
        await installMod(updatedMod);
      }

      await recordLog("info", "updates", `已更新 Mod：${targetMod.name}`);
      return true;
    } catch (caught) {
      if (backupCreated) {
        try {
          if (targetMod.rootPath && await window.mayfly.exists(targetMod.rootPath)) {
            await window.mayfly.remove(targetMod.rootPath);
          }
          await window.mayfly.restoreBackupZip({
            backupPath,
            targetPath: targetMod.rootPath
          });
          mods.value = mods.value.map((mod) => mod.id === targetMod.id ? targetMod : mod);
          await persist();

          if (wasInstalled && !targetMod.installed) {
            await installMod(targetMod);
          }
        } catch (rollbackCaught) {
          await recordLog(
            "error",
            "updates",
            `更新失败且回滚失败：${targetMod.name}`,
            rollbackCaught instanceof Error ? rollbackCaught.message : String(rollbackCaught)
          );
        }
      }

      error.value = caught instanceof Error ? caught.message : "更新 Mod 失败";
      await recordLog("error", "updates", `更新 Mod 失败：${targetMod.name}`, error.value);
      return false;
    } finally {
      activeGameId.value = previousActiveGameId;
    }
  }

  async function importCompletedDownload(task: DownloadTask, outputPath: string) {
    if (!settings.value.autoImportAfterDownload) return;

    if (task.updateTargetModId) {
      await replaceModFromDownloadedUpdate(task, outputPath);
      return;
    }

    if (task.source === "NexusMods") {
      const presetId = task.gameId.replace(/^nexus:/u, "");
      const localGame = games.value.find((game) => game.presetId === presetId);
      if (!localGame) return;

      const previousActiveGameId = activeGameId.value;
      activeGameId.value = localGame.id;
      await importLocalModsFromPaths([outputPath], "", task.updateSource
        ? {
          [outputPath]: task.updateSource,
          [normalizeText(outputPath)]: task.updateSource
        }
        : {});
      activeGameId.value = previousActiveGameId;
      return;
    }

    const targetGame = games.value.find((game) => game.id === task.gameId) ?? activeGame.value;
    if (!targetGame) return;

    const previousActiveGameId = activeGameId.value;
    activeGameId.value = targetGame.id;
    await importLocalModsFromPaths([outputPath]);
    activeGameId.value = previousActiveGameId;
  }

  async function runDownloadTask(taskId: string, resume = false) {
    const task = downloads.value.find((item) => item.id === taskId);
    if (!task || !task.url || task.status === "downloading") return;

    updateDownloadTask(task.id, {
      status: "downloading",
      error: ""
    });
    await persist();

    try {
      const result = await window.mayfly.downloadFile({
        taskId: task.id,
        url: task.url,
        outputPath: task.outputPath,
        resume,
        proxyUrl: activeProxyUrl(),
        engine: settings.value.downloadEngine,
        aria2ExecutablePath: settings.value.aria2ExecutablePath,
        aria2MaxConnections: settings.value.aria2MaxConnections
      });

      updateDownloadTask(task.id, {
        status: "completed",
        outputPath: result.outputPath,
        receivedBytes: result.receivedBytes,
        totalBytes: result.totalBytes,
        error: ""
      });
      await persist();
      await importCompletedDownload(task, result.outputPath);
    } catch (caught) {
      const current = downloads.value.find((item) => item.id === task.id);

      // 1. Manually paused by user
      if (current?.status === "paused") {
        await refreshDownloadSize(current ?? task);
        updateDownloadTask(task.id, {
          status: "paused",
          error: "已暂停"
        });
        await persist();
        return;
      }

      // 2. Unexpected error or disconnect (including aborts not triggered by user)
      await refreshDownloadSize(current ?? task);
      updateDownloadTask(task.id, {
        status: "failed",
        error: "连接异常，3秒后自动重试..."
      });
      await persist();

      // Schedule auto-retry
      window.setTimeout(() => {
        const checkTask = downloads.value.find((item) => item.id === task.id);
        if (checkTask && checkTask.status === "failed") {
          resumeDownloadTask(task.id).catch(console.error);
        }
      }, 3000);
    }
  }

  async function downloadNexusFile(
    file: NexusModFile,
    mod = selectedNexusMod.value,
    authorization?: NexusDownloadAuthorization
  ) {
    if (!nexusPreset.value || !mod) return;

    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    if (!nexusAuthorized.value) {
      error.value = "请先登录 NexusMods。";
      return;
    }

    const existingTask = downloads.value.find((task) =>
      task.source === "NexusMods" &&
      task.gameId === `nexus:${nexusPreset.value?.id}` &&
      task.modId === mod.id &&
      task.fileId === file.id &&
      ["queued", "downloading", "completed", "external"].includes(task.status)
    );

    if (existingTask && existingTask.status !== "external") {
      error.value = `下载队列里已经有“${file.name}”。`;
      return;
    }

    const now = Date.now();
    const outputFile = sanitizeFileName(`${mod.title || mod.id}-${file.name || file.id}`);
    const extension = /\.[a-z0-9]{2,5}$/i.test(outputFile) ? "" : ".zip";
    const updateSource: ModUpdateSource = {
      type: "nexus",
      gameDomain: nexusPreset.value.nexusDomain,
      gameName: nexusPreset.value.name,
      modId: mod.id,
      fileId: file.id,
      fileName: file.name,
      fileVersion: file.version,
      modVersion: mod.version,
      categoryName: file.categoryName,
      modPageUrl: mod.website || nexusModWebsite(nexusPreset.value.nexusDomain, mod.id),
      filePageUrl: file.detailsUrl || nexusModWebsite(nexusPreset.value.nexusDomain, mod.id, file.id),
      coverImage: mod.cover || "",
      downloadedAt: now
    };
    const task: DownloadTask = existingTask ?? {
      id: createId("download"),
      gameId: `nexus:${nexusPreset.value.id}`,
      gameName: nexusPreset.value.name,
      source: "NexusMods",
      modId: mod.id,
      modName: mod.title,
      fileId: file.id,
      fileName: file.name,
      url: "",
      outputPath: `${settings.value.storagePath}\\downloads\\nexus-${nexusPreset.value.id}\\${outputFile}${extension}`,
      coverImage: mod.cover || "",
      updateSource,
      status: "queued",
      receivedBytes: 0,
      totalBytes: file.size,
      error: "",
      createdAt: now,
      updatedAt: now
    };

    if (existingTask) {
      updateDownloadTask(task.id, {
        url: "",
        status: "queued",
        error: "",
        coverImage: mod.cover || "",
        updateSource,
        totalBytes: Math.max(task.totalBytes, file.size)
      });
    } else {
      downloads.value = [task, ...downloads.value];
    }
    await persist();

    try {
      const url = await window.mayfly.getNexusDownloadUrl({
        ...nexusRequestAuth(),
        gameDomain: nexusPreset.value.nexusDomain,
        modId: mod.id,
        fileId: file.id,
        proxyUrl: activeProxyUrl(),
        key: authorization?.key,
        expires: authorization?.expires
      });

      updateDownloadTask(task.id, { url });
      await persist();

      if (isExternalUrl(url)) {
        updateDownloadTask(task.id, {
          status: "external",
          error: ""
        });
        await persist();
        await window.mayfly.openExternal(url);
        return;
      }

      await runDownloadTask(task.id);
    } catch (caught) {
      updateDownloadTask(task.id, {
        status: "failed",
        error: caught instanceof Error ? caught.message : "下载 NexusMods 文件失败"
      });
      await persist();
    }
  }

  async function openDownloadFile(task: DownloadTask) {
    if (task.status === "external" && task.url) {
      await window.mayfly.openExternal(task.url);
      return;
    }

    if (!task.outputPath) return;
    await window.mayfly.openPath(task.outputPath);
  }

  async function openDownloadFolder(task: DownloadTask) {
    if (!task.outputPath) return;
    await window.mayfly.openPath(dirName(task.outputPath));
  }

  async function downloadCustomUrl(url: string, fileNameInput = "") {
    const normalizedUrl = url.trim();

    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    if (!/^https?:\/\//i.test(normalizedUrl)) {
      error.value = "请输入有效的 http 或 https 下载地址。";
      return;
    }

    const guessedName =
      fileNameInput.trim() ||
      decodeURIComponent(normalizedUrl.split("?")[0].split("/").filter(Boolean).pop() ?? "") ||
      "custom-download.zip";
    const safeName = sanitizeFileName(guessedName);
    const now = Date.now();
    const task: DownloadTask = {
      id: createId("download"),
      gameId: activeGame.value?.id ?? "custom",
      gameName: activeGame.value?.name ?? "自定义下载",
      source: "Custom",
      modId: "",
      modName: fileNameInput.trim() || safeName,
      fileId: "",
      fileName: safeName,
      url: normalizedUrl,
      outputPath: `${settings.value.storagePath}\\downloads\\custom\\${safeName}`,
      status: "queued",
      receivedBytes: 0,
      totalBytes: 0,
      error: "",
      createdAt: now,
      updatedAt: now
    };

    downloads.value = [task, ...downloads.value];
    await persist();

    try {
      await runDownloadTask(task.id);
    } catch (caught) {
      updateDownloadTask(task.id, {
        status: "failed",
        error: caught instanceof Error ? caught.message : "下载自定义 URL 失败"
      });
      await persist();
    }
  }

  async function removeDownloadTask(taskId: string) {
    await removeDownloadTasks([taskId], false);
  }

  async function removeDownloadTasks(taskIds: string[], removeFiles = false) {
    const ids = new Set(taskIds.filter(Boolean));
    const targets = downloads.value.filter((task) => ids.has(task.id));

    for (const task of targets) {
      if (task.status === "downloading") {
        await window.mayfly.cancelDownload(task.id);
      }

      if (removeFiles && task.outputPath) {
        try {
          if (await window.mayfly.exists(task.outputPath)) {
            await window.mayfly.remove(task.outputPath);
          }
        } catch (caught) {
          await recordLog(
            "error",
            "downloads",
            `删除下载文件失败：${task.fileName}`,
            caught instanceof Error ? caught.message : String(caught)
          );
        }
      }
    }

    downloads.value = downloads.value.filter((task) => !ids.has(task.id));
    await persist();
  }

  async function pauseDownloadTask(taskId: string) {
    const task = downloads.value.find((item) => item.id === taskId);
    if (!task || task.status !== "downloading") return;

    updateDownloadTask(task.id, {
      status: "paused",
      error: "正在暂停..."
    });
    await window.mayfly.cancelDownload(task.id);
    await refreshDownloadSize(task);
    updateDownloadTask(task.id, { error: "已暂停" });
    await persist();
  }

  async function resumeDownloadTask(taskId: string) {
    const task = downloads.value.find((item) => item.id === taskId);
    if (!task || !["paused", "failed", "queued"].includes(task.status)) return;

    if (!task.url) {
      updateDownloadTask(task.id, {
        status: "failed",
        error: "没有可继续的下载地址，请重新发起下载。"
      });
      await persist();
      return;
    }

    await runDownloadTask(task.id, true);
  }

  async function pauseDownloadTasks(taskIds: string[]) {
    for (const taskId of [...new Set(taskIds)]) {
      await pauseDownloadTask(taskId);
    }
  }

  async function resumeDownloadTasks(taskIds: string[]) {
    for (const taskId of [...new Set(taskIds)]) {
      await resumeDownloadTask(taskId);
    }
  }

  async function createActiveGameBackup(nameInput = "") {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return;
    }

    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    busy.value = true;
    error.value = "";

    try {
      const now = Date.now();
      const name = sanitizeFileName(nameInput.trim() || `${activeGame.value.name}-${new Date(now).toISOString().slice(0, 10)}`);
      const outputPath = `${settings.value.storagePath}\\backups\\${activeGame.value.id}\\${name}.zip`;
      const result = await window.mayfly.createBackupZip({
        sourcePath: activeGame.value.path,
        outputPath
      });

      backups.value = [
        {
          id: createId("backup"),
          gameId: activeGame.value.id,
          gameName: activeGame.value.name,
          name,
          sourcePath: activeGame.value.path,
          outputPath: result.outputPath,
          size: result.size,
          filesCount: result.filesCount,
          createdAt: now
        },
        ...backups.value
      ];
      await persist();
      await recordLog("info", "backup", `已创建备份：${name}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "创建备份失败";
    } finally {
      busy.value = false;
    }
  }

  async function createActiveSaveBackup(nameInput = "") {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return;
    }

    if (!settings.value.storagePath) {
      error.value = "请先在设置里选择 Mod 存储路径。";
      return;
    }

    const savePath = await window.mayfly.openDirectory();
    if (!savePath) return;

    busy.value = true;
    error.value = "";

    try {
      const now = Date.now();
      const name = sanitizeFileName(nameInput.trim() || `${activeGame.value.name}-存档-${new Date(now).toISOString().slice(0, 10)}`);
      const outputPath = `${settings.value.storagePath}\\backups\\${activeGame.value.id}\\saves\\${name}.zip`;
      const result = await window.mayfly.createBackupZip({
        sourcePath: savePath,
        outputPath
      });

      backups.value = [
        {
          id: createId("backup"),
          gameId: activeGame.value.id,
          gameName: `${activeGame.value.name} 存档`,
          name,
          sourcePath: savePath,
          outputPath: result.outputPath,
          size: result.size,
          filesCount: result.filesCount,
          createdAt: now
        },
        ...backups.value
      ];
      await persist();
      await recordLog("info", "backup", `已创建存档备份：${name}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "创建存档备份失败";
    } finally {
      busy.value = false;
    }
  }

  async function restoreBackup(backup: BackupEntry) {
    const targetPath = backup.sourcePath || games.value.find((item) => item.id === backup.gameId)?.path || "";

    if (!targetPath) {
      error.value = "恢复失败：没有找到恢复目录。";
      return;
    }

    busy.value = true;
    error.value = "";

    try {
      await window.mayfly.restoreBackupZip({
        backupPath: backup.outputPath,
        targetPath
      });
      await recordLog("info", "backup", `已恢复备份：${backup.name}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "恢复备份失败";
    } finally {
      busy.value = false;
    }
  }

  async function removeBackup(backup: BackupEntry, removeFile = false) {
    if (removeFile && backup.outputPath) {
      await window.mayfly.remove(backup.outputPath);
    }

    backups.value = backups.value.filter((item) => item.id !== backup.id);
    await persist();
  }

  async function renameBackup(backupId: string, name: string) {
    const nextName = name.trim();
    if (!nextName) return;

    backups.value = backups.value.map((backup) =>
      backup.id === backupId ? { ...backup, name: nextName } : backup
    );
    await persist();
  }

  async function importBackupFile() {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return;
    }

    const paths = await window.mayfly.openArchive();
    const backupPath = paths.find((path) => /\.zip$/iu.test(path)) ?? "";
    if (!backupPath) {
      error.value = "请选择 zip 备份文件。";
      return;
    }

    try {
      const fileStat = await window.mayfly.stat(backupPath);
      const contents = await window.mayfly.listBackupZip(backupPath);
      const backup: BackupEntry = {
        id: createId("backup"),
        gameId: activeGame.value.id,
        gameName: activeGame.value.name,
        name: modNameFromPath(backupPath),
        sourcePath: activeGame.value.path,
        outputPath: backupPath,
        size: fileStat.size,
        filesCount: contents.filter((entry) => !entry.isDirectory).length,
        createdAt: Date.now()
      };

      backups.value = [backup, ...backups.value];
      backupContents.value = {
        ...backupContents.value,
        [backup.id]: contents
      };
      await persist();
      await recordLog("info", "backup", `已导入备份文件：${backup.name}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导入备份文件失败";
    }
  }

  async function loadBackupContents(backup: BackupEntry) {
    try {
      backupContents.value = {
        ...backupContents.value,
        [backup.id]: await window.mayfly.listBackupZip(backup.outputPath)
      };
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "读取备份内容失败";
    }
  }

  async function openBackupFolder(backup?: BackupEntry) {
    if (backup?.outputPath) {
      await window.mayfly.openPath(dirName(backup.outputPath));
      return;
    }

    if (!settings.value.storagePath) return;
    await window.mayfly.openPath(`${settings.value.storagePath}\\backups`);
  }

  async function exportData() {
    const defaultName = `mayfly-data-${new Date().toISOString().slice(0, 10)}.json`;
    const outputPath = await window.mayfly.saveJson(defaultName);
    if (!outputPath) return;

    await window.mayfly.writeJsonFile(outputPath, toData());
    await recordLog("info", "data", `已导出数据：${outputPath}`);
  }

  async function importData() {
    const inputPath = await window.mayfly.openJson();
    if (!inputPath) return;

    try {
      const imported = normalizeAppData(await window.mayfly.readJsonFile<Partial<AppData>>(inputPath));
      const gameIds = new Set(games.value.map((game) => game.id));
      const profileIds = new Set(modProfiles.value.map((profile) => profile.id));
      const modIds = new Set(mods.value.map((mod) => mod.id));
      const downloadIds = new Set(downloads.value.map((task) => task.id));
      const backupIds = new Set(backups.value.map((backup) => backup.id));
      const logIds = new Set(logs.value.map((log) => log.id));

      games.value = [
        ...games.value,
        ...imported.games.filter((game) => !gameIds.has(game.id))
      ];
      modProfiles.value = [
        ...modProfiles.value,
        ...imported.modProfiles.filter((profile) => !profileIds.has(profile.id))
      ];
      mods.value = [
        ...mods.value,
        ...imported.mods.filter((mod) => !modIds.has(mod.id))
      ];
      downloads.value = [
        ...downloads.value,
        ...imported.downloads.filter((task) => !downloadIds.has(task.id))
      ];
      backups.value = [
        ...backups.value,
        ...imported.backups.filter((backup) => !backupIds.has(backup.id))
      ];
      logs.value = [
        ...logs.value,
        ...imported.logs.filter((log) => !logIds.has(log.id))
      ].slice(-300);

      if (!activeGameId.value && games.value[0]) {
        activeGameId.value = games.value[0].id;
      }

      await persist();
      await recordLog("info", "data", `已导入数据：${inputPath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导入数据失败";
    }
  }

  async function exportModsToPackage(options: {
    targetMods: LocalMod[];
    name: string;
    author: string;
    version: string;
    description: string;
  }) {
    const targetMods = options.targetMods.filter((mod) => mod.rootPath);

    if (targetMods.length === 0) {
      error.value = "请先选择要导出的 Mod。";
      return;
    }

    const packageName = options.name.trim() || (targetMods.length === 1 ? targetMods[0].name : "Mayfly Mod Pack");
    const outputPath = await window.mayfly.saveFile({
      defaultPath: `${sanitizeFileName(packageName)}.mmp`,
      filters: [
        { name: "Mayfly Mod Package", extensions: ["mmp"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (!outputPath) return;

    const manifest = {
      format: "mayfly-mod-package",
      version: 1,
      name: packageName,
      author: options.author.trim(),
      modVersion: options.version.trim(),
      description: options.description.trim(),
      exportedAt: new Date().toISOString(),
      mods: targetMods.map((mod) => ({
        id: mod.id,
        name: mod.name,
        version: mod.version,
        author: mod.author,
        website: mod.website,
        description: mod.description,
        tags: mod.tags,
        requirements: mod.requirements,
        updateSource: mod.updateSource,
        folder: sanitizeFileName(mod.name || mod.id)
      }))
    };

    const operationId = beginPackageOperation("export", "正在导出 Mod 包...");
    busy.value = true;
    error.value = "";

    try {
      const finalPath = outputPath.toLowerCase().endsWith(".mmp")
        ? outputPath
        : `${outputPath}.mmp`;
      await window.mayfly.exportModPackage({
        outputPath: finalPath,
        operationId,
        manifest: toPlain(manifest),
        mods: toPlain(targetMods.map((mod) => ({
          rootPath: mod.rootPath,
          folderName: sanitizeFileName(mod.name || mod.id)
        })))
      });
      await recordLog("info", "package", `已导出 .mmp：${finalPath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导出 .mmp 失败";
    } finally {
      busy.value = false;
      endPackageOperation(operationId);
    }
  }

  async function exportActiveGamePack(nameInput = "") {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return;
    }

    const gameMods = mods.value.filter((mod) => mod.gameId === activeGame.value?.id && mod.rootPath);
    if (gameMods.length === 0) {
      error.value = "当前游戏还没有可导出的 Mod。";
      return;
    }

    const packageName = nameInput.trim() || `${activeGame.value.name} Mod 整合包`;
    const outputPath = await window.mayfly.saveFile({
      defaultPath: `${sanitizeFileName(packageName)}.zip`,
      filters: [
        { name: "Mayfly Game Mod Pack", extensions: ["zip"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (!outputPath) return;

    const orderedMods = [...gameMods].sort((left, right) => left.sortIndex - right.sortIndex || left.createdAt - right.createdAt);
    const manifest = {
      format: "mayfly-game-pack",
      version: 1,
      name: packageName,
      game: {
        id: activeGame.value.id,
        presetId: activeGame.value.presetId,
        name: activeGame.value.name,
        path: activeGame.value.path,
        installPath: activeGame.value.installPath,
        launchArgs: activeGame.value.launchArgs,
        exeNames: activeGame.value.exeNames,
        coverUrl: activeGame.value.coverUrl,
        typeNames: activeGame.value.typeNames,
        customAdapterRules: activeGame.value.customAdapterRules,
        adapterStatus: activeGame.value.adapterStatus,
        steamAppId: activeGame.value.steamAppId,
        nexusDomain: activeGame.value.nexusDomain,
        nexusGameId: activeGame.value.nexusGameId,
        catalogGameId: activeGame.value.catalogGameId
      },
      tagColors: settings.value.tagColors,
      exportedAt: new Date().toISOString(),
      mods: orderedMods.map((mod, index) => ({
        id: mod.id,
        folder: modFolderName(mod.rootPath, String(index + 1)),
        name: mod.name,
        sourcePath: mod.sourcePath,
        version: mod.version,
        author: mod.author,
        website: mod.website,
        description: mod.description,
        coverImage: mod.coverImage,
        tags: mod.tags,
        requirements: mod.requirements,
        updateSource: mod.updateSource,
        modTypeId: mod.modTypeId,
        modTypeName: mod.modTypeName,
        sortIndex: index,
        installed: mod.installed
      }))
    };
    const finalPath = isPackageArchive(outputPath) ? outputPath : `${outputPath}.zip`;
    const operationId = beginPackageOperation("export", "正在导出游戏整合包...");
    busy.value = true;
    error.value = "";

    try {
      await window.mayfly.exportModPackage({
        outputPath: finalPath,
        operationId,
        manifest: toPlain(manifest),
        mods: toPlain(orderedMods.map((mod, index) => ({
          rootPath: mod.rootPath,
          folderName: modFolderName(mod.rootPath, String(index + 1))
        })))
      });
      await recordLog("info", "package", `已导出游戏整合包：${finalPath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导出游戏整合包失败";
    } finally {
      busy.value = false;
      endPackageOperation(operationId);
    }
  }

  async function restoreActiveGamePack() {
    if (!settings.value.storagePath) {
      error.value = "请先设置 Mod 存储路径。";
      return;
    }

    const paths = await window.mayfly.openArchive();
    const packagePath = paths.find(isPackageArchive) ?? "";
    if (!packagePath) return;
    const manifest = await window.mayfly.readPackageManifest(packagePath);
    const gameMeta = manifest.game && typeof manifest.game === "object"
      ? manifest.game as Record<string, unknown>
      : {};
    const gameName = String(gameMeta.name || "").trim();

    if (manifest.format !== "mayfly-game-pack" || !gameName) {
      error.value = "这不是有效的游戏 Mod 整合包。";
      return;
    }

    const confirmed = window.confirm(`确定恢复“${gameName}”整合包吗？这会添加或选中该游戏，并替换它的 Mod 管理列表。`);
    if (!confirmed) return;

    busy.value = true;
    error.value = "";
    const operationId = beginPackageOperation("import", "正在准备导入整合包...");

    try {
      let targetGame = games.value.find((game) =>
        (game.presetId && game.presetId === String(gameMeta.presetId || "")) ||
        game.name === gameName
      );

      if (!targetGame) {
        const now = Date.now();
        targetGame = {
          id: createId("game"),
          presetId: String(gameMeta.presetId || ""),
          catalogGameId: Number(gameMeta.catalogGameId) || 0,
          steamAppId: Number(gameMeta.steamAppId) || 0,
          nexusDomain: String(gameMeta.nexusDomain || ""),
          nexusGameId: Number(gameMeta.nexusGameId) || 0,
          name: gameName,
          path: String(gameMeta.path || ""),
          installPath: String(gameMeta.installPath || ""),
          launchArgs: String(gameMeta.launchArgs || ""),
          exeNames: Array.isArray(gameMeta.exeNames) ? gameMeta.exeNames.map(String) : [],
          coverUrl: String(gameMeta.coverUrl || ""),
          typeNames: Array.isArray(gameMeta.typeNames) ? gameMeta.typeNames.map(String) : [],
          customAdapterRules: normalizeCustomAdapterRules(gameMeta.customAdapterRules),
          adapterStatus: gameMeta.adapterStatus === "custom" ? "custom" : "implemented",
          createdAt: now
        };
        games.value = [...games.value, targetGame];
      } else {
        games.value = games.value.map((game) =>
          game.id === targetGame?.id
            ? {
              ...game,
              name: gameName,
              path: String(gameMeta.path || game.path),
              installPath: String(gameMeta.installPath || game.installPath),
              launchArgs: String(gameMeta.launchArgs || game.launchArgs),
              coverUrl: String(gameMeta.coverUrl || game.coverUrl),
              customAdapterRules: normalizeCustomAdapterRules(gameMeta.customAdapterRules).length > 0
                ? normalizeCustomAdapterRules(gameMeta.customAdapterRules)
                : game.customAdapterRules
            }
            : game
        );
        targetGame = games.value.find((game) => game.id === targetGame?.id) ?? targetGame;
      }

      activeGameId.value = targetGame.id;
      const tagColors = manifest.tagColors && typeof manifest.tagColors === "object"
        ? manifest.tagColors as Record<string, string>
        : {};
      settings.value = {
        ...settings.value,
        tagColors: {
          ...settings.value.tagColors,
          ...tagColors
        }
      };
      const oldGameMods = mods.value.filter((mod) => mod.gameId === targetGame.id);
      for (const mod of oldGameMods) {
        if (mod.rootPath && await window.mayfly.exists(mod.rootPath)) {
          await window.mayfly.remove(mod.rootPath);
        }
      }

      const result = await window.mayfly.importGamePack({
        packagePath,
        storagePath: settings.value.storagePath,
        gameName: targetGame.name,
        overwrite: true,
        operationId
      });
      const adapter = adapterForGame(targetGame);
      const packedMods = Array.isArray(result.manifest.mods) ? result.manifest.mods as Array<Record<string, unknown>> : [];
      const restoredMods: LocalMod[] = result.mods.map((imported, index) => {
        const meta = packedMods.find((item) => String(item.folder) === imported.folder) ?? {};
        const now = Date.now();
        const modType = resolveStoredModType(
          adapter,
          targetGame.presetId,
          meta.modTypeId ?? meta.modType,
          meta.modTypeName,
          imported.files
        );

        return {
          id: createId("mod"),
          gameId: targetGame.id,
          sortIndex: Number(meta.sortIndex) || index,
          name: String(meta.name || imported.folder),
          sourcePath: String(meta.sourcePath || packagePath),
          rootPath: imported.rootPath,
          version: String(meta.version || ""),
          author: String(meta.author || ""),
          website: String(meta.website || ""),
          description: String(meta.description || ""),
          coverImage: imported.coverImage || String(meta.coverImage || ""),
          tags: stringList(meta.tags),
          requirements: stringList(meta.requirements),
          files: imported.files,
          modTypeId: modType.id,
          modTypeName: modType.name,
          installed: false,
          deployedFiles: [],
          updateSource: normalizeModUpdateSource(meta.updateSource),
          createdAt: now,
          updatedAt: now
        };
      });

      mods.value = [
        ...mods.value.filter((mod) => mod.gameId !== targetGame.id),
        ...restoredMods
      ];
      selectedModIds.value = [];
      await persist();
      await recordLog("info", "package", `已恢复游戏整合包：${packagePath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "恢复游戏整合包失败";
    } finally {
      busy.value = false;
      endPackageOperation(operationId);
    }
  }

  async function installMod(mod: LocalMod) {
    if (!activeGame.value) return;

    busy.value = true;
    error.value = "";

    try {
      const adapter = adapterForGame(activeGame.value);
      const modType = getModType(adapter, mod.modTypeId);
      const managedToolCandidates = managedToolCandidatesForStrategy(modType.install);

      const plan = await window.mayfly.createInstallPlan({
        modRoot: mod.rootPath,
        gamePath: activeGame.value.path,
        targetFolderName: mod.name,
        strategy: toPlain(modType.install),
        useSymlink: settings.value.useSymlinkInstall
      });

      if (plan.conflicts.length > 0) {
        const preview = plan.conflicts.slice(0, 5).join(", ");
        const more = plan.conflicts.length > 5 ? ` 等 ${plan.conflicts.length} 个文件` : "";
        throw new Error(`安装会覆盖已存在文件，已阻止：${preview}${more}`);
      }

      const result = await window.mayfly.applyModStrategy({
        modRoot: mod.rootPath,
        gamePath: activeGame.value.path,
        targetFolderName: mod.name,
        strategy: toPlain(modType.install),
        isInstall: true,
        useSymlink: settings.value.useSymlinkInstall,
        managedToolCandidates
      });
      await updateMod(mod.id, {
        installed: true,
        deployedFiles: result.deployedFiles,
        updatedAt: Date.now()
      });
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "安装 Mod 失败";
    } finally {
      busy.value = false;
    }
  }

  async function previewInstallPlan(mod: LocalMod) {
    if (!activeGame.value) return null;

    busy.value = true;
    error.value = "";

    try {
      const adapter = adapterForGame(activeGame.value);
      const modType = getModType(adapter, mod.modTypeId);
      const plan = await window.mayfly.createInstallPlan({
        modRoot: mod.rootPath,
        gamePath: activeGame.value.path,
        targetFolderName: mod.name,
        strategy: toPlain(modType.install),
        useSymlink: settings.value.useSymlinkInstall
      });

      installPlans.value = {
        ...installPlans.value,
        [mod.id]: plan
      };
      return plan;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "生成安装计划失败";
      return null;
    } finally {
      busy.value = false;
    }
  }

  async function installSelectedMods() {
    for (const mod of [...selectedMods.value].sort(compareGameInstallOrder)) {
      if (!mod.installed) {
        await installMod(mod);
      }
    }
  }

  async function removeDeployedFilesWithFallback(gamePath: string, deployedFiles: string[]) {
    const files = [...deployedFiles]
      .map((file) => file.trim())
      .filter(Boolean)
      .sort((left, right) => right.replace(/\\/g, "/").split("/").length - left.replace(/\\/g, "/").split("/").length);

    try {
      await window.mayfly.removeDeployedFiles({
        gamePath,
        deployedFiles: files
      });
      return;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);

      if (!/EISDIR|directory|目录/iu.test(message)) {
        throw caught;
      }

      await recordLog("info", "mods", "卸载时遇到目录记录，已切换递归清理。", message);
    }

    for (const file of files) {
      const targetPath = joinGameRelativePath(gamePath, file);
      if (!targetPath) continue;
      await window.mayfly.remove(targetPath);
    }
  }

  async function uninstallMod(mod: LocalMod) {
    if (!activeGame.value) return false;

    busy.value = true;
    error.value = "";

    try {
      const adapter = adapterForGame(activeGame.value);
      const modType = getModType(adapter, mod.modTypeId);
      const strategy = modType.uninstall ?? modType.install;
      const managedToolCandidates = managedToolCandidatesForStrategy(strategy);

      if (mod.deployedFiles.length > 0 && !strategyNeedsManagedUninstall(strategy.kind)) {
        await removeDeployedFilesWithFallback(activeGame.value.path, mod.deployedFiles);
      } else {
        await window.mayfly.applyModStrategy({
          modRoot: mod.rootPath,
          gamePath: activeGame.value.path,
          targetFolderName: mod.name,
          strategy: toPlain(strategy),
          isInstall: false,
          useSymlink: settings.value.useSymlinkInstall,
          managedToolCandidates
        });
      }

      await updateMod(mod.id, {
        installed: false,
        deployedFiles: [],
        updatedAt: Date.now()
      });
      return true;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "卸载 Mod 失败";
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function uninstallSelectedMods() {
    for (const mod of [...selectedMods.value].sort((left, right) => compareGameInstallOrder(right, left))) {
      if (mod.installed) {
        await uninstallMod(mod);
      }
    }
  }

  async function updateMod(modId: string, patch: Partial<LocalMod>) {
    mods.value = mods.value.map((mod) =>
      mod.id === modId ? { ...mod, ...patch } : mod
    );
    await persist();
  }

  async function updateSelectedMods(patch: Partial<LocalMod> & { appendTags?: string[] }) {
    const selectedIds = new Set(selectedMods.value.map((mod) => mod.id));
    const now = Date.now();

    mods.value = mods.value.map((mod) => {
      if (!selectedIds.has(mod.id)) return mod;

      const nextTags = patch.appendTags
        ? [...new Set([...mod.tags, ...patch.appendTags])]
        : (patch.tags ?? mod.tags);

      return {
        ...mod,
        ...patch,
        tags: nextTags,
        updatedAt: now
      };
    });
    await persist();
  }

  function currentProfileSnapshot(gameId: string) {
    const gameMods = mods.value
      .filter((mod) => mod.gameId === gameId)
      .sort((left, right) => left.sortIndex - right.sortIndex || left.createdAt - right.createdAt);

    return {
      enabledModIds: gameMods.filter((mod) => mod.installed).map((mod) => mod.id),
      modOrder: gameMods.map((mod) => mod.id)
    };
  }

  async function createModProfile(nameInput: string) {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return null;
    }

    const name = nameInput.trim();
    if (!name) {
      error.value = "请输入配置档案名称。";
      return null;
    }

    if (activeProfiles.value.some((profile) => profile.name.toLowerCase() === name.toLowerCase())) {
      error.value = "当前游戏已经有同名配置档案。";
      return null;
    }

    const snapshot = currentProfileSnapshot(activeGame.value.id);
    const now = Date.now();
    const profile: ModProfile = {
      id: createId("profile"),
      gameId: activeGame.value.id,
      name,
      enabledModIds: selectedModIds.value.length > 0 ? [...selectedModIds.value] : snapshot.enabledModIds,
      modOrder: snapshot.modOrder,
      createdAt: now,
      updatedAt: now
    };
    modProfiles.value = [...modProfiles.value, profile];
    await persist();
    return profile;
  }

  async function saveModProfile(profileId: string) {
    if (!activeGame.value) return false;
    const profile = activeProfiles.value.find((item) => item.id === profileId);
    if (!profile) return false;

    modProfiles.value = modProfiles.value.map((item) =>
      item.id === profileId
        ? {
          ...item,
          enabledModIds: selectedModIds.value.length > 0 ? [...selectedModIds.value] : currentProfileSnapshot(activeGame.value!.id).enabledModIds,
          modOrder: currentProfileSnapshot(activeGame.value!.id).modOrder,
          updatedAt: Date.now()
        }
        : item
    );
    await persist();
    return true;
  }

  async function addSelectedModsToProfile(profileId: string) {
    if (!activeGame.value || selectedModIds.value.length === 0) return false;
    const profile = activeProfiles.value.find((item) => item.id === profileId);
    if (!profile) return false;

    const newIds = [...new Set([...profile.enabledModIds, ...selectedModIds.value])];
    modProfiles.value = modProfiles.value.map((item) =>
      item.id === profileId ? { ...item, enabledModIds: newIds, updatedAt: Date.now() } : item
    );
    await persist();
    clearSelection();
    return true;
  }

  async function removeSelectedModsFromProfile(profileId: string) {
    if (!activeGame.value || selectedModIds.value.length === 0) return false;
    const profile = activeProfiles.value.find((item) => item.id === profileId);
    if (!profile) return false;

    const idsToRemove = new Set(selectedModIds.value);
    const newIds = profile.enabledModIds.filter(id => !idsToRemove.has(id));

    modProfiles.value = modProfiles.value.map((item) =>
      item.id === profileId ? { ...item, enabledModIds: newIds, updatedAt: Date.now() } : item
    );
    await persist();
    clearSelection();
    return true;
  }

  async function renameModProfile(profileId: string, nameInput: string) {
    const profile = activeProfiles.value.find((item) => item.id === profileId);
    const name = nameInput.trim();
    if (!profile || !name) return false;

    if (activeProfiles.value.some((item) =>
      item.id !== profileId && item.name.toLowerCase() === name.toLowerCase()
    )) {
      error.value = "当前游戏已经有同名配置档案。";
      return false;
    }

    modProfiles.value = modProfiles.value.map((item) =>
      item.id === profileId ? { ...item, name, updatedAt: Date.now() } : item
    );
    await persist();
    return true;
  }

  async function removeModProfile(profileId: string) {
    if (!activeProfiles.value.some((profile) => profile.id === profileId)) return false;

    modProfiles.value = modProfiles.value.filter((profile) => profile.id !== profileId);
    await persist();
    return true;
  }

  async function applyModProfile(profileId: string) {
    if (!activeGame.value) {
      error.value = "请先选择一个游戏。";
      return false;
    }

    const profile = activeProfiles.value.find((item) => item.id === profileId);
    if (!profile) return false;
    if (profileApplying.value) return false;

    const gameMods = mods.value.filter((mod) => mod.gameId === activeGame.value?.id);
    const modMap = new Map(gameMods.map((mod) => [mod.id, mod]));
    const desiredIds = new Set(profile.enabledModIds.filter((id) => modMap.has(id)));
    const orderIndex = new Map(profile.modOrder.map((id, index) => [id, index]));
    const desiredOrder = gameMods
      .filter((mod) => desiredIds.has(mod.id))
      .sort((left, right) =>
        (orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      );
    const toUninstall = gameMods.filter((mod) => mod.installed && !desiredIds.has(mod.id));
    const toInstall = desiredOrder.filter((mod) => !mod.installed);

    profileApplying.value = true;
    error.value = "";

    try {
      for (const mod of [...toUninstall].sort((left, right) => right.sortIndex - left.sortIndex)) {
        const success = await uninstallMod(mod);
        if (!success) {
          throw new Error(error.value || `卸载 Mod 失败：${mod.name}`);
        }
      }

      for (const mod of toInstall) {
        await installMod(mod);
        const latest = mods.value.find((item) => item.id === mod.id);
        if (!latest?.installed) {
          throw new Error(error.value || `安装 Mod 失败：${mod.name}`);
        }
      }

      const orderedIds = [
        ...profile.modOrder.filter((id) => modMap.has(id)),
        ...gameMods.map((mod) => mod.id).filter((id) => !profile.modOrder.includes(id))
      ];
      const sortMap = new Map(orderedIds.map((id, index) => [id, index]));
      mods.value = mods.value.map((mod) =>
        mod.gameId === activeGame.value?.id && sortMap.has(mod.id)
          ? { ...mod, sortIndex: sortMap.get(mod.id) ?? mod.sortIndex, updatedAt: Date.now() }
          : mod
      );
      await persist();
      return true;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "应用配置档案失败";
      return false;
    } finally {
      profileApplying.value = false;
    }
  }

  async function setTagColor(tag: string, color: string) {
    settings.value.tagColors = {
      ...settings.value.tagColors,
      [tag]: color
    };
    await persist();
  }

  async function updateSettings(patch: Partial<typeof settings.value>) {
    if (typeof patch.launchAtStartup === "boolean") {
      patch.launchAtStartup = await window.mayfly.setLaunchAtStartup(patch.launchAtStartup);
    }

    settings.value = {
      ...settings.value,
      ...patch
    };
    await persist();
  }

  async function removeMod(mod: LocalMod) {
    if (mod.installed) {
      const uninstalled = await uninstallMod(mod);
      if (!uninstalled) return;
    }

    await window.mayfly.remove(mod.rootPath);
    mods.value = mods.value.filter((item) => item.id !== mod.id);
    selectedModIds.value = selectedModIds.value.filter((id) => id !== mod.id);
    await persist();
  }

  async function removeSelectedMods() {
    for (const mod of [...selectedMods.value]) {
      await removeMod(mod);
    }
  }

  function toggleModSelection(modId: string, selected?: boolean) {
    const nextSelected = selected ?? !selectedModIds.value.includes(modId);

    selectedModIds.value = nextSelected
      ? [...new Set([...selectedModIds.value, modId])]
      : selectedModIds.value.filter((id) => id !== modId);
  }

  function selectAllVisibleMods() {
    selectedModIds.value = [...new Set([...selectedModIds.value, ...activeMods.value.map((mod) => mod.id)])];
  }

  function clearSelection() {
    selectedModIds.value = [];
  }

  async function reorderActiveMods(draggedId: string, targetId: string) {
    if (!activeGame.value || draggedId === targetId) return false;

    if (!canReorderMods.value) {
      error.value = "拖拽排序前请先清空搜索、类型和标签筛选。";
      return false;
    }

    const orderedIds = activeMods.value.map((mod) => mod.id);
    const fromIndex = orderedIds.indexOf(draggedId);
    const toIndex = orderedIds.indexOf(targetId);

    if (fromIndex < 0 || toIndex < 0) return false;

    const [movedId] = orderedIds.splice(fromIndex, 1);
    orderedIds.splice(toIndex, 0, movedId);
    const orderMap = new Map(orderedIds.map((id, index) => [id, index]));
    const now = Date.now();

    sortMode.value = "custom";
    mods.value = mods.value.map((mod) =>
      mod.gameId === activeGame.value?.id && orderMap.has(mod.id)
        ? { ...mod, sortIndex: orderMap.get(mod.id) ?? mod.sortIndex, updatedAt: now }
        : mod
    );
    await persist();
    return true;
  }

  function sortMods(list: LocalMod[]) {
    const next = [...list];

    switch (sortMode.value) {
      case "custom":
        return next.sort((a, b) => a.sortIndex - b.sortIndex || compareGameInstallOrder(a, b));
      case "createdAsc":
        return next.sort((a, b) => a.createdAt - b.createdAt);
      case "nameAsc":
        return next.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
      case "nameDesc":
        return next.sort((a, b) => b.name.localeCompare(a.name, "zh-Hans-CN"));
      case "installedFirst":
        return next.sort((a, b) => Number(b.installed) - Number(a.installed) || b.updatedAt - a.updatedAt);
      case "createdDesc":
      default:
        return next.sort((a, b) => b.createdAt - a.createdAt);
    }
  }

  function setError(message: string) {
    error.value = message;
  }

  let lastLoggedError = "";
  watch(error, (message) => {
    const normalized = message.trim();
    if (!normalized || normalized === lastLoggedError) return;
    lastLoggedError = normalized;
    void recordLog("error", "library", normalized);
  });

  return {
    securityNotice,
    initialized,
    busy,
    error,
    settings,
    games,
    activeGameId,
    activeGame,
    nexusPresetId,
    nexusPreset,
    nexusPresets,
    activeAdapter,
    presetSearch,
    presetList,
    presetCount,
    mods,
    downloads,
    logs,
    backups,
    backupContents,
    search,
    selectedTypeId,
    selectedTag,
    sortMode,
    selectedModIds,
    profileApplying,
    installPlans,
    nexusSearch,
    nexusPage,
    nexusPageSize,
    nexusSort,
    nexusCategory,
    nexusLanguage,
    nexusTag,
    nexusFacets,
    nexusMods,
    nexusTotalCount,
    nexusTotalPages,
    nexusLoading,
    nexusDetailLoading,
    nexusLoginLoading,
    nexusTranslationLoading,
    nexusTranslationVisible,
    nexusTranslationError,
    nexusTranslatedSummary,
    nexusTranslatedDescription,
    selectedNexusMod,
    nexusAuthorized,
    tagPalette,
    selectedProfileId,
    activeMods,
    activeTags,
    activeProfiles,
    installedCount,
    canReorderMods,
    selectedMods,
    activeUpdateAvailableCount,
    activeDownloads,
    packageProgress,
    updateBatchProgress,
    updateCheckResult,
    checkModUpdate,
    updateCheckingIds,
    appUpdateChecking,
    appUpdateDialogVisible,
    appUpdateInfo,
    appUpdateCurrentVersion,
    appUpdateMessage,
    initialize,
    chooseStoragePath,
    addGame,
    addCustomGameFromInput,
    openActiveGameModFolder,
    setActiveGame,
    setNexusPreset,
    updateGame,
    addCustomAdapterRule,
    removeCustomAdapterRule,
    chooseActiveGamePath,
    chooseActiveGameExecutable,
    locateActiveGameFromSteam,
    launchActiveGame,
    removeGame,
    importLocalMods,
    chooseModCoverImage,
    importLocalModsFromPaths,
    saveNexusApiKey,
    loginNexusWithBrowser,
    validateNexusApiKey,
    clearNexusAuth,
    recordLog,
    clearLogs,
    checkAppUpdate,
    closeAppUpdateDialog,
    openAppUpdateDownload,
    loadNexusMods,
    openNexusModDetail,
    openNexusUrl,
    translateSelectedNexusMod,
    showOriginalNexusText,
    handleNxmUrl,
    downloadNexusFile,
    checkActiveGameUpdates,
    updateNexusMod,
    updateAllAvailableMods,
    downloadCustomUrl,
    openDownloadFile,
    openDownloadFolder,
    removeDownloadTask,
    removeDownloadTasks,
    pauseDownloadTask,
    resumeDownloadTask,
    pauseDownloadTasks,
    resumeDownloadTasks,
    createActiveGameBackup,
    createActiveSaveBackup,
    restoreBackup,
    removeBackup,
    renameBackup,
    importBackupFile,
    loadBackupContents,
    openBackupFolder,
    exportData,
    importData,
    exportModsToPackage,
    exportActiveGamePack,
    restoreActiveGamePack,
    installMod,
    previewInstallPlan,
    installSelectedMods,
    uninstallMod,
    uninstallSelectedMods,
    updateMod,
    updateSelectedMods,
    createModProfile,
    saveModProfile,
    addSelectedModsToProfile,
    removeSelectedModsFromProfile,
    renameModProfile,
    removeModProfile,
    applyModProfile,
    setTagColor,
    updateSettings,
    removeMod,
    removeSelectedMods,
    toggleModSelection,
    selectAllVisibleMods,
    clearSelection,
    reorderActiveMods,
    setError,
    translateTextCached
  };
});
