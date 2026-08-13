<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  Archive,
  ArrowDownToLine,
  CheckCircle2,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Info,
  LoaderCircle,
  ListTree,
  ScrollText,
  PackagePlus,
  Play,
  Search,
  Settings,
  SquarePen,
  Trash2,
  XCircle
} from "lucide-vue-next";
import { useLibraryStore } from "@/stores/library";
import type { LocalMod } from "@/types/domain";

const library = useLibraryStore();
type AppTab = "games" | "manager" | "nexus" | "download" | "logs" | "backup" | "settings" | "about";

const activeTab = ref<AppTab>("manager");
const editingInstallPath = ref("");
const showPresetPicker = ref(false);
const dragActive = ref(false);
const expandedModId = ref("");
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
const toastMessage = ref("");
const customDownloadUrl = ref("");
const customDownloadName = ref("");
const backupName = ref("");

const storageLabel = computed(
  () => library.settings.storagePath || "还没有选择 Mod 存储路径"
);

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

function downloadStatusText(status: string) {
  const map: Record<string, string> = {
    queued: "排队中",
    downloading: "下载中",
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
  library.nexusPage = 1;
  await library.loadNexusMods(1);
}

async function nextNexusPage(step: number) {
  const nextPage = Math.max(1, Math.min(library.nexusTotalPages || 1, library.nexusPage + step));
  await library.loadNexusMods(nextPage);
}

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
    <div v-if="toastMessage" class="toast">
      {{ toastMessage }}
    </div>
    <aside class="sidebar">
      <div class="brand">
        <div class="brandMark">M</div>
        <div>
          <strong>Mayfly</strong>
          <span>Mod Manager</span>
        </div>
      </div>

      <nav class="nav">
        <button :class="{ active: activeTab === 'games' }" @click="activeTab = 'games'">
          <Gamepad2 :size="18" />
          游戏
        </button>
        <button :class="{ active: activeTab === 'manager' }" @click="activeTab = 'manager'">
          <Archive :size="18" />
          管理
        </button>
        <button :class="{ active: activeTab === 'nexus' }" @click="activeTab = 'nexus'">
          <HardDrive :size="18" />
          Nexus
        </button>
        <button :class="{ active: activeTab === 'download' }" @click="activeTab = 'download'">
          <ArrowDownToLine :size="18" />
          下载
        </button>
        <button :class="{ active: activeTab === 'logs' }" @click="activeTab = 'logs'">
          <ScrollText :size="18" />
          日志
        </button>
        <button :class="{ active: activeTab === 'backup' }" @click="activeTab = 'backup'">
          <Archive :size="18" />
          备份
        </button>
        <button :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
          <Settings :size="18" />
          设置
        </button>
        <button :class="{ active: activeTab === 'about' }" @click="activeTab = 'about'">
          <Info :size="18" />
          关于
        </button>
      </nav>

      <div class="sidebarFooter">
        <span>当前存储</span>
        <strong>{{ storageLabel }}</strong>
      </div>
    </aside>

    <main class="content">
      <section v-if="activeTab === 'games'" class="page">
        <header class="pageHeader">
          <div>
            <p class="eyebrow">Games</p>
            <h1>游戏库</h1>
            <p>先在这里添加和选择游戏，再到“管理”页导入、安装和卸载本地 Mod。</p>
          </div>
          <div class="headerActions">
            <button class="secondary" @click="library.addGame()">
              <Gamepad2 :size="17" />
              手动游戏
            </button>
            <button class="primary" @click="showPresetPicker = !showPresetPicker">
              <Gamepad2 :size="17" />
              支持游戏
            </button>
          </div>
        </header>

        <div v-if="library.error" class="alert">
          <XCircle :size="18" />
          {{ library.error }}
        </div>

        <section class="panel gameLibraryPanel">
          <div class="panelHeader">
            <h2>添加游戏</h2>
            <span>{{ library.games.length }} 个已添加 / 支持 {{ library.presetCount }} 个</span>
          </div>

          <div v-if="showPresetPicker" class="presetPicker wide">
            <div class="presetSearch">
              <Search :size="16" />
              <input v-model="library.presetSearch" placeholder="搜索支持游戏、Steam ID、Nexus domain 或 exe" />
            </div>
            <div class="presetGrid">
              <button
                v-for="preset in library.presetList"
                :key="preset.id"
                class="presetItem"
                @click="library.addGame(preset)"
              >
                <img v-if="preset.coverUrl" :src="preset.coverUrl" alt="" />
                <div>
                  <strong>{{ preset.name }}</strong>
                  <span>
                    {{ preset.steamAppId ? `Steam ${preset.steamAppId}` : "非 Steam/未知" }}
                    · {{ preset.nexusDomain ? `Nexus ${preset.nexusDomain}` : "无 Nexus 配置" }}
                    · {{ preset.adapterStatus === "implemented" ? "已适配" : "通用规则" }}
                  </span>
                </div>
              </button>
            </div>
            <button class="secondary fullWidth" @click="addCustomGame">
              不在列表里，填写自定义游戏
            </button>
          </div>

          <div v-if="showCustomGameForm" class="customGameForm wide">
            <input v-model="customGameName" placeholder="游戏名称" />
            <div class="pathPicker">
              <input v-model="customGamePath" placeholder="游戏目录" />
              <button class="secondary" @click="chooseCustomGamePath">目录</button>
            </div>
            <div class="pathPicker">
              <input v-model="customGameExeNames" placeholder="exe 名称，多个用逗号分隔" />
              <button class="secondary" @click="chooseCustomGameExe">exe</button>
            </div>
            <input v-model="customGameInstallPath" placeholder="默认安装相对路径，留空为根目录" />
            <input v-model="customGameLaunchArgs" placeholder="启动参数，留空不传" />
            <div class="pathPicker">
              <input v-model="customGameCoverUrl" placeholder="封面图片路径，可选" />
              <button class="secondary" @click="chooseCustomGameCover">封面</button>
            </div>
            <button class="primary fullWidth" @click="createCustomGameFromForm">保存自定义游戏</button>
          </div>

          <div v-if="library.games.length === 0" class="empty">
            还没有添加游戏。点击“支持游戏”选择预设，或点击“手动游戏”直接选择游戏目录。
          </div>

          <div class="gameLibraryList">
            <article
              v-for="game in library.games"
              :key="game.id"
              class="gameLibraryItem"
              :class="{ selected: game.id === library.activeGameId }"
              @click="chooseGame(game.id)"
            >
              <img v-if="gameCoverUrls[game.id]" :src="gameCoverUrls[game.id]" alt="" />
              <div v-else class="gameLibraryIcon">
                <Gamepad2 :size="22" />
              </div>
              <div>
                <input
                  class="gameNameInput"
                  :value="game.name"
                  @click.stop
                  @change="library.updateGame(game.id, { name: ($event.target as HTMLInputElement).value.trim() || game.name })"
                />
                <small>{{ game.path || "未设置目录" }}</small>
                <div class="gameMeta">
                  <span v-if="game.steamAppId">Steam {{ game.steamAppId }}</span>
                  <span>{{ game.adapterStatus === "implemented" ? "已接入安装规则" : "通用安装规则" }}</span>
                  <span>{{ game.nexusDomain ? `Nexus ${game.nexusDomain}` : "无 Nexus 配置" }}</span>
                </div>
              </div>
              <div class="compactActions">
                <button class="iconButton" :disabled="library.busy" title="启动游戏" @click.stop="chooseGame(game.id); library.launchActiveGame()">
                  <Play :size="17" />
                </button>
                <button class="iconButton" title="打开游戏目录" @click.stop="openGamePath(game.path)">
                  <FolderOpen :size="17" />
                </button>
                <button class="secondary" :disabled="library.busy" @click.stop="chooseGame(game.id); library.chooseActiveGameExecutable()">
                  选择 exe
                </button>
                <button class="secondary" :disabled="!game.steamAppId || library.busy" @click.stop="chooseGame(game.id); library.locateActiveGameFromSteam()">
                  Steam 定位
                </button>
                <button class="iconButton danger" title="移除游戏" @click.stop="chooseGame(game.id); confirmRemoveActiveGame()">
                  <Trash2 :size="17" />
                </button>
              </div>
            </article>
          </div>
        </section>
      </section>

      <section v-else-if="activeTab === 'manager'" class="page">
        <header class="pageHeader">
          <div>
            <p class="eyebrow">Local Library</p>
            <h1>本地 Mod 管理</h1>
            <p>先跑通本地加载、导入、安装和卸载，其他平台能力后面再接。</p>
          </div>
          <div class="headerActions">
            <button class="secondary" @click="activeTab = 'games'">
              <Gamepad2 :size="17" />
              游戏库
            </button>
            <button class="primary" :disabled="library.busy" @click="library.importLocalMods">
              <PackagePlus :size="17" />
              导入 Mod
            </button>
          </div>
        </header>

        <div v-if="library.error" class="alert">
          <XCircle :size="18" />
          {{ library.error }}
        </div>

        <div class="workspaceGrid">
          <section class="panel gamePanel">
            <div class="panelHeader">
              <h2>游戏库</h2>
              <span>{{ library.games.length }} / 支持 {{ library.presetCount }} 个</span>
            </div>

            <div v-if="showPresetPicker" class="presetPicker">
              <div class="presetSearch">
                <Search :size="16" />
                <input v-model="library.presetSearch" placeholder="搜索支持游戏、Steam ID 或 exe" />
              </div>
              <div class="presetList">
                <button
                  v-for="preset in library.presetList"
                  :key="preset.id"
                  class="presetItem"
                  @click="library.addGame(preset)"
                >
                  <img v-if="preset.coverUrl" :src="preset.coverUrl" alt="" />
                  <div>
                    <strong>{{ preset.name }}</strong>
                    <span>
                      {{ preset.steamAppId ? `Steam ${preset.steamAppId}` : "非 Steam/未知" }}
                      · {{ preset.nexusDomain ? `Nexus ${preset.nexusDomain}` : "无 Nexus 配置" }}
                      · {{ preset.typeNames.length }} 类
                    </span>
                  </div>
                </button>
              </div>
              <button class="secondary fullWidth" @click="addCustomGame">
                不在列表里，手动添加
              </button>
            </div>

            <div v-if="showCustomGameForm" class="customGameForm">
              <input v-model="customGameName" placeholder="游戏名称" />
              <div class="pathPicker">
                <input v-model="customGamePath" placeholder="游戏目录" />
                <button class="secondary" @click="chooseCustomGamePath">目录</button>
              </div>
              <div class="pathPicker">
                <input v-model="customGameExeNames" placeholder="exe 名称，多个用逗号分隔" />
                <button class="secondary" @click="chooseCustomGameExe">exe</button>
              </div>
              <input v-model="customGameInstallPath" placeholder="默认安装相对路径，留空为根目录" />
              <input v-model="customGameLaunchArgs" placeholder="启动参数，留空不传" />
              <div class="pathPicker">
                <input v-model="customGameCoverUrl" placeholder="封面图片路径，可选" />
                <button class="secondary" @click="chooseCustomGameCover">封面</button>
              </div>
              <button class="primary fullWidth" @click="createCustomGameFromForm">保存自定义游戏</button>
            </div>

            <div v-if="library.games.length === 0" class="empty">
              还没有添加游戏。先点右上角“添加游戏”，选择游戏根目录。
            </div>

            <button
              v-for="game in library.games"
              :key="game.id"
              class="gameItem"
              :class="{ selected: game.id === library.activeGameId }"
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

          <section
            class="panel managerPanel"
            :class="{ dragging: dragActive }"
            @dragenter.prevent="dragActive = true"
            @dragover.prevent="dragActive = true"
            @dragleave.prevent="dragActive = false"
            @drop.prevent="dropLocalMods"
          >
            <div v-if="dragActive" class="dropOverlay">
              <PackagePlus :size="24" />
              松开导入到当前游戏
            </div>
            <div class="activeGameBar">
              <div>
                <span>当前游戏</span>
                <img
                  v-if="library.activeGame && gameCoverUrls[library.activeGame.id]"
                  class="activeGameCover"
                  :src="gameCoverUrls[library.activeGame.id]"
                  alt=""
                />
                <input
                  v-if="library.activeGame"
                  class="gameNameInput"
                  :value="library.activeGame.name"
                  @change="library.updateGame(library.activeGame.id, { name: ($event.target as HTMLInputElement).value.trim() || library.activeGame.name })"
                />
                <strong v-else>未选择</strong>
                <small>{{ library.activeGame?.path ?? "添加游戏后才能导入和安装 Mod" }}</small>
                <div v-if="library.activeGame" class="gameMeta">
                  <span v-if="library.activeGame.exeNames.length">
                    EXE: {{ library.activeGame.exeNames.join(", ") }}
                  </span>
                  <span>
                    适配: {{ library.activeGame.adapterStatus === "implemented" ? "已接入安装规则" : library.activeGame.adapterStatus === "custom" ? "自定义通用规则" : "已加入目录，当前使用通用安装" }}
                  </span>
                  <span>
                    Nexus: {{ library.activeGame.nexusDomain || "未配置" }}
                  </span>
                </div>
              </div>
              <div class="compactActions">
                <button class="iconButton" :disabled="!library.activeGame || library.busy" title="启动游戏" @click="library.launchActiveGame">
                  <Play :size="17" />
                </button>
                <button class="iconButton" :disabled="!library.activeGame" title="打开游戏目录" @click="openActiveGamePath">
                  <FolderOpen :size="17" />
                </button>
                <button class="iconButton" :disabled="!library.activeGame || library.busy" title="选择游戏目录" @click="library.chooseActiveGamePath">
                  <SquarePen :size="17" />
                </button>
                <button class="secondary" :disabled="!library.activeGame || library.busy" @click="library.chooseActiveGameExecutable">
                  选择 exe
                </button>
                <button class="secondary" :disabled="!library.activeGame?.steamAppId || library.busy" @click="library.locateActiveGameFromSteam">
                  Steam 定位
                </button>
                <button class="secondary" :disabled="!library.activeGame || library.busy" @click="chooseActiveGameCover">
                  封面
                </button>
                <button class="iconButton" :disabled="!library.activeGame || !library.settings.storagePath" title="打开当前游戏 Mod 目录" @click="library.openActiveGameModFolder">
                  <Archive :size="17" />
                </button>
                <button class="iconButton danger" :disabled="!library.activeGame" title="移除游戏" @click="confirmRemoveActiveGame">
                  <Trash2 :size="17" />
                </button>
              </div>
            </div>

            <div class="toolsRow">
              <label class="searchBox">
                <Search :size="17" />
                <input v-model="library.search" placeholder="搜索 Mod 名称、作者、标签或来源路径" />
              </label>
              <select v-model="library.selectedTypeId" class="typeFilter">
                <option value="all">全部类型</option>
                <option
                  v-for="type in library.activeAdapter?.modTypes ?? []"
                  :key="type.id"
                  :value="type.id"
                >
                  {{ type.name }}
                </option>
              </select>
              <select v-model="library.selectedTag" class="typeFilter">
                <option value="all">全部标签</option>
                <option v-for="tag in library.activeTags" :key="tag" :value="tag">
                  {{ tag }}
                </option>
              </select>
              <select v-model="library.sortMode" class="sortFilter">
                <option value="createdDesc">最近导入</option>
                <option value="createdAsc">最早导入</option>
                <option value="nameAsc">名称 A-Z</option>
                <option value="nameDesc">名称 Z-A</option>
                <option value="installedFirst">已安装优先</option>
              </select>
              <div class="stats">
                <span>{{ library.activeMods.length }} 个 Mod</span>
                <span>{{ library.installedCount }} 个已安装</span>
              </div>
            </div>

            <div class="batchBar">
              <span>已选择 {{ library.selectedMods.length }} 个</span>
              <button class="secondary" :disabled="library.activeMods.length === 0" @click="library.selectAllVisibleMods">
                全选当前列表
              </button>
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

            <div class="installPathRow">
              <label>安装到游戏目录下的相对路径</label>
              <input
                v-model="editingInstallPath"
                :disabled="!library.activeGame"
                placeholder="留空表示直接安装到游戏根目录，例如 Mods 或 BepInEx/plugins"
                @blur="saveInstallPath"
                @keyup.enter="saveInstallPath"
              />
            </div>

            <div class="installPathRow">
              <label>启动参数</label>
              <input
                :value="library.activeGame?.launchArgs ?? ''"
                :disabled="!library.activeGame"
                placeholder="例如 -windowed 或 --skip-launcher"
                @change="library.activeGame && library.updateGame(library.activeGame.id, { launchArgs: ($event.target as HTMLInputElement).value })"
              />
            </div>

            <div v-if="library.activeGame?.typeNames.length" class="typeStrip">
              <span v-for="type in library.activeAdapter?.modTypes ?? []" :key="type.id">
                {{ type }}
              </span>
            </div>

            <div v-if="library.busy" class="loadingLine">
              <LoaderCircle :size="18" class="spin" />
              正在处理本地文件...
            </div>

            <div v-if="library.activeMods.length === 0" class="empty modEmpty">
              当前游戏还没有本地 Mod。点击“导入 Mod”选择文件夹或文件，系统会复制到你的 Mod 存储目录并生成记录。
            </div>

            <article v-for="mod in library.activeMods" :key="mod.id" class="modRow">
              <label class="rowCheck">
                <input
                  type="checkbox"
                  :checked="library.selectedModIds.includes(mod.id)"
                  @change="library.toggleModSelection(mod.id, ($event.target as HTMLInputElement).checked)"
                />
              </label>
              <div class="statusIcon" :class="{ installed: mod.installed }">
                <img v-if="coverUrls[mod.id]" :src="coverUrls[mod.id]" alt="" />
                <CheckCircle2 v-else-if="mod.installed" :size="18" />
                <Archive v-else :size="18" />
              </div>
              <div class="modBody">
                <div class="modTitle">
                  <input
                    :value="mod.name"
                    @change="library.updateMod(mod.id, { name: ($event.target as HTMLInputElement).value, updatedAt: Date.now() })"
                  />
                  <span :class="['badge', mod.installed ? 'ok' : 'muted']">
                    {{ mod.installed ? "已安装" : "未安装" }}
                  </span>
                  <span v-if="mod.deployedFiles.length" class="badge muted">
                    {{ mod.deployedFiles.length }} 个部署文件
                  </span>
                  <span
                    v-for="tag in mod.tags"
                    :key="tag"
                    class="tagBadge"
                    :style="{ borderColor: tagColor(tag), color: tagColor(tag) }"
                  >
                    {{ tag }}
                  </span>
                </div>
                <p>{{ formatFiles(mod) }}</p>
                <small>{{ mod.rootPath }}</small>
                <div class="modMetaRow">
                  <label>
                    类型
                    <select
                      :value="mod.modTypeId"
                      @change="changeModType(mod, ($event.target as HTMLSelectElement).value)"
                    >
                      <option
                        v-for="type in library.activeAdapter?.modTypes ?? []"
                        :key="type.id"
                        :value="type.id"
                      >
                        {{ type.name }}
                      </option>
                    </select>
                  </label>
                  <label>
                    版本
                    <input
                      :value="mod.version"
                      placeholder="版本"
                      @change="library.updateMod(mod.id, { version: ($event.target as HTMLInputElement).value, updatedAt: Date.now() })"
                    />
                  </label>
                  <label>
                    作者
                    <input
                      :value="mod.author"
                      placeholder="作者"
                      @change="library.updateMod(mod.id, { author: ($event.target as HTMLInputElement).value, updatedAt: Date.now() })"
                    />
                  </label>
                </div>
                <div class="modMetaRow">
                  <label>
                    标签
                    <input
                      :value="mod.tags.join(', ')"
                      placeholder="用空格或逗号分隔"
                      @change="library.updateMod(mod.id, { tags: splitTags(($event.target as HTMLInputElement).value), updatedAt: Date.now() })"
                    />
                  </label>
                  <label v-if="mod.tags.length">
                    标签色
                    <select
                      :value="tagColor(mod.tags[0])"
                      @change="library.setTagColor(mod.tags[0], ($event.target as HTMLSelectElement).value)"
                    >
                      <option
                        v-for="color in library.tagPalette"
                        :key="color"
                        :value="color"
                      >
                        {{ color }}
                      </option>
                    </select>
                  </label>
                  <label>
                    前置
                    <input
                      :value="mod.requirements.join(', ')"
                      placeholder="BepInEx, SKSE..."
                      @change="library.updateMod(mod.id, { requirements: splitTags(($event.target as HTMLInputElement).value), updatedAt: Date.now() })"
                    />
                  </label>
                  <label>
                    网址
                    <input
                      :value="mod.website"
                      placeholder="来源网址"
                      @change="library.updateMod(mod.id, { website: ($event.target as HTMLInputElement).value, updatedAt: Date.now() })"
                    />
                  </label>
                </div>
                <label class="modDescription">
                  描述
                  <textarea
                    :value="mod.description"
                    placeholder="记录安装说明、前置依赖或来源备注"
                    @change="library.updateMod(mod.id, { description: ($event.target as HTMLTextAreaElement).value, updatedAt: Date.now() })"
                  />
                </label>
              </div>
              <div class="modActions">
                <button v-if="!mod.installed" class="primary" :disabled="library.busy" @click="library.installMod(mod)">
                  <Play :size="16" />
                  安装
                </button>
                <button v-else class="secondary" :disabled="library.busy" @click="confirmUninstallMod(mod)">
                  卸载
                </button>
                <button
                  v-if="mod.installed"
                  class="iconButton"
                  :disabled="library.busy"
                  title="查看部署文件"
                  @click="toggleModDetails(mod.id)"
                >
                  <ListTree :size="16" />
                </button>
                <button
                  v-else
                  class="iconButton"
                  :disabled="library.busy"
                  title="预览安装计划"
                  @click="previewModInstallPlan(mod)"
                >
                  <ListTree :size="16" />
                </button>
                <button class="iconButton" :disabled="library.busy" title="打开 Mod 缓存目录" @click="openModCache(mod)">
                  <FolderOpen :size="16" />
                </button>
                <button class="iconButton danger" :disabled="library.busy" title="删除本地 Mod" @click="confirmRemoveMod(mod)">
                  <Trash2 :size="16" />
                </button>
              </div>
              <div v-if="expandedModId === mod.id" class="modDetails">
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
            </article>
          </section>
        </div>
      </section>

      <section v-else-if="activeTab === 'nexus'" class="page">
        <header class="pageHeader">
          <div>
            <p class="eyebrow">NexusMods</p>
            <h1>Nexus Mods</h1>
            <p>按当前游戏的 Nexus domain 浏览、查看详情、选择文件下载。</p>
          </div>
          <div class="headerActions">
            <button class="secondary" :disabled="!library.nexusPreset?.nexusDomain || library.nexusLoading" @click="library.loadNexusMods(1)">
              <Search :size="17" />
              拉取列表
            </button>
          </div>
        </header>

        <div v-if="library.error" class="alert">
          <XCircle :size="18" />
          {{ library.error }}
        </div>

        <section class="panel nexusAuthPanel">
          <div>
            <label>NexusMods API Key</label>
            <div class="pathPicker">
              <input v-model="nexusApiKeyInput" type="password" placeholder="填写 NexusMods Personal API Key" />
              <button class="primary" :disabled="library.busy" @click="saveAndValidateNexusApiKey">保存并校验</button>
              <button class="secondary" :disabled="!library.settings.nexusApiKey" @click="library.clearNexusAuth">清除</button>
            </div>
          </div>
          <div class="nexusUserBox">
            <strong>{{ library.settings.nexusUser?.name || "未校验 API Key" }}</strong>
            <span v-if="library.settings.nexusUser">
              {{ library.settings.nexusUser.isPremium ? "Premium" : "Free" }}
              · {{ library.settings.nexusUser.email || "无邮箱信息" }}
            </span>
            <span v-else>填写 API Key 后点击“保存并校验”，校验成功才能浏览和下载。</span>
          </div>
          <div class="nexusUserBox">
            <strong>{{ library.nexusPreset?.name || "未选择游戏" }}</strong>
            <span>Nexus domain: {{ library.nexusPreset?.nexusDomain || "未配置" }}</span>
          </div>
        </section>

        <div class="nexusGrid">
          <section class="panel nexusListPanel">
            <div class="nexusGamePicker">
              <label for="nexus-game-select">选择游戏</label>
              <select
                id="nexus-game-select"
                :value="library.nexusPresetId"
                @change="library.setNexusPreset(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="preset in library.nexusPresets" :key="preset.id" :value="preset.id">
                  {{ preset.name }}{{ preset.nexusDomain ? ` · ${preset.nexusDomain}` : " · 暂无 Nexus 配置" }}
                </option>
              </select>
              <span>这里显示全部支持游戏；没有 Nexus domain 的游戏暂时不能拉取线上 Mod。</span>
            </div>
            <div class="toolsRow">
              <label class="searchBox">
                <Search :size="17" />
                <input v-model="library.nexusSearch" placeholder="搜索当前游戏的 Nexus Mod" @keyup.enter="searchNexusMods" />
              </label>
              <select v-model="library.nexusSort" class="sortFilter" @change="searchNexusMods">
                <option value="downloads">下载最多</option>
                <option value="updatedAt">最近更新</option>
                <option value="createdAt">最新发布</option>
                <option value="default">默认</option>
              </select>
              <button class="primary" :disabled="!library.nexusPreset?.nexusDomain || library.nexusLoading" @click="searchNexusMods">
                搜索
              </button>
            </div>
            <div class="nexusFilterRow">
              <select v-model="library.nexusCategory" @change="searchNexusMods">
                <option value="">全部分类</option>
                <option v-for="facet in library.nexusFacets.categoryName" :key="facet.value" :value="facet.value">
                  {{ facet.label }} ({{ facet.count }})
                </option>
              </select>
              <select v-model="library.nexusLanguage" @change="searchNexusMods">
                <option value="">全部语言</option>
                <option v-for="facet in library.nexusFacets.languageName" :key="facet.value" :value="facet.value">
                  {{ facet.label }} ({{ facet.count }})
                </option>
              </select>
              <select v-model="library.nexusTag" @change="searchNexusMods">
                <option value="">全部标签</option>
                <option v-for="facet in library.nexusFacets.tag" :key="facet.value" :value="facet.value">
                  {{ facet.label }} ({{ facet.count }})
                </option>
              </select>
            </div>

            <div class="panelHeader">
              <h2>Mod 列表</h2>
              <span>{{ library.nexusTotalCount }} 个结果</span>
            </div>

            <div v-if="library.nexusLoading" class="loadingLine">
              <LoaderCircle :size="18" class="spin" />
              正在拉取 NexusMods...
            </div>
            <div v-else-if="library.nexusMods.length === 0" class="empty">
              当前还没有列表数据。选择游戏后点击“拉取列表”。
            </div>

            <article
              v-for="item in library.nexusMods"
              :key="item.id"
              class="nexusModRow"
              :class="{ selected: library.selectedNexusMod?.id === item.id }"
            >
              <button class="nexusCover" @click="library.openNexusModDetail(item)">
                <img v-if="item.cover" :src="item.cover" alt="" />
                <Archive v-else :size="20" />
              </button>
              <div>
                <button class="linkButton" @click="library.openNexusModDetail(item)">
                  {{ item.title || `Mod ${item.id}` }}
                </button>
                <p>{{ item.summary || "无摘要" }}</p>
                <div class="gameMeta">
                  <span>{{ item.author || "未知作者" }}</span>
                  <span>{{ formatNumber(item.downloads) }} 次下载</span>
                  <span>{{ formatDate(item.updatedAt) }} 更新</span>
                  <span v-for="category in item.categories" :key="category">{{ category }}</span>
                </div>
              </div>
              <button class="secondary" @click="library.openNexusUrl(item.website)">网页</button>
            </article>

            <div class="paginationBar">
              <button class="secondary" :disabled="library.nexusPage <= 1 || library.nexusLoading" @click="nextNexusPage(-1)">上一页</button>
              <span>第 {{ library.nexusPage }} / {{ library.nexusTotalPages || 1 }} 页</span>
              <button class="secondary" :disabled="library.nexusPage >= (library.nexusTotalPages || 1) || library.nexusLoading" @click="nextNexusPage(1)">下一页</button>
            </div>
          </section>

          <section class="panel nexusDetailPanel">
            <div v-if="library.nexusDetailLoading" class="loadingLine">
              <LoaderCircle :size="18" class="spin" />
              正在读取详情和文件...
            </div>
            <div v-else-if="!library.selectedNexusMod" class="empty">
              从左侧选择一个 Mod 后，这里会显示简介和可下载文件。
            </div>
            <template v-else>
              <div class="detailHero">
                <img v-if="library.selectedNexusMod.cover" :src="library.selectedNexusMod.cover" alt="" />
                <div>
                  <h2>{{ library.selectedNexusMod.title }}</h2>
                  <p>{{ library.selectedNexusMod.summary || "无摘要" }}</p>
                  <div class="gameMeta">
                    <span>{{ library.selectedNexusMod.author || "未知作者" }}</span>
                    <span>{{ library.selectedNexusMod.version || "无版本" }}</span>
                    <span>{{ formatDate(library.selectedNexusMod.updatedAt) }} 更新</span>
                  </div>
                </div>
              </div>

              <div class="detailActions">
                <button class="secondary" @click="library.openNexusUrl(library.selectedNexusMod.website)">打开 Nexus 页面</button>
              </div>

              <h3>文件</h3>
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
            </template>
          </section>
        </div>
      </section>

      <section v-else-if="activeTab === 'download'" class="page">
        <header class="pageHeader">
          <div>
            <p class="eyebrow">Downloads</p>
            <h1>下载队列</h1>
            <p>NexusMods 下载任务会保存到这里，完成后可自动导入到本地 Mod 库。</p>
          </div>
        </header>

        <section class="panel downloadPanel">
          <div class="panelHeader">
            <h2>当前游戏下载</h2>
            <span>{{ library.activeDownloads.length }} 个任务</span>
          </div>

          <div class="customDownloadBox">
            <input v-model="customDownloadUrl" placeholder="自定义下载地址，http 或 https" />
            <input v-model="customDownloadName" placeholder="文件名，可选" />
            <button class="primary" :disabled="!customDownloadUrl.trim() || library.busy" @click="startCustomDownload">
              <ArrowDownToLine :size="16" />
              下载
            </button>
          </div>

          <div v-if="library.activeDownloads.length === 0" class="empty">
            还没有下载任务。到 Nexus 页选择文件后会出现在这里。
          </div>

          <article v-for="task in library.activeDownloads" :key="task.id" class="downloadRow">
            <div>
              <div class="modTitle">
                <strong>{{ task.modName }}</strong>
                <span :class="['badge', task.status === 'completed' ? 'ok' : task.status === 'failed' ? 'dangerBadge' : 'muted']">
                  {{ downloadStatusText(task.status) }}
                </span>
              </div>
              <p>{{ task.fileName }}</p>
              <small>{{ task.outputPath }}</small>
              <div class="gameMeta">
                <span>{{ task.source }}</span>
                <span>{{ task.gameName }}</span>
                <span>{{ formatBytes(task.receivedBytes) }} / {{ formatBytes(task.totalBytes) }}</span>
                <span>{{ formatDate(task.updatedAt) }}</span>
              </div>
              <p v-if="task.error" class="conflictText">{{ task.error }}</p>
            </div>
            <div class="compactActions">
              <button class="secondary" :disabled="!task.outputPath" @click="library.openDownloadFolder(task)">
                <FolderOpen :size="16" />
                文件夹
              </button>
              <button class="secondary" :disabled="!task.outputPath && !task.url" @click="library.openDownloadFile(task)">
                打开
              </button>
              <button class="iconButton danger" title="删除任务记录" @click="library.removeDownloadTask(task.id)">
                <Trash2 :size="16" />
              </button>
            </div>
          </article>
        </section>
      </section>

      <section v-else-if="activeTab === 'logs'" class="page">
        <header class="pageHeader">
          <div>
            <p class="eyebrow">Logs</p>
            <h1>日志</h1>
            <p>这里记录运行错误、Nexus 请求错误和本地操作错误，方便继续调试。</p>
          </div>
          <div class="headerActions">
            <button class="secondary" :disabled="library.logs.length === 0" @click="library.clearLogs">
              清空日志
            </button>
          </div>
        </header>

        <section class="panel logPanel">
          <div v-if="library.logs.length === 0" class="empty">
            还没有日志。
          </div>
          <article v-for="entry in [...library.logs].reverse()" :key="entry.id" class="logRow">
            <div>
              <span :class="['badge', entry.level === 'error' ? 'dangerBadge' : 'ok']">
                {{ entry.level === "error" ? "错误" : "信息" }}
              </span>
              <strong>{{ entry.message }}</strong>
            </div>
            <small>{{ logTime(entry.createdAt) }} · {{ entry.source }}</small>
            <pre v-if="entry.detail">{{ entry.detail }}</pre>
          </article>
        </section>
      </section>

      <section v-else-if="activeTab === 'backup'" class="page narrow">
        <header class="pageHeader">
          <div>
            <p class="eyebrow">Backup</p>
            <h1>备份</h1>
            <p>备份当前游戏目录为 zip，并可恢复到游戏目录。</p>
          </div>
          <div class="headerActions">
            <button class="secondary" :disabled="!library.settings.storagePath" @click="library.openBackupFolder()">
              <FolderOpen :size="17" />
              打开备份目录
            </button>
          </div>
        </header>

        <section class="panel backupPanel">
          <div class="customDownloadBox">
            <input v-model="backupName" placeholder="备份名称，可选" />
            <button class="primary" :disabled="!library.activeGame || library.busy" @click="createBackup">
              创建当前游戏备份
            </button>
          </div>

          <div v-if="library.backups.length === 0" class="empty">
            还没有备份。先选择一个游戏，再创建当前游戏备份。
          </div>

          <article v-for="backup in library.backups" :key="backup.id" class="downloadRow">
            <div>
              <div class="modTitle">
                <input
                  class="backupNameInput"
                  :value="backup.name"
                  @change="library.renameBackup(backup.id, ($event.target as HTMLInputElement).value)"
                />
                <span class="badge muted">{{ backup.gameName }}</span>
              </div>
              <p>{{ backup.outputPath }}</p>
              <div class="gameMeta">
                <span>{{ formatBytes(backup.size) }}</span>
                <span>{{ backup.filesCount }} 个文件</span>
                <span>{{ formatDate(backup.createdAt) }}</span>
              </div>
            </div>
            <div class="compactActions">
              <button class="secondary" @click="library.openBackupFolder(backup)">
                <FolderOpen :size="16" />
                文件夹
              </button>
              <button class="secondary" @click="library.loadBackupContents(backup)">
                内容
              </button>
              <button class="primary" :disabled="library.busy" @click="confirmRestoreBackup(backup)">
                恢复
              </button>
              <button class="iconButton danger" :disabled="library.busy" title="删除备份" @click="confirmRemoveBackup(backup)">
                <Trash2 :size="16" />
              </button>
            </div>
            <div v-if="library.backupContents[backup.id]?.length" class="modDetails">
              <strong>备份内容</strong>
              <ul>
                <li v-for="entry in library.backupContents[backup.id].slice(0, 120)" :key="entry.path">
                  {{ entry.isDirectory ? "[目录]" : "[文件]" }} {{ entry.path }} <span v-if="!entry.isDirectory">({{ formatBytes(entry.size) }})</span>
                </li>
              </ul>
              <p v-if="library.backupContents[backup.id].length > 120">
                仅显示前 120 项，共 {{ library.backupContents[backup.id].length }} 项。
              </p>
            </div>
          </article>
        </section>
      </section>

      <section v-else-if="activeTab === 'settings'" class="page narrow">
        <header class="pageHeader">
          <div>
            <p class="eyebrow">Settings</p>
            <h1>基础设置</h1>
            <p>现在只保留本地管理必需的设置。</p>
          </div>
        </header>

        <section class="panel settingsPanel">
          <label>Mod 存储路径</label>
          <div class="pathPicker">
            <input :value="library.settings.storagePath" readonly placeholder="请选择一个目录" />
            <button class="secondary" @click="library.chooseStoragePath">选择目录</button>
            <button class="iconButton" :disabled="!library.settings.storagePath" title="打开存储目录" @click="openStoragePath">
              <FolderOpen :size="17" />
            </button>
          </div>
          <p>
            导入的 Mod 会复制到这个目录下的 <code>mods/&lt;gameId&gt;/&lt;modId&gt;</code>。
          </p>
          <label>数据导入/导出</label>
          <div class="pathPicker">
            <button class="secondary" @click="library.exportData">导出数据</button>
            <button class="secondary" @click="library.importData">导入数据</button>
          </div>
          <label class="toggleRow">
            <input
              type="checkbox"
              :checked="library.settings.useSymlinkInstall"
              @change="library.updateSettings({ useSymlinkInstall: ($event.target as HTMLInputElement).checked })"
            />
            <span>使用软链安装文件</span>
          </label>
          <p>
            开启后，逐文件安装策略会把游戏目录中的目标文件创建为指向 Mod 缓存的链接；如果系统权限不足，请关闭该开关。
          </p>
          <label>主题</label>
          <select
            :value="library.settings.theme"
            @change="library.updateSettings({ theme: ($event.target as HTMLSelectElement).value as 'dark' | 'light' })"
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
          <label>默认启动页</label>
          <select
            :value="library.settings.defaultTab"
            @change="library.updateSettings({ defaultTab: ($event.target as HTMLSelectElement).value as typeof library.settings.defaultTab })"
          >
            <option value="games">游戏</option>
            <option value="manager">管理</option>
            <option value="nexus">Nexus</option>
            <option value="download">下载</option>
            <option value="logs">日志</option>
            <option value="backup">备份</option>
            <option value="settings">设置</option>
            <option value="about">关于</option>
          </select>
          <label class="toggleRow">
            <input
              type="checkbox"
              :checked="library.settings.autoImportAfterDownload"
              @change="library.updateSettings({ autoImportAfterDownload: ($event.target as HTMLInputElement).checked })"
            />
            <span>下载完成后自动导入</span>
          </label>
          <label class="toggleRow">
            <input
              type="checkbox"
              :checked="library.settings.preferDirectoryGamePicker"
              @change="library.updateSettings({ preferDirectoryGamePicker: ($event.target as HTMLInputElement).checked })"
            />
            <span>优先通过目录选择游戏</span>
          </label>
          <label class="toggleRow">
            <input
              type="checkbox"
              :checked="library.settings.launchAtStartup"
              @change="library.updateSettings({ launchAtStartup: ($event.target as HTMLInputElement).checked })"
            />
            <span>开机自启</span>
          </label>
          <label class="toggleRow">
            <input
              type="checkbox"
              :checked="library.settings.allowGameRunningChanges"
              @change="library.updateSettings({ allowGameRunningChanges: ($event.target as HTMLInputElement).checked })"
            />
            <span>允许游戏运行时修改 Mod</span>
          </label>
          <label class="toggleRow">
            <input
              type="checkbox"
              :checked="library.settings.debugMode"
              @change="library.updateSettings({ debugMode: ($event.target as HTMLInputElement).checked })"
            />
            <span>调试模式</span>
          </label>
          <label class="toggleRow">
            <input
              type="checkbox"
              :checked="library.settings.showDebugInfo"
              @change="library.updateSettings({ showDebugInfo: ($event.target as HTMLInputElement).checked })"
            />
            <span>显示调试信息</span>
          </label>
          <label class="toggleRow">
            <input
              type="checkbox"
              :checked="library.settings.autoCheckUpdates"
              @change="library.updateSettings({ autoCheckUpdates: ($event.target as HTMLInputElement).checked })"
            />
            <span>自动检查应用更新</span>
          </label>
        </section>
      </section>

      <section v-else class="page narrow">
        <header class="pageHeader">
          <div>
            <p class="eyebrow">About</p>
            <h1>关于</h1>
            <p>项目任务单在文档里，当前范围已经收紧为 Nexus-only。</p>
          </div>
        </header>
        <section class="panel settingsPanel">
          <code>docs/reference-feature-map.md</code>
          <p>AI/MCP/Skills 和非 Nexus 线上源都不做。</p>
        </section>
      </section>
    </main>
  </div>
</template>
