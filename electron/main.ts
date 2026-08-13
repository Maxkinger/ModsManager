import * as electron from "electron";
import AdmZip from "adm-zip";
import { spawn } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { path7za } from "7zip-bin";
import {
  cp,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  stat,
  writeFile
} from "node:fs/promises";

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const PASS_FILE_NAMES = new Set([
  "readme.md",
  "manifest.json",
  "icon.png",
  "changelog.md",
  "license"
]);
const COVER_FILE_NAMES = new Set([
  "icon.png",
  "cover.png",
  "cover.jpg",
  "cover.jpeg",
  "cover.webp",
  "preview.png",
  "preview.jpg",
  "preview.jpeg",
  "preview.webp",
  "thumbnail.png",
  "thumbnail.jpg",
  "thumbnail.webp"
]);
const STEAM_LIBRARY_KEY = "HKEY_CURRENT_USER\\Software\\Valve\\Steam";
const NEXUS_GRAPHQL_URL = "https://api-router.nexusmods.com/graphql";
const NEXUS_API_URL = "https://api.nexusmods.com";
const NXM_PROTOCOL = "nxm";
let mainWindow: electron.BrowserWindow | null = null;
const pendingNxmUrls: string[] = [];

function getResourcePath(fileName: string) {
  return isDev
    ? join(electron.app.getAppPath(), "resources", fileName)
    : join(process.resourcesPath, "resources", fileName);
}

function readWindowState() {
  const fallback = {
    width: 1320,
    height: 840
  };
  const filePath = join(electron.app.getPath("userData"), "window-state.json");

  try {
    const saved = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<Electron.Rectangle>;

    return {
      width: Math.max(1080, Number(saved.width) || fallback.width),
      height: Math.max(680, Number(saved.height) || fallback.height),
      x: typeof saved.x === "number" ? saved.x : undefined,
      y: typeof saved.y === "number" ? saved.y : undefined
    };
  } catch {
    return fallback;
  }
}

function saveWindowState(win: electron.BrowserWindow) {
  if (win.isDestroyed() || win.isMinimized()) return;

  const bounds = win.getBounds();
  const filePath = join(electron.app.getPath("userData"), "window-state.json");

  void mkdir(dirname(filePath), { recursive: true })
    .then(() => writeFile(filePath, JSON.stringify(bounds, null, 2), "utf-8"));
}

function createWindow() {
  const windowState = readWindowState();
  const win = new electron.BrowserWindow({
    ...windowState,
    minWidth: 1080,
    minHeight: 680,
    title: "Mayfly Mod Manager",
    icon: getResourcePath("icon.ico"),
    backgroundColor: "#0f1216",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow = win;
  win.webContents.on("did-finish-load", () => {
    while (pendingNxmUrls.length > 0) {
      win.webContents.send("nxm:open", pendingNxmUrls.shift());
    }
  });
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
  win.on("close", () => saveWindowState(win));
}

function findNxmUrl(argv: string[]) {
  return argv.find((arg) => /^nxm:\/\//i.test(arg)) ?? "";
}

function dispatchNxmUrl(url: string) {
  if (!url) return;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();

    if (!mainWindow.webContents.isLoadingMainFrame()) {
      mainWindow.webContents.send("nxm:open", url);
      return;
    }
  }

  pendingNxmUrls.push(url);
}

async function ensureJsonFile<T>(fileName: string, fallback: T) {
  const appData = join(electron.app.getPath("userData"), "data");
  const filePath = join(appData, fileName);
  await mkdir(appData, { recursive: true });

  if (!existsSync(filePath)) {
    await writeFile(filePath, JSON.stringify(fallback, null, 2), "utf-8");
  }

  return filePath;
}

async function listFiles(rootPath: string, currentPath = rootPath): Promise<string[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const nextPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        return listFiles(rootPath, nextPath);
      }

      return [relative(rootPath, nextPath).replace(/\\/g, "/")];
    })
  );

  return files.flat();
}

function isPathInside(rootPath: string, targetPath: string) {
  const root = resolve(rootPath);
  const target = resolve(targetPath);
  const rel = relative(root, target);

  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertPathInside(rootPath: string, targetPath: string, label = "目标路径") {
  if (!isPathInside(rootPath, targetPath)) {
    throw new Error(`${label} 超出允许目录：${targetPath}`);
  }
}

function safeJoin(rootPath: string, ...paths: string[]) {
  const target = join(rootPath, ...paths);
  assertPathInside(rootPath, target);
  return target;
}

function runProcess(command: string, args: string[]) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn(command, args, {
      windowsHide: true
    });
    const output: string[] = [];
    const errors: string[] = [];

    child.stdout.on("data", (chunk) => output.push(String(chunk)));
    child.stderr.on("data", (chunk) => errors.push(String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveOutput(output.join(""));
      } else {
        reject(new Error(errors.join("") || output.join("") || `进程退出码：${code}`));
      }
    });
  });
}

async function extractWith7za(sourcePath: string, targetPath: string) {
  const listing = await runProcess(path7za, ["l", "-slt", sourcePath]);
  const paths = listing
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("Path = "))
    .map((line) => line.slice("Path = ".length).trim())
    .filter((entryPath) => entryPath && entryPath !== sourcePath);

  for (const entryPath of paths) {
    safeJoin(targetPath, entryPath);
  }

  await runProcess(path7za, ["x", "-y", `-o${targetPath}`, sourcePath]);
}

function parseVdfStringValue(raw: string, key: string) {
  const match = raw.match(new RegExp(`"${key}"\\s+"([^"]+)"`, "i"));
  return match?.[1]?.replace(/\\\\/g, "\\") ?? "";
}

async function getSteamInstallPath() {
  if (process.platform !== "win32") return "";

  try {
    const output = await runProcess("reg", ["query", STEAM_LIBRARY_KEY, "/v", "SteamPath"]);
    const match = output.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    return match?.[1]?.trim().replace(/\//g, "\\") ?? "";
  } catch {
    return "";
  }
}

async function findSteamGamePath(steamAppId: number) {
  if (!steamAppId) return "";

  const steamPath = await getSteamInstallPath();
  if (!steamPath) return "";

  const libraryFile = join(steamPath, "steamapps", "libraryfolders.vdf");
  const libraryRoots = [steamPath];

  try {
    const raw = await readFile(libraryFile, "utf-8");
    const pathMatches = raw.matchAll(/"path"\s+"([^"]+)"/gi);

    for (const match of pathMatches) {
      const libraryPath = match[1]?.replace(/\\\\/g, "\\");
      if (libraryPath && !libraryRoots.includes(libraryPath)) {
        libraryRoots.push(libraryPath);
      }
    }
  } catch {
    // Steam 旧版或文件缺失时只使用 Steam 主目录。
  }

  for (const root of libraryRoots) {
    const manifestPath = join(root, "steamapps", `appmanifest_${steamAppId}.acf`);
    if (!existsSync(manifestPath)) continue;

    try {
      const raw = await readFile(manifestPath, "utf-8");
      const installDir = parseVdfStringValue(raw, "installdir");
      if (!installDir) continue;

      const gamePath = join(root, "steamapps", "common", installDir);
      if (existsSync(gamePath)) return gamePath;
    } catch {
      continue;
    }
  }

  return "";
}


function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function normalizeNexusText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nexusHeaders(apiKey = "", requireAuthorization = false) {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  const normalizedApiKey = apiKey.trim();

  if (normalizedApiKey) {
    headers.apikey = normalizedApiKey;
  } else if (requireAuthorization) {
    throw new Error("请先配置 NexusMods API Key。");
  }

  return headers;
}

function buildNexusWebsite(gameDomain: string, modId: string, fileId?: string) {
  const url = new URL(`https://www.nexusmods.com/${gameDomain}/mods/${modId}`);

  if (fileId) {
    url.searchParams.set("tab", "files");
    url.searchParams.set("file_id", fileId);
    url.searchParams.set("nmm", "1");
  }

  return url.toString();
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => ({})) as T & { message?: string, errors?: Array<{message?: string}> };

  if (!response.ok) {
    throw new Error(payload?.message || fallbackMessage);
  }

  if (payload?.errors && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message || fallbackMessage);
  }

  return payload as T;
}

function normalizeNexusFile(file: Record<string, unknown>, gameDomain: string, modId: string) {
  const fileId = String(file.file_id ?? "");
  const sizeKb = Number(file.size_kb ?? 0);
  const sizeBytes = Number(file.size_in_bytes ?? 0);

  return {
    id: fileId,
    name: normalizeNexusText(file.name) || normalizeNexusText(file.file_name) || `file-${fileId}`,
    version: normalizeNexusText(file.version) || normalizeNexusText(file.mod_version),
    size: sizeBytes || sizeKb * 1024 || 0,
    createdAt: normalizeNexusText(file.uploaded_time),
    categoryName: normalizeNexusText(file.category_name),
    downloadUrl: buildNexusWebsite(gameDomain, modId, fileId),
    detailsUrl: buildNexusWebsite(gameDomain, modId, fileId)
  };
}

function normalizeNexusFiles(files: Array<Record<string, unknown>>, gameDomain: string, modId: string) {
  const prioritized = files.filter((file) =>
    ["MAIN", "OPTIONAL"].includes(normalizeNexusText(file.category_name))
  );
  const list = prioritized.length > 0 ? prioritized : files;
  const weight = (categoryName: string) => {
    if (categoryName === "MAIN") return 0;
    if (categoryName === "OPTIONAL") return 1;
    return 2;
  };

  return list
    .sort((left, right) =>
      weight(normalizeNexusText(left.category_name)) - weight(normalizeNexusText(right.category_name)) ||
      Number(right.uploaded_timestamp ?? 0) - Number(left.uploaded_timestamp ?? 0)
    )
    .map((file) => normalizeNexusFile(file, gameDomain, modId));
}

function normalizeNexusDetail(mod: Record<string, unknown>, files: Array<Record<string, unknown>>, gameDomain: string) {
  const modId = String(mod.mod_id ?? "");
  const normalizedFiles = normalizeNexusFiles(files, gameDomain, modId);
  const user = mod.user && typeof mod.user === "object" ? mod.user as Record<string, unknown> : {};

  return {
    id: modId,
    title: normalizeNexusText(mod.name),
    summary: normalizeNexusText(mod.summary),
    author: normalizeNexusText(mod.author) || normalizeNexusText(mod.uploaded_by) || normalizeNexusText(user.name),
    version: normalizeNexusText(mod.version),
    website: buildNexusWebsite(gameDomain, modId),
    cover: normalizeNexusText(mod.picture_url),
    downloads: Math.max(0, Number(mod.mod_downloads ?? 0)),
    likes: Math.max(0, Number(mod.endorsement_count ?? 0)),
    categories: [],
    createdAt: normalizeNexusText(mod.created_time),
    updatedAt: normalizeNexusText(mod.updated_time),
    nsfw: Boolean(mod.contains_adult_content),
    filesCount: normalizedFiles.length,
    primaryFile: normalizedFiles[0] ?? null,
    description: normalizeNexusText(mod.description) || normalizeNexusText(mod.summary),
    descriptionFormat: normalizeNexusText(mod.description) ? "html" : "text",
    files: normalizedFiles
  };
}

function sanitizeFileName(name: string) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "-").trim() || "download.bin";
}

function normalizeNexusFacetOptions(source?: Record<string, number>) {
  return Object.entries(source ?? {})
    .map(([value, count]) => ({
      label: value,
      value,
      count: Math.max(0, Number(count) || 0)
    }))
    .filter((item) => item.value)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          return firstString(
            (item as Record<string, unknown>).name,
            (item as Record<string, unknown>).id,
            (item as Record<string, unknown>).modId
          );
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,，\n\r]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

async function readManifest(rootPath: string, files: string[]) {
  const manifestPath = files.find((file) => basename(file).toLowerCase() === "manifest.json");
  if (!manifestPath) {
    return {};
  }

  try {
    const raw = await readFile(join(rootPath, manifestPath), "utf-8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;

    return {
      name: firstString(manifest.name, manifest.title, manifest.modName, manifest.displayName),
      version: firstString(manifest.version, manifest.modVersion),
      author: firstString(manifest.author, manifest.authorName, manifest.creator, manifest.owner),
      website: firstString(manifest.website, manifest.homepage, manifest.url, manifest.nexusUrl),
      description: firstString(manifest.description, manifest.summary),
      tags: stringArray(manifest.tags),
      requirements: [
        ...stringArray(manifest.requirements),
        ...stringArray(manifest.dependencies),
        ...stringArray(manifest.deps)
      ]
    };
  } catch {
    return {};
  }
}

function findCoverImage(files: string[]) {
  return files.find((file) => COVER_FILE_NAMES.has(basename(file).toLowerCase())) ?? "";
}

async function findFileByName(rootPath: string, fileNames: string[], maxDepth = 5) {
  const targets = new Set(fileNames.map((fileName) => fileName.toLowerCase()));

  async function visit(currentPath: string, depth: number): Promise<string> {
    if (depth > maxDepth) return "";

    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = join(currentPath, entry.name);

      if (entry.isFile() && targets.has(entry.name.toLowerCase())) {
        return nextPath;
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const found = await visit(join(currentPath, entry.name), depth + 1);
      if (found) return found;
    }

    return "";
  }

  return visit(rootPath, 0);
}

async function isDirectoryEmpty(folderPath: string) {
  try {
    const entries = await readdir(folderPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}

async function deleteEmptyParents(gamePath: string, startFolder: string) {
  let current = startFolder;

  while (isPathInside(gamePath, current) && resolve(current) !== resolve(gamePath)) {
    if (!(await isDirectoryEmpty(current))) {
      return;
    }

    await rm(current, { force: true });
    current = dirname(current);
  }
}

async function deleteRelativeFiles(gamePath: string, files: string[]) {
  const uniqueFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))];

  for (const file of uniqueFiles) {
    const target = safeJoin(gamePath, file);
    await rm(target, { force: true });
    await deleteEmptyParents(gamePath, dirname(target));
  }
}

function isPassFile(filePath: string) {
  return PASS_FILE_NAMES.has(basename(filePath).toLowerCase());
}

function normalizePathParts(filePath: string) {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

function getExtension(filePath: string) {
  const name = basename(filePath).toLowerCase();
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1);
}

function getPathExtension(filePath: string) {
  const name = basename(filePath).toLowerCase();
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1);
}

function compareFileName(filePath: string, fileName: string) {
  return basename(filePath).toLowerCase() === fileName.toLowerCase();
}

async function readFileMap(dictionaryFile: string) {
  const dictionaryPath = isAbsolute(dictionaryFile)
    ? dictionaryFile
    : [
        join(electron.app.getAppPath(), dictionaryFile),
        join(__dirname, "..", "..", dictionaryFile)
      ].find((candidate) => existsSync(candidate)) ?? join(electron.app.getAppPath(), dictionaryFile);
  const raw = await readFile(dictionaryPath, "utf-8");
  const rows = raw
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter((line) => line && !line.startsWith("#"));
  const map = new Map<string, string>();

  for (const row of rows) {
    const normalized = row.replace(/^\/+/, "");
    const key = basename(normalized).toLowerCase();

    if (key && !map.has(key)) {
      map.set(key, normalized);
    }
  }

  return map;
}

function getFolderFromPath(filePath: string, folderName: string, include = false) {
  const parts = normalizePathParts(filePath);
  const index = parts.findIndex((part) => part.toLowerCase() === folderName.toLowerCase());

  if (index === -1) {
    return "";
  }

  return parts.slice(include ? index : index + 1).join("/");
}

function getUniqueParentFolders(modRoot: string, files: string[]) {
  return [
    ...new Set(
      files.map((file) => join(modRoot, dirname(file))).filter((folder) => folder !== modRoot)
    )
  ];
}

function uniqueRelativeTargets(gamePath: string, targets: string[]) {
  return [
    ...new Set(
      targets
        .map((target) => {
          assertPathInside(gamePath, target);
          return target;
        })
        .map((target) => relative(gamePath, target).replace(/\\/g, "/"))
        .filter(Boolean)
    )
  ];
}

async function planGeneralStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  keepPath?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");

  return uniqueRelativeTargets(
    options.gamePath,
    files
      .filter((file) => !isPassFile(file))
      .map((file) => options.keepPath ? join(targetRoot, file) : join(targetRoot, basename(file)))
  );
}

async function planFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
  include?: boolean;
  spare?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const folders = Array.isArray(options.folderName) ? options.folderName : [options.folderName];
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const targets: string[] = [];

  for (const file of files) {
    if (isPassFile(file)) continue;

    let relativeInstallPath = "";

    for (const folder of folders) {
      relativeInstallPath = getFolderFromPath(file, folder, options.include);
      if (relativeInstallPath) break;
    }

    if (!relativeInstallPath && options.spare) {
      relativeInstallPath = file;
    }

    if (relativeInstallPath) {
      targets.push(join(targetRoot, relativeInstallPath));
    }
  }

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function planFileStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const matched = files.filter((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );
  const folders = getUniqueParentFolders(options.modRoot, matched);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const targets: string[] = [];

  for (const folder of folders) {
    const target = join(targetRoot, basename(folder));
    targets.push(
      ...(await listFiles(folder))
        .filter((file) => !isPassFile(file))
        .map((file) => join(target, file))
    );
  }

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function planFileSiblingStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  pass?: string[];
}) {
  const files = await listFiles(options.modRoot);
  const matched = files.find((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );

  if (!matched) return [];

  const sourceFolder = join(options.modRoot, dirname(matched));
  const siblingFiles = await listFiles(sourceFolder);
  const pass = new Set((options.pass ?? []).map((item) => item.toLowerCase()));
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");

  return uniqueRelativeTargets(
    options.gamePath,
    siblingFiles
      .filter((file) => !pass.has(basename(file).toLowerCase()) && !isPassFile(file))
      .map((file) => join(targetRoot, file))
  );
}

async function planFolderParentStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string;
}) {
  const files = await listFiles(options.modRoot);
  const matched = files.find((file) =>
    normalizePathParts(file).some((part) => part.toLowerCase() === options.folderName.toLowerCase())
  );

  if (!matched) return [];

  const parts = normalizePathParts(matched);
  const index = parts.findIndex((part) => part.toLowerCase() === options.folderName.toLowerCase());
  const parent = parts.slice(0, Math.max(index, 0)).join("/");
  const sourceFolder = join(options.modRoot, parent);
  const target = safeJoin(options.gamePath, options.installPath || ".", basename(sourceFolder));

  return uniqueRelativeTargets(
    options.gamePath,
    (await listFiles(sourceFolder))
      .filter((file) => !isPassFile(file))
      .map((file) => join(target, file))
  );
}

async function planFileMapStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  dictionaryFile: string;
}) {
  const files = await listFiles(options.modRoot);
  const fileMap = await readFileMap(options.dictionaryFile);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");

  return uniqueRelativeTargets(
    options.gamePath,
    files
      .filter((file) => !isPassFile(file))
      .map((file) => {
        const mappedPath = fileMap.get(basename(file).toLowerCase());
        return mappedPath ? join(targetRoot, mappedPath) : "";
      })
      .filter(Boolean)
  );
}

async function planFileIntoParentFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  requireParent?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const matched = files.filter((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");

  return uniqueRelativeTargets(
    options.gamePath,
    matched
      .map((file) => {
        const parentName = basename(dirname(file));

        if (options.requireParent && (!parentName || parentName === ".")) {
          return "";
        }

        return join(targetRoot, parentName || "default", basename(file));
      })
      .filter(Boolean)
  );
}

async function copyOrRemoveFile(
  source: string,
  target: string,
  isInstall: boolean,
  gamePath: string,
  useSymlink = false
) {
  assertPathInside(gamePath, target);
  const deployedFile = relative(gamePath, target).replace(/\\/g, "/");

  if (isInstall) {
    if (existsSync(target)) {
      throw new Error(`目标文件已存在，已阻止覆盖：${deployedFile}`);
    }

    await mkdir(dirname(target), { recursive: true });
    if (useSymlink) {
      await symlink(source, target, "file");
    } else {
      await cp(source, target, { force: true, errorOnExist: false });
    }
    return [deployedFile];
  } else {
    await rm(target, { force: true });
    await deleteEmptyParents(gamePath, dirname(target));
    return [];
  }
}

async function applyGeneralStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  keepPath?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of files) {
    if (isPassFile(file)) continue;

    const source = join(options.modRoot, file);
    const target = options.keepPath
      ? join(targetRoot, file)
      : join(targetRoot, basename(file));
    deployedFiles.push(
      ...(await copyOrRemoveFile(source, target, options.isInstall, options.gamePath, options.useSymlink))
    );
  }

  return deployedFiles;
}

async function applyFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
  include?: boolean;
  spare?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const folders = Array.isArray(options.folderName) ? options.folderName : [options.folderName];
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of files) {
    if (isPassFile(file)) continue;

    let relativeInstallPath = "";

    for (const folder of folders) {
      relativeInstallPath = getFolderFromPath(file, folder, options.include);
      if (relativeInstallPath) break;
    }

    if (!relativeInstallPath && options.spare) {
      relativeInstallPath = file;
    }

    if (!relativeInstallPath) continue;

    deployedFiles.push(...(await copyOrRemoveFile(
      join(options.modRoot, file),
      join(targetRoot, relativeInstallPath),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    )));
  }

  return deployedFiles;
}

async function applyFileStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  commonParent?: boolean;
  isInstall: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const matched = files.filter((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );
  const folders = getUniqueParentFolders(options.modRoot, matched);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const folder of folders) {
    const target = join(targetRoot, basename(folder));

    if (options.isInstall) {
      if (existsSync(target)) {
        throw new Error(`目标目录已存在，已阻止覆盖：${relative(options.gamePath, target).replace(/\\/g, "/")}`);
      }

      await cp(folder, target, {
        recursive: true,
        force: true,
        errorOnExist: false
      });
      deployedFiles.push(
        ...(await listFiles(folder)).filter((file) => !isPassFile(file)).map((file) =>
          relative(options.gamePath, join(target, file)).replace(/\\/g, "/")
        )
      );
    } else {
      await rm(target, { recursive: true, force: true });
      await deleteEmptyParents(options.gamePath, dirname(target));
    }
  }

  return deployedFiles;
}

async function applyFileSiblingStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  pass?: string[];
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const matched = files.find((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );

  if (!matched) return [];

  const sourceFolder = join(options.modRoot, dirname(matched));
  const siblingFiles = await listFiles(sourceFolder);
  const pass = new Set((options.pass ?? []).map((item) => item.toLowerCase()));
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of siblingFiles) {
    if (pass.has(basename(file).toLowerCase()) || isPassFile(file)) continue;
    deployedFiles.push(...(await copyOrRemoveFile(
      join(sourceFolder, file),
      join(targetRoot, file),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    )));
  }

  return deployedFiles;
}

async function applyFolderParentStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string;
  isInstall: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const matched = files.find((file) =>
    normalizePathParts(file).some((part) => part.toLowerCase() === options.folderName.toLowerCase())
  );

  if (!matched) return [];

  const parts = normalizePathParts(matched);
  const index = parts.findIndex((part) => part.toLowerCase() === options.folderName.toLowerCase());
  const parent = parts.slice(0, Math.max(index, 0)).join("/");
  const sourceFolder = join(options.modRoot, parent);
  const target = safeJoin(options.gamePath, options.installPath || ".", basename(sourceFolder));

  if (options.isInstall) {
    if (existsSync(target)) {
      throw new Error(`目标目录已存在，已阻止覆盖：${relative(options.gamePath, target).replace(/\\/g, "/")}`);
    }

    await cp(sourceFolder, target, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
    return (await listFiles(sourceFolder)).filter((file) => !isPassFile(file)).map((file) =>
      relative(options.gamePath, join(target, file)).replace(/\\/g, "/")
    );
  } else {
    await rm(target, { recursive: true, force: true });
    await deleteEmptyParents(options.gamePath, dirname(target));
    return [];
  }
}

async function applyFileMapStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  dictionaryFile: string;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const fileMap = await readFileMap(options.dictionaryFile);
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of files) {
    if (isPassFile(file)) continue;

    const mappedPath = fileMap.get(basename(file).toLowerCase());
    if (!mappedPath) continue;

    deployedFiles.push(...(await copyOrRemoveFile(
      join(options.modRoot, file),
      join(targetRoot, mappedPath),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    )));
  }

  return deployedFiles;
}

async function applyFileIntoParentFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  requireParent?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const files = await listFiles(options.modRoot);
  const matched = files.filter((file) =>
    options.isExtname
      ? getExtension(file) === options.fileName.replace(/^\./, "").toLowerCase()
      : compareFileName(file, options.fileName)
  );
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const deployedFiles: string[] = [];

  for (const file of matched) {
    const parentName = basename(dirname(file));

    if (options.requireParent && (!parentName || parentName === ".")) {
      continue;
    }

    deployedFiles.push(...(await copyOrRemoveFile(
      join(options.modRoot, file),
      join(targetRoot, parentName || "default", basename(file)),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    )));
  }

  return deployedFiles;
}

electron.ipcMain.handle("dialog:openDirectory", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? "" : result.filePaths[0] ?? "";
});

electron.ipcMain.handle("dialog:openExecutable", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Windows executable", extensions: ["exe"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? "" : result.filePaths[0] ?? "";
});

electron.ipcMain.handle("dialog:openImage", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? "" : result.filePaths[0] ?? "";
});

electron.ipcMain.handle("dialog:openArchive", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Mod packages", extensions: ["zip", "rar", "7z", "gmm"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});

electron.ipcMain.handle("dialog:openModSource", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile", "openDirectory", "multiSelections"],
    filters: [
      { name: "Mod packages", extensions: ["zip", "rar", "7z", "gmm"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});

electron.ipcMain.handle("dialog:openJson", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? "" : result.filePaths[0] ?? "";
});

electron.ipcMain.handle("dialog:saveJson", async (_event, defaultPath: string) => {
  const result = await electron.dialog.showSaveDialog({
    defaultPath,
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? "" : result.filePath ?? "";
});

electron.ipcMain.handle("dialog:saveFile", async (_event, options: {
  defaultPath: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}) => {
  const result = await electron.dialog.showSaveDialog({
    defaultPath: options.defaultPath,
    filters: options.filters?.length
      ? options.filters
      : [{ name: "All files", extensions: ["*"] }]
  });

  return result.canceled ? "" : result.filePath ?? "";
});

electron.ipcMain.handle("shell:openPath", async (_event, targetPath: string) => {
  if (!targetPath) return false;
  const error = await electron.shell.openPath(targetPath);
  return !error;
});

electron.ipcMain.handle("shell:openExternal", async (_event, targetUrl: string) => {
  if (!targetUrl) return false;
  await electron.shell.openExternal(targetUrl);
  return true;
});

electron.ipcMain.handle("shell:fileUrl", async (_event, targetPath: string) => {
  if (!targetPath) return "";
  return pathToFileURL(resolve(targetPath)).toString();
});

electron.ipcMain.handle("app:launchExecutable", async (_event, options: {
  executablePath: string;
  cwd?: string;
  args?: string[];
}) => {
  if (!options.executablePath || !existsSync(options.executablePath)) {
    throw new Error("启动失败：游戏主程序不存在。");
  }

  const child = spawn(options.executablePath, options.args ?? [], {
    cwd: options.cwd || dirname(options.executablePath),
    detached: true,
    stdio: "ignore"
  });

  child.unref();
  return true;
});

electron.ipcMain.handle("app:setLaunchAtStartup", async (_event, enabled: boolean) => {
  electron.app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });
  return electron.app.getLoginItemSettings().openAtLogin;
});

electron.ipcMain.handle("store:read", async (_event, fileName: string, fallback: unknown) => {
  const filePath = await ensureJsonFile(fileName, fallback);
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as unknown;
});

electron.ipcMain.handle("store:write", async (_event, fileName: string, value: unknown) => {
  const filePath = await ensureJsonFile(fileName, value);
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
  return true;
});

electron.ipcMain.handle("fs:exists", async (_event, targetPath: string) => existsSync(targetPath));

electron.ipcMain.handle("fs:stat", async (_event, targetPath: string) => {
  const info = await stat(targetPath);
  return {
    isDirectory: info.isDirectory(),
    size: info.size,
    mtimeMs: info.mtimeMs
  };
});

electron.ipcMain.handle("fs:remove", async (_event, targetPath: string) => {
  await rm(targetPath, { recursive: true, force: true });
  return true;
});

electron.ipcMain.handle("fs:listFiles", async (_event, targetPath: string) => listFiles(targetPath));

electron.ipcMain.handle("fs:readJsonFile", async (_event, targetPath: string) => {
  const raw = await readFile(targetPath, "utf-8");
  return JSON.parse(raw) as unknown;
});

electron.ipcMain.handle("fs:writeJsonFile", async (_event, targetPath: string, value: unknown) => {
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(value, null, 2), "utf-8");
  return true;
});

electron.ipcMain.handle("fs:findFileByName", async (_event, options: {
  rootPath: string;
  fileNames: string[];
  maxDepth?: number;
}) => findFileByName(options.rootPath, options.fileNames, options.maxDepth ?? 5));

electron.ipcMain.handle("steam:findGamePath", async (_event, steamAppId: number) =>
  findSteamGamePath(steamAppId)
);

electron.ipcMain.handle("nexus:validateApiKey", async (_event, apiKey: string) => {
  const response = await fetch(`${NEXUS_API_URL}/v1/users/validate.json`, {
    method: "GET",
    headers: nexusHeaders(apiKey, true)
  });
  const payload = await readJsonResponse<Record<string, unknown>>(response, "校验 NexusMods API Key 失败。");

  return {
    key: normalizeNexusText(payload.key) || apiKey.trim(),
    name: normalizeNexusText(payload.name),
    email: normalizeNexusText(payload.email),
    profileUrl: normalizeNexusText(payload.profile_url),
    isPremium: Boolean(payload.is_premium),
    isSupporter: Boolean(payload.is_supporter)
  };
});

electron.ipcMain.handle("nexus:listMods", async (_event, options: {
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
}) => {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(40, Math.max(1, Number(options.pageSize) || 20));
  const gameDomain = options.gameDomain.trim();
  const searchText = options.searchText?.trim() ?? "";
  const sortKey = options.sort === "updatedAt"
    ? "updatedAt"
    : options.sort === "createdAt"
      ? "createdAt"
      : "downloads";
  const gql = `
    query ModsListing($count: Int = 0, $filter: ModsFilter, $offset: Int, $sort: [ModsSort!]) {
      mods(count: $count, filter: $filter, offset: $offset, sort: $sort, viewUserBlockedContent: false) {
        facetsData
        nodes {
          adultContent
          createdAt
          downloads
          endorsements
          game { domainName }
          modCategory { name }
          modId
          name
          summary
          thumbnailUrl
          updatedAt
          uploader { name }
        }
        totalCount
      }
    }
  `;
  const variables: Record<string, unknown> = {
    count: pageSize,
    offset: (page - 1) * pageSize,
    sort: [{ [sortKey]: { direction: "DESC" } }],
    filter: {
      gameDomainName: {
        op: "EQUALS",
        value: gameDomain
      },
      ...(searchText
        ? {
            name: {
              op: "WILDCARD",
              value: searchText.includes("*") ? searchText : `*${searchText}*`
            }
          }
        : {}),
      ...(options.facets?.categoryName
        ? {
            categoryName: [options.facets.categoryName]
          }
        : {}),
      ...(options.facets?.languageName
        ? {
            languageName: [options.facets.languageName]
          }
        : {}),
      ...(options.facets?.tag
        ? {
            tag: [options.facets.tag]
          }
        : {})
    }
  };
  const response = await fetch(NEXUS_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...nexusHeaders(options.apiKey)
    },
    body: JSON.stringify({ query: gql, variables })
  });
  const payload = await readJsonResponse<{
    data?: {
      mods?: {
        nodes?: Array<Record<string, unknown>>;
        totalCount?: number;
        facetsData?: {
          categoryName?: Record<string, number>;
          languageName?: Record<string, number>;
          tag?: Record<string, number>;
        };
      };
    };
  }>(response, "获取 NexusMods 列表失败。");
  const nodes = payload.data?.mods?.nodes ?? [];
  const totalCount = payload.data?.mods?.totalCount ?? 0;
  const facetsData = payload.data?.mods?.facetsData;

  return {
    items: nodes.map((node) => {
      const game = node.game && typeof node.game === "object" ? node.game as Record<string, unknown> : {};
      const uploader = node.uploader && typeof node.uploader === "object" ? node.uploader as Record<string, unknown> : {};
      const category = node.modCategory && typeof node.modCategory === "object" ? node.modCategory as Record<string, unknown> : {};
      const modId = String(node.modId ?? "").split("_")[0];
      const domain = normalizeNexusText(game.domainName) || gameDomain;

      return {
        id: modId,
        title: normalizeNexusText(node.name),
        summary: normalizeNexusText(node.summary),
        author: normalizeNexusText(uploader.name),
        version: "",
        website: buildNexusWebsite(domain, modId),
        cover: normalizeNexusText(node.thumbnailUrl),
        downloads: Math.max(0, Number(node.downloads ?? 0)),
        likes: Math.max(0, Number(node.endorsements ?? 0)),
        categories: [normalizeNexusText(category.name)].filter(Boolean),
        createdAt: normalizeNexusText(node.createdAt),
        updatedAt: normalizeNexusText(node.updatedAt),
        nsfw: Boolean(node.adultContent),
        filesCount: 0,
        primaryFile: null
      };
    }),
    page,
    pageSize,
    totalCount,
    totalPages: totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0,
    facets: {
      categoryName: normalizeNexusFacetOptions(facetsData?.categoryName),
      languageName: normalizeNexusFacetOptions(facetsData?.languageName),
      tag: normalizeNexusFacetOptions(facetsData?.tag)
    }
  };
});

electron.ipcMain.handle("nexus:getModDetail", async (_event, options: {
  apiKey: string;
  gameDomain: string;
  modId: string;
}) => {
  const gameDomain = options.gameDomain.trim();
  const modId = options.modId.trim();
  const detailResponse = await fetch(`${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}.json`, {
    method: "GET",
    headers: nexusHeaders(options.apiKey)
  });
  const detail = await readJsonResponse<Record<string, unknown>>(detailResponse, "获取 NexusMods Mod 详情失败。");
  const filesResponse = await fetch(`${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}/files.json`, {
    method: "GET",
    headers: nexusHeaders(options.apiKey)
  });
  const filesPayload = await readJsonResponse<{
    files?: Array<Record<string, unknown>>;
  }>(filesResponse, "获取 NexusMods 文件列表失败。");

  return normalizeNexusDetail(detail, filesPayload.files ?? [], gameDomain);
});

electron.ipcMain.handle("nexus:getDownloadUrl", async (_event, options: {
  apiKey: string;
  gameDomain: string;
  modId: string;
  fileId: string;
}) => {
  const gameDomain = options.gameDomain.trim();
  const modId = options.modId.trim();
  const fileId = options.fileId.trim();
  const response = await fetch(
    `${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}/files/${fileId}/download_link.json`,
    {
      method: "GET",
      headers: nexusHeaders(options.apiKey, true)
    }
  );
  const payload = await response.json().catch(() => ({})) as Array<{ URI?: string }> | { message?: string };

  if (!response.ok) {
    if (response.status === 403) {
      return buildNexusWebsite(gameDomain, modId, fileId);
    }

    throw new Error(!Array.isArray(payload) && payload.message ? payload.message : "获取 NexusMods 下载地址失败。");
  }

  return Array.isArray(payload) && payload[0]?.URI
    ? payload[0].URI
    : buildNexusWebsite(gameDomain, modId, fileId);
});

electron.ipcMain.handle("downloads:downloadFile", async (_event, options: {
  url: string;
  outputPath: string;
}) => {
  const response = await fetch(options.url, {
    headers: {
      "user-agent": "Mayfly Mod Manager"
    }
  });

  if (!response.ok || !response.body) {
    throw new Error(`下载失败：HTTP ${response.status}`);
  }

  await mkdir(dirname(options.outputPath), { recursive: true });
  const file = await open(options.outputPath, "w");
  let receivedBytes = 0;

  try {
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      await file.write(Buffer.from(value));
    }
  } finally {
    await file.close();
  }

  return {
    outputPath: options.outputPath,
    receivedBytes,
    totalBytes: Number(response.headers.get("content-length") ?? receivedBytes) || receivedBytes
  };
});

electron.ipcMain.handle("backups:createZip", async (_event, options: {
  sourcePath: string;
  outputPath: string;
}) => {
  const source = resolve(options.sourcePath);
  const output = resolve(options.outputPath);
  const sourceStat = await stat(source);

  if (!sourceStat.isDirectory()) {
    throw new Error("备份失败：来源必须是文件夹。");
  }

  await mkdir(dirname(output), { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFolder(source);
  zip.writeZip(output);
  const outputStat = await stat(output);

  return {
    outputPath: output,
    size: outputStat.size,
    filesCount: (await listFiles(source)).length
  };
});

electron.ipcMain.handle("backups:restoreZip", async (_event, options: {
  backupPath: string;
  targetPath: string;
}) => {
  const backup = resolve(options.backupPath);
  const target = resolve(options.targetPath);

  if (!existsSync(backup)) {
    throw new Error("恢复失败：备份文件不存在。");
  }

  await mkdir(target, { recursive: true });
  const zip = new AdmZip(backup);

  for (const entry of zip.getEntries()) {
    const entryTarget = safeJoin(target, entry.entryName);

    if (entry.isDirectory) {
      await mkdir(entryTarget, { recursive: true });
    } else {
      await mkdir(dirname(entryTarget), { recursive: true });
      await writeFile(entryTarget, entry.getData());
    }
  }

  return true;
});

electron.ipcMain.handle("backups:listZip", async (_event, backupPath: string) => {
  const backup = resolve(backupPath);

  if (!existsSync(backup)) {
    throw new Error("读取失败：备份文件不存在。");
  }

  const zip = new AdmZip(backup);

  return zip.getEntries().map((entry) => ({
    path: entry.entryName,
    isDirectory: entry.isDirectory,
    size: entry.header.size
  }));
});

electron.ipcMain.handle("gmm:exportMods", async (_event, options: {
  mods: Array<{
    rootPath: string;
    folderName: string;
  }>;
  manifest: Record<string, unknown>;
  outputPath: string;
}) => {
  const output = resolve(options.outputPath);
  await mkdir(dirname(output), { recursive: true });

  if (existsSync(output)) {
    throw new Error("导出失败：目标文件已存在，请换一个文件名。");
  }

  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(options.manifest, null, 2), "utf-8"));

  for (const mod of options.mods) {
    const rootPath = resolve(mod.rootPath);
    const folderName = sanitizeFileName(mod.folderName);

    if (!existsSync(rootPath)) continue;

    zip.addLocalFolder(rootPath, folderName);
  }

  zip.writeZip(output);
  const outputStat = await stat(output);

  return {
    outputPath: output,
    size: outputStat.size
  };
});

electron.ipcMain.handle("mods:importFolder", async (_event, options: {
  sourcePath: string;
  storagePath: string;
  gameId: string;
  modId: string;
}) => {
  const sourceStat = await stat(options.sourcePath);
  const modRoot = join(options.storagePath, "mods", options.gameId, options.modId);
  await mkdir(modRoot, { recursive: true });

  if (sourceStat.isDirectory()) {
    await cp(options.sourcePath, modRoot, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  } else if (["zip", "gmm"].includes(getPathExtension(options.sourcePath))) {
    const zip = new AdmZip(options.sourcePath);
    for (const entry of zip.getEntries()) {
      const entryTarget = safeJoin(modRoot, entry.entryName);

      if (entry.isDirectory) {
        await mkdir(entryTarget, { recursive: true });
      } else {
        await mkdir(dirname(entryTarget), { recursive: true });
        await writeFile(entryTarget, entry.getData());
      }
    }
  } else if (["7z", "rar"].includes(getPathExtension(options.sourcePath))) {
    await extractWith7za(options.sourcePath, modRoot);
  } else {
    await cp(options.sourcePath, join(modRoot, basename(options.sourcePath)), {
      force: true,
      errorOnExist: false
    });
  }

  const files = await listFiles(modRoot);

  return {
    rootPath: modRoot,
    files,
    manifest: await readManifest(modRoot, files),
    coverImage: findCoverImage(files)
  };
});

electron.ipcMain.handle("mods:install", async (_event, options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
}) => {
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  await mkdir(targetRoot, { recursive: true });
  await cp(options.modRoot, targetRoot, {
    recursive: true,
    force: true,
    errorOnExist: false
  });

  return true;
});

electron.ipcMain.handle("mods:uninstall", async (_event, options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
}) => {
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");
  const files = await listFiles(options.modRoot);

  await Promise.all(
    files.map((file) => rm(safeJoin(targetRoot, file), { force: true }))
  );

  return true;
});

electron.ipcMain.handle("mods:createInstallPlan", async (_event, options: {
  modRoot: string;
  gamePath: string;
  strategy: {
    kind: string;
    installPath?: string;
    keepPath?: boolean;
    folderName?: string | string[];
    include?: boolean;
    spare?: boolean;
    fileName?: string;
    isExtname?: boolean;
    commonParent?: boolean;
    pass?: string[];
    dictionaryFile?: string;
    requireParent?: boolean;
    reason?: string;
  };
}) => {
  const installPath = options.strategy.installPath ?? "";
  let targetFiles: string[] = [];

  switch (options.strategy.kind) {
    case "general":
      targetFiles = await planGeneralStrategy({
        modRoot: options.modRoot,
        gamePath: options.gamePath,
        installPath,
        keepPath: options.strategy.keepPath
      });
      break;
    case "folder":
      targetFiles = await planFolderStrategy({
        modRoot: options.modRoot,
        gamePath: options.gamePath,
        installPath,
        folderName: options.strategy.folderName ?? "",
        include: options.strategy.include,
        spare: options.strategy.spare
      });
      break;
    case "file":
      targetFiles = await planFileStrategy({
        modRoot: options.modRoot,
        gamePath: options.gamePath,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname
      });
      break;
    case "fileSibling":
      targetFiles = await planFileSiblingStrategy({
        modRoot: options.modRoot,
        gamePath: options.gamePath,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname,
        pass: options.strategy.pass
      });
      break;
    case "folderParent":
      if (Array.isArray(options.strategy.folderName)) {
        throw new Error("folderParent 策略只支持单个 folderName。");
      }
      targetFiles = await planFolderParentStrategy({
        modRoot: options.modRoot,
        gamePath: options.gamePath,
        installPath,
        folderName: options.strategy.folderName ?? ""
      });
      break;
    case "fileMap":
      targetFiles = await planFileMapStrategy({
        modRoot: options.modRoot,
        gamePath: options.gamePath,
        installPath,
        dictionaryFile: options.strategy.dictionaryFile ?? ""
      });
      break;
    case "fileIntoParentFolder":
      targetFiles = await planFileIntoParentFolderStrategy({
        modRoot: options.modRoot,
        gamePath: options.gamePath,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname,
        requireParent: options.strategy.requireParent
      });
      break;
    case "manual":
      throw new Error(options.strategy.reason || "该 Mod 类型需要手动安装。");
    default:
      throw new Error(`未知安装策略: ${options.strategy.kind}`);
  }

  return {
    targetFiles,
    conflicts: targetFiles.filter((file) => existsSync(safeJoin(options.gamePath, file)))
  };
});

electron.ipcMain.handle("mods:applyStrategy", async (_event, options: {
  modRoot: string;
  gamePath: string;
  strategy: {
    kind: string;
    installPath?: string;
    keepPath?: boolean;
    folderName?: string | string[];
    include?: boolean;
    spare?: boolean;
    fileName?: string;
    isExtname?: boolean;
    commonParent?: boolean;
    pass?: string[];
    dictionaryFile?: string;
    requireParent?: boolean;
    reason?: string;
  };
  isInstall: boolean;
  useSymlink?: boolean;
}) => {
  const installPath = options.strategy.installPath ?? "";
  let deployedFiles: string[] = [];

  try {
    switch (options.strategy.kind) {
      case "general":
        deployedFiles = await applyGeneralStrategy({
          modRoot: options.modRoot,
          gamePath: options.gamePath,
          installPath,
          keepPath: options.strategy.keepPath,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        return { deployedFiles };
      case "folder":
        deployedFiles = await applyFolderStrategy({
          modRoot: options.modRoot,
          gamePath: options.gamePath,
          installPath,
          folderName: Array.isArray(options.strategy.folderName)
            ? (options.strategy.folderName[0] ?? "")
            : (options.strategy.folderName ?? ""),
          include: options.strategy.include,
          spare: options.strategy.spare,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        return { deployedFiles };
      case "file":
        deployedFiles = await applyFileStrategy({
          modRoot: options.modRoot,
          gamePath: options.gamePath,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          commonParent: options.strategy.commonParent,
          isInstall: options.isInstall
        });
        return { deployedFiles };
      case "fileSibling":
        deployedFiles = await applyFileSiblingStrategy({
          modRoot: options.modRoot,
          gamePath: options.gamePath,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          pass: options.strategy.pass,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        return { deployedFiles };
      case "folderParent":
        if (Array.isArray(options.strategy.folderName)) {
          throw new Error("folderParent 策略只支持单个 folderName。");
        }
        deployedFiles = await applyFolderParentStrategy({
          modRoot: options.modRoot,
          gamePath: options.gamePath,
          installPath,
          folderName: options.strategy.folderName ?? "",
          isInstall: options.isInstall
        });
        return { deployedFiles };
      case "fileMap":
        deployedFiles = await applyFileMapStrategy({
          modRoot: options.modRoot,
          gamePath: options.gamePath,
          installPath,
          dictionaryFile: options.strategy.dictionaryFile ?? "",
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        return { deployedFiles };
      case "fileIntoParentFolder":
        deployedFiles = await applyFileIntoParentFolderStrategy({
          modRoot: options.modRoot,
          gamePath: options.gamePath,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          requireParent: options.strategy.requireParent,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        return { deployedFiles };
      case "manual":
        throw new Error(options.strategy.reason || "该 Mod 类型需要手动安装。");
      default:
        throw new Error(`未知安装策略: ${options.strategy.kind}`);
    }
  } catch (error) {
    if (options.isInstall && deployedFiles.length > 0) {
      try {
        await deleteRelativeFiles(options.gamePath, deployedFiles);
      } catch {
        // 保留原始错误，让调用方看到真正的安装失败原因。
      }
    }

    throw error;
  }
});

electron.ipcMain.handle("mods:removeDeployedFiles", async (_event, options: {
  gamePath: string;
  deployedFiles: string[];
}) => {
  await deleteRelativeFiles(options.gamePath, options.deployedFiles);
  return true;
});

electron.app.setAsDefaultProtocolClient(NXM_PROTOCOL);

if (!electron.app.requestSingleInstanceLock()) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", (_event, argv) => {
    dispatchNxmUrl(findNxmUrl(argv));
  });
}

electron.app.on("open-url", (event, url) => {
  event.preventDefault();
  dispatchNxmUrl(url);
});

electron.app.whenReady().then(() => {
  createWindow();
  dispatchNxmUrl(findNxmUrl(process.argv));

  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
