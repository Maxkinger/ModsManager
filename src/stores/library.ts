import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { getGameAdapter, getModType } from "@/adapters";
import { gamePresets } from "@/data/game-presets";
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
  NexusModDetail,
  NexusModFile,
  NexusModItem,
  NexusModListResult
} from "@/types/domain";

const DATA_FILE = "mayfly-library.json";
const DATA_VERSION = 8;

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function baseName(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function modNameFromPath(path: string) {
  return baseName(path).replace(/\.(zip|rar|7z|gmm)$/i, "");
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

const glossTypeIdMap: Record<string, Record<string, string>> = {
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

  const mappedId = glossTypeIdMap[presetId]?.[rawId];
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
    theme: "dark",
    language: "zh-CN",
    defaultTab: "manager",
    autoImportAfterDownload: true,
    proxyEnabled: false,
    proxyUrl: "",
    preferDirectoryGamePicker: true,
    launchAtStartup: false,
    allowGameRunningChanges: false,
    debugMode: false,
    showDebugInfo: false,
    autoCheckUpdates: false
  },
  games: [],
  activeGameId: "",
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
  const mods = Array.isArray(data.mods) ? data.mods : [];
  const downloads = Array.isArray(data.downloads) ? data.downloads : [];
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const backups = Array.isArray(data.backups) ? data.backups : [];
  const dataBackups = Array.isArray(data.dataBackups) ? data.dataBackups : [];
  const rawTranslationCache = data.translationCache && typeof data.translationCache === "object"
    ? data.translationCache
    : {};

  return {
    dataVersion: Number(data.dataVersion) || DATA_VERSION,
    settings: {
      ...fallbackData.settings,
      ...settings,
      tagColors: settings.tagColors ?? {},
      useSymlinkInstall: Number(data.dataVersion) < 3 ? true : settings.useSymlinkInstall ?? true,
      nexusApiKey: settings.nexusApiKey ?? "",
      nexusUser: settings.nexusUser ?? null,
      translationProvider: ["google-gtx", "baidu", "youdao", "tencent", "volcengine"].includes(String(settings.translationProvider))
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
      theme: settings.theme ?? "dark",
      language: settings.language ?? "zh-CN",
      defaultTab: settings.defaultTab ?? "manager",
      autoImportAfterDownload: settings.autoImportAfterDownload ?? true,
      proxyEnabled: settings.proxyEnabled ?? false,
      proxyUrl: settings.proxyUrl ?? "",
      preferDirectoryGamePicker: settings.preferDirectoryGamePicker ?? true,
      launchAtStartup: settings.launchAtStartup ?? false,
      allowGameRunningChanges: settings.allowGameRunningChanges ?? false,
      debugMode: settings.debugMode ?? false,
      showDebugInfo: settings.showDebugInfo ?? false,
      autoCheckUpdates: settings.autoCheckUpdates ?? false
    },
    games: games.map((game) => ({
      ...game,
      launchArgs: game.launchArgs ?? "",
      coverUrl: game.coverUrl ?? "",
      typeNames: Array.isArray(game.typeNames) ? game.typeNames : [],
      customAdapterRules: normalizeCustomAdapterRules((game as Partial<ManagedGame>).customAdapterRules)
    })),
    activeGameId: typeof data.activeGameId === "string" ? data.activeGameId : "",
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
      tags: stringList(mod.tags)
    })),
    downloads: downloads.map((task) => ({
      ...task,
      status: task.status ?? "queued",
      receivedBytes: task.receivedBytes ?? 0,
      totalBytes: task.totalBytes ?? 0,
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
  const initialized = ref(false);
  const busy = ref(false);
  const error = ref("");
  const settings = ref({ ...fallbackData.settings });
  const games = ref<ManagedGame[]>([]);
  const activeGameId = ref("");
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

  const nexusPresets = computed(() =>
    gamePresets
  );

  const nexusPreset = computed(() =>
    nexusPresets.value.find((preset) => preset.id === nexusPresetId.value) ??
    nexusPresets.value[0] ??
    null
  );

  const presetList = computed(() => {
    const keyword = presetSearch.value.trim().toLowerCase();

    if (!keyword) {
      return gamePresets;
    }

    return gamePresets.filter((preset) =>
      [
        preset.name,
        preset.sourceFile,
        preset.glossGameId,
        preset.steamAppId,
        preset.nexusDomain,
        preset.nexusGameId,
        preset.exeNames.join(" "),
        preset.typeNames.join(" ")
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  });

  const presetCount = computed(() => gamePresets.length);

  const activeMods = computed(() => {
    const keyword = search.value.trim().toLowerCase();
    let list = mods.value.filter((mod) => mod.gameId === activeGameId.value);

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

  const installedCount = computed(
    () => activeMods.value.filter((mod) => mod.installed).length
  );

  const canReorderMods = computed(() =>
    !search.value.trim() &&
    selectedTypeId.value === "all" &&
    selectedTag.value === "all"
  );

  const selectedMods = computed(() =>
    activeMods.value.filter((mod) => selectedModIds.value.includes(mod.id))
  );

  const activeAdapter = computed(() =>
    activeGame.value ? adapterForGame(activeGame.value) : null
  );

  const activeDownloads = computed(() =>
    [...downloads.value]
      .sort((a, b) => b.createdAt - a.createdAt)
  );

  const nexusAuthorized = computed(() => Boolean(settings.value.nexusUser?.key?.trim()));

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

  function toGlossModInfo(mod: LocalMod, index: number) {
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
        deployedFiles: mod.deployedFiles
      }
    };
  }

  async function syncGlossGameFiles() {
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

      await window.mayfly.writeJsonFile(`${gameRoot}\\mod.json`, toPlain(gameMods.map(toGlossModInfo)));
      await window.mayfly.writeJsonFile(`${gameRoot}\\tags.json`, toPlain(tags));
    }
  }

  async function persist() {
    await window.mayfly.writeStore(DATA_FILE, toData());
    await syncGlossGameFiles();
  }

  async function migrateModCachesToGlossLayout() {
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

      const alreadyGlossLayout =
        mod.rootPath.startsWith(`${getGameModRoot(game)}\\`) &&
        /^\d+$/u.test(baseName(mod.rootPath));

      if (alreadyGlossLayout || !(await window.mayfly.exists(mod.rootPath))) {
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

  async function loadModsFromGlossFiles() {
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
            id: `gloss_${game.id}_${numericId}`,
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
            createdAt: Number(item.createdAt) || Date.now(),
            updatedAt: Number(item.updatedAt) || Date.now()
          };
        });

        nextModsByGame.set(game.id, parsedMods);
      } catch (caught) {
        await recordLog(
          "error",
          "gloss-data",
          `读取 Gloss Mod 数据失败：${game.name}`,
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
        await migrateModCachesToGlossLayout();
      }
      await loadModsFromGlossFiles();
      await persist();
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
    const selected = await window.mayfly.openDirectory();
    if (!selected) return;

    let resolvedPath = selected;

    if (preset?.exeNames.length) {
      const foundExe = await window.mayfly.findFileByName({
        rootPath: selected,
        fileNames: preset.exeNames,
        maxDepth: 5
      });

      if (!foundExe) {
        error.value = `所选目录没有找到预期主程序：${preset.exeNames.join(", ")}`;
        return;
      }

      resolvedPath = dirName(foundExe);
    }

    const now = Date.now();
    const game: ManagedGame = {
      id: createId("game"),
      presetId: preset?.id ?? "",
      glossGameId: preset?.glossGameId ?? 0,
      steamAppId: preset?.steamAppId ?? 0,
      nexusDomain: preset?.nexusDomain ?? "",
      nexusGameId: preset?.nexusGameId ?? 0,
      name: preset?.name ?? baseName(selected),
      path: resolvedPath,
      installPath: "",
      launchArgs: "",
      exeNames: preset?.exeNames ?? [],
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
      glossGameId: 0,
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

    const exeNames = activeGame.value.exeNames.length > 0
      ? activeGame.value.exeNames
      : [`${activeGame.value.name}.exe`];
    const executablePath = await window.mayfly.findFileByName({
      rootPath: activeGame.value.path,
      fileNames: exeNames,
      maxDepth: 3
    });

    if (!executablePath) {
      error.value = `没有找到可启动文件：${exeNames.join(", ")}。可以先选择 exe 更新游戏路径。`;
      return;
    }

    try {
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

  async function importLocalModsFromPaths(sources: string[]) {
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
          website: result.manifest?.website ?? "",
          description: result.manifest?.description ?? "",
          coverImage: result.coverImage ?? "",
          tags: result.manifest?.tags ?? [],
          requirements: result.manifest?.requirements ?? [],
          files: result.files,
          modTypeId: modType.id,
          modTypeName: modType.name,
          installed: false,
          deployedFiles: [],
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
      const result = await window.mayfly.listNexusMods({
        apiKey: settings.value.nexusApiKey,
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
        apiKey: settings.value.nexusApiKey,
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
      volcengineRegion: settings.value.volcengineTranslateRegion
    });

    cacheTranslation(key, translated);
    return translated;
  }

  function canTranslateNexusText() {
    return settings.value.translationProvider !== "off";
  }

  async function translateManyTexts(values: string[], context: string, force = false) {
    const result = new Map<string, string>();
    const uniqueValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))];

    for (const value of uniqueValues) {
      try {
        result.set(value, await translateTextCached(value, `${context}:${hashText(value)}`, force));
      } catch (caught) {
        result.set(value, value);
        await recordLog(
          "error",
          "translate",
          `翻译失败：${value.slice(0, 40)}`,
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
      ...result.facets.categoryName.map((facet) => facet.label),
      ...result.facets.languageName.map((facet) => facet.label),
      ...result.facets.tag.map((facet) => facet.label)
    ];
    const itemTexts = result.items.flatMap((item) => [
      item.title,
      item.summary,
      ...item.categories
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
        summary: translatedValue(textMap, item.summary),
        categories: item.categories.map((category) => translatedValue(textMap, category))
      })),
      facets: {
        categoryName: result.facets.categoryName.map(translateFacet),
        languageName: result.facets.languageName.map(translateFacet),
        tag: result.facets.tag.map(translateFacet)
      }
    };
  }

  async function translateNexusDetailData(detail: NexusModDetail) {
    if (!canTranslateNexusText()) return detail;

    const source = nexusTranslationSource(detail);
    const shortTextMap = await translateManyTexts([
      detail.title,
      detail.summary,
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
      summary: translatedValue(shortTextMap, detail.summary),
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
      const [summary, description] = await Promise.all([
        translateTextCached(source.summary, `nexus:${detail.id}:summary`, force),
        translateTextCached(source.description, `nexus:${detail.id}:description`, force)
      ]);

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

  function isAbortError(caught: unknown) {
    return caught instanceof Error && (
      caught.name === "AbortError" ||
      /abort|cancel|取消|中止/iu.test(caught.message)
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

  async function importCompletedDownload(task: DownloadTask, outputPath: string) {
    if (!settings.value.autoImportAfterDownload) return;

    if (task.source === "NexusMods") {
      const presetId = task.gameId.replace(/^nexus:/u, "");
      const localGame = games.value.find((game) => game.presetId === presetId);
      if (!localGame) return;

      const previousActiveGameId = activeGameId.value;
      activeGameId.value = localGame.id;
      await importLocalModsFromPaths([outputPath]);
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
        proxyUrl: activeProxyUrl()
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
      if (current?.status === "paused" || isAbortError(caught)) {
        await refreshDownloadSize(current ?? task);
        updateDownloadTask(task.id, {
          status: "paused",
          error: "已暂停"
        });
        await persist();
        return;
      }

      updateDownloadTask(task.id, {
        status: "failed",
        error: caught instanceof Error ? caught.message : "下载失败"
      });
      await persist();
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
      ["queued", "downloading", "completed"].includes(task.status)
    );

    if (existingTask) {
      error.value = `下载队列里已经有“${file.name}”。`;
      return;
    }

    const now = Date.now();
    const outputFile = sanitizeFileName(`${mod.title || mod.id}-${file.name || file.id}`);
    const extension = /\.[a-z0-9]{2,5}$/i.test(outputFile) ? "" : ".zip";
    const task: DownloadTask = {
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
      status: "queued",
      receivedBytes: 0,
      totalBytes: file.size,
      error: "",
      createdAt: now,
      updatedAt: now
    };

    downloads.value = [task, ...downloads.value];
    await persist();

    try {
      const url = await window.mayfly.getNexusDownloadUrl({
        apiKey: settings.value.nexusApiKey,
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
          error: "NexusMods 没有给管理器直链，已打开网页下载页。"
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
    const task = downloads.value.find((item) => item.id === taskId);
    if (task?.status === "downloading") {
      await window.mayfly.cancelDownload(taskId);
    }
    downloads.value = downloads.value.filter((task) => task.id !== taskId);
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
      const modIds = new Set(mods.value.map((mod) => mod.id));
      const downloadIds = new Set(downloads.value.map((task) => task.id));
      const backupIds = new Set(backups.value.map((backup) => backup.id));
      const logIds = new Set(logs.value.map((log) => log.id));

      games.value = [
        ...games.value,
        ...imported.games.filter((game) => !gameIds.has(game.id))
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

  async function exportModsToGmm(options: {
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
      defaultPath: `${sanitizeFileName(packageName)}.gmm`,
      filters: [
        { name: "GMM Mod Package", extensions: ["gmm"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (!outputPath) return;

    const manifest = {
      format: "mayfly-gmm",
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
        folder: sanitizeFileName(mod.name || mod.id)
      }))
    };

    try {
      const finalPath = outputPath.toLowerCase().endsWith(".gmm")
        ? outputPath
        : `${outputPath}.gmm`;
      await window.mayfly.exportGmm({
        outputPath: finalPath,
        manifest: toPlain(manifest),
        mods: toPlain(targetMods.map((mod) => ({
          rootPath: mod.rootPath,
          folderName: sanitizeFileName(mod.name || mod.id)
        })))
      });
      await recordLog("info", "gmm", `已导出 .gmm：${finalPath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导出 .gmm 失败";
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
        glossGameId: activeGame.value.glossGameId
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
        modTypeId: mod.modTypeId,
        modTypeName: mod.modTypeName,
        sortIndex: index,
        installed: mod.installed
      }))
    };
    const finalPath = /\.(zip|gmm)$/i.test(outputPath) ? outputPath : `${outputPath}.zip`;

    try {
      await window.mayfly.exportGmm({
        outputPath: finalPath,
        manifest: toPlain(manifest),
        mods: toPlain(orderedMods.map((mod, index) => ({
          rootPath: mod.rootPath,
          folderName: modFolderName(mod.rootPath, String(index + 1))
        })))
      });
      await recordLog("info", "gmm", `已导出游戏整合包：${finalPath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导出游戏整合包失败";
    }
  }

  async function restoreActiveGamePack() {
    if (!settings.value.storagePath) {
      error.value = "请先设置 Mod 存储路径。";
      return;
    }

    const paths = await window.mayfly.openArchive();
    const packagePath = paths.find((path) => /\.(zip|gmm)$/i.test(path)) ?? "";
    if (!packagePath) return;
    const manifest = await window.mayfly.readGmmManifest(packagePath);
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
          glossGameId: Number(gameMeta.glossGameId) || 0,
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
        overwrite: true
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
      await recordLog("info", "gmm", `已恢复游戏整合包：${packagePath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "恢复游戏整合包失败";
    } finally {
      busy.value = false;
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
    nexusTranslationLoading,
    nexusTranslationVisible,
    nexusTranslationError,
    nexusTranslatedSummary,
    nexusTranslatedDescription,
    selectedNexusMod,
    nexusAuthorized,
    tagPalette,
    activeMods,
    activeTags,
    installedCount,
    canReorderMods,
    selectedMods,
    activeDownloads,
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
    importLocalModsFromPaths,
    saveNexusApiKey,
    validateNexusApiKey,
    clearNexusAuth,
    recordLog,
    clearLogs,
    loadNexusMods,
    openNexusModDetail,
    openNexusUrl,
    translateSelectedNexusMod,
    showOriginalNexusText,
    handleNxmUrl,
    downloadNexusFile,
    downloadCustomUrl,
    openDownloadFile,
    openDownloadFolder,
    removeDownloadTask,
    pauseDownloadTask,
    resumeDownloadTask,
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
    exportModsToGmm,
    exportActiveGamePack,
    restoreActiveGamePack,
    installMod,
    previewInstallPlan,
    installSelectedMods,
    uninstallMod,
    uninstallSelectedMods,
    updateMod,
    updateSelectedMods,
    setTagColor,
    updateSettings,
    removeMod,
    removeSelectedMods,
    toggleModSelection,
    selectAllVisibleMods,
    clearSelection,
    reorderActiveMods,
    setError
  };
});
