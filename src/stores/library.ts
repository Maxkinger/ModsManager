import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { getGameAdapter, getModType } from "@/adapters";
import { gamePresets } from "@/data/game-presets";
import type {
  AppData,
  AppLogEntry,
  BackupEntry,
  DownloadTask,
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
const DATA_VERSION = 2;

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

function normalizeLoose(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "");
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

function fileName(path: string) {
  return baseName(path);
}

function sanitizeFileName(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "-").trim() || "download.bin";
}

function isExternalUrl(url: string) {
  return /^https?:\/\/www\.nexusmods\.com\//i.test(url);
}

interface CustomGameInput {
  name: string;
  path: string;
  exeNames: string[];
  installPath: string;
  launchArgs: string;
  coverUrl: string;
}

const fallbackData: AppData = {
  dataVersion: DATA_VERSION,
  settings: {
    storagePath: "",
    tagColors: {},
    useSymlinkInstall: false,
    nexusApiKey: "",
    nexusUser: null,
    theme: "dark",
    language: "zh-CN",
    defaultTab: "manager",
    autoImportAfterDownload: true,
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
  backups: []
};

function normalizeAppData(rawData: Partial<AppData> | null | undefined): AppData {
  const data = rawData ?? {};
  const settings = (data.settings ?? {}) as Partial<AppSettings>;
  const games = Array.isArray(data.games) ? data.games : [];
  const mods = Array.isArray(data.mods) ? data.mods : [];
  const downloads = Array.isArray(data.downloads) ? data.downloads : [];
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const backups = Array.isArray(data.backups) ? data.backups : [];

  return {
    dataVersion: Number(data.dataVersion) || DATA_VERSION,
    settings: {
      ...fallbackData.settings,
      ...settings,
      tagColors: settings.tagColors ?? {},
      useSymlinkInstall: settings.useSymlinkInstall ?? false,
      nexusApiKey: settings.nexusApiKey ?? "",
      nexusUser: settings.nexusUser ?? null,
      theme: settings.theme ?? "dark",
      language: settings.language ?? "zh-CN",
      defaultTab: settings.defaultTab ?? "manager",
      autoImportAfterDownload: settings.autoImportAfterDownload ?? true,
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
      typeNames: Array.isArray(game.typeNames) ? game.typeNames : []
    })),
    activeGameId: typeof data.activeGameId === "string" ? data.activeGameId : "",
    mods: mods.map((mod) => ({
      ...mod,
      modTypeId: mod.modTypeId ?? "root",
      modTypeName: mod.modTypeName ?? "游戏根目录",
      deployedFiles: mod.deployedFiles ?? [],
      website: mod.website ?? "",
      description: mod.description ?? "",
      coverImage: mod.coverImage ?? "",
      requirements: mod.requirements ?? [],
      tags: mod.tags ?? []
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
      }))
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
  const backupContents = ref<Record<string, Array<{ path: string; isDirectory: boolean; size: number }>>>({});
  const search = ref("");
  const selectedTypeId = ref("all");
  const selectedTag = ref("all");
  const sortMode = ref<"createdDesc" | "createdAsc" | "nameAsc" | "nameDesc" | "installedFirst">("createdDesc");
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

  const selectedMods = computed(() =>
    activeMods.value.filter((mod) => selectedModIds.value.includes(mod.id))
  );

  const activeAdapter = computed(() =>
    activeGame.value ? getGameAdapter(activeGame.value.presetId) : null
  );

  const activeDownloads = computed(() =>
    [...downloads.value]
      .sort((a, b) => b.createdAt - a.createdAt)
  );

  const nexusAuthorized = computed(() => Boolean(settings.value.nexusUser?.key?.trim()));

  function toData(): AppData {
    const data = {
      dataVersion: DATA_VERSION,
      settings: settings.value,
      games: games.value,
      activeGameId: activeGameId.value,
      mods: mods.value,
      downloads: downloads.value,
      logs: logs.value,
      backups: backups.value
    };

    return JSON.parse(JSON.stringify(data)) as AppData;
  }

  async function persist() {
    await window.mayfly.writeStore(DATA_FILE, toData());
  }

  async function initialize() {
    if (initialized.value) return;

    busy.value = true;
    error.value = "";

    try {
      const data = normalizeAppData(await window.mayfly.readStore<AppData>(DATA_FILE, fallbackData));
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
      downloads.value = data.downloads;
      logs.value = data.logs;
      backups.value = data.backups;
      initialized.value = true;
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
      adapterStatus: preset ? "implemented" : "custom",
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
        const result = await window.mayfly.importModFolder({
          sourcePath,
          storagePath: settings.value.storagePath,
          gameId: activeGame.value.id,
          modId: id
        });
        const adapter = getGameAdapter(activeGame.value.presetId);
        const modTypeId = adapter.checkModType(result.files);
        const modType = getModType(adapter, modTypeId);

        imported.push({
          id,
          gameId: activeGame.value.id,
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
      const user = await window.mayfly.validateNexusApiKey(key);
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
        searchText: nexusSearch.value,
        sort: nexusSort.value,
        facets: {
          categoryName: nexusCategory.value,
          languageName: nexusLanguage.value,
          tag: nexusTag.value
        }
      });

      if (append) {
        nexusMods.value = [...nexusMods.value, ...result.items];
      } else {
        nexusMods.value = result.items;
      }
      nexusPage.value = result.page;
      nexusTotalCount.value = result.totalCount;
      nexusTotalPages.value = result.totalPages;
      nexusFacets.value = result.facets;
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
    error.value = "";

    try {
      selectedNexusMod.value = await window.mayfly.getNexusModDetail({
        apiKey: settings.value.nexusApiKey,
        gameDomain: nexusPreset.value.nexusDomain,
        modId: item.id
      });
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "获取 NexusMods 详情失败";
    } finally {
      nexusDetailLoading.value = false;
    }
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

      if (!gameId || !modId) return null;

      return { gameId, modId, fileId };
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
        await downloadNexusFile(targetFile, selectedNexusMod.value);
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

  async function downloadNexusFile(file: NexusModFile, mod = selectedNexusMod.value) {
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
        fileId: file.id
      });

      updateDownloadTask(task.id, { url });
      await persist();

      if (isExternalUrl(url)) {
        updateDownloadTask(task.id, {
          status: "external",
          error: "NexusMods 未返回直链，已打开网页下载页。"
        });
        await persist();
        await window.mayfly.openExternal(url);
        return;
      }

      updateDownloadTask(task.id, { status: "downloading" });
      await persist();

      const result = await window.mayfly.downloadFile({
        url,
        outputPath: task.outputPath
      });

      updateDownloadTask(task.id, {
        status: "completed",
        outputPath: result.outputPath,
        receivedBytes: result.receivedBytes,
        totalBytes: result.totalBytes,
        error: ""
      });
      await persist();

      const localGame = games.value.find((game) =>
        game.presetId === nexusPreset.value?.id
      );

      if (settings.value.autoImportAfterDownload && localGame) {
        const previousActiveGameId = activeGameId.value;
        activeGameId.value = localGame.id;
        await importLocalModsFromPaths([result.outputPath]);
        activeGameId.value = previousActiveGameId;
      }
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
      updateDownloadTask(task.id, { status: "downloading" });
      await persist();

      const result = await window.mayfly.downloadFile({
        url: normalizedUrl,
        outputPath: task.outputPath
      });

      updateDownloadTask(task.id, {
        status: "completed",
        outputPath: result.outputPath,
        receivedBytes: result.receivedBytes,
        totalBytes: result.totalBytes,
        error: ""
      });
      await persist();

      if (settings.value.autoImportAfterDownload && activeGame.value) {
        await importLocalModsFromPaths([result.outputPath]);
      }
    } catch (caught) {
      updateDownloadTask(task.id, {
        status: "failed",
        error: caught instanceof Error ? caught.message : "下载自定义 URL 失败"
      });
      await persist();
    }
  }

  async function removeDownloadTask(taskId: string) {
    downloads.value = downloads.value.filter((task) => task.id !== taskId);
    await persist();
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

  async function restoreBackup(backup: BackupEntry) {
    const game = games.value.find((item) => item.id === backup.gameId);

    if (!game) {
      error.value = "恢复失败：没有找到对应游戏。";
      return;
    }

    busy.value = true;
    error.value = "";

    try {
      await window.mayfly.restoreBackupZip({
        backupPath: backup.outputPath,
        targetPath: game.path
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
        manifest,
        mods: targetMods.map((mod) => ({
          rootPath: mod.rootPath,
          folderName: sanitizeFileName(mod.name || mod.id)
        }))
      });
      await recordLog("info", "gmm", `已导出 .gmm：${finalPath}`);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : "导出 .gmm 失败";
    }
  }

  async function installMod(mod: LocalMod) {
    if (!activeGame.value) return;

    busy.value = true;
    error.value = "";

    try {
      const adapter = getGameAdapter(activeGame.value.presetId);
      const modType = getModType(adapter, mod.modTypeId);
      const missingRequirements = (modType.requiredModNames ?? []).filter((requiredName) => {
        const normalizedRequiredName = normalizeLoose(requiredName);

        return !mods.value.some((item) =>
          item.gameId === activeGame.value?.id &&
          item.id !== mod.id &&
          item.installed &&
          normalizeLoose(item.name).includes(normalizedRequiredName)
        );
      });

      if (missingRequirements.length > 0) {
        throw new Error(`缺少前置 Mod：${missingRequirements.join(", ")}。请先安装前置后再安装该 Mod。`);
      }

      const plan = await window.mayfly.createInstallPlan({
        modRoot: mod.rootPath,
        gamePath: activeGame.value.path,
        strategy: modType.install
      });

      if (plan.conflicts.length > 0) {
        const preview = plan.conflicts.slice(0, 5).join(", ");
        const more = plan.conflicts.length > 5 ? ` 等 ${plan.conflicts.length} 个文件` : "";
        throw new Error(`安装会覆盖已存在文件，已阻止：${preview}${more}`);
      }

      const result = await window.mayfly.applyModStrategy({
        modRoot: mod.rootPath,
        gamePath: activeGame.value.path,
        strategy: modType.install,
        isInstall: true,
        useSymlink: settings.value.useSymlinkInstall
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
      const adapter = getGameAdapter(activeGame.value.presetId);
      const modType = getModType(adapter, mod.modTypeId);
      const plan = await window.mayfly.createInstallPlan({
        modRoot: mod.rootPath,
        gamePath: activeGame.value.path,
        strategy: modType.install
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
    for (const mod of selectedMods.value) {
      if (!mod.installed) {
        await installMod(mod);
      }
    }
  }

  async function uninstallMod(mod: LocalMod) {
    if (!activeGame.value) return false;

    busy.value = true;
    error.value = "";

    try {
      const adapter = getGameAdapter(activeGame.value.presetId);
      const modType = getModType(adapter, mod.modTypeId);

      if (mod.deployedFiles.length > 0) {
        await window.mayfly.removeDeployedFiles({
          gamePath: activeGame.value.path,
          deployedFiles: mod.deployedFiles
        });
      } else {
        await window.mayfly.applyModStrategy({
          modRoot: mod.rootPath,
          gamePath: activeGame.value.path,
          strategy: modType.uninstall ?? modType.install,
          isInstall: false,
          useSymlink: settings.value.useSymlinkInstall
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
    for (const mod of selectedMods.value) {
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

  function sortMods(list: LocalMod[]) {
    const next = [...list];

    switch (sortMode.value) {
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
    selectedNexusMod,
    nexusAuthorized,
    tagPalette,
    activeMods,
    activeTags,
    installedCount,
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
    handleNxmUrl,
    downloadNexusFile,
    downloadCustomUrl,
    openDownloadFile,
    openDownloadFolder,
    removeDownloadTask,
    createActiveGameBackup,
    restoreBackup,
    removeBackup,
    renameBackup,
    loadBackupContents,
    openBackupFolder,
    exportData,
    importData,
    exportModsToGmm,
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
    setError
  };
});
