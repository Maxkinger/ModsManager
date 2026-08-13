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
  X,
  XCircle,
  ChevronDown,
  ChevronUp,
  Plus
} from "lucide-vue-next";
import { useLibraryStore } from "@/stores/library";
import type { LocalMod } from "@/types/domain";

const library = useLibraryStore();
type AppTab = "manager" | "nexus" | "download" | "logs" | "backup" | "settings" | "about";

const activeTab = ref<AppTab>("manager");
const showAddGameModal = ref(false);
const contextMenu = ref({ visible: false, x: 0, y: 0, gameId: "" });

const showGameContextMenu = (e: MouseEvent, gameId: string) => {
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    gameId
  };
};

const deleteContextGame = async () => {
  if (window.confirm("确定要删除这个游戏吗？")) {
    await library.removeGame(contextMenu.value.gameId);
  }
};

onMounted(() => {
  window.addEventListener("click", () => {
    if (contextMenu.value.visible) {
      contextMenu.value.visible = false;
    }
  });
});
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
const showNexusAuthModal = ref(false);
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

async function nextNexusPage(step: number, append = false) {
  const nextPage = Math.max(1, Math.min(library.nexusTotalPages || 1, library.nexusPage + step));
  if (nextPage === library.nexusPage && !append) return;
  await library.loadNexusMods(nextPage, append);
}

const handleMainScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  if (!target) return;
  if (target.scrollTop + target.clientHeight >= target.scrollHeight - 200) {
    if (activeTab.value === 'nexus' && !library.selectedNexusMod && !library.nexusLoading && library.nexusPage < (library.nexusTotalPages || 1)) {
      nextNexusPage(1, true);
    }
  }
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
          备份
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
              <button class="primary" :disabled="library.busy" @click="library.importLocalMods">
                <PackagePlus :size="17" />
                导入 Mod
              </button>
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

      <section v-else-if="activeTab === 'nexus'" class="page" style="padding: 0; height: 100%;">
        <div class="workspaceGrid">
          
          <!-- Left Sidebar: Nexus Game List -->
          <section class="panel gamePanel">
            <div class="panelHeader">
              <h2>Nexus 游戏</h2>
              <span>支持 {{ library.nexusPresets.length }} 个</span>
            </div>
            <button
              v-for="preset in library.nexusPresets"
              :key="preset.id"
              class="gameItem"
              :class="{ active: library.nexusPresetId === preset.id }"
              @click="library.setNexusPreset(preset.id)"
            >
              <Gamepad2 :size="18" />
              <span>
                {{ preset.name }}
                <small v-if="preset.nexusDomain">{{ preset.nexusDomain }}</small>
                <small v-else>暂无 Nexus 配置</small>
              </span>
            </button>
          </section>

          <!-- Right Content: Manager Panel -->
          <section class="panel managerPanel">

            <!-- Mod Details View -->
            <div v-if="library.selectedNexusMod" class="nexusDetailView" style="display: flex; flex-direction: column; gap: 18px;">
              <div class="activeGameBar">
                <button class="secondary" @click="library.selectedNexusMod = null">
                  ← 返回列表
                </button>
                <span>{{ library.selectedNexusMod.title }}</span>
              </div>

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
            </div>

            <!-- Mod List View -->
            <div v-else class="nexusListView" style="display: flex; flex-direction: column; gap: 18px;">
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
              <div v-else class="steamCardsGrid">
                <article
                  v-for="item in library.nexusMods"
                  :key="item.id"
                  class="steamCard"
                  @click="library.openNexusModDetail(item)"
                >
                  <div class="cardCover">
                    <img v-if="item.cover" :src="item.cover" alt="" />
                    <div v-else class="noCover"><Archive :size="32" /></div>
                    <div class="cardHover">
                      <span>查看详情</span>
                    </div>
                  </div>
                  <div class="cardInfo">
                    <h3 :title="item.title">{{ item.title || `Mod ${item.id}` }}</h3>
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
                <HardDrive :size="28" v-if="task.source === 'custom'" class="taskIcon" />
                <Archive :size="28" v-else class="taskIcon" />
              </div>
              
              <div class="taskMain">
                <div class="taskTitleRow">
                  <h3 :title="task.modName || task.fileName">{{ task.modName || task.fileName }}</h3>
                  <span class="taskStatusBadge" :class="{ ok: task.status === 'completed', error: task.status === 'failed', active: task.status === 'downloading' }">
                    {{ downloadStatusText(task.status) }}
                  </span>
                </div>
                
                <p class="taskFileName" :title="task.fileName">{{ task.fileName }}</p>
                <p v-if="task.error" class="taskError">{{ task.error }}</p>

                <div class="taskMetaRow">
                  <span class="metaItem"><Gamepad2 :size="12" /> {{ task.gameName || '未知游戏' }}</span>
                  <span class="metaItem"><ListTree :size="12" /> {{ task.source === 'nexus' ? 'NexusMods' : '自定义链接' }}</span>
                  
                  <span class="metaItem progressText" v-if="task.totalBytes > 0">
                    {{ formatBytes(task.receivedBytes) }} / {{ formatBytes(task.totalBytes) }}
                  </span>
                  <span class="metaItem progressText" v-else>
                    {{ formatBytes(task.receivedBytes) }} 已下载
                  </span>
                </div>
                
                <div class="taskProgressBar" v-if="task.status === 'downloading'">
                  <div class="progressFill" :style="{ width: task.totalBytes > 0 ? `${Math.min(100, Math.round((task.receivedBytes / task.totalBytes) * 100))}%` : '100%' }" :class="{ indeterminate: task.totalBytes === 0 }"></div>
                </div>
              </div>
              
              <div class="taskActionsRight">
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

      <section v-else-if="activeTab === 'backup'" class="page steamDownloadsPage">
        <div class="steamDownloadsWrapper">
          <div class="steamDownloadsHeader">
            <h2>游戏备份 <span>({{ library.backups.length }})</span></h2>
            
            <div class="steamCustomDownloadRow">
              <input v-model="backupName" placeholder="备份名称(可选)" />
              <button class="primary" :disabled="!library.activeGame || library.busy" @click="createBackup">
                创建当前游戏备份
              </button>
              <button class="secondary" :disabled="!library.settings.storagePath" @click="library.openBackupFolder()">
                <FolderOpen :size="14" /> 打开目录
              </button>
            </div>
          </div>

          <div class="steamDownloadsList">
            <div v-if="library.backups.length === 0" class="empty">
              还没有备份。先在管理页选择一个游戏，再创建备份。
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
                  <li v-for="entry in library.backupContents[backup.id].slice(0, 100)" :key="entry.path">
                    <span class="fileType">{{ entry.isDirectory ? "目录" : "文件" }}</span> {{ entry.path }} <span v-if="!entry.isDirectory" class="fileSize">({{ formatBytes(entry.size) }})</span>
                  </li>
                </ul>
                <p v-if="library.backupContents[backup.id].length > 100" class="muted">
                  仅显示前 100 项，共 {{ library.backupContents[backup.id].length }} 项。
                </p>
              </div>
            </article>
          </div>
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
      <button @click.stop="deleteContextGame">
        <Trash2 :size="14" style="color: #ff5e5e;" /> 删除游戏
      </button>
    </div>
  </div>
</template>
