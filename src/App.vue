<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  Archive,
  ArrowDownToLine,
  CheckCircle2,
  FolderOpen,
  Gamepad2,
  GripVertical,
  HardDrive,
  Info,
  LayoutGrid,
  LoaderCircle,
  List,
  ListTree,
  ScrollText,
  PackagePlus,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X,
  XCircle,
  ChevronDown,
  ChevronUp,
  Languages,
  Plus,
  User,
  Download,
  Calendar
} from "lucide-vue-next";
import { useLibraryStore } from "@/stores/library";
import type { CustomAdapterRule, LocalMod } from "@/types/domain";

const library = useLibraryStore();
type AppTab = "games" | "manager" | "nexus" | "download" | "logs" | "backup" | "settings" | "about";

const activeTab = ref<AppTab>("manager");
const showAddGameModal = ref(false);
const showGameInfoModal = ref(false);
const showGameSettingsModal = ref(false);
const contextMenu = ref({ visible: false, x: 0, y: 0, gameId: "" });
const draggingModId = ref("");
const dragOverModId = ref("");
const previewImage = ref({ visible: false, url: "", title: "" });
const selectedNexusImageIndex = ref(0);
const modViewMode = ref<"list" | "grid">("list");
const openDevTools = () => window.mayfly.openDevTools();

const showGameContextMenu = (e: MouseEvent, gameId: string) => {
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    gameId
  };
};

async function selectContextGame() {
  if (!contextMenu.value.gameId) return false;
  await chooseGame(contextMenu.value.gameId);
  contextMenu.value.visible = false;
  return true;
}

async function openContextGameInfo() {
  if (await selectContextGame()) {
    showGameInfoModal.value = true;
  }
}

async function openContextGameSettings() {
  if (await selectContextGame()) {
    showGameSettingsModal.value = true;
  }
}

async function launchContextGame() {
  if (await selectContextGame()) {
    await library.launchActiveGame();
  }
}

async function openContextGameFolder() {
  if (await selectContextGame()) {
    await openActiveGamePath();
  }
}

const deleteContextGame = async () => {
  const game = library.games.find((item) => item.id === contextMenu.value.gameId);
  if (!game) return;

  if (window.confirm(`确定要删除游戏“${game.name}”吗？`)) {
    await library.removeGame(game.id);
  }

  contextMenu.value.visible = false;
};

onMounted(() => {
  window.addEventListener("click", () => {
    if (contextMenu.value.visible) {
      contextMenu.value.visible = false;
    }
    openDropdownId.value = "";
  });
});
const editingInstallPath = ref("");
const showPresetPicker = ref(false);
const dragActive = ref(false);
const expandedModId = ref("");
const openDropdownId = ref("");
const editingModId = ref("");
const showModEditModal = ref(false);
const coverUrls = ref<Record<string, string>>({});
const gameCoverUrls = ref<Record<string, string>>({});
const showBatchEdit = ref(false);
const showGmmExport = ref(false);
const showCustomGameForm = ref(false);
const batchTypeId = ref("");
const batchVersion = ref("");
const batchAuthor = ref("");
const batchWebsite = ref("");
const batchTags = ref("");
const quickTagName = ref("");
const gmmName = ref("");
const gmmAuthor = ref("");
const gmmVersion = ref("");
const gmmDescription = ref("");
const customGameName = ref("");
const customGamePath = ref("");
const customGameExeNames = ref("");
const customGameInstallPath = ref("");
const customGameLaunchArgs = ref("");
const customGameCoverUrl = ref("");
const nexusApiKeyInput = ref("");
const showNexusAuthModal = ref(false);
const toastMessage = ref("");
const customDownloadUrl = ref("");
const customDownloadName = ref("");
const backupName = ref("");
const customRuleName = ref("");
const customRuleDetectKind = ref<CustomAdapterRule["detect"]["kind"]>("always");
const customRuleDetectValue = ref("");
const customRuleInstallKind = ref<"general" | "folderRoot" | "folder" | "file" | "fileSibling" | "manual">("general");
const customRuleInstallPath = ref("");
const customRuleInstallName = ref("");
const customRuleKeepPath = ref(true);

const storageLabel = computed(
  () => library.settings.storagePath || "还没有选择 Mod 存储路径"
);

const nexusGames = computed(() =>
  library.games.filter((game) => game.presetId && game.nexusDomain)
);

const editingMod = computed(() =>
  library.mods.find((mod) => mod.id === editingModId.value) ?? null
);

function toggleDropdown(id: string) {
  openDropdownId.value = openDropdownId.value === id ? "" : id;
}

function closeDropdown() {
  openDropdownId.value = "";
}

function typeFilterLabel() {
  if (library.selectedTypeId === "all") return "全部类型";
  return library.activeAdapter?.modTypes.find((type) => type.id === library.selectedTypeId)?.name ?? "全部类型";
}

function tagFilterLabel() {
  return library.selectedTag === "all" ? "全部标签" : library.selectedTag;
}

function sortLabel() {
  const labels = {
    custom: "自定义排序",
    createdDesc: "最近导入",
    createdAsc: "最早导入",
    nameAsc: "名称 A-Z",
    nameDesc: "名称 Z-A",
    installedFirst: "已安装优先"
  };

  return labels[library.sortMode];
}

function modTypeLabel(mod: LocalMod) {
  return library.activeAdapter?.modTypes.find((type) => type.id === mod.modTypeId)?.name ?? mod.modTypeName;
}

function detectKindLabel(kind: CustomAdapterRule["detect"]["kind"]) {
  const labels = {
    always: "默认",
    fileName: "文件名",
    extension: "扩展名",
    pathPart: "路径片段"
  };

  return labels[kind];
}

function installStrategyLabel(strategy: CustomAdapterRule["install"]) {
  switch (strategy.kind) {
    case "folder":
      return `匹配文件夹 ${Array.isArray(strategy.folderName) ? strategy.folderName.join(", ") : strategy.folderName} -> ${strategy.installPath || "游戏根目录"}`;
    case "folderRoot":
      return `文件夹根内容 -> ${strategy.installPath || "游戏根目录"}`;
    case "file":
      return `匹配文件 ${strategy.fileName || "*"} -> ${strategy.installPath || "游戏根目录"}`;
    case "fileSibling":
      return `匹配文件同级 -> ${strategy.installPath || "游戏根目录"}`;
    case "fileOnly":
      return `仅匹配文件 ${strategy.fileName || "*"} -> ${strategy.installPath || "游戏根目录"}`;
    case "folderParent":
      return `匹配父文件夹 ${strategy.folderName || "*"} -> ${strategy.installPath || "游戏根目录"}`;
    case "fileMap":
      return `按字典 ${strategy.dictionaryFile || "*"} -> ${strategy.installPath || "游戏根目录"}`;
    case "fileIntoParentFolder":
      return `匹配文件进父目录 ${strategy.fileName || "*"} -> ${strategy.installPath || "游戏根目录"}`;
    case "manual":
      return strategy.reason;
    case "general":
      return `全部内容 -> ${strategy.installPath || "游戏根目录"}${strategy.keepPath === false ? "，不保留路径" : ""}`;
    default:
      return "内置安装规则";
  }
}

function customRuleSummary(rule: CustomAdapterRule) {
  const detectValue = rule.detect.kind === "always" ? "" : ` ${rule.detect.value || "*"}`;
  return `${detectKindLabel(rule.detect.kind)}${detectValue} / ${installStrategyLabel(rule.install)}`;
}

function resetCustomRuleForm() {
  customRuleName.value = "";
  customRuleDetectKind.value = "always";
  customRuleDetectValue.value = "";
  customRuleInstallKind.value = "general";
  customRuleInstallPath.value = "";
  customRuleInstallName.value = "";
  customRuleKeepPath.value = true;
}

async function saveCustomAdapterRule() {
  if (customRuleDetectKind.value !== "always" && !customRuleDetectValue.value.trim()) {
    library.setError("请填写识别值。");
    return;
  }

  await library.addCustomAdapterRule({
    name: customRuleName.value,
    detectKind: customRuleDetectKind.value,
    detectValue: customRuleDetectValue.value,
    installKind: customRuleInstallKind.value,
    installPath: customRuleInstallPath.value,
    installName: customRuleInstallName.value,
    keepPath: customRuleKeepPath.value
  });

  if (!library.error) {
    resetCustomRuleForm();
  }
}

function openModEdit(mod: LocalMod) {
  editingModId.value = mod.id;
  showModEditModal.value = true;
}

watch(
  () => library.error,
  (message) => {
    if (!message) return;
    toastMessage.value = message;
    window.setTimeout(() => {
      if (toastMessage.value === message) {
        toastMessage.value = "";
      }
    }, 3800);
  }
);

onMounted(async () => {
  await library.initialize();
  activeTab.value = library.settings.defaultTab;
  editingInstallPath.value = library.activeGame?.installPath ?? "";
  nexusApiKeyInput.value = library.settings.nexusApiKey;
  window.mayfly.onNxmOpen((url) => {
    activeTab.value = "nexus";
    void library.handleNxmUrl(url);
  });

  window.addEventListener("error", (event) => {
    void library.recordLog(
      "error",
      "renderer",
      event.message || "前端运行错误",
      `${event.filename || ""}:${event.lineno || 0}:${event.colno || 0}\n${event.error?.stack || ""}`.trim()
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error
      ? `${event.reason.message}\n${event.reason.stack || ""}`
      : String(event.reason || "");
    void library.recordLog("error", "promise", "未处理的异步错误", reason);
  });
});

watch(
  () => library.activeMods.map((mod) => [mod.id, mod.rootPath, mod.coverImage].join("|")),
  async () => {
    for (const mod of library.activeMods) {
      if (!mod.coverImage || coverUrls.value[mod.id]) continue;
      coverUrls.value = {
        ...coverUrls.value,
        [mod.id]: await window.mayfly.fileUrl(`${mod.rootPath}\\${mod.coverImage}`)
      };
    }
  },
  { immediate: true }
);

watch(
  () => library.games.map((game) => [game.id, game.coverUrl].join("|")),
  async () => {
    for (const game of library.games) {
      if (!game.coverUrl || gameCoverUrls.value[game.id]) continue;

      gameCoverUrls.value = {
        ...gameCoverUrls.value,
        [game.id]: /^https?:\/\//i.test(game.coverUrl)
          ? game.coverUrl
          : await window.mayfly.fileUrl(game.coverUrl)
      };
    }
  },
  { immediate: true }
);

watch(
  () => library.settings.nexusApiKey,
  (apiKey) => {
    nexusApiKeyInput.value = apiKey;
  }
);

async function chooseGame(gameId: string) {
  await library.setActiveGame(gameId);
  editingInstallPath.value = library.activeGame?.installPath ?? "";
}

async function chooseNexusGame(gameId: string) {
  const game = library.games.find((item) => item.id === gameId);
  if (!game?.presetId || !game.nexusDomain) {
    library.setError("这个游戏没有 Nexus 配置。");
    return;
  }

  await chooseGame(game.id);
  library.setNexusPreset(game.presetId);
  
  // 自动触发搜索并重置过滤条件
  library.nexusSearch = "";
  library.nexusCategory = "";
  library.nexusLanguage = "";
  library.nexusTag = "";
  library.nexusSort = "downloads";
  await searchNexusMods();
}

async function addCustomGame() {
  showCustomGameForm.value = !showCustomGameForm.value;
  showPresetPicker.value = false;
}

async function saveInstallPath() {
  if (!library.activeGame) return;
  await library.updateGame(library.activeGame.id, {
    installPath: editingInstallPath.value.trim()
  });
}

async function openActiveGamePath() {
  if (!library.activeGame) return;
  await window.mayfly.openPath(library.activeGame.path);
}

async function openGamePath(path: string) {
  if (!path) return;
  await window.mayfly.openPath(path);
}

async function openStoragePath() {
  if (!library.settings.storagePath) return;
  await window.mayfly.openPath(library.settings.storagePath);
}

function formatFiles(mod: LocalMod) {
  if (mod.files.length === 0) return "没有扫描到文件";
  if (mod.files.length === 1) return mod.files[0];
  return `${mod.files[0]} 等 ${mod.files.length} 个文件`;
}

function changeModType(mod: LocalMod, typeId: string) {
  const type = library.activeAdapter?.modTypes.find((item) => item.id === typeId);
  void library.updateMod(mod.id, {
    modTypeId: typeId,
    modTypeName: type?.name ?? mod.modTypeName,
    updatedAt: Date.now()
  });
}

function splitTags(value: string) {
  return value
    .split(/[,，\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCommaList(value: string) {
  return value
    .split(/[,，\n\r]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dirName(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  const prefix = /^[a-z]:/i.test(parts[0] ?? "") ? "" : "/";
  return `${prefix}${parts.join("/")}`.replace(/\//g, "\\");
}

function tagColor(tag: string) {
  return library.settings.tagColors[tag] || "#4f8cff";
}

async function chooseCustomGamePath() {
  const selected = await window.mayfly.openDirectory();
  if (!selected) return;

  customGamePath.value = selected;
  if (!customGameName.value.trim()) {
    customGameName.value = selected.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  }
}

async function chooseCustomGameExe() {
  const selected = await window.mayfly.openExecutable();
  if (!selected) return;

  const exeName = selected.replace(/\\/g, "/").split("/").pop() ?? "";
  customGamePath.value = dirName(selected);
  customGameExeNames.value = [...new Set([...splitCommaList(customGameExeNames.value), exeName])].join(", ");

  if (!customGameName.value.trim()) {
    customGameName.value = exeName.replace(/\.exe$/i, "");
  }
}

async function chooseCustomGameCover() {
  const selected = await window.mayfly.openImage();
  if (!selected) return;
  customGameCoverUrl.value = selected;
}

async function chooseActiveGameCover() {
  if (!library.activeGame) return;
  const selected = await window.mayfly.openImage();
  if (!selected) return;

  gameCoverUrls.value = {
    ...gameCoverUrls.value,
    [library.activeGame.id]: await window.mayfly.fileUrl(selected)
  };
  await library.updateGame(library.activeGame.id, { coverUrl: selected });
}

async function createCustomGameFromForm() {
  if (!customGamePath.value.trim()) {
    library.setError("请先选择自定义游戏目录或 exe。");
    return;
  }

  await library.addCustomGameFromInput({
    name: customGameName.value,
    path: customGamePath.value,
    exeNames: splitCommaList(customGameExeNames.value),
    installPath: customGameInstallPath.value,
    launchArgs: customGameLaunchArgs.value,
    coverUrl: customGameCoverUrl.value
  });
  editingInstallPath.value = library.activeGame?.installPath ?? "";
  customGameName.value = "";
  customGamePath.value = "";
  customGameExeNames.value = "";
  customGameInstallPath.value = "";
  customGameLaunchArgs.value = "";
  customGameCoverUrl.value = "";
  showCustomGameForm.value = false;
}

async function applyBatchEdit() {
  const patch: Parameters<typeof library.updateSelectedMods>[0] = {};

  if (batchTypeId.value) {
    const type = library.activeAdapter?.modTypes.find((item) => item.id === batchTypeId.value);
    patch.modTypeId = batchTypeId.value;
    patch.modTypeName = type?.name ?? batchTypeId.value;
  }

  if (batchVersion.value.trim()) patch.version = batchVersion.value.trim();
  if (batchAuthor.value.trim()) patch.author = batchAuthor.value.trim();
  if (batchWebsite.value.trim()) patch.website = batchWebsite.value.trim();
  if (batchTags.value.trim()) patch.appendTags = splitTags(batchTags.value);

  await library.updateSelectedMods(patch);
  batchTypeId.value = "";
  batchVersion.value = "";
  batchAuthor.value = "";
  batchWebsite.value = "";
  batchTags.value = "";
  showBatchEdit.value = false;
}

async function addQuickTagToSelected() {
  const tags = splitTags(quickTagName.value);
  if (tags.length === 0) return;

  if (library.selectedMods.length === 0) {
    library.setError("请先勾选要添加分类标签的 Mod。");
    return;
  }

  await library.updateSelectedMods({ appendTags: tags });
  quickTagName.value = "";
}

async function exportSelectedGmm() {
  await library.exportModsToGmm({
    targetMods: library.selectedMods,
    name: gmmName.value,
    author: gmmAuthor.value,
    version: gmmVersion.value,
    description: gmmDescription.value
  });

  if (!library.error) {
    showGmmExport.value = false;
    gmmName.value = "";
    gmmAuthor.value = "";
    gmmVersion.value = "";
    gmmDescription.value = "";
  }
}

function toggleModDetails(modId: string) {
  expandedModId.value = expandedModId.value === modId ? "" : modId;
}

function visibleDeployedFiles(mod: LocalMod) {
  return mod.deployedFiles.slice(0, 80);
}

function visiblePlanFiles(mod: LocalMod) {
  return (library.installPlans[mod.id]?.targetFiles ?? []).slice(0, 80);
}

function formatBytes(size: number) {
  if (!size) return "未知大小";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function formatDate(value: string | number) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("zh-CN");
}

function visibleBackupTreeEntries(backupId: string) {
  const entries = library.backupContents[backupId] ?? [];
  const folders = new Set<string>();

  for (const entry of entries) {
    const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
    parts.pop();

    for (let index = 1; index <= parts.length; index += 1) {
      folders.add(parts.slice(0, index).join("/"));
    }
  }

  const folderEntries = [...folders].map((path) => ({
    path,
    isDirectory: true,
    size: 0
  }));
  const allEntries = [...folderEntries, ...entries]
    .sort((left, right) => {
      const leftParts = left.path.split("/");
      const rightParts = right.path.split("/");
      const parentCompare = leftParts.slice(0, -1).join("/").localeCompare(rightParts.slice(0, -1).join("/"), "zh-CN");
      if (parentCompare !== 0) return parentCompare;
      if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
      return leftParts.at(-1)!.localeCompare(rightParts.at(-1)!, "zh-CN");
    })
    .map((entry) => {
      const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
      return {
        ...entry,
        name: parts.at(-1) ?? entry.path,
        depth: Math.max(0, parts.length - 1)
      };
    });

  return allEntries.slice(0, 200);
}

function sanitizeNexusHtml(html: string) {
  if (!html) return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, form").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith("on") || value.startsWith("javascript:")) {
        node.removeAttribute(attribute.name);
      }
    });
  });

  return doc.body.innerHTML;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeLink(url: string) {
  const normalized = url.replace(/&amp;/g, "&").trim();
  return /^https?:\/\//i.test(normalized) ? escapeHtml(normalized) : "";
}

function renderNexusBbCode(value: string) {
  let html = escapeHtml(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br />")
    .replace(/&lt;\/?(?:p|div)&gt;/gi, "<br />")
    .replace(/\[\/?(?:size|font|center|left|right|color|quote)(?:=[^\]]*)?\]/gi, "")
    .replace(/\[(?:br|hr)\s*\/?\]/gi, "<br />")
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>")
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>")
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<span class=\"bbUnderline\">$1</span>")
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_match, url: string) => {
      const href = safeLink(url);
      return href ? `<img src="${href}" alt="" />` : "";
    })
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, url: string, label: string) => {
      const href = safeLink(url);
      return href ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>` : label;
    })
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_match, url: string) => {
      const href = safeLink(url);
      return href ? `<a href="${href}" target="_blank" rel="noreferrer">${href}</a>` : url;
    })
    .replace(/\[\*\]/g, "<br />• ")
    .replace(/\[\/?list(?:=[^\]]*)?\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n/g, "<br />");

  html = html.replace(/(?:<br \/>){3,}/g, "<br /><br />");
  return sanitizeNexusHtml(html);
}

function renderNexusDescription(value: string, format: string) {
  if (!value) return "暂无说明。";
  return /\[[a-z*]+(?:=[^\]]+)?\]/i.test(value)
    ? renderNexusBbCode(value)
    : sanitizeNexusHtml(format === "html" ? value : escapeHtml(value).replace(/\n/g, "<br />"));
}

function openPreviewImage(url: string, title: string) {
  if (!url) return;
  previewImage.value = { visible: true, url, title };
}

function beginModDrag(mod: LocalMod) {
  if (!library.canReorderMods) {
    library.setError("拖拽排序前请先清空搜索、类型和标签筛选。");
    return;
  }

  draggingModId.value = mod.id;
}

async function dropModOn(target: LocalMod) {
  if (!draggingModId.value) return;
  await library.reorderActiveMods(draggingModId.value, target.id);
  draggingModId.value = "";
  dragOverModId.value = "";
}

function downloadStatusText(status: string) {
  const map: Record<string, string> = {
    queued: "排队中",
    downloading: "下载中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    external: "网页下载"
  };

  return map[status] ?? status;
}

function logTime(value: number) {
  return new Date(value).toLocaleString("zh-CN");
}

async function saveAndValidateNexusApiKey() {
  await library.saveNexusApiKey(nexusApiKeyInput.value);
  const user = await library.validateNexusApiKey();
  if (user) {
    toastMessage.value = `Nexus API Key 已校验：${user.name || "已授权"}`;
  }
}

async function searchNexusMods() {
  if (!nexusGames.value.some((game) => game.presetId === library.nexusPresetId)) {
    library.setError("请先在左侧选择已经添加过的 Nexus 游戏。");
    return;
  }

  library.nexusPage = 1;
  await library.loadNexusMods(1);
}

async function nextNexusPage(step: number, append = false) {
  const nextPage = Math.max(1, Math.min(library.nexusTotalPages || 1, library.nexusPage + step));
  if (nextPage === library.nexusPage && !append) return;
  await library.loadNexusMods(nextPage, append);
}

const handleMainScroll = (e: Event) => {
  // Infinite scroll disabled in favor of manual pagination widget
};

async function startCustomDownload() {
  await library.downloadCustomUrl(customDownloadUrl.value, customDownloadName.value);
  if (!library.error) {
    customDownloadUrl.value = "";
    customDownloadName.value = "";
  }
}

async function createBackup() {
  await library.createActiveGameBackup(backupName.value);
  if (!library.error) {
    backupName.value = "";
  }
}

async function confirmRestoreBackup(backup: (typeof library.backups)[number]) {
  const confirmed = window.confirm(`确定恢复备份“${backup.name}”吗？这会把备份内容写回游戏目录。`);
  if (!confirmed) return;
  await library.restoreBackup(backup);
}

async function confirmRemoveBackup(backup: (typeof library.backups)[number]) {
  const removeFile = window.confirm(`删除备份记录“${backup.name}”吗？点击“确定”会同时删除 zip 文件。`);
  await library.removeBackup(backup, removeFile);
}

function conflictCount(mod: LocalMod) {
  return library.installPlans[mod.id]?.conflicts.length ?? 0;
}

async function previewModInstallPlan(mod: LocalMod) {
  expandedModId.value = mod.id;
  await library.previewInstallPlan(mod);
}

async function dropLocalMods(event: DragEvent) {
  dragActive.value = false;
  if (draggingModId.value) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  const paths = files.map((file) => window.mayfly.getPathForFile(file)).filter(Boolean);

  if (paths.length === 0) {
    library.setError("没有读取到拖拽文件路径，请改用“导入 Mod”按钮选择文件或文件夹。");
    return;
  }

  await library.importLocalModsFromPaths(paths);
}

async function confirmRemoveActiveGame() {
  if (!library.activeGame) return;

  const confirmed = window.confirm(`确定移除游戏“${library.activeGame.name}”吗？这会同时移除该游戏的本地 Mod 记录。`);
  if (!confirmed) return;

  await library.removeGame(library.activeGame.id);
}

async function confirmRemoveMod(mod: LocalMod) {
  const message = mod.installed
    ? `确定删除“${mod.name}”吗？它当前已安装，会先卸载游戏目录里的部署文件，再删除本地缓存。`
    : `确定删除“${mod.name}”的本地缓存和记录吗？`;

  if (!window.confirm(message)) return;
  await library.removeMod(mod);
}

async function confirmUninstallMod(mod: LocalMod) {
  if (mod.deployedFiles.length === 0) {
    const confirmed = window.confirm(`“${mod.name}”没有部署文件记录，将按当前安装规则匹配并删除文件。确定继续卸载吗？`);
    if (!confirmed) return;
  }

  await library.uninstallMod(mod);
}

async function confirmUninstallSelectedMods() {
  const legacyCount = library.selectedMods.filter(
    (mod) => mod.installed && mod.deployedFiles.length === 0
  ).length;

  if (legacyCount > 0) {
    const confirmed = window.confirm(`选中的 Mod 中有 ${legacyCount} 个没有部署文件记录，将按当前安装规则卸载。确定继续吗？`);
    if (!confirmed) return;
  }

  await library.uninstallSelectedMods();
}

async function openModCache(mod: LocalMod) {
  await window.mayfly.openPath(mod.rootPath);
}

async function confirmRemoveSelectedMods() {
  const installedCount = library.selectedMods.filter((mod) => mod.installed).length;
  const suffix = installedCount > 0
    ? `其中 ${installedCount} 个已安装，会先卸载部署文件。`
    : "这会删除它们的本地缓存和记录。";

  if (!window.confirm(`确定批量删除 ${library.selectedMods.length} 个 Mod 吗？${suffix}`)) return;
  await library.removeSelectedMods();
}
</script>

<template>
  <div class="shell" :class="`theme-${library.settings.theme}`">
    <div class="steam-toast-container">
      <div v-if="toastMessage" class="steam-toast info">
        <Info :size="16" class="toast-icon" />
        <div class="toast-content">
          <span>{{ toastMessage }}</span>
        </div>
      </div>
      <div v-if="library.error" class="steam-toast error">
        <XCircle :size="16" class="toast-icon" />
        <div class="toast-content">
          <span>{{ library.error }}</span>
          <button v-if="library.error.includes('设置里')" class="secondary toast-action" @click="library.error = ''; activeTab = 'settings'">
            去设置
          </button>
        </div>
        <button class="toast-close" @click="library.error = ''"><X :size="16" /></button>
      </div>
    </div>

    <div v-if="previewImage.visible" class="steam-modal-overlay imagePreviewOverlay" @click.self="previewImage.visible = false">
      <div class="imagePreviewModal">
        <div class="steam-modal-header">
          <span>{{ previewImage.title || "预览图" }}</span>
          <button class="iconButton" @click="previewImage.visible = false">
            <X :size="16" />
          </button>
        </div>
        <img :src="previewImage.url" alt="" />
      </div>
    </div>

    <!-- Steam Style Modal for Nexus Auth -->
    <div v-if="showNexusAuthModal" class="steam-modal-overlay" @click.self="showNexusAuthModal = false">
      <div class="steam-modal">
        <div class="steam-modal-header">
          <span>NexusMods 账户</span>
        </div>
        <div class="steam-modal-content" style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label style="display: block; margin-bottom: 8px; color: #c8d2df; font-size: 13px; font-weight: 700;">NexusMods API Key</label>
            <div class="pathPicker" style="display: flex; gap: 8px;">
              <input v-model="nexusApiKeyInput" type="password" placeholder="填写 Personal API Key" style="flex: 1;" />
              <button class="primary" :disabled="library.busy" @click="saveAndValidateNexusApiKey" style="padding: 0 12px; height: 38px;">保存并校验</button>
              <button class="secondary" :disabled="!library.settings.nexusApiKey" @click="library.clearNexusAuth" style="padding: 0 12px; height: 38px;">清除</button>
            </div>
          </div>
          <div class="nexusUserBox" style="display: grid; gap: 6px; border: 1px solid #252c36; border-radius: 7px; background: #10151c; padding: 10px;">
            <strong style="color: #fff;">{{ library.settings.nexusUser?.name || "未校验 API Key" }}</strong>
            <span v-if="library.settings.nexusUser" style="color: #8f9bab; font-size: 12px;">
              {{ library.settings.nexusUser.isPremium ? "Premium" : "Free" }}
              · {{ library.settings.nexusUser.email || "无邮箱信息" }}
            </span>
            <span v-else style="color: #8f9bab; font-size: 12px;">填写 API Key 后点击“保存并校验”，校验成功才能浏览和下载。</span>
          </div>
        </div>
        <div class="steam-modal-footer">
          <button class="primary" @click="showNexusAuthModal = false">完成</button>
        </div>
      </div>
    </div>

    <div v-if="showGameInfoModal && library.activeGame" class="steam-modal-overlay" @click.self="showGameInfoModal = false">
      <div class="steam-modal">
        <div class="steam-modal-header">
          <Info :size="16" />
          <span>游戏信息</span>
          <button class="close-btn" @click="showGameInfoModal = false"><X :size="18" /></button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <div class="gameModalHero">
            <img v-if="gameCoverUrls[library.activeGame.id]" :src="gameCoverUrls[library.activeGame.id]" alt="" />
            <Gamepad2 v-else :size="30" />
            <input
              class="gameNameInput"
              :value="library.activeGame.name"
              @change="library.updateGame(library.activeGame.id, { name: ($event.target as HTMLInputElement).value.trim() || library.activeGame.name })"
            />
          </div>
          <div class="gameInfoGrid">
            <label>
              游戏目录
              <span>{{ library.activeGame.path || "未设置" }}</span>
            </label>
            <label>
              EXE
              <span>{{ library.activeGame.exeNames.length ? library.activeGame.exeNames.join(", ") : "未设置" }}</span>
            </label>
            <label>
              Steam
              <span>{{ library.activeGame.steamAppId || "无" }}</span>
            </label>
            <label>
              Nexus
              <span>{{ library.activeGame.nexusDomain || "无" }}</span>
            </label>
            <label>
              适配
              <span>{{ library.activeGame.adapterStatus === "implemented" ? "已接入安装规则" : library.activeGame.adapterStatus === "custom" ? "自定义通用规则" : "通用规则" }}</span>
            </label>
          </div>
        </div>
        <div class="steam-modal-footer">
          <button class="secondary" @click="openActiveGamePath">打开目录</button>
          <button class="primary" @click="showGameInfoModal = false">完成</button>
        </div>
      </div>
    </div>

    <div v-if="showGameSettingsModal && library.activeGame" class="steam-modal-overlay" @click.self="showGameSettingsModal = false">
      <div class="steam-modal">
        <div class="steam-modal-header">
          <Settings :size="16" />
          <span>高级设置</span>
          <button class="close-btn" @click="showGameSettingsModal = false"><X :size="18" /></button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <div class="gameActionGrid">
            <button class="secondary" :disabled="library.busy" @click="library.chooseActiveGamePath">
              <SquarePen :size="16" />
              游戏目录
            </button>
            <button class="secondary" :disabled="library.busy" @click="library.chooseActiveGameExecutable">
              选择 exe
            </button>
            <button class="secondary" :disabled="!library.activeGame.steamAppId || library.busy" @click="library.locateActiveGameFromSteam">
              Steam 定位
            </button>
            <button class="secondary" :disabled="library.busy" @click="chooseActiveGameCover">
              封面
            </button>
            <button class="secondary" :disabled="!library.settings.storagePath" @click="library.openActiveGameModFolder">
              Mod 缓存
            </button>
          </div>
          <label class="modalField">
            启动参数
            <input
              :value="library.activeGame.launchArgs"
              placeholder="例如 -windowed 或 --skip-launcher"
              @change="library.updateGame(library.activeGame.id, { launchArgs: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <div class="customAdapterPanel">
            <div class="customAdapterHeader">
              <strong>自定义 adapter</strong>
              <span>{{ library.activeGame.customAdapterRules.length }} 条规则</span>
            </div>
            <div v-if="library.activeGame.customAdapterRules.length === 0" class="customAdapterEmpty">
              当前使用内置规则。
            </div>
            <div v-else class="customAdapterRuleList">
              <article
                v-for="rule in library.activeGame.customAdapterRules"
                :key="rule.id"
                class="customAdapterRuleItem"
              >
                <div>
                  <strong>{{ rule.name }}</strong>
                  <span>{{ customRuleSummary(rule) }}</span>
                </div>
                <button class="danger iconOnly" :disabled="library.busy" title="删除规则" @click="library.removeCustomAdapterRule(rule.id)">
                  <Trash2 :size="14" />
                </button>
              </article>
            </div>
            <div class="customAdapterForm">
              <div class="modalTwoCols">
                <label class="modalField">
                  类型名称
                  <input v-model="customRuleName" placeholder="例如 PAK / BepInEx / Mods" />
                </label>
                <label class="modalField">
                  安装目录
                  <input v-model="customRuleInstallPath" placeholder="相对游戏根目录，留空为根目录" />
                </label>
              </div>
              <div class="modalTwoCols">
                <label class="modalField">
                  识别方式
                  <select v-model="customRuleDetectKind">
                    <option value="always">默认</option>
                    <option value="fileName">文件名</option>
                    <option value="extension">扩展名</option>
                    <option value="pathPart">路径片段</option>
                  </select>
                </label>
                <label class="modalField">
                  识别值
                  <input v-model="customRuleDetectValue" :disabled="customRuleDetectKind === 'always'" placeholder="pak / BepInEx / winhttp.dll" />
                </label>
              </div>
              <div class="modalTwoCols">
                <label class="modalField">
                  安装方式
                  <select v-model="customRuleInstallKind">
                    <option value="general">复制全部内容</option>
                    <option value="folderRoot">复制文件夹根内容</option>
                    <option value="folder">匹配文件夹</option>
                    <option value="file">匹配文件</option>
                    <option value="fileSibling">匹配文件同级</option>
                    <option value="manual">手动安装</option>
                  </select>
                </label>
                <label class="modalField">
                  匹配名称
                  <input v-model="customRuleInstallName" :disabled="customRuleInstallKind === 'general' || customRuleInstallKind === 'folderRoot' || customRuleInstallKind === 'manual'" placeholder="默认使用识别值" />
                </label>
              </div>
              <div class="customAdapterFooter">
                <label class="inlineCheck">
                  <input v-model="customRuleKeepPath" type="checkbox" :disabled="customRuleInstallKind !== 'general'" />
                  保留原目录结构
                </label>
                <button class="primary" :disabled="library.busy" @click="saveCustomAdapterRule">
                  添加规则
                </button>
              </div>
            </div>
          </div>
          <div v-if="library.settings.debugMode" class="typeStrip">
            <span v-for="type in library.activeAdapter?.modTypes ?? []" :key="type.id">
              {{ type.name }}
            </span>
          </div>
        </div>
        <div class="steam-modal-footer">
          <button class="primary" @click="showGameSettingsModal = false">完成</button>
        </div>
      </div>
    </div>

    <div v-if="showModEditModal && editingMod" class="steam-modal-overlay" @click.self="showModEditModal = false">
      <div class="steam-modal modEditModal">
        <div class="steam-modal-header">
          <SquarePen :size="16" />
          <span>编辑 Mod</span>
          <button class="close-btn" @click="showModEditModal = false"><X :size="18" /></button>
        </div>
        <div class="steam-modal-content gameModalContent">
          <label class="modalField">
            名称
            <input
              :value="editingMod.name"
              @change="library.updateMod(editingMod.id, { name: ($event.target as HTMLInputElement).value, updatedAt: Date.now() })"
            />
          </label>
          <div class="modalTwoCols">
            <label class="modalField">
              版本
              <input
                :value="editingMod.version"
                placeholder="版本"
                @change="library.updateMod(editingMod.id, { version: ($event.target as HTMLInputElement).value, updatedAt: Date.now() })"
              />
            </label>
            <label class="modalField">
              作者
              <input
                :value="editingMod.author"
                placeholder="作者"
                @change="library.updateMod(editingMod.id, { author: ($event.target as HTMLInputElement).value, updatedAt: Date.now() })"
              />
            </label>
          </div>
          <div class="modalTwoCols">
            <label class="modalField">
              标签
              <input
                :value="editingMod.tags.join(', ')"
                placeholder="用空格或逗号分隔"
                @change="library.updateMod(editingMod.id, { tags: splitTags(($event.target as HTMLInputElement).value), updatedAt: Date.now() })"
              />
            </label>
            <label class="modalField">
              前置
              <input
                :value="editingMod.requirements.join(', ')"
                placeholder="BepInEx, SKSE..."
                @change="library.updateMod(editingMod.id, { requirements: splitTags(($event.target as HTMLInputElement).value), updatedAt: Date.now() })"
              />
            </label>
          </div>
          <label class="modalField">
            来源网址
            <input
              :value="editingMod.website"
              placeholder="来源网址"
              @change="library.updateMod(editingMod.id, { website: ($event.target as HTMLInputElement).value, updatedAt: Date.now() })"
            />
          </label>
          <label class="modalField">
            描述
            <textarea
              :value="editingMod.description"
              placeholder="安装说明、备注或来源说明"
              @change="library.updateMod(editingMod.id, { description: ($event.target as HTMLTextAreaElement).value, updatedAt: Date.now() })"
            />
          </label>
        </div>
        <div class="steam-modal-footer">
          <button class="secondary" @click="openModCache(editingMod)">打开缓存</button>
          <button class="primary" @click="showModEditModal = false">完成</button>
        </div>
      </div>
    </div>

    <header class="topbar">
      <nav class="nav">
        <button :class="{ active: activeTab === 'manager' }" @click="activeTab = 'manager'">
          管理
        </button>
        <button :class="{ active: activeTab === 'nexus' }" @click="activeTab = 'nexus'">
          NEXUS
        </button>
        <button :class="{ active: activeTab === 'download' }" @click="activeTab = 'download'">
          下载
        </button>
        <button :class="{ active: activeTab === 'logs' }" @click="activeTab = 'logs'">
          日志
        </button>
        <button :class="{ active: activeTab === 'backup' }" @click="activeTab = 'backup'">
          整合包
        </button>
        <button :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
          设置
        </button>
        <button :class="{ active: activeTab === 'about' }" @click="activeTab = 'about'">
          关于
        </button>
      </nav>

      <div class="topbarFooter" style="display: flex; align-items: center; gap: 16px;">
        <div style="font-size: 12px; color: #8b929a;">
          <span>当前存储:</span>
          <strong style="color: #fff; margin-left: 4px;">{{ storageLabel }}</strong>
        </div>
        <button class="nexus-profile-btn" @click="showNexusAuthModal = true" style="background: transparent; border: none; cursor: pointer; display: flex; align-items: center; gap: 8px; color: #dcdedf; font-size: 13px;">
          <img v-if="library.settings.nexusUser?.avatar" :src="library.settings.nexusUser.avatar" style="width: 28px; height: 28px; border-radius: 4px; border: 1px solid #454f5f;" />
          <div v-else style="width: 28px; height: 28px; border-radius: 4px; background: #2a2d33; display: flex; align-items: center; justify-content: center; border: 1px solid #454f5f;"><User :size="16" /></div>
          <span style="font-weight: 600;">{{ library.settings.nexusUser?.name || "未登录 Nexus" }}</span>
        </button>
      </div>
    </header>

    <main class="content" @scroll="handleMainScroll">

      <section v-if="activeTab === 'manager'" class="page" style="padding: 0; height: 100%;">


        <div class="workspaceGrid">
          <section class="panel gamePanel">
            <div class="panelHeader" style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h2>游戏库</h2>
                <span>{{ library.games.length }} / 支持 {{ library.presetCount }} 个</span>
              </div>
              <button class="iconButton" @click="showAddGameModal = true" title="添加游戏" style="color: #4f8cff;">
                <Plus :size="18" />
              </button>
            </div>

            <!-- 添加游戏弹窗 -->
            <div v-if="showAddGameModal" class="steam-modal-overlay">
              <div class="steam-modal" style="width: 560px; max-height: 80vh; display: flex; flex-direction: column;">
                <div class="steam-modal-header">
                  <h3>添加游戏</h3>
                  <button class="close-btn" @click="showAddGameModal = false"><X :size="20" /></button>
                </div>
                
                <div class="steam-modal-body" style="overflow-y: auto;">
                  <div v-if="!showCustomGameForm" class="presetPicker" style="border: none; padding: 0;">
                    <div class="presetSearch" style="margin-bottom: 12px; background: rgba(0,0,0,0.2); border: 1px solid #3d4450; padding: 6px 12px; border-radius: 4px; display: flex; align-items: center; gap: 8px;">
                      <Search :size="16" style="color: #8b929a;" />
                      <input v-model="library.presetSearch" placeholder="搜索支持游戏、Steam ID 或 exe" style="background: transparent; border: none; color: #fff; flex: 1; outline: none;" />
                    </div>
                    <div class="presetList" style="max-height: 400px;">
                      <button
                        v-for="preset in library.presetList"
                        :key="preset.id"
                        class="presetItem"
                        @click="library.addGame(preset); showAddGameModal = false;"
                      >
                        <img v-if="preset.coverUrl" :src="preset.coverUrl" alt="" />
                        <div>
                          <strong>{{ preset.name }}</strong>
                          <span>
                            {{ preset.steamAppId ? `Steam ${preset.steamAppId}` : "非 Steam/未知" }}
                            · {{ preset.nexusDomain ? `Nexus ${preset.nexusDomain}` : "无 Nexus 配置" }}
                          </span>
                        </div>
                      </button>
                    </div>
                  </div>

                  <div v-if="showCustomGameForm" class="customGameForm" style="border: none; padding: 0;">
                    <input class="steamInput" v-model="customGameName" placeholder="游戏名称" style="margin-bottom: 8px;" />
                    <div class="pathPicker" style="margin-bottom: 8px; display: flex; gap: 8px;">
                      <input class="steamInput" v-model="customGamePath" placeholder="游戏目录" />
                      <button class="secondary" @click="chooseCustomGamePath">选择目录</button>
                    </div>
                    <div class="pathPicker" style="margin-bottom: 8px; display: flex; gap: 8px;">
                      <input class="steamInput" v-model="customGameExeNames" placeholder="exe 名称，逗号分隔" />
                      <button class="secondary" @click="chooseCustomGameExe">选择 exe</button>
                    </div>
                    <input class="steamInput" v-model="customGameInstallPath" placeholder="安装相对路径(空为根目录)" style="margin-bottom: 8px;" />
                    <input class="steamInput" v-model="customGameLaunchArgs" placeholder="启动参数" style="margin-bottom: 8px;" />
                    <div class="pathPicker" style="margin-bottom: 8px; display: flex; gap: 8px;">
                      <input class="steamInput" v-model="customGameCoverUrl" placeholder="封面图片路径(可选)" />
                      <button class="secondary" @click="chooseCustomGameCover">选择封面</button>
                    </div>
                    <button class="primary fullWidth" @click="createCustomGameFromForm(); showAddGameModal = false;">保存自定义游戏</button>
                  </div>
                </div>

                <div class="steam-modal-footer">
                  <button class="secondary" v-if="!showCustomGameForm" @click="showCustomGameForm = true">不在列表里，手动添加</button>
                  <button class="secondary" v-else @click="showCustomGameForm = false">返回预设列表</button>
                </div>
              </div>
            </div>

            <div v-if="library.games.length === 0" class="empty">
              还没有添加游戏。点击右上角 + 添加。
            </div>

            <button
              v-for="game in library.games"
              :key="game.id"
              class="gameItem"
              :class="{ selected: game.id === library.activeGameId }"
              @click="chooseGame(game.id)"
              @contextmenu.prevent="showGameContextMenu($event, game.id)"
            >
              <img v-if="gameCoverUrls[game.id]" :src="gameCoverUrls[game.id]" alt="" />
              <Gamepad2 v-else :size="18" />
              <span>
                {{ game.name }}
                <small v-if="game.steamAppId">Steam {{ game.steamAppId }}</small>
              </span>
            </button>
          </section>

          <section
            class="panel managerPanel"
            :class="{ dragging: dragActive }"
            @dragenter.prevent="dragActive = !draggingModId"
            @dragover.prevent="dragActive = !draggingModId"
            @dragleave.prevent="dragActive = false"
            @drop.prevent="dropLocalMods"
          >
            <div v-if="library.activeGame" class="steamHeroBanner">
              <div class="heroBg" :style="gameCoverUrls[library.activeGame.id] ? { backgroundImage: `url('${gameCoverUrls[library.activeGame.id]}')` } : {}"></div>
              <div class="heroGradientBottom"></div>
              <div class="heroGradientLeft"></div>
              <div class="heroContent">
                <div class="heroMain">
                  <h1 class="heroTitle">{{ library.activeGame.name }}</h1>
                  <div class="heroActions">
                    <button class="steamPlayBtn" @click="library.launchActiveGame()">
                      <Play :size="20" fill="currentColor" />
                      启动游戏
                    </button>
                    <div class="heroStats">
                      <span>状态</span>
                      <strong>{{ library.activeGame.adapterStatus === 'implemented' ? '已接入规则' : '通用规则' }}</strong>
                    </div>
                  </div>
                </div>
                <div class="heroSummary">
                  <div class="heroSummaryCard">
                    <span>已启用 Mod</span>
                    <strong>{{ library.installedCount }}</strong>
                  </div>
                  <div class="heroSummaryCard">
                    <span>全部 Mod</span>
                    <strong>{{ library.activeMods.length }}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="dragActive" class="dropOverlay">
              <PackagePlus :size="24" />
              松开导入到当前游戏
            </div>
            
            <div class="managerContent">
              <div class="stickyFilters">
              <div class="toolsRow">
              <button class="primary" :disabled="library.busy" @click="library.importLocalMods">
                <PackagePlus :size="17" />
                导入 Mod
              </button>
              <label class="searchBox">
                <Search :size="17" />
                <input v-model="library.search" placeholder="搜索 Mod 名称、作者、标签或来源路径" />
              </label>
              <div class="steamSelect" @click.stop>
                <button @click="toggleDropdown('mod-type-filter')">
                  {{ typeFilterLabel() }}
                  <ChevronDown :size="13" />
                </button>
                <div v-if="openDropdownId === 'mod-type-filter'" class="steamSelectMenu">
                  <button @click="library.selectedTypeId = 'all'; closeDropdown()">全部类型</button>
                  <button
                    v-for="type in library.activeAdapter?.modTypes ?? []"
                    :key="type.id"
                    @click="library.selectedTypeId = type.id; closeDropdown()"
                  >
                    {{ type.name }}
                  </button>
                </div>
              </div>
              <div class="steamSelect" @click.stop>
                <button @click="toggleDropdown('mod-tag-filter')">
                  {{ tagFilterLabel() }}
                  <ChevronDown :size="13" />
                </button>
                <div v-if="openDropdownId === 'mod-tag-filter'" class="steamSelectMenu">
                  <button @click="library.selectedTag = 'all'; closeDropdown()">全部标签</button>
                  <button
                    v-for="tag in library.activeTags"
                    :key="tag"
                    @click="library.selectedTag = tag; closeDropdown()"
                  >
                    {{ tag }}
                  </button>
                </div>
              </div>
              <div class="steamSelect" @click.stop>
                <button @click="toggleDropdown('mod-sort-filter')">
                  {{ sortLabel() }}
                  <ChevronDown :size="13" />
                </button>
                <div v-if="openDropdownId === 'mod-sort-filter'" class="steamSelectMenu">
                  <button @click="library.sortMode = 'custom'; closeDropdown()">自定义排序</button>
                  <button @click="library.sortMode = 'createdDesc'; closeDropdown()">最近导入</button>
                  <button @click="library.sortMode = 'createdAsc'; closeDropdown()">最早导入</button>
                  <button @click="library.sortMode = 'nameAsc'; closeDropdown()">名称 A-Z</button>
                  <button @click="library.sortMode = 'nameDesc'; closeDropdown()">名称 Z-A</button>
                  <button @click="library.sortMode = 'installedFirst'; closeDropdown()">已安装优先</button>
                </div>
              </div>
              <div class="stats">
                <span>{{ library.activeMods.length }} 个 Mod</span>
                <span>{{ library.installedCount }} 个已安装</span>
              </div>
              <div class="viewSwitch">
                <button
                  class="iconButton"
                  :class="{ active: modViewMode === 'list' }"
                  title="列表视图"
                  @click="modViewMode = 'list'"
                >
                  <List :size="16" />
                </button>
                <button
                  class="iconButton"
                  :class="{ active: modViewMode === 'grid' }"
                  title="网格视图"
                  @click="modViewMode = 'grid'"
                >
                  <LayoutGrid :size="16" />
                </button>
              </div>
            </div>

            <div class="tagToolsRow">
              <span class="tagToolsTitle">分类标签</span>
              <button
                v-for="tag in library.activeTags"
                :key="tag"
                class="tagChip"
                :class="{ active: library.selectedTag === tag }"
                :style="{ borderColor: tagColor(tag), color: tagColor(tag) }"
                @click="library.selectedTag = library.selectedTag === tag ? 'all' : tag"
              >
                {{ tag }}
              </button>
              <span v-if="library.activeTags.length === 0" class="muted">暂无标签</span>
              <input v-model="quickTagName" class="tagQuickInput" placeholder="给选中 Mod 添加标签" @keyup.enter="addQuickTagToSelected" />
              <button class="secondary" :disabled="library.selectedMods.length === 0 || !quickTagName.trim()" @click="addQuickTagToSelected">
                添加
              </button>
            </div>

            <div v-if="library.selectedMods.length > 0" class="batchBar">
              <span>已选择 {{ library.selectedMods.length }} 个</span>
              <button class="secondary" :disabled="library.selectedMods.length === 0" @click="library.clearSelection">
                清空
              </button>
              <button class="secondary" :disabled="library.selectedMods.length === 0" @click="showBatchEdit = !showBatchEdit">
                批量编辑
              </button>
              <button class="secondary" :disabled="library.selectedMods.length === 0" @click="showGmmExport = !showGmmExport">
                导出 .gmm
              </button>
              <button class="primary" :disabled="library.selectedMods.length === 0 || library.busy" @click="library.installSelectedMods">
                批量安装
              </button>
              <button class="secondary" :disabled="library.selectedMods.length === 0 || library.busy" @click="confirmUninstallSelectedMods">
                批量卸载
              </button>
              <button class="secondary danger" :disabled="library.selectedMods.length === 0 || library.busy" @click="confirmRemoveSelectedMods">
                批量删除
              </button>
            </div>
            </div> <!-- end of stickyFilters -->

            <div v-if="showBatchEdit" class="batchEditPanel">
              <select v-model="batchTypeId">
                <option value="">不改类型</option>
                <option
                  v-for="type in library.activeAdapter?.modTypes ?? []"
                  :key="type.id"
                  :value="type.id"
                >
                  {{ type.name }}
                </option>
              </select>
              <input v-model="batchVersion" placeholder="统一版本，留空不改" />
              <input v-model="batchAuthor" placeholder="统一作者，留空不改" />
              <input v-model="batchWebsite" placeholder="统一来源网址，留空不改" />
              <input v-model="batchTags" placeholder="追加标签，空格或逗号分隔" />
              <button class="primary" :disabled="library.busy" @click="applyBatchEdit">
                应用
              </button>
            </div>

            <div v-if="showGmmExport" class="batchEditPanel gmmExportPanel">
              <input v-model="gmmName" placeholder="包名，留空用 Mod 名称" />
              <input v-model="gmmAuthor" placeholder="作者" />
              <input v-model="gmmVersion" placeholder="版本" />
              <input v-model="gmmDescription" placeholder="描述" />
              <button class="primary" :disabled="library.busy || library.selectedMods.length === 0" @click="exportSelectedGmm">
                导出
              </button>
            </div>

            <div v-if="library.busy" class="loadingLine">
              <LoaderCircle :size="18" class="spin" />
              正在处理本地文件...
            </div>

            <div v-if="library.activeMods.length === 0" class="empty modEmpty">
              当前游戏还没有本地 Mod。点击“导入 Mod”选择文件夹或文件，系统会复制到你的 Mod 存储目录并生成记录。
            </div>

            <div v-else-if="modViewMode === 'list'" class="steamModTable">
              <div class="steamModHeader">
                <label class="rowCheck">
                  <input
                    type="checkbox"
                    :checked="library.activeMods.length > 0 && library.selectedMods.length === library.activeMods.length"
                    @change="($event.target as HTMLInputElement).checked ? library.selectAllVisibleMods() : library.clearSelection()"
                  />
                </label>
                <span></span>
                <span>名称</span>
                <span>版本</span>
                <span>类型</span>
                <span>状态</span>
                <span>预览</span>
                <span>操作</span>
              </div>
              <template v-for="mod in library.activeMods" :key="mod.id">
                <article
                  class="steamModRow"
                  :class="{ dragging: draggingModId === mod.id, dragOver: dragOverModId === mod.id }"
                  :draggable="library.canReorderMods && !library.busy"
                  @dragstart="beginModDrag(mod)"
                  @dragover.prevent="dragOverModId = mod.id"
                  @dragleave="dragOverModId === mod.id && (dragOverModId = '')"
                  @drop.prevent="dropModOn(mod)"
                  @dragend="draggingModId = ''; dragOverModId = ''"
                >
                  <label class="rowCheck">
                    <input
                      type="checkbox"
                      :checked="library.selectedModIds.includes(mod.id)"
                      @change="library.toggleModSelection(mod.id, ($event.target as HTMLInputElement).checked)"
                    />
                  </label>
                  <button class="dragHandle" :disabled="!library.canReorderMods || library.busy" title="拖拽排序">
                    <GripVertical :size="16" />
                  </button>
                  <div class="steamModName">
                    <Archive :size="16" />
                    <strong :title="mod.name">{{ mod.name }}</strong>
                    <span v-for="tag in mod.tags.slice(0, 2)" :key="tag" class="tagBadge" :style="{ borderColor: tagColor(tag), color: tagColor(tag) }">
                      {{ tag }}
                    </span>
                  </div>
                  <span class="steamModVersion">{{ mod.version || "1.0.0" }}</span>
                  <div class="steamSelect steamSelectCompact" @click.stop>
                    <button @click="toggleDropdown(`mod-type-${mod.id}`)">
                      {{ modTypeLabel(mod) }}
                      <ChevronDown :size="13" />
                    </button>
                    <div v-if="openDropdownId === `mod-type-${mod.id}`" class="steamSelectMenu">
                      <button
                        v-for="type in library.activeAdapter?.modTypes ?? []"
                        :key="type.id"
                        @click="changeModType(mod, type.id); closeDropdown()"
                      >
                        {{ type.name }}
                      </button>
                    </div>
                  </div>
                  <button
                    class="steamToggleCell"
                    :class="{ active: mod.installed }"
                    :disabled="library.busy"
                    @click="mod.installed ? confirmUninstallMod(mod) : library.installMod(mod)"
                  >
                    <span class="steamToggle"><span /></span>
                    {{ mod.installed ? "已安装" : "未安装" }}
                  </button>
                  <div class="modPreviewCell">
                    <button
                      v-if="coverUrls[mod.id]"
                      class="modThumbButton"
                      :title="`查看预览图：${mod.name}`"
                      @click="openPreviewImage(coverUrls[mod.id], mod.name)"
                    >
                      <img :src="coverUrls[mod.id]" alt="" />
                    </button>
                    <button
                      v-else
                      class="iconButton"
                      :disabled="library.busy"
                      :title="mod.installed ? '查看部署文件' : '预览安装计划'"
                      @click="mod.installed ? toggleModDetails(mod.id) : previewModInstallPlan(mod)"
                    >
                      <ListTree :size="16" />
                    </button>
                  </div>
                  <div class="steamRowActions">
                    <button class="secondary" :disabled="library.busy" @click="openModEdit(mod)">
                      编辑
                    </button>
                    <button class="iconButton danger" :disabled="library.busy" title="删除本地 Mod" @click="confirmRemoveMod(mod)">
                      <Trash2 :size="16" />
                    </button>
                  </div>
                </article>
                <div v-if="expandedModId === mod.id" class="modDetails steamModDetails">
                <template v-if="mod.installed">
                  <strong>部署文件</strong>
                  <p v-if="mod.deployedFiles.length === 0">当前还没有部署记录，旧记录卸载会回退到安装策略匹配。</p>
                  <ul v-else>
                    <li v-for="file in visibleDeployedFiles(mod)" :key="file">{{ file }}</li>
                  </ul>
                  <p v-if="mod.deployedFiles.length > 80">
                    仅显示前 80 个，共 {{ mod.deployedFiles.length }} 个文件。
                  </p>
                </template>
                <template v-else>
                  <strong>安装计划</strong>
                  <p v-if="!library.installPlans[mod.id]">点击计划按钮后会显示准备写入游戏目录的相对路径。</p>
                  <p v-else-if="visiblePlanFiles(mod).length === 0">没有匹配到可自动安装的文件。</p>
                  <p v-else-if="conflictCount(mod) > 0" class="conflictText">
                    检测到 {{ conflictCount(mod) }} 个冲突文件，直接安装会被阻止。
                  </p>
                  <ul v-if="visiblePlanFiles(mod).length > 0">
                    <li
                      v-for="file in visiblePlanFiles(mod)"
                      :key="file"
                      :class="{ conflict: library.installPlans[mod.id]?.conflicts.includes(file) }"
                    >
                      {{ file }}
                    </li>
                  </ul>
                  <p v-if="(library.installPlans[mod.id]?.targetFiles.length ?? 0) > 80">
                    仅显示前 80 个，共 {{ library.installPlans[mod.id]?.targetFiles.length }} 个文件。
                  </p>
                </template>
                </div>
              </template>
            </div>
            <div v-else class="steamModGrid">
              <article
                v-for="mod in library.activeMods"
                :key="mod.id"
                class="steamModCard"
                :class="{ installed: mod.installed, selected: library.selectedModIds.includes(mod.id), dragging: draggingModId === mod.id, dragOver: dragOverModId === mod.id }"
                :draggable="library.canReorderMods && !library.busy"
                @dragstart="beginModDrag(mod)"
                @dragover.prevent="dragOverModId = mod.id"
                @dragleave="dragOverModId === mod.id && (dragOverModId = '')"
                @drop.prevent="dropModOn(mod)"
                @dragend="draggingModId = ''; dragOverModId = ''"
              >
                <div class="modCardCover">
                  <img v-if="coverUrls[mod.id]" :src="coverUrls[mod.id]" alt="" @click="openPreviewImage(coverUrls[mod.id], mod.name)" />
                  <Archive v-else :size="32" />
                  <label class="modCardCheck">
                    <input
                      type="checkbox"
                      :checked="library.selectedModIds.includes(mod.id)"
                      @change="library.toggleModSelection(mod.id, ($event.target as HTMLInputElement).checked)"
                    />
                  </label>
                  <button class="modCardDrag" :disabled="!library.canReorderMods || library.busy" title="拖拽排序">
                    <GripVertical :size="16" />
                  </button>
                </div>

                <div class="modCardBody">
                  <h3 :title="mod.name">{{ mod.name }}</h3>
                  <div class="modCardMeta">
                    <span>{{ mod.version || "1.0.0" }}</span>
                    <span>{{ mod.files.length }} 个文件</span>
                    <span>{{ modTypeLabel(mod) }}</span>
                  </div>
                  <div class="modCardTags" v-if="mod.tags.length">
                    <span v-for="tag in mod.tags.slice(0, 3)" :key="tag" class="tagBadge" :style="{ borderColor: tagColor(tag), color: tagColor(tag) }">
                      {{ tag }}
                    </span>
                  </div>
                </div>

                <div class="modCardActions">
                  <button
                    class="steamToggleCell"
                    :class="{ active: mod.installed }"
                    :disabled="library.busy"
                    @click="mod.installed ? confirmUninstallMod(mod) : library.installMod(mod)"
                  >
                    <span class="steamToggle"><span /></span>
                    {{ mod.installed ? "已安装" : "未安装" }}
                  </button>
                  <button
                    class="iconButton"
                    :disabled="library.busy"
                    :title="mod.installed ? '查看部署文件' : '预览安装计划'"
                    @click="mod.installed ? toggleModDetails(mod.id) : previewModInstallPlan(mod)"
                  >
                    <ListTree :size="16" />
                  </button>
                  <button class="iconButton" :disabled="library.busy" title="编辑" @click="openModEdit(mod)">
                    <SquarePen :size="16" />
                  </button>
                  <button class="iconButton danger" :disabled="library.busy" title="删除本地 Mod" @click="confirmRemoveMod(mod)">
                    <Trash2 :size="16" />
                  </button>
                </div>

                <div v-if="expandedModId === mod.id" class="modDetails steamModDetails modCardDetails">
                  <template v-if="mod.installed">
                    <strong>部署文件</strong>
                    <p v-if="mod.deployedFiles.length === 0">当前还没有部署记录，旧记录卸载会回退到安装策略匹配。</p>
                    <ul v-else>
                      <li v-for="file in visibleDeployedFiles(mod)" :key="file">{{ file }}</li>
                    </ul>
                  </template>
                  <template v-else>
                    <strong>安装计划</strong>
                    <p v-if="!library.installPlans[mod.id]">点击计划按钮后会显示准备写入游戏目录的相对路径。</p>
                    <p v-else-if="visiblePlanFiles(mod).length === 0">没有匹配到可自动安装的文件。</p>
                    <p v-else-if="conflictCount(mod) > 0" class="conflictText">
                      检测到 {{ conflictCount(mod) }} 个冲突文件，直接安装会被阻止。
                    </p>
                    <ul v-if="visiblePlanFiles(mod).length > 0">
                      <li
                        v-for="file in visiblePlanFiles(mod)"
                        :key="file"
                        :class="{ conflict: library.installPlans[mod.id]?.conflicts.includes(file) }"
                      >
                        {{ file }}
                      </li>
                    </ul>
                  </template>
                </div>
              </article>
            </div>
            </div>
          </section>
        </div>
      </section>

      <section v-else-if="activeTab === 'nexus'" class="page" style="padding: 0; height: 100%;">
        <div class="workspaceGrid">
          
          <!-- Left Sidebar: Nexus Game List -->
          <section class="panel gamePanel">
            <div class="panelHeader">
              <h2>Nexus 游戏</h2>
              <span>{{ nexusGames.length }} 个已添加</span>
            </div>
            <div v-if="nexusGames.length === 0" class="empty">
              还没有添加带 Nexus 配置的游戏。
            </div>
            <button
              v-for="game in nexusGames"
              :key="game.id"
              class="gameItem"
              :class="{ active: library.nexusPresetId === game.presetId }"
              @click="chooseNexusGame(game.id)"
            >
              <img v-if="gameCoverUrls[game.id]" :src="gameCoverUrls[game.id]" alt="" />
              <Gamepad2 v-else :size="18" />
              <span>
                {{ game.name }}
                <small>{{ game.nexusDomain }}</small>
              </span>
            </button>
          </section>

          <!-- Right Content: Manager Panel -->
          <section class="panel managerPanel" @scroll="handleMainScroll">

            <!-- Mod Details View -->
            <div v-if="library.selectedNexusMod" class="nexusDetailView managerContent">
              <div class="activeGameBar" style="margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #2a2d33;">
                <button class="secondary" @click="library.selectedNexusMod = null">
                  ← 返回列表
                </button>
                <span style="font-size: 20px; font-weight: 300; color: #dcdedf; margin-left: 12px;">{{ library.selectedNexusMod.title }}</span>
              </div>

              <div class="steamWorkshopHero">
                <div class="heroCarousel">
                  <div class="heroMainImageWrapper" @click="library.selectedNexusMod.images.length > 0 ? openPreviewImage(library.selectedNexusMod.images[selectedNexusImageIndex]?.imageUrl || library.selectedNexusMod.images[selectedNexusImageIndex]?.thumbnailUrl, library.selectedNexusMod.images[selectedNexusImageIndex]?.title) : null">
                    <img v-if="library.selectedNexusMod.images.length > 0" :src="library.selectedNexusMod.images[selectedNexusImageIndex]?.imageUrl || library.selectedNexusMod.images[selectedNexusImageIndex]?.thumbnailUrl" alt="" class="heroMainImage" />
                    <img v-else-if="library.selectedNexusMod.cover" :src="library.selectedNexusMod.cover" alt="" class="heroMainImage" />
                    <div v-else class="noCover"><Archive :size="64" /></div>
                  </div>
                  
                  <div class="heroThumbnails" v-if="library.selectedNexusMod.images.length > 1">
                    <button v-for="(img, idx) in library.selectedNexusMod.images" :key="img.id" class="heroThumb" :class="{ active: selectedNexusImageIndex === idx }" @click="selectedNexusImageIndex = idx">
                      <img :src="img.thumbnailUrl || img.imageUrl" />
                    </button>
                  </div>
                </div>

                <div class="heroSidebar">
                  <div class="sidebarPanel">
                    <h3>Mod 信息</h3>
                    <div class="metaRow"><span>作者</span><strong>{{ library.selectedNexusMod.author || '未知' }}</strong></div>
                    <div class="metaRow"><span>版本</span><strong>{{ library.selectedNexusMod.version || '无' }}</strong></div>
                    <div class="metaRow"><span>更新</span><strong>{{ formatDate(library.selectedNexusMod.updatedAt).split(' ')[0] }}</strong></div>
                    <div class="metaRow"><span>下载</span><strong>{{ (library.selectedNexusMod.downloads || 0).toLocaleString() }}</strong></div>
                    <div class="metaRow"><span>点赞</span><strong>{{ (library.selectedNexusMod.likes || 0).toLocaleString() }}</strong></div>
                  </div>

                  <div class="sidebarPanel" v-if="library.selectedNexusMod.categories.length > 0">
                    <h3>分类标签</h3>
                    <div class="nexusCategoryRow" style="margin-top: 12px;">
                      <span v-for="category in library.selectedNexusMod.categories" :key="category">{{ category }}</span>
                    </div>
                  </div>

                  <div class="sidebarActions">
                    <button class="secondary" @click="library.openNexusUrl(library.selectedNexusMod.website)" style="width: 100%; justify-content: center;">打开 Nexus 页面</button>
                    <button class="secondary" :disabled="library.nexusTranslationLoading" @click="library.translateSelectedNexusMod(library.nexusTranslationVisible)" style="width: 100%; justify-content: center; margin-top: 8px;">
                      <LoaderCircle v-if="library.nexusTranslationLoading" :size="16" class="spin" />
                      <Languages v-else :size="16" />
                      {{ library.nexusTranslationVisible ? "刷新翻译" : "翻译成中文" }}
                    </button>
                    <button v-if="library.nexusTranslationVisible" class="secondary" @click="library.showOriginalNexusText" style="width: 100%; justify-content: center; margin-top: 8px;">查看原文</button>
                  </div>

                  <p v-if="library.nexusTranslationError" class="translationError" style="margin-top: 12px;">
                    {{ library.nexusTranslationError }}
                  </p>
                </div>
              </div>

              <div class="nexusDetailColumns" style="margin-top: 32px; gap: 32px;">
                <section class="nexusDescriptionBlock" style="flex: 2; min-width: 0;">
                  <h3 style="font-size: 18px; border-bottom: 1px solid #2a2d33; padding-bottom: 8px; margin-bottom: 16px;">说明</h3>
                  <div style="font-size: 14px; color: #b8b6b4; line-height: 1.6; padding: 12px; background: rgba(0,0,0,0.2); border-left: 3px solid #67c1f5; margin-bottom: 24px;">
                    {{ library.nexusTranslationVisible && library.nexusTranslatedSummary ? library.nexusTranslatedSummary : library.selectedNexusMod.summary || "无摘要" }}
                  </div>
                  <div
                    v-if="library.nexusTranslationVisible && library.nexusTranslatedDescription"
                    class="nexusDescription translatedText"
                    v-html="renderNexusDescription(library.nexusTranslatedDescription, library.selectedNexusMod.descriptionFormat)"
                  />
                  <div
                    v-else
                    class="nexusDescription"
                    v-html="renderNexusDescription(library.selectedNexusMod.description, library.selectedNexusMod.descriptionFormat)"
                  />
                </section>

                <section class="nexusFilesBlock" style="flex: 1;">
                  <h3 style="font-size: 18px; border-bottom: 1px solid #2a2d33; padding-bottom: 8px; margin-bottom: 16px;">文件</h3>
                  <div v-if="library.selectedNexusMod.files.length === 0" class="empty">
                    Nexus 没返回可下载文件。
                  </div>
                  <article v-for="file in library.selectedNexusMod.files" :key="file.id" class="fileRow">
                    <div>
                      <strong>{{ file.name }}</strong>
                      <span>
                        {{ file.categoryName || "文件" }}
                        · {{ file.version || "无版本" }}
                        · {{ formatBytes(file.size) }}
                        · {{ formatDate(file.createdAt) }}
                      </span>
                    </div>
                    <div class="compactActions">
                      <button class="secondary" @click="library.openNexusUrl(file.detailsUrl)">网页</button>
                      <button class="primary" :disabled="library.busy" @click="library.downloadNexusFile(file)">
                        <ArrowDownToLine :size="16" />
                        下载
                      </button>
                    </div>
                  </article>
                </section>
              </div>
            </div>

            <!-- Mod List View -->
            <div v-else class="nexusListView managerContent" style="gap: 18px;">
              <!-- Steam Filter Bar -->
              <div class="steamFilterBar">
                <div class="steamFilterLeft">
                  <div class="searchWrapper">
                    <Search :size="14" class="searchIcon" />
                    <input v-model="library.nexusSearch" placeholder="搜索 Mod" @keyup.enter="searchNexusMods" />
                  </div>
                  
                  <div class="steamDropdown">
                    <select v-model="library.nexusCategory" @change="searchNexusMods">
                      <option value="">全部分类</option>
                      <option v-for="facet in library.nexusFacets.categoryName" :key="facet.value" :value="facet.value">
                        {{ facet.label }} ({{ facet.count }})
                      </option>
                    </select>
                    <ChevronDown :size="12" class="chevron" />
                  </div>
                  
                  <div class="steamDropdown">
                    <select v-model="library.nexusLanguage" @change="searchNexusMods">
                      <option value="">全部语言</option>
                      <option v-for="facet in library.nexusFacets.languageName" :key="facet.value" :value="facet.value">
                        {{ facet.label }} ({{ facet.count }})
                      </option>
                    </select>
                    <ChevronDown :size="12" class="chevron" />
                  </div>

                  <div class="steamDropdown">
                    <select v-model="library.nexusTag" @change="searchNexusMods">
                      <option value="">全部标签</option>
                      <option v-for="facet in library.nexusFacets.tag" :key="facet.value" :value="facet.value">
                        {{ facet.label }} ({{ facet.count }})
                      </option>
                    </select>
                    <ChevronDown :size="12" class="chevron" />
                  </div>
                </div>

                <div class="steamFilterRight">
                  <div class="steamDropdown">
                    <span class="label">排序方式:</span>
                    <select v-model="library.nexusSort" @change="searchNexusMods">
                      <option value="downloads">下载最多</option>
                      <option value="updatedAt">最近更新</option>
                      <option value="createdAt">最新发布</option>
                      <option value="default">默认</option>
                    </select>
                    <ChevronDown :size="12" class="chevron" />
                  </div>
                </div>
              </div>

              <!-- Loader / Empty States -->
              <div v-if="library.nexusLoading && library.nexusMods.length === 0" class="steamLoadingCenter">
                <LoaderCircle :size="32" class="spin" />
                <p>正在拉取 NexusMods...</p>
              </div>
              <div v-else-if="library.nexusMods.length === 0" class="empty">
                当前还没有列表数据。选择游戏后进行搜索或筛选。
              </div>

              <!-- Steam Grid Cards -->
              <div v-else class="steamCardsGrid horizontalGrid" :class="{ 'is-loading': library.nexusLoading }">
                <!-- Loading overlay for existing list -->
                <div v-if="library.nexusLoading" class="gridLoadingOverlay">
                  <div class="loadingSpinnerWrapper">
                    <LoaderCircle :size="32" class="spin" />
                  </div>
                </div>
                <article
                  v-for="item in library.nexusMods"
                  :key="item.id"
                  class="steamCard horizontalCard"
                  @click="library.openNexusModDetail(item); selectedNexusImageIndex = 0;"
                >
                  <div class="cardCover">
                    <img v-if="item.cover" :src="item.cover" alt="" />
                    <div v-else class="noCover"><Archive :size="32" /></div>
                    <div class="cardHover">
                      <span>查看详情</span>
                    </div>
                  </div>
                  <div class="cardInfoHorizontal" style="flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px 12px; height: 60px;">
                    <div class="cardInfoTitle" style="width: 100%;">
                      <h3 :title="item.title" style="flex: 1; font-size: 14px; margin-bottom: 2px;">{{ item.title || `Mod ${item.id}` }}</h3>
                    </div>
                    <div style="display: flex; gap: 16px; font-size: 11px; color: #8f98a0; width: 100%;">
                      <span title="下载量"><Download :size="11" style="vertical-align: -2px; margin-right: 4px;"/>{{ (item.downloads || 0).toLocaleString() }}</span>
                      <span title="更新日期"><Calendar :size="11" style="vertical-align: -2px; margin-right: 4px;"/>{{ formatDate(item.updatedAt).split(' ')[0] }}</span>
                    </div>
                  </div>
                </article>
              </div>

              <div class="steamPaginationFloat" v-if="library.nexusMods.length > 0">
                <button class="secondary" :disabled="library.nexusPage <= 1 || library.nexusLoading" @click="nextNexusPage(-1)">
                  <ChevronUp :size="16" />
                </button>
                <span>{{ library.nexusPage }} / {{ library.nexusTotalPages || 1 }}</span>
                <button class="secondary" :disabled="library.nexusPage >= (library.nexusTotalPages || 1) || library.nexusLoading" @click="nextNexusPage(1)">
                  <ChevronDown :size="16" />
                </button>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section v-else-if="activeTab === 'download'" class="page steamDownloadsPage">
        <div class="steamDownloadsWrapper">
          <div class="steamDownloadsHeader">
            <h2>下载队列 <span>({{ library.activeDownloads.length }})</span></h2>
            
            <div class="steamCustomDownloadRow">
              <input v-model="customDownloadUrl" placeholder="输入自定义下载链接 (http/https)..." />
              <input v-model="customDownloadName" placeholder="重命名文件(可选)" />
              <button class="primary" :disabled="!customDownloadUrl.trim() || library.busy" @click="startCustomDownload">
                <ArrowDownToLine :size="14" />
                添加任务
              </button>
            </div>
          </div>

          <div class="steamDownloadsList">
            <div v-if="library.activeDownloads.length === 0" class="empty">
              当前没有任何下载任务。
            </div>
            
            <article v-for="task in library.activeDownloads" :key="task.id" class="steamDownloadTask">
              <div class="taskIconWrapper">
                <HardDrive :size="28" v-if="task.source === 'Custom'" class="taskIcon" />
                <Archive :size="28" v-else class="taskIcon" />
              </div>
              
              <div class="taskMain">
                <div class="taskTitleRow">
                  <h3 :title="task.modName || task.fileName">{{ task.modName || task.fileName }}</h3>
                  <span class="taskStatusBadge" :class="{ ok: task.status === 'completed', error: task.status === 'failed', active: task.status === 'downloading', paused: task.status === 'paused' }">
                    {{ downloadStatusText(task.status) }}
                  </span>
                </div>
                
                <p class="taskFileName" :title="task.fileName">{{ task.fileName }}</p>
                <p v-if="task.error" class="taskError">{{ task.error }}</p>

                <div class="taskMetaRow">
                  <span class="metaItem"><Gamepad2 :size="12" /> {{ task.gameName || '未知游戏' }}</span>
                  <span class="metaItem"><ListTree :size="12" /> {{ task.source === 'NexusMods' ? 'NexusMods' : '自定义链接' }}</span>
                  
                  <span class="metaItem progressText" v-if="task.totalBytes > 0">
                    <span v-if="task.status === 'downloading' && task.speed">{{ formatBytes(task.speed) }}/s • </span>{{ formatBytes(task.receivedBytes) }} / {{ formatBytes(task.totalBytes) }}
                  </span>
                  <span class="metaItem progressText" v-else>
                    <span v-if="task.status === 'downloading' && task.speed">{{ formatBytes(task.speed) }}/s • </span>{{ formatBytes(task.receivedBytes) }} 已下载
                  </span>
                </div>
                
                <div class="taskProgressBar" v-if="['downloading', 'paused'].includes(task.status)">
                  <div class="progressFill" :style="{ width: task.totalBytes > 0 ? `${Math.min(100, Math.round((task.receivedBytes / task.totalBytes) * 100))}%` : '100%' }" :class="{ indeterminate: task.totalBytes === 0 }"></div>
                </div>
              </div>
              
              <div class="taskActionsRight">
                <button v-if="task.status === 'downloading'" class="secondary" title="暂停下载" @click="library.pauseDownloadTask(task.id)">
                  <Pause :size="16" />
                </button>
                <button
                  v-else-if="['paused', 'failed', 'queued'].includes(task.status)"
                  class="secondary"
                  title="继续下载"
                  :disabled="!task.url"
                  @click="library.resumeDownloadTask(task.id)"
                >
                  <RotateCcw :size="16" />
                </button>
                <button class="secondary" title="打开文件位置" :disabled="!task.outputPath" @click="library.openDownloadFolder(task)">
                  <FolderOpen :size="16" />
                </button>
                <button class="secondary" title="执行文件" :disabled="!task.outputPath && !task.url" @click="library.openDownloadFile(task)">
                  <Play :size="16" />
                </button>
                <button class="iconButton danger" title="移除任务" @click="library.removeDownloadTask(task.id)">
                  <X :size="16" />
                </button>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'logs'" class="page steamDownloadsPage">
        <div class="steamDownloadsWrapper">
          <div class="steamDownloadsHeader">
            <h2>运行日志</h2>
            
            <div class="steamCustomDownloadRow">
              <button class="secondary" :disabled="library.logs.length === 0" @click="library.clearLogs">
                <Trash2 :size="14" /> 清空日志
              </button>
            </div>
          </div>

          <div class="steamDownloadsList">
            <div v-if="library.logs.length === 0" class="empty">
              还没有日志。
            </div>
            <article v-for="entry in [...library.logs].reverse()" :key="entry.id" class="steamDownloadTask">
              <div class="taskIconWrapper" :style="{ color: entry.level === 'error' ? '#ff5e5e' : '#2bcb40' }">
                <Info :size="24" v-if="entry.level === 'info'" />
                <XCircle :size="24" v-else />
              </div>
              <div class="taskMain">
                <div class="taskTitleRow">
                  <h3 :style="{ color: entry.level === 'error' ? '#ff5e5e' : '#fff' }">{{ entry.message }}</h3>
                </div>
                <div class="taskMetaRow" style="margin-bottom: 0;">
                  <span class="metaItem">{{ logTime(entry.createdAt) }}</span>
                  <span class="metaItem">[{{ entry.source }}]</span>
                </div>
                <pre v-if="entry.detail" class="logDetailBox">{{ entry.detail }}</pre>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'backup'" class="page" style="padding: 0; height: 100%;">
        <div class="workspaceGrid">
          <section class="panel gamePanel">
            <div class="panelHeader">
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <div>
                  <h2>游戏库</h2>
                  <span>支持 {{ library.games.length }} 个</span>
                </div>
                <button class="steamAddGameBtn" @click="showPresetPicker = true" title="添加游戏">
                  <Plus :size="16" />
                </button>
              </div>
            </div>
            <div v-if="library.games.length === 0" class="empty">
              还没有添加游戏。
            </div>
            <button
              v-for="game in library.games"
              :key="game.id"
              class="gameItem"
              :class="{ active: library.activeGameId === game.id }"
              @click="chooseGame(game.id)"
            >
              <img v-if="gameCoverUrls[game.id]" :src="gameCoverUrls[game.id]" alt="" />
              <Gamepad2 v-else :size="18" />
              <span>
                {{ game.name }}
                <small v-if="game.steamAppId">Steam {{ game.steamAppId }}</small>
              </span>
            </button>
          </section>

          <section class="panel managerPanel steamDownloadsPage">
            <div class="steamDownloadsWrapper">
          <div class="steamDownloadsHeader" style="display: flex; justify-content: space-between; align-items: center; padding: 24px 32px 16px; border-bottom: 1px solid #2a2d33;">
            <div class="headerLeft">
              <h2>整合包管理 <span>({{ library.backups.length }} 个)</span></h2>
              <span class="muted" style="font-size: 13px; margin-top: 6px; display: block;">可以导出当前游戏的 Mod 整合包，或从外部导入。</span>
            </div>
            
            <div class="steamCustomDownloadRow" style="display: flex; gap: 8px; align-items: center;">
              <input v-model="backupName" class="steamInput" placeholder="整合包名称(可选)" style="width: 180px; height: 32px; padding: 0 10px;" />
              <button class="primary" :disabled="!library.activeGame || library.busy" @click="library.exportActiveGamePack(backupName)" style="white-space: nowrap; height: 32px;">
                导出 .zip
              </button>
              <button class="secondary" :disabled="!library.settings.storagePath || library.busy" @click="library.restoreActiveGamePack" style="white-space: nowrap; height: 32px;">
                导入
              </button>
              <button class="secondary" :disabled="!library.settings.storagePath" @click="library.openBackupFolder()" style="white-space: nowrap; height: 32px; display: flex; align-items: center;">
                <FolderOpen :size="14" style="margin-right: 6px;" /> 打开目录
              </button>
            </div>
          </div>

          <div class="steamDownloadsList">
            <div v-if="library.backups.length === 0" class="empty">
              当前没有整合包记录。您可以在上方导出整合包，或从外部导入。
            </div>

            <article v-for="backup in library.backups" :key="backup.id" class="steamDownloadTask" style="flex-direction: column; gap: 12px;">
              <div style="display: flex; gap: 20px; width: 100%;">
                <div class="taskIconWrapper">
                  <Archive :size="28" />
                </div>
                <div class="taskMain">
                  <div class="taskTitleRow" style="margin-bottom: 8px;">
                    <input
                      class="backupNameInput steamInput"
                      :value="backup.name"
                      @change="library.renameBackup(backup.id, ($event.target as HTMLInputElement).value)"
                    />
                    <span class="taskStatusBadge ok">{{ backup.gameName }}</span>
                  </div>
                  <p class="taskFileName">{{ backup.outputPath }}</p>
                  <div class="taskMetaRow" style="margin-bottom: 0;">
                    <span class="metaItem">{{ formatBytes(backup.size) }}</span>
                    <span class="metaItem">{{ backup.filesCount }} 个文件</span>
                    <span class="metaItem">{{ formatDate(backup.createdAt) }}</span>
                  </div>
                </div>
                
                <div class="taskActionsRight">
                  <button class="secondary" title="打开文件夹" @click="library.openBackupFolder(backup)">
                    <FolderOpen :size="16" />
                  </button>
                  <button class="secondary" title="查看内容" @click="library.loadBackupContents(backup)">
                    <ListTree :size="16" />
                  </button>
                  <button class="primary" title="恢复备份" :disabled="library.busy" @click="confirmRestoreBackup(backup)">
                    <ArrowDownToLine :size="16" />
                  </button>
                  <button class="danger" title="删除备份" :disabled="library.busy" @click="confirmRemoveBackup(backup)">
                    <Trash2 :size="16" />
                  </button>
                </div>
              </div>
              
              <div v-if="library.backupContents[backup.id]?.length" class="backupContentsBox">
                <strong>备份内容:</strong>
                <ul class="backupFileList">
                  <li
                    v-for="entry in visibleBackupTreeEntries(backup.id)"
                    :key="`${entry.isDirectory ? 'dir' : 'file'}:${entry.path}`"
                    :style="{ paddingLeft: `${entry.depth * 16}px` }"
                  >
                    <span class="fileType">{{ entry.isDirectory ? "目录" : "文件" }}</span>
                    <span class="backupTreeName" :title="entry.path">{{ entry.name }}</span>
                    <span v-if="!entry.isDirectory" class="fileSize">({{ formatBytes(entry.size) }})</span>
                  </li>
                </ul>
                <p v-if="library.backupContents[backup.id].length > 200" class="muted">
                  仅显示前 200 项，共 {{ library.backupContents[backup.id].length }} 个文件。
                </p>
              </div>
            </article>
          </div>
        </div>
          </section>
        </div>
      </section>

      <section v-else-if="activeTab === 'settings'" class="page steamDownloadsPage">
        <div class="steamDownloadsWrapper">
          <div class="steamDownloadsHeader" style="justify-content: center;">
            <h2>系统设置</h2>
          </div>
          
          <div class="steamDownloadsList" style="align-items: center;">
            <div class="steamSettingsContainer">
              
              <div class="steamSettingsBlock">
                <h3>存储与数据</h3>
                
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>Mod 存储路径</label>
                    <span>导入的 Mod 会复制到此目录下的 mods/&lt;gameId&gt;/&lt;modId&gt;。</span>
                  </div>
                  <div class="settingControl pathPicker" style="min-width: 320px;">
                    <input :value="library.settings.storagePath" readonly placeholder="请选择一个目录" class="steamInput" />
                    <button class="secondary" @click="library.chooseStoragePath">选择</button>
                    <button class="secondary" :disabled="!library.settings.storagePath" title="打开" @click="openStoragePath">
                      <FolderOpen :size="17" />
                    </button>
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>数据导入 / 导出</label>
                    <span>备份或迁移您的所有应用配置数据。</span>
                  </div>
                  <div class="settingControl" style="display: flex; gap: 8px;">
                    <button class="secondary" @click="library.exportData">导出数据</button>
                    <button class="secondary" @click="library.importData">导入数据</button>
                  </div>
                </div>
              </div>

              <div class="steamSettingsBlock">
                <h3>应用偏好</h3>
                
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>主题</label>
                  </div>
                  <div class="settingControl">
                    <select class="steamSelectBox" :value="library.settings.theme" @change="library.updateSettings({ theme: ($event.target as HTMLSelectElement).value as 'dark' | 'light' })">
                      <option value="dark">深色 (默认)</option>
                      <option value="light">浅色</option>
                    </select>
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>默认启动页</label>
                  </div>
                  <div class="settingControl">
                    <select class="steamSelectBox" :value="library.settings.defaultTab" @change="library.updateSettings({ defaultTab: ($event.target as HTMLSelectElement).value as typeof library.settings.defaultTab })">
                      <option value="games">游戏</option>
                      <option value="manager">管理</option>
                      <option value="nexus">Nexus</option>
                      <option value="download">下载</option>
                      <option value="logs">日志</option>
                      <option value="backup">备份</option>
                      <option value="settings">设置</option>
                      <option value="about">关于</option>
                    </select>
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>开机自启</label>
                  </div>
                  <div class="settingControl">
                    <label class="steamToggle">
                      <input type="checkbox" :checked="library.settings.launchAtStartup" @change="library.updateSettings({ launchAtStartup: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>
              </div>
              
              <div class="steamSettingsBlock">
                <h3>高级选项</h3>
                
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>使用软链安装文件</label>
                    <span>把游戏目录目标文件创建为指向 Mod 的链接；权限不足请关闭。</span>
                  </div>
                  <div class="settingControl">
                    <label class="steamToggle">
                      <input type="checkbox" :checked="library.settings.useSymlinkInstall" @change="library.updateSettings({ useSymlinkInstall: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>优先通过目录选择游戏</label>
                  </div>
                  <div class="settingControl">
                    <label class="steamToggle">
                      <input type="checkbox" :checked="library.settings.preferDirectoryGamePicker" @change="library.updateSettings({ preferDirectoryGamePicker: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>
                
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>下载完成后自动导入</label>
                  </div>
                  <div class="settingControl">
                    <label class="steamToggle">
                      <input type="checkbox" :checked="library.settings.autoImportAfterDownload" @change="library.updateSettings({ autoImportAfterDownload: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>开发者工具 (DevTools)</label>
                    <span>用于调试网络请求和界面问题，适合进阶用户。</span>
                  </div>
                  <div class="settingControl">
                    <button class="secondary" @click="openDevTools()">
                      打开调试工具
                    </button>
                  </div>
                </div>


                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>联网请求使用代理</label>
                    <span>Nexus 浏览、API Key 校验、下载直链和普通下载都会使用此代理。</span>
                  </div>
                  <div class="settingControl">
                    <label class="steamToggle">
                      <input type="checkbox" :checked="library.settings.proxyEnabled" @change="library.updateSettings({ proxyEnabled: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>代理地址</label>
                    <span>例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7890。</span>
                  </div>
                  <div class="settingControl" style="min-width: 320px;">
                    <input
                      class="steamInput"
                      :value="library.settings.proxyUrl"
                      placeholder="127.0.0.1:7890"
                      @change="library.updateSettings({ proxyUrl: ($event.target as HTMLInputElement).value })"
                    />
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>Nexus 内容翻译</label>
                    <span>实验性免费源可能限流或失效；译文会缓存在本地，不覆盖原文。</span>
                  </div>
                  <div class="settingControl">
                    <select
                      class="steamSelectBox"
                      :value="library.settings.translationProvider"
                      @change="library.updateSettings({ translationProvider: ($event.target as HTMLSelectElement).value as typeof library.settings.translationProvider })"
                    >
                      <option value="off">关闭</option>
                      <option value="google-gtx">Google 免费接口</option>
                      <option value="baidu">百度翻译开放平台</option>
                      <option value="youdao">有道智云翻译</option>
                      <option value="tencent">腾讯云机器翻译</option>
                      <option value="volcengine">火山引擎机器翻译</option>
                    </select>
                  </div>
                </div>

                <template v-if="library.settings.translationProvider === 'baidu'">
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>百度翻译 AppID</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.baiduTranslateAppId" @change="library.updateSettings({ baiduTranslateAppId: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>百度翻译密钥</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" type="password" :value="library.settings.baiduTranslateSecret" @change="library.updateSettings({ baiduTranslateSecret: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                </template>

                <template v-if="library.settings.translationProvider === 'youdao'">
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>有道智云应用 ID</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.youdaoTranslateAppKey" @change="library.updateSettings({ youdaoTranslateAppKey: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>有道智云应用密钥</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" type="password" :value="library.settings.youdaoTranslateSecret" @change="library.updateSettings({ youdaoTranslateSecret: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                </template>

                <template v-if="library.settings.translationProvider === 'tencent'">
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>腾讯云 SecretId</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.tencentTranslateSecretId" @change="library.updateSettings({ tencentTranslateSecretId: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>腾讯云 SecretKey</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" type="password" :value="library.settings.tencentTranslateSecretKey" @change="library.updateSettings({ tencentTranslateSecretKey: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>腾讯云地域</label>
                      <span>默认 ap-guangzhou。</span>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.tencentTranslateRegion" @change="library.updateSettings({ tencentTranslateRegion: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                </template>

                <template v-if="library.settings.translationProvider === 'volcengine'">
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>火山引擎 AccessKey ID</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.volcengineTranslateAccessKeyId" @change="library.updateSettings({ volcengineTranslateAccessKeyId: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>火山引擎 Secret AccessKey</label>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" type="password" :value="library.settings.volcengineTranslateSecretAccessKey" @change="library.updateSettings({ volcengineTranslateSecretAccessKey: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                  <div class="steamSettingRow">
                    <div class="settingInfo">
                      <label>火山引擎地域</label>
                      <span>默认 cn-north-1。</span>
                    </div>
                    <div class="settingControl" style="min-width: 320px;">
                      <input class="steamInput" :value="library.settings.volcengineTranslateRegion" @change="library.updateSettings({ volcengineTranslateRegion: ($event.target as HTMLInputElement).value })" />
                    </div>
                  </div>
                </template>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>允许游戏运行时修改 Mod</label>
                  </div>
                  <div class="settingControl">
                    <label class="steamToggle">
                      <input type="checkbox" :checked="library.settings.allowGameRunningChanges" @change="library.updateSettings({ allowGameRunningChanges: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>
                
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>自动检查应用更新</label>
                  </div>
                  <div class="settingControl">
                    <label class="steamToggle">
                      <input type="checkbox" :checked="library.settings.autoCheckUpdates" @change="library.updateSettings({ autoCheckUpdates: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>显示调试信息 / 调试模式</label>
                  </div>
                  <div class="settingControl" style="display: flex; gap: 12px;">
                    <label class="steamToggle" title="调试模式">
                      <input type="checkbox" :checked="library.settings.debugMode" @change="library.updateSettings({ debugMode: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                    <label class="steamToggle" title="显示调试信息">
                      <input type="checkbox" :checked="library.settings.showDebugInfo" @change="library.updateSettings({ showDebugInfo: ($event.target as HTMLInputElement).checked })" />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>
              </div>
              
            </div>
          </div>
        </div>
      </section>

      <section v-else class="page steamDownloadsPage">
        <div class="steamDownloadsWrapper">
          <div class="steamDownloadsHeader" style="justify-content: center;">
            <h2>关于 Mayfly Mod Manager</h2>
          </div>
          <div class="steamDownloadsList" style="align-items: center;">
            <div class="steamSettingsContainer">
              <div class="steamSettingsBlock">
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>项目状态</label>
                    <span>目前已完成 Nexus-only 本地管理的构建。</span>
                  </div>
                </div>
                <div class="steamSettingRow">
                  <div class="settingInfo">
                    <label>开发范围</label>
                    <span>参考文档: docs/reference-feature-map.md。AI/MCP/Skills 和非 Nexus 线上源已取消开发。</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- 游戏右键菜单 -->
    <div
      v-if="contextMenu.visible"
      class="steamContextMenu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
    >
      <button @click.stop="openContextGameInfo">
        <Info :size="14" /> 游戏信息
      </button>
      <button @click.stop="openContextGameSettings">
        <Settings :size="14" /> 高级设置
      </button>
      <button @click.stop="launchContextGame">
        <Play :size="14" /> 启动游戏
      </button>
      <button @click.stop="openContextGameFolder">
        <FolderOpen :size="14" /> 打开目录
      </button>
      <button @click.stop="deleteContextGame">
        <Trash2 :size="14" style="color: #ff5e5e;" /> 删除游戏
      </button>
    </div>
  </div>
</template>
