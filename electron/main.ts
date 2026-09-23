import * as electron from "electron";
import AdmZip from "adm-zip";
import { ProxyAgent } from "undici";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { path7za } from "7zip-bin";
import { assertPlatformInstallStrategy } from "../src/utils/platform-support";
import {
  cp,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
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
const MOD_PREVIEW_FOLDER = "mod-preview";
const LEGACY_PACKAGE_EXTENSION = ["g", "m", "m"].join("");
const ARCHIVE_EXTENSIONS = ["zip", "mmp", LEGACY_PACKAGE_EXTENSION];
const STEAM_LIBRARY_KEY = "HKEY_CURRENT_USER\\Software\\Valve\\Steam";
const NEXUS_GRAPHQL_URL = "https://api-router.nexusmods.com/graphql";
const NEXUS_API_URL = "https://api.nexusmods.com";
const NEXUS_OAUTH_URL = "https://users.nexusmods.com/oauth";
const NEXUS_OAUTH_CLIENT_ID = "vortex_loopback";
const NXM_PROTOCOL = "nxm";
let mainWindow: electron.BrowserWindow | null = null;
const pendingNxmUrls: string[] = [];
const downloadControllers = new Map<string, AbortController>();
const proxyAgents = new Map<string, ProxyAgent>();
const aria2Tasks = new Map<string, {
  gid: string;
  cancelled: boolean;
}>();
let aria2Runtime: {
  process: ReturnType<typeof spawn>;
  port: number;
  secret: string;
  executablePath: string;
} | null = null;
let translationQueue = Promise.resolve();
let activeNexusOAuth:
  | {
      finish: (error?: Error, result?: {
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        user: {
          key: string;
          name: string;
          email: string;
          profileUrl: string;
          avatar?: string;
          isPremium: boolean;
          isSupporter: boolean;
        };
      }) => void;
    }
  | null = null;

function normalizeProxyUrl(proxyUrl = "") {
  const value = proxyUrl.trim();
  if (!value) return "";

  if (/^(http|https|socks|socks4|socks5):\/\//iu.test(value)) {
    return value;
  }

  return `http://${value}`;
}

function proxyAgent(proxyUrl = "") {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return undefined;

  const existing = proxyAgents.get(normalized);
  if (existing) return existing;

  const agent = new ProxyAgent(normalized);
  proxyAgents.set(normalized, agent);
  return agent;
}

function fetchWithProxy(input: Parameters<typeof fetch>[0], init: RequestInit & { proxyUrl?: string } = {}) {
  const { proxyUrl, ...requestInit } = init;
  const dispatcher = proxyAgent(proxyUrl);

  return fetch(input, {
    ...requestInit,
    ...(dispatcher ? { dispatcher } : {})
  } as RequestInit & { dispatcher?: ProxyAgent });
}

function findAria2Executable(configuredPath = "") {
  const configured = configuredPath.trim();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`aria2c.exe 不存在：${configured}`);
    }
    return configured;
  }

  const bundledPath = getResourcePath("aria2/aria2c.exe");
  if (existsSync(bundledPath)) return bundledPath;

  return "aria2c";
}

async function findFreePort() {
  const server = net.createServer();

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });

  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));

  if (!port) {
    throw new Error("无法为 aria2 分配本地 RPC 端口。");
  }

  return port;
}

async function aria2Rpc<T>(runtime: {
  port: number;
  secret: string;
}, method: string, parameters: unknown[] = []) {
  const response = await fetch(`http://127.0.0.1:${runtime.port}/jsonrpc`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params: [`token:${runtime.secret}`, ...parameters]
    })
  });
  const payload = await response.json().catch(() => ({})) as {
    result?: T;
    error?: {
      code?: number;
      message?: string;
    };
  };

  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `aria2 请求失败：HTTP ${response.status}`);
  }

  return payload.result as T;
}

async function ensureAria2Runtime(configuredPath = "", maxConnections = 4) {
  const executablePath = findAria2Executable(configuredPath);
  if (
    aria2Runtime &&
    aria2Runtime.executablePath === executablePath &&
    !aria2Runtime.process.killed
  ) {
    return aria2Runtime;
  }

  aria2Runtime?.process.kill();
  const port = await findFreePort();
  const secret = randomUUID().replace(/-/gu, "");
  const child = spawn(executablePath, [
    "--enable-rpc=true",
    "--rpc-listen-all=false",
    "--rpc-listen-port", String(port),
    "--rpc-secret", secret,
    "--console-log-level=warn",
    "--auto-file-renaming=false",
    "--allow-overwrite=true",
    "--max-concurrent-downloads", String(Math.max(1, Math.min(16, Number(maxConnections) || 4)))
  ], {
    windowsHide: true,
    stdio: "ignore"
  });

  const runtime = {
    process: child,
    port,
    secret,
    executablePath
  };
  aria2Runtime = runtime;

  child.once("exit", () => {
    if (aria2Runtime?.process === child) {
      aria2Runtime = null;
    }
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await aria2Rpc(runtime, "aria2.getVersion");
      return runtime;
    } catch (caught) {
      lastError = caught;
      await sleep(100);
    }
  }

  child.kill();
  aria2Runtime = null;
  throw new Error(
    `无法启动 aria2，请确认 aria2c.exe 可执行。${lastError instanceof Error ? ` ${lastError.message}` : ""}`
  );
}

function abortDownloadError() {
  const error = new Error("下载已暂停");
  error.name = "AbortError";
  return error;
}

async function downloadWithAria2(options: {
  taskId?: string;
  url: string;
  outputPath: string;
  resume?: boolean;
  aria2ExecutablePath?: string;
  aria2MaxConnections?: number;
}) {
  const taskId = options.taskId?.trim();
  const runtime = await ensureAria2Runtime(
    options.aria2ExecutablePath,
    options.aria2MaxConnections
  );

  await mkdir(dirname(options.outputPath), { recursive: true });
  const gid = await aria2Rpc<string>(runtime, "aria2.addUri", [[options.url], {
    dir: dirname(options.outputPath),
    out: basename(options.outputPath),
    continue: options.resume ? "true" : "false",
    "allow-overwrite": "true",
    "auto-file-renaming": "false",
    "file-allocation": "none",
    split: String(Math.max(1, Math.min(16, Number(options.aria2MaxConnections) || 4))),
    "max-connection-per-server": String(Math.max(1, Math.min(16, Number(options.aria2MaxConnections) || 4))),
    "user-agent": "mayflyMods",
    "summary-interval": "1"
  }]);
  const taskState = { gid, cancelled: false };

  if (taskId) {
    aria2Tasks.set(taskId, taskState);
  }

  try {
    while (true) {
      if (taskState.cancelled) {
        throw abortDownloadError();
      }

      const status = await aria2Rpc<{
        status?: string;
        completedLength?: string;
        totalLength?: string;
        downloadSpeed?: string;
        errorCode?: string;
        errorMessage?: string;
      }>(runtime, "aria2.tellStatus", [gid, [
        "status",
        "completedLength",
        "totalLength",
        "downloadSpeed",
        "errorCode",
        "errorMessage"
      ]]);
      const receivedBytes = Number(status.completedLength) || 0;
      const totalBytes = Number(status.totalLength) || receivedBytes;

      if (taskId && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("downloads:progress", {
          taskId,
          receivedBytes,
          totalBytes
        });
      }

      if (status.status === "complete") {
        await aria2Rpc(runtime, "aria2.removeDownloadResult", [gid]).catch(() => undefined);
        return {
          outputPath: options.outputPath,
          receivedBytes,
          totalBytes
        };
      }

      if (status.status === "error" || status.status === "removed") {
        throw new Error(
          status.errorMessage ||
          `aria2 下载失败${status.errorCode ? `（错误码 ${status.errorCode}）` : ""}`
        );
      }

      await sleep(500);
    }
  } catch (caught) {
    if (taskState.cancelled) {
      throw abortDownloadError();
    }
    throw caught;
  } finally {
    if (taskId && aria2Tasks.get(taskId) === taskState) {
      aria2Tasks.delete(taskId);
    }
  }
}

function getResourcePath(fileName: string) {
  return isDev
    ? join(electron.app.getAppPath(), "resources", fileName)
    : join(process.resourcesPath, "resources", fileName);
}

function readWindowState() {
  const fallback = {
    width: 1200,
    height: 800
  };
  const filePath = join(electron.app.getPath("userData"), "window-state.json");

  try {
    const saved = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<Electron.Rectangle>;

    return {
      width: Math.max(1024, Number(saved.width) || fallback.width),
      height: Math.max(768, Number(saved.height) || fallback.height),
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
    minWidth: 1024,
    minHeight: 768,
    title: "mayflyMods - [b战：清梦与狗不得使用，其他人随意使用，不过分抄袭套壳即可]",
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

function registerNxmProtocol() {
  if (isDev || process.defaultApp) {
    const appPath = electron.app.getAppPath() || process.argv[1];

    if (appPath) {
      electron.app.setAsDefaultProtocolClient(NXM_PROTOCOL, process.execPath, [
        resolve(appPath)
      ]);
      return;
    }
  }

  electron.app.setAsDefaultProtocolClient(NXM_PROTOCOL);
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

type PackageProgressPayload = {
  operationId: string;
  operation: "import" | "export";
  phase: string;
  current: number;
  total: number;
  message: string;
};

function sendPackageProgress(sender: electron.WebContents, payload: PackageProgressPayload) {
  if (!sender.isDestroyed()) {
    sender.send("package:progress", payload);
  }
}

function yieldToRenderer() {
  return new Promise<void>((resolveNext) => {
    setImmediate(resolveNext);
  });
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

type InstallTargetScope = "game" | "documents" | "appData";

function normalizeTargetScope(scope: unknown): InstallTargetScope {
  return scope === "documents" || scope === "appData" ? scope : "game";
}

function getTargetScopeRoot(gamePath: string, scope: InstallTargetScope) {
  if (process.platform === "darwin" && scope !== "game") {
    throw new Error("macOS installs are currently limited to the selected game directory.");
  }

  switch (scope) {
    case "documents":
      return electron.app.getPath("documents");
    case "appData":
      return dirname(electron.app.getPath("appData"));
    case "game":
    default:
      return gamePath;
  }
}

function formatScopedFile(scope: InstallTargetScope, file: string) {
  return scope === "game" ? file : `${scope}:${file}`;
}

function parseScopedFile(file: string): { scope: InstallTargetScope; path: string } {
  const match = file.match(/^(documents|appData):(.+)$/u);
  return match
    ? { scope: match[1] as InstallTargetScope, path: match[2] }
    : { scope: "game", path: file };
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

function toPowerShellLiteral(value: string) {
  return `'${value.replace(/'/gu, "''")}'`;
}

async function invokeManagedTool<T = unknown>(options: {
  assemblyPath: string;
  typeName: string;
  methodName: string;
  payload?: unknown;
}) {
  if (process.platform !== "win32") {
    throw new Error("当前仅支持在 Windows 环境下调用 .NET 工具。");
  }

  if (!existsSync(options.assemblyPath)) {
    throw new Error(`未找到托管工具：${options.assemblyPath}`);
  }

  const hasPayload = "payload" in options;
  const payloadText = JSON.stringify(hasPayload ? options.payload : null);
  const jsonBridgeTypeDefinition = [
    "using System;",
    "using System.Collections;",
    "using System.Collections.Generic;",
    "using System.Dynamic;",
    "using System.Web.Script.Serialization;",
    "public static class MayflyDynamicJsonBridge {",
    "    public static object Parse(string json) {",
    "        if (String.IsNullOrWhiteSpace(json)) return null;",
    "        var serializer = new JavaScriptSerializer();",
    "        return ToDynamic(serializer.DeserializeObject(json));",
    "    }",
    "    private static object ToDynamic(object value) {",
    "        var dictionary = value as IDictionary<string, object>;",
    "        if (dictionary != null) {",
    "            IDictionary<string, object> expando = new ExpandoObject();",
    "            foreach (var pair in dictionary) expando[pair.Key] = ToDynamic(pair.Value);",
    "            return (ExpandoObject)expando;",
    "        }",
    "        var list = value as ArrayList;",
    "        if (list != null) {",
    "            var result = new List<object>();",
    "            foreach (var item in list) result.Add(ToDynamic(item));",
    "            return result;",
    "        }",
    "        return value;",
    "    }",
    "}"
  ].join("\n");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$assemblyPath = ${toPowerShellLiteral(options.assemblyPath)}`,
    `$typeName = ${toPowerShellLiteral(options.typeName)}`,
    `$methodName = ${toPowerShellLiteral(options.methodName)}`,
    `$payloadText = ${toPowerShellLiteral(payloadText)}`,
    `$hasPayload = ${toPowerShellLiteral(hasPayload ? "1" : "0")}`,
    `$jsonBridgeTypeDefinition = ${toPowerShellLiteral(jsonBridgeTypeDefinition)}`,
    "if (-not ('MayflyDynamicJsonBridge' -as [type])) { Add-Type -ReferencedAssemblies 'System.Web.Extensions' -TypeDefinition $jsonBridgeTypeDefinition }",
    "$assembly = [Reflection.Assembly]::LoadFrom($assemblyPath)",
    "$type = $assembly.GetType($typeName, $true)",
    "$bindingFlags = [Reflection.BindingFlags]'Public, NonPublic, Instance, Static, DeclaredOnly'",
    "$expectedParameterCount = if ($hasPayload -eq '1') { 1 } else { 0 }",
    "$methodCandidates = $type.GetMethods($bindingFlags) | Where-Object { $_.Name -eq $methodName }",
    "$method = $methodCandidates | Where-Object { $_.GetParameters().Length -eq $expectedParameterCount } | Select-Object -First 1",
    "if ($null -eq $method -and $expectedParameterCount -eq 0) { $method = $methodCandidates | Where-Object { $_.GetParameters().Length -eq 1 } | Select-Object -First 1 }",
    "if ($null -eq $method) { throw \"未找到方法: $typeName::$methodName\" }",
    "$payload = $null",
    "if ($hasPayload -eq '1') { $payload = [MayflyDynamicJsonBridge]::Parse($payloadText) }",
    "$instance = if ($method.IsStatic) { $null } else { [Activator]::CreateInstance($type, $true) }",
    "$parameterCount = $method.GetParameters().Length",
    "if ($parameterCount -gt 1) { throw \"暂不支持调用多参数方法: $typeName::$methodName\" }",
    "$parameters = New-Object object[] $parameterCount",
    "if ($parameterCount -eq 1) { $parameters[0] = $payload }",
    "$result = $method.Invoke($instance, $parameters)",
    "if ($result -is [System.Threading.Tasks.Task]) { $result.GetAwaiter().GetResult() | Out-Null; $resultType = $result.GetType(); if ($resultType.IsGenericType) { $result = $resultType.GetProperty('Result').GetValue($result) } else { $result = $null } }",
    "[Console]::Write((ConvertTo-Json -Depth 100 -Compress -InputObject $result))"
  ].join("\n");
  const raw = await runProcess("powershell", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ]);

  return (raw.trim() ? JSON.parse(raw) : null) as T;
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

function nexusHeaders(options: {
  apiKey?: string;
  accessToken?: string;
}, requireAuthorization = false) {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  const normalizedApiKey = options.apiKey?.trim() ?? "";
  const normalizedAccessToken = options.accessToken?.trim() ?? "";

  if (normalizedApiKey) {
    headers.apikey = normalizedApiKey;
  }

  if (normalizedAccessToken) {
    headers.Authorization = `Bearer ${normalizedAccessToken}`;
  }

  if (requireAuthorization && !normalizedApiKey && !normalizedAccessToken) {
    throw new Error("请先登录 NexusMods。");
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

function parseVersion(version: string) {
  return String(version || "")
    .trim()
    .split(".")
    .map((item) => Number.parseInt(item, 10))
    .map((item) => (Number.isFinite(item) ? item : 0));
}

function compareVersions(left: string, right: string) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;

    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function normalizeUpdatePayload(payload: Record<string, unknown> = {}) {
  return {
    versionName: String(payload.versionName || payload.version || ""),
    downloadUrl: String(payload.downloadUrl || ""),
    updateLog: String(payload.updateLog || ""),
    forceUpdate:
      payload.forceUpdate === true ||
      payload.forceUpdate === 1 ||
      String(payload.forceUpdate || "").toLowerCase() === "true"
  };
}

function withCacheBuster(updateUrl: string) {
  const url = new URL(updateUrl);
  url.searchParams.set("t", String(Date.now()));
  return url.toString();
}

async function checkAppUpdate(options: {
  updateUrl: string;
  currentVersion?: string;
  proxyUrl?: string;
}) {
  const updateUrl = String(options.updateUrl || "").trim();

  if (!updateUrl) {
    throw new Error("请先填写应用更新地址。");
  }

  const response = await fetchWithProxy(withCacheBuster(updateUrl), {
    proxyUrl: options.proxyUrl,
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });
  const payload = await readJsonResponse<Record<string, unknown>>(response, "检查应用更新失败。");
  const remote = normalizeUpdatePayload(payload);
  const currentVersionName = String(options.currentVersion || electron.app.getVersion() || "");
  const versionCompare = remote.versionName
    ? compareVersions(remote.versionName, currentVersionName)
    : 0;

  return {
    hasUpdate: versionCompare > 0,
    versionCompare,
    currentVersionName,
    remote
  };
}

async function fetchRemoteJson(options: {
  url: string;
  proxyUrl?: string;
}) {
  const rawUrl = String(options.url || "").trim();
  if (!rawUrl) {
    throw new Error("远程内容地址不能为空。");
  }

  const remoteUrl = new URL(rawUrl);
  if (!["http:", "https:"].includes(remoteUrl.protocol)) {
    throw new Error("远程内容地址只支持 http/https。");
  }

  const response = await fetchWithProxy(withCacheBuster(remoteUrl.toString()), {
    proxyUrl: options.proxyUrl,
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": `mayflyMods/${electron.app.getVersion()}`
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`远程内容读取失败：HTTP ${response.status}`);
  }

  if (text.length > 1024 * 1024) {
    throw new Error("远程内容过大，已拒绝读取。");
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("远程内容不是有效 JSON。");
  }
}

function nexusOAuthPage(success: boolean, message: string) {
  const title = success ? "mayflyMods 登录成功" : "mayflyMods 登录失败";
  const color = success ? "#65d6ad" : "#ff7b86";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#10151c;color:#e8edf3;font-family:Segoe UI,sans-serif">
    <main style="max-width:520px;padding:32px;text-align:center">
      <h1 style="color:${color};font-size:24px">${title}</h1>
      <p style="color:#b7c0cc">${message}</p>
      <p style="color:#7f8b99;font-size:13px">可以关闭此页面并返回 mayflyMods。</p>
    </main>
  </body>
</html>`;
}

async function startNexusOAuthLogin(proxyUrl = "") {
  activeNexusOAuth?.finish(new Error("网页登录已重新开始。"));

  const verifier = `${randomUUID()}${randomUUID()}`.replace(/-/gu, "");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomUUID();

  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "127.0.0.1"}`
      );

      if (requestUrl.pathname !== "/") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const returnedState = requestUrl.searchParams.get("state") ?? "";
      const code = requestUrl.searchParams.get("code") ?? "";
      const oauthError = requestUrl.searchParams.get("error") ?? "";
      const oauthErrorDescription = requestUrl.searchParams.get("error_description") ?? "";

      if (returnedState !== state) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(nexusOAuthPage(false, "登录状态已失效，请重新开始网页登录。"));
        activeNexusOAuth?.finish(new Error("Nexus 登录状态校验失败。"));
        return;
      }

      if (oauthError || !code) {
        const message = oauthErrorDescription || "Nexus 没有返回授权结果。";
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(nexusOAuthPage(false, message));
        activeNexusOAuth?.finish(new Error(message));
        return;
      }

      try {
        const tokenResponse = await fetchWithProxy(`${NEXUS_OAUTH_URL}/token`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: NEXUS_OAUTH_CLIENT_ID,
            redirect_uri: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
            code,
            code_verifier: verifier
          }).toString(),
          proxyUrl
        });
        const token = await readJsonResponse<{
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        }>(tokenResponse, "Nexus OAuth 令牌交换失败。");

        const accessToken = String(token.access_token ?? "").trim();
        const refreshToken = String(token.refresh_token ?? "").trim();
        if (!accessToken) {
          throw new Error("Nexus 没有返回访问令牌。");
        }

        let userPayload: Record<string, unknown> = {};

        try {
          const userResponse = await fetchWithProxy(`${NEXUS_API_URL}/v1/users/validate.json`, {
            method: "GET",
            headers: nexusHeaders({ accessToken }, true),
            proxyUrl
          });
          userPayload = await readJsonResponse<Record<string, unknown>>(
            userResponse,
            "获取 Nexus 用户信息失败。"
          );
        } catch {
          const userResponse = await fetchWithProxy(`${NEXUS_OAUTH_URL}/userinfo`, {
            method: "GET",
            headers: nexusHeaders({ accessToken }, true),
            proxyUrl
          });
          userPayload = await readJsonResponse<Record<string, unknown>>(
            userResponse,
            "获取 Nexus 用户信息失败。"
          );
        }

        const result = {
          accessToken,
          refreshToken,
          expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
          user: {
            key: "",
            name: firstString(
              userPayload.name,
              userPayload.username,
              userPayload.preferred_username,
              "Nexus 用户"
            ),
            email: firstString(userPayload.email),
            profileUrl: firstString(userPayload.profile_url, userPayload.profileUrl),
            avatar: firstString(userPayload.avatar_url, userPayload.avatar, userPayload.picture) || undefined,
            isPremium: Boolean(userPayload.is_premium ?? userPayload.isPremium),
            isSupporter: Boolean(userPayload.is_supporter ?? userPayload.isSupporter)
          }
        };

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(nexusOAuthPage(true, "Nexus 账户已经连接。"));
        activeNexusOAuth?.finish(undefined, result);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Nexus 登录失败。";
        response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        response.end(nexusOAuthPage(false, message));
        activeNexusOAuth?.finish(new Error(message));
      }
    })();
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("无法启动 Nexus 登录回调服务。");
  }

  const redirectUri = `http://127.0.0.1:${address.port}`;
  const authorizeUrl = new URL(`${NEXUS_OAUTH_URL}/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    scope: "openid profile email",
    code_challenge_method: "S256",
    client_id: NEXUS_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge
  }).toString();

  return new Promise((resolveLogin, rejectLogin) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error("网页登录等待超时，请重试。"));
    }, 5 * 60 * 1000);

    const finish = (error?: Error, result?: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      user: {
        key: string;
        name: string;
        email: string;
        profileUrl: string;
        avatar?: string;
        isPremium: boolean;
        isSupporter: boolean;
      };
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (activeNexusOAuth?.finish === finish) {
        activeNexusOAuth = null;
      }
      server.close();
      if (error) {
        rejectLogin(error);
      } else if (result) {
        resolveLogin(result);
      } else {
        rejectLogin(new Error("Nexus 登录没有返回结果。"));
      }
    };

    activeNexusOAuth = { finish };
    void electron.shell.openExternal(authorizeUrl.toString()).catch((caught) => {
      finish(caught instanceof Error ? caught : new Error("无法打开 Nexus 登录页面。"));
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function splitTextForTranslation(text: string, maxLength = 1800) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let buffer = "";
  const parts = normalized.split(/(\n{2,}|[。！？.!?]\s+|\n)/u);

  for (const part of parts) {
    if (!part) continue;

    if ((buffer + part).length <= maxLength) {
      buffer += part;
      continue;
    }

    if (buffer.trim()) {
      chunks.push(buffer.trim());
      buffer = "";
    }

    if (part.length <= maxLength) {
      buffer = part;
      continue;
    }

    for (let index = 0; index < part.length; index += maxLength) {
      chunks.push(part.slice(index, index + maxLength).trim());
    }
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks;
}

function parseGoogleGtxPayload(payload: unknown) {
  if (!Array.isArray(payload)) return "";
  const sentences = Array.isArray(payload[0]) ? payload[0] : [];

  return sentences
    .map((item) => Array.isArray(item) && typeof item[0] === "string" ? item[0] : "")
    .join("")
    .trim();
}

function requireTranslationSecret(value: string | undefined, label: string) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`请先在设置里填写${label}。`);
  }

  return normalized;
}

async function translateGoogleGtxText(options: {
  text: string;
  targetLang: "zh-CN";
  sourceLang?: string;
  proxyUrl?: string;
}) {
  const chunks = splitTextForTranslation(options.text);
  if (chunks.length === 0) return "";

  const translated: string[] = [];

  for (const chunk of chunks) {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", options.sourceLang?.trim() || "auto");
    url.searchParams.set("tl", options.targetLang);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", chunk);

    const response = await fetchWithProxy(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      proxyUrl: options.proxyUrl
    });

    if (response.status === 429) {
      throw new Error("翻译请求过快，Google 免费接口返回 429，请稍后再试。");
    }

    if (!response.ok) {
      throw new Error(`Google 免费翻译接口请求失败：HTTP ${response.status}`);
    }

    const payload = await response.json().catch(() => null);
    const text = parseGoogleGtxPayload(payload);

    if (!text) {
      throw new Error("Google 免费翻译接口没有返回有效译文。");
    }

    translated.push(text);
    await sleep(350);
  }

  return translated.join("\n\n");
}

async function translateBaiduText(options: {
  text: string;
  appId?: string;
  secret?: string;
  proxyUrl?: string;
}) {
  const appId = requireTranslationSecret(options.appId, "百度翻译 AppID");
  const secret = requireTranslationSecret(options.secret, "百度翻译密钥");
  const chunks = splitTextForTranslation(options.text, 1500);
  const translated: string[] = [];

  for (const chunk of chunks) {
    const salt = randomUUID().replace(/-/g, "");
    const sign = createHash("md5").update(`${appId}${chunk}${salt}${secret}`).digest("hex");
    const body = new URLSearchParams({
      q: chunk,
      from: "auto",
      to: "zh",
      appid: appId,
      salt,
      sign
    });
    const response = await fetchWithProxy("https://api.fanyi.baidu.com/api/trans/vip/translate", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      proxyUrl: options.proxyUrl
    });
    const payload = await response.json().catch(() => ({})) as {
      error_code?: string;
      error_msg?: string;
      trans_result?: Array<{ dst?: string }>;
    };

    if (!response.ok || payload.error_code) {
      throw new Error(payload.error_msg || `百度翻译请求失败：${payload.error_code || response.status}`);
    }

    const text = payload.trans_result?.map((item) => item.dst || "").join("\n").trim();
    if (!text) {
      throw new Error("百度翻译没有返回有效译文。");
    }

    translated.push(text);
    await sleep(350);
  }

  return translated.join("\n\n");
}

function truncateYoudaoText(text: string) {
  return text.length <= 20
    ? text
    : `${text.slice(0, 10)}${text.length}${text.slice(-10)}`;
}

async function translateYoudaoText(options: {
  text: string;
  appKey?: string;
  secret?: string;
  proxyUrl?: string;
}) {
  const appKey = requireTranslationSecret(options.appKey, "有道智云应用 ID");
  const secret = requireTranslationSecret(options.secret, "有道智云应用密钥");
  const chunks = splitTextForTranslation(options.text, 1500);
  const translated: string[] = [];

  for (const chunk of chunks) {
    const salt = randomUUID();
    const curtime = String(Math.floor(Date.now() / 1000));
    const signText = `${appKey}${truncateYoudaoText(chunk)}${salt}${curtime}${secret}`;
    const sign = createHash("sha256").update(signText).digest("hex");
    const body = new URLSearchParams({
      q: chunk,
      from: "auto",
      to: "zh-CHS",
      appKey,
      salt,
      sign,
      signType: "v3",
      curtime
    });
    const response = await fetchWithProxy("https://openapi.youdao.com/api", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      proxyUrl: options.proxyUrl
    });
    const payload = await response.json().catch(() => ({})) as {
      errorCode?: string;
      translation?: string[];
      l?: string;
    };

    if (!response.ok || payload.errorCode !== "0") {
      throw new Error(`有道翻译请求失败：${payload.errorCode || response.status}`);
    }

    const text = payload.translation?.join("\n").trim();
    if (!text) {
      throw new Error("有道翻译没有返回有效译文。");
    }

    translated.push(text);
    await sleep(350);
  }

  return translated.join("\n\n");
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function tencentDate(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function volcengineXDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/gu, "");
}

function volcengineShortDate(xDate: string) {
  return xDate.slice(0, 8);
}

function volcengineCanonicalQuery(params: Record<string, string>) {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function volcengineSigningKey(secretAccessKey: string, date: string, region: string, service: string) {
  const dateKey = hmacSha256(secretAccessKey, date);
  const regionKey = hmacSha256(dateKey, region);
  const serviceKey = hmacSha256(regionKey, service);
  return hmacSha256(serviceKey, "request");
}

function createVolcengineAuthorization(options: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  host: string;
  method: string;
  path: string;
  query: string;
  payload: string;
  xDate: string;
}) {
  const payloadHash = sha256Hex(options.payload);
  const shortDate = volcengineShortDate(options.xDate);
  const canonicalHeaders = [
    "content-type:application/json",
    `host:${options.host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${options.xDate}`
  ].join("\n") + "\n";
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = [
    options.method,
    options.path,
    options.query,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${shortDate}/${options.region}/${options.service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    options.xDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = createHmac("sha256", volcengineSigningKey(
    options.secretAccessKey,
    shortDate,
    options.region,
    options.service
  )).update(stringToSign).digest("hex");

  return {
    authorization: `HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    payloadHash
  };
}

function groupVolcengineTextList(chunks: string[]) {
  const groups: string[][] = [];
  let group: string[] = [];
  let totalLength = 0;

  for (const chunk of chunks) {
    if (group.length >= 16 || totalLength + chunk.length > 4800) {
      groups.push(group);
      group = [];
      totalLength = 0;
    }

    group.push(chunk);
    totalLength += chunk.length;
  }

  if (group.length > 0) {
    groups.push(group);
  }

  return groups;
}

async function translateTencentText(options: {
  text: string;
  secretId?: string;
  secretKey?: string;
  region?: string;
  proxyUrl?: string;
}) {
  const secretId = requireTranslationSecret(options.secretId, "腾讯云 SecretId");
  const secretKey = requireTranslationSecret(options.secretKey, "腾讯云 SecretKey");
  const region = options.region?.trim() || "ap-guangzhou";
  const chunks = splitTextForTranslation(options.text, 1800);
  const translated: string[] = [];

  for (const chunk of chunks) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      SourceText: chunk,
      Source: "auto",
      Target: "zh",
      ProjectId: 0
    });
    const canonicalHeaders = "content-type:application/json; charset=utf-8\nhost:tmt.tencentcloudapi.com\n";
    const signedHeaders = "content-type;host";
    const canonicalRequest = [
      "POST",
      "/",
      "",
      canonicalHeaders,
      signedHeaders,
      sha256Hex(payload)
    ].join("\n");
    const date = tencentDate(timestamp);
    const credentialScope = `${date}/tmt/tc3_request`;
    const stringToSign = [
      "TC3-HMAC-SHA256",
      String(timestamp),
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join("\n");
    const secretDate = hmacSha256(`TC3${secretKey}`, date);
    const secretService = hmacSha256(secretDate, "tmt");
    const secretSigning = hmacSha256(secretService, "tc3_request");
    const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
    const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetchWithProxy("https://tmt.tencentcloudapi.com", {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json; charset=utf-8",
        Host: "tmt.tencentcloudapi.com",
        "X-TC-Action": "TextTranslate",
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Version": "2018-03-21",
        "X-TC-Region": region
      },
      body: payload,
      proxyUrl: options.proxyUrl
    });
    const result = await response.json().catch(() => ({})) as {
      Response?: {
        TargetText?: string;
        Error?: {
          Code?: string;
          Message?: string;
        };
      };
    };
    const error = result.Response?.Error;

    if (!response.ok || error) {
      throw new Error(error?.Message || `腾讯云翻译请求失败：${error?.Code || response.status}`);
    }

    const text = result.Response?.TargetText?.trim();
    if (!text) {
      throw new Error("腾讯云翻译没有返回有效译文。");
    }

    translated.push(text);
    await sleep(350);
  }

  return translated.join("\n\n");
}

async function translateVolcengineText(options: {
  text: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  proxyUrl?: string;
}) {
  const accessKeyId = requireTranslationSecret(options.accessKeyId, "火山引擎 AccessKey ID");
  const secretAccessKey = requireTranslationSecret(options.secretAccessKey, "火山引擎 Secret AccessKey");
  const region = options.region?.trim() || "cn-north-1";
  const host = "translate.volcengineapi.com";
  const service = "translate";
  const query = volcengineCanonicalQuery({
    Action: "TranslateText",
    Version: "2020-06-01"
  });
  const chunks = splitTextForTranslation(options.text, 4500);
  const translated: string[] = [];

  for (const textList of groupVolcengineTextList(chunks)) {
    const payload = JSON.stringify({
      TargetLanguage: "zh",
      TextList: textList
    });
    const xDate = volcengineXDate();
    const signed = createVolcengineAuthorization({
      accessKeyId,
      secretAccessKey,
      region,
      service,
      host,
      method: "POST",
      path: "/",
      query,
      payload,
      xDate
    });
    const response = await fetchWithProxy(`https://${host}/?${query}`, {
      method: "POST",
      headers: {
        Authorization: signed.authorization,
        "Content-Type": "application/json",
        Host: host,
        "X-Content-Sha256": signed.payloadHash,
        "X-Date": xDate
      },
      body: payload,
      proxyUrl: options.proxyUrl
    });
    const result = await response.json().catch(() => ({})) as {
      TranslationList?: Array<{ Translation?: string; DetectedSourceLanguage?: string }>;
      ResponseMetadata?: { Error?: { Code?: string; Message?: string } };
      ResponseMetaData?: { Error?: { Code?: string; Message?: string } };
    };
    const error = result.ResponseMetadata?.Error ?? result.ResponseMetaData?.Error;

    if (!response.ok || error) {
      throw new Error(error?.Message || `火山引擎翻译请求失败：${error?.Code || response.status}`);
    }

    const texts = result.TranslationList?.map((item) => item.Translation?.trim() || "").filter(Boolean) ?? [];
    if (texts.length === 0) {
      throw new Error("火山引擎翻译没有返回有效译文。");
    }

    translated.push(...texts);
    await sleep(250);
  }

  return translated.join("\n\n");
}

function normalizeOllamaBaseUrl(baseUrl?: string) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/u, "");
  return normalized || "http://127.0.0.1:11434";
}

function ollamaPrompt(text: string) {
  return [
    "你是游戏 Mod 内容翻译助手。",
    "请把下面内容翻译成简体中文。",
    "保留 Mod 名称、文件名、路径、代码、版本号、工具名和专有名词。",
    "只输出译文，不要解释，不要添加额外说明。",
    "",
    "内容：",
    text
  ].join("\n");
}

async function translateOllamaText(options: {
  text: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  proxyUrl?: string;
}) {
  const model = requireTranslationSecret(options.model, "Ollama 模型名");
  const chunks = splitTextForTranslation(options.text, 2400);
  const translated: string[] = [];
  const endpoint = `${normalizeOllamaBaseUrl(options.baseUrl)}/api/generate`;
  const timeoutMs = Math.max(10000, Number(options.timeoutMs) || 120000);

  for (const chunk of chunks) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchWithProxy(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          prompt: ollamaPrompt(chunk),
          stream: false,
          options: {
            temperature: 0.1
          }
        }),
        proxyUrl: options.proxyUrl,
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({})) as {
        response?: string;
        error?: string;
      };

      if (!response.ok || payload.error) {
        throw new Error(payload.error || `Ollama 翻译请求失败：HTTP ${response.status}`);
      }

      const text = String(payload.response || "").trim();
      if (!text) {
        throw new Error("Ollama 没有返回有效译文。");
      }

      translated.push(text);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        throw new Error("Ollama 翻译超时，请检查模型是否已启动或调大超时时间。");
      }
      throw caught;
    } finally {
      clearTimeout(timeout);
    }
  }

  return translated.join("\n\n");
}

async function translateTextByProvider(options: {
  text: string;
  provider?: string;
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
}) {
  switch (options.provider) {
    case "baidu":
      return translateBaiduText({
        text: options.text,
        appId: options.baiduAppId,
        secret: options.baiduSecret,
        proxyUrl: options.proxyUrl
      });
    case "youdao":
      return translateYoudaoText({
        text: options.text,
        appKey: options.youdaoAppKey,
        secret: options.youdaoSecret,
        proxyUrl: options.proxyUrl
      });
    case "tencent":
      return translateTencentText({
        text: options.text,
        secretId: options.tencentSecretId,
        secretKey: options.tencentSecretKey,
        region: options.tencentRegion,
        proxyUrl: options.proxyUrl
      });
    case "volcengine":
      return translateVolcengineText({
        text: options.text,
        accessKeyId: options.volcengineAccessKeyId,
        secretAccessKey: options.volcengineSecretAccessKey,
        region: options.volcengineRegion,
        proxyUrl: options.proxyUrl
      });
    case "ollama":
      return translateOllamaText({
        text: options.text,
        baseUrl: options.ollamaBaseUrl,
        model: options.ollamaModel,
        timeoutMs: options.ollamaTimeoutMs,
        proxyUrl: options.proxyUrl
      });
    case "google-gtx":
    default:
      return translateGoogleGtxText({
        text: options.text,
        targetLang: options.targetLang,
        sourceLang: options.sourceLang,
        proxyUrl: options.proxyUrl
      });
  }
}

function enqueueTranslation<T>(task: () => Promise<T>) {
  const queued = translationQueue.then(task, task);
  translationQueue = queued.then(
    () => undefined,
    () => undefined
  );

  return queued;
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

function normalizeNexusImage(image: Record<string, unknown>, index: number) {
  const imageId = String(image.id ?? image.image_id ?? index);
  const thumbnailUrl = firstString(
    image.thumbnail_url,
    image.thumbnail_uri,
    image.thumbnail,
    image.thumb,
    image.small_url,
    image.small_uri,
    image.url,
    image.uri
  );
  const imageUrl = firstString(
    image.original_url,
    image.original_uri,
    image.image_url,
    image.image_uri,
    image.large_url,
    image.large_uri,
    image.url,
    image.uri,
    thumbnailUrl
  );

  return {
    id: imageId,
    title: firstString(image.name, image.title, image.description) || `image-${imageId}`,
    thumbnailUrl,
    imageUrl
  };
}

function normalizeNexusImages(images: Array<Record<string, unknown>>) {
  return images
    .map((image, index) => normalizeNexusImage(image, index))
    .filter((image) => image.thumbnailUrl || image.imageUrl);
}

function normalizeNexusDetail(
  mod: Record<string, unknown>,
  files: Array<Record<string, unknown>>,
  images: Array<Record<string, unknown>>,
  gameDomain: string
) {
  const modId = String(mod.mod_id ?? "");
  const normalizedFiles = normalizeNexusFiles(files, gameDomain, modId);
  const normalizedImages = normalizeNexusImages(images);
  const user = mod.user && typeof mod.user === "object" ? mod.user as Record<string, unknown> : {};
  const cover = normalizeNexusText(mod.picture_url) || normalizedImages[0]?.imageUrl || normalizedImages[0]?.thumbnailUrl || "";
  const category = mod.category && typeof mod.category === "object" ? mod.category as Record<string, unknown> : {};
  const categories = [
    firstString(mod.category_name, mod.categoryName, category.name, category.category_name)
  ].filter(Boolean);

  return {
    id: modId,
    title: normalizeNexusText(mod.name),
    summary: normalizeNexusText(mod.summary),
    author: normalizeNexusText(mod.author) || normalizeNexusText(mod.uploaded_by) || normalizeNexusText(user.name),
    version: normalizeNexusText(mod.version),
    website: buildNexusWebsite(gameDomain, modId),
    cover,
    downloads: Math.max(0, Number(mod.mod_downloads ?? 0)),
    likes: Math.max(0, Number(mod.endorsement_count ?? 0)),
    categories,
    createdAt: normalizeNexusText(mod.created_time),
    updatedAt: normalizeNexusText(mod.updated_time),
    nsfw: Boolean(mod.contains_adult_content),
    filesCount: normalizedFiles.length,
    primaryFile: normalizedFiles[0] ?? null,
    description: normalizeNexusText(mod.description) || normalizeNexusText(mod.summary),
    descriptionFormat: normalizeNexusText(mod.description) ? "html" : "text",
    images: normalizedImages,
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

function smapiDependencyIds(value: unknown) {
  if (!Array.isArray(value)) {
    return stringArray(value);
  }

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();

      if (item && typeof item === "object") {
        const dependency = item as Record<string, unknown>;
        return firstString(dependency.UniqueID, dependency.uniqueId, dependency.id, dependency.name);
      }

      return "";
    })
    .filter(Boolean);
}

async function readManifest(rootPath: string, files: string[]) {
  const manifestPath = files.find((file) => basename(file).toLowerCase() === "manifest.json");
  if (!manifestPath) {
    return {};
  }

  try {
    const raw = await readFile(join(rootPath, manifestPath), "utf-8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    const contentPackFor = manifest.ContentPackFor && typeof manifest.ContentPackFor === "object"
      ? manifest.ContentPackFor as Record<string, unknown>
      : manifest.contentPackFor && typeof manifest.contentPackFor === "object"
        ? manifest.contentPackFor as Record<string, unknown>
        : {};
    const contentPackForId = firstString(contentPackFor.UniqueID, contentPackFor.uniqueId, contentPackFor.id);
    const dependencies = smapiDependencyIds(manifest.Dependencies ?? manifest.dependencies);

    return {
      name: firstString(manifest.Name, manifest.name, manifest.title, manifest.modName, manifest.displayName),
      version: firstString(manifest.Version, manifest.version, manifest.modVersion),
      author: firstString(manifest.Author, manifest.author, manifest.authorName, manifest.creator, manifest.owner),
      website: firstString(manifest.Website, manifest.website, manifest.homepage, manifest.url, manifest.nexusUrl),
      description: firstString(manifest.Description, manifest.description, manifest.summary),
      tags: stringArray(manifest.Tags ?? manifest.tags),
      requirements: [...new Set([
        contentPackForId,
        ...stringArray(manifest.requirements),
        ...dependencies,
        ...stringArray(manifest.deps)
      ].filter(Boolean))]
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

    await rm(current, { force: true, recursive: true });
    current = dirname(current);
  }
}

async function deleteRelativeFiles(gamePath: string, files: string[]) {
  const uniqueFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))]
    .sort((left, right) => normalizePathParts(parseScopedFile(right).path).length - normalizePathParts(parseScopedFile(left).path).length);

  for (const file of uniqueFiles) {
    const scoped = parseScopedFile(file);
    const targetRoot = getTargetScopeRoot(gamePath, scoped.scope);
    const target = safeJoin(targetRoot, scoped.path);
    await rm(target, { force: true, recursive: true });
    await deleteEmptyParents(targetRoot, dirname(target));
  }
}

function isPassFile(filePath: string) {
  const parts = normalizePathParts(filePath);
  return PASS_FILE_NAMES.has(basename(filePath).toLowerCase()) ||
    parts.some((part) => [".mayfly", MOD_PREVIEW_FOLDER].includes(part.toLowerCase()));
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

async function planFolderRootStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  targetFolderName?: string;
}) {
  const targetRoot = safeJoin(
    options.gamePath,
    options.installPath || ".",
    sanitizeFileName(options.targetFolderName || basename(options.modRoot))
  );

  return uniqueRelativeTargets(options.gamePath, [targetRoot]);
}

async function planFileStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  useSymlink?: boolean;
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
    if (options.useSymlink) {
      targets.push(target);
      continue;
    }

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

async function planFileOnlyStrategy(options: {
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
  const targetRoot = safeJoin(options.gamePath, options.installPath || ".");

  return uniqueRelativeTargets(
    options.gamePath,
    matched
      .filter((file) => !isPassFile(file))
      .map((file) => join(targetRoot, basename(file)))
  );
}

async function planFolderParentStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
  useSymlink?: boolean;
}) {
  const folderNames = (Array.isArray(options.folderName) ? options.folderName : [options.folderName])
    .map((folder) => folder.toLowerCase())
    .filter(Boolean);
  const files = await listFiles(options.modRoot);
  const matched = files.find((file) =>
    normalizePathParts(file).some((part) => folderNames.includes(part.toLowerCase()))
  );

  if (!matched) return [];

  const parts = normalizePathParts(matched);
  const index = parts.findIndex((part) => folderNames.includes(part.toLowerCase()));
  const parent = parts.slice(0, Math.max(index, 0)).join("/");
  const sourceFolder = join(options.modRoot, parent);
  const target = safeJoin(options.gamePath, options.installPath || ".", basename(sourceFolder));

  if (options.useSymlink) {
    return uniqueRelativeTargets(options.gamePath, [target]);
  }

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

async function applyFolderRootStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  targetFolderName?: string;
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const target = safeJoin(
    options.gamePath,
    options.installPath || ".",
    sanitizeFileName(options.targetFolderName || basename(options.modRoot))
  );
  const deployedFolder = relative(options.gamePath, target).replace(/\\/g, "/");

  if (options.isInstall) {
    if (existsSync(target)) {
      if (!options.useSymlink) {
        throw new Error(`目标目录已存在，已阻止覆盖：${deployedFolder}`);
      }

      await rm(target, { recursive: true, force: true });
    }

    await mkdir(dirname(target), { recursive: true });

    if (options.useSymlink) {
      await symlink(options.modRoot, target, process.platform === "win32" ? "junction" : "dir");
    } else {
      await cp(options.modRoot, target, {
        recursive: true,
        force: true,
        errorOnExist: false
      });
    }

    return [deployedFolder];
  }

  await rm(target, { recursive: true, force: true });
  await deleteEmptyParents(options.gamePath, dirname(target));
  return [];
}

async function applyFileStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  commonParent?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
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

      await mkdir(dirname(target), { recursive: true });

      if (options.useSymlink) {
        await symlink(folder, target, process.platform === "win32" ? "junction" : "dir");
        deployedFiles.push(relative(options.gamePath, target).replace(/\\/g, "/"));
      } else {
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
      }
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

async function applyFileOnlyStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
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
    if (isPassFile(file)) continue;

    deployedFiles.push(...(await copyOrRemoveFile(
      join(options.modRoot, file),
      join(targetRoot, basename(file)),
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
  folderName: string | string[];
  isInstall: boolean;
  useSymlink?: boolean;
}): Promise<string[]> {
  const folderNames = (Array.isArray(options.folderName) ? options.folderName : [options.folderName])
    .map((folder) => folder.toLowerCase())
    .filter(Boolean);
  const files = await listFiles(options.modRoot);
  const matched = files.find((file) =>
    normalizePathParts(file).some((part) => folderNames.includes(part.toLowerCase()))
  );

  if (!matched) return [];

  const parts = normalizePathParts(matched);
  const index = parts.findIndex((part) => folderNames.includes(part.toLowerCase()));
  const parent = parts.slice(0, Math.max(index, 0)).join("/");
  const sourceFolder = join(options.modRoot, parent);
  const target = safeJoin(options.gamePath, options.installPath || ".", basename(sourceFolder));

  if (options.isInstall) {
    if (existsSync(target)) {
      throw new Error(`目标目录已存在，已阻止覆盖：${relative(options.gamePath, target).replace(/\\/g, "/")}`);
    }

    await mkdir(dirname(target), { recursive: true });

    if (options.useSymlink) {
      await symlink(sourceFolder, target, process.platform === "win32" ? "junction" : "dir");
      return [relative(options.gamePath, target).replace(/\\/g, "/")];
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

function localAppDataPath(...parts: string[]) {
  return join(dirname(electron.app.getPath("appData")), "Local", ...parts);
}

function documentsPath(...parts: string[]) {
  return join(electron.app.getPath("documents"), ...parts);
}

async function readTextFile(filePath: string, fallback = "") {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return fallback;
  }
}

async function writeTextFile(filePath: string, value: string) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf-8");
}

async function ensureArchiveIni(options: {
  documentsGameFolder: string;
  iniFileName: string;
}) {
  const iniPath = documentsPath("My Games", options.documentsGameFolder, options.iniFileName);
  const raw = await readTextFile(iniPath);
  const lines = raw.split(/\r?\n/u);
  const nextLines: string[] = [];
  let inArchive = false;
  let sawArchive = false;
  let sawInvalidate = false;
  let sawResourceDirs = false;

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/u)?.[1]?.trim().toLowerCase();

    if (section) {
      if (inArchive) {
        if (!sawInvalidate) nextLines.push("bInvalidateOlderFiles=1");
        if (!sawResourceDirs) nextLines.push("sResourceDataDirsFinal=");
      }

      inArchive = section === "archive";
      sawArchive ||= inArchive;
      sawInvalidate = false;
      sawResourceDirs = false;
      nextLines.push(line);
      continue;
    }

    if (inArchive && /^\s*bInvalidateOlderFiles\s*=/iu.test(line)) {
      nextLines.push("bInvalidateOlderFiles=1");
      sawInvalidate = true;
      continue;
    }

    if (inArchive && /^\s*sResourceDataDirsFinal\s*=/iu.test(line)) {
      nextLines.push("sResourceDataDirsFinal=");
      sawResourceDirs = true;
      continue;
    }

    nextLines.push(line);
  }

  if (inArchive) {
    if (!sawInvalidate) nextLines.push("bInvalidateOlderFiles=1");
    if (!sawResourceDirs) nextLines.push("sResourceDataDirsFinal=");
  }

  if (!sawArchive) {
    if (nextLines.some((line) => line.trim())) nextLines.push("");
    nextLines.push("[Archive]", "bInvalidateOlderFiles=1", "sResourceDataDirsFinal=");
  }

  await writeTextFile(iniPath, nextLines.join("\n").trimEnd() + "\n");
}

function pluginFileNames(files: string[]) {
  return files
    .filter((file) => ["esp", "esm", "esl"].includes(getExtension(file)))
    .map((file) => basename(file));
}

async function updatePluginsTxt(options: {
  localAppDataGameFolder: string;
  files: string[];
  isInstall: boolean;
  header?: string;
  starPrefix?: boolean;
}) {
  const names = pluginFileNames(options.files);
  if (names.length === 0) return;

  const pluginsPath = localAppDataPath(options.localAppDataGameFolder, "plugins.txt");
  let entries = (await readTextFile(pluginsPath))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (options.header && entries[0] !== options.header) {
    entries = [options.header, ...entries.filter((line) => line !== options.header)];
  }

  for (const name of names) {
    const entry = `${options.starPrefix === false ? "" : "*"}${name}`;
    if (options.isInstall) {
      if (!entries.includes(entry)) entries.push(entry);
    } else {
      entries = entries.filter((line) => line !== entry && line !== name);
    }
  }

  await writeTextFile(pluginsPath, [...new Set(entries)].join("\n") + "\n");
}

async function updateStarfieldGeneralTestFiles(options: {
  documentsGameFolder: string;
  iniFileName: string;
  files: string[];
  isInstall: boolean;
}) {
  const espNames = options.files
    .filter((file) => getExtension(file) === "esp")
    .map((file) => basename(file));

  if (espNames.length === 0) return;

  const iniPath = documentsPath("My Games", options.documentsGameFolder, options.iniFileName);
  const raw = await readTextFile(iniPath);
  const lines = raw.split(/\r?\n/u);
  const nextLines: string[] = [];
  let inGeneral = false;
  let sawGeneral = false;
  let maxIndex = 0;
  const remainingNames = new Set(espNames);

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/u)?.[1]?.trim().toLowerCase();

    if (section) {
      inGeneral = section === "general";
      sawGeneral ||= inGeneral;
      nextLines.push(line);
      continue;
    }

    const testMatch = inGeneral ? line.match(/^\s*sTestFile(\d*)\s*=\s*(.+?)\s*$/iu) : null;
    if (testMatch) {
      const index = Number(testMatch[1] || 0);
      maxIndex = Math.max(maxIndex, index);
      const value = testMatch[2]?.trim() ?? "";

      if (!options.isInstall && remainingNames.has(value)) {
        remainingNames.delete(value);
        continue;
      }

      if (options.isInstall) {
        remainingNames.delete(value);
      }
    }

    nextLines.push(line);
  }

  if (options.isInstall && remainingNames.size > 0) {
    if (!sawGeneral) {
      if (nextLines.some((line) => line.trim())) nextLines.push("");
      nextLines.push("[General]");
    }

    for (const name of remainingNames) {
      maxIndex += 1;
      nextLines.push(`sTestFile${maxIndex}=${name}`);
    }
  }

  await writeTextFile(iniPath, nextLines.join("\n").trimEnd() + "\n");
}

async function planBethesdaDataStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
}) {
  return planFolderStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    folderName: options.folderName,
    spare: true
  });
}

async function applyBethesdaDataStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  folderName: string | string[];
  documentsGameFolder: string;
  iniFileName: string;
  localAppDataGameFolder: string;
  pluginsHeader?: string;
  updateGeneralTestFiles?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const files = await listFiles(options.modRoot);

  if (options.isInstall) {
    await ensureArchiveIni({
      documentsGameFolder: options.documentsGameFolder,
      iniFileName: options.iniFileName
    });
  }

  await updatePluginsTxt({
    localAppDataGameFolder: options.localAppDataGameFolder,
    files,
    isInstall: options.isInstall,
    header: options.pluginsHeader
  });

  if (options.updateGeneralTestFiles) {
    await updateStarfieldGeneralTestFiles({
      documentsGameFolder: options.documentsGameFolder,
      iniFileName: options.iniFileName,
      files,
      isInstall: options.isInstall
    });
  }

  return applyFolderStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    folderName: options.folderName,
    spare: true,
    isInstall: options.isInstall,
    useSymlink: options.useSymlink
  });
}

async function planBethesdaPluginFilesStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
}) {
  const files = await listFiles(options.modRoot);
  const targets = files
    .filter((file) => ["esp", "esm", "esl"].includes(getExtension(file)))
    .map((file) => safeJoin(options.gamePath, options.installPath, basename(file)));

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function applyBethesdaPluginFilesStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  documentsGameFolder: string;
  iniFileName: string;
  localAppDataGameFolder: string;
  pluginsHeader?: string;
  updateGeneralTestFiles?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const files = await listFiles(options.modRoot);

  if (options.isInstall) {
    await ensureArchiveIni({
      documentsGameFolder: options.documentsGameFolder,
      iniFileName: options.iniFileName
    });
  }

  await updatePluginsTxt({
    localAppDataGameFolder: options.localAppDataGameFolder,
    files,
    isInstall: options.isInstall,
    header: options.pluginsHeader
  });

  if (options.updateGeneralTestFiles) {
    await updateStarfieldGeneralTestFiles({
      documentsGameFolder: options.documentsGameFolder,
      iniFileName: options.iniFileName,
      files,
      isInstall: options.isInstall
    });
  }

  return applyFileOnlyStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    fileName: "esp",
    isExtname: true,
    isInstall: options.isInstall,
    useSymlink: options.useSymlink
  }).then(async (deployed) => [
    ...deployed,
    ...await applyFileOnlyStrategy({
      modRoot: options.modRoot,
      gamePath: options.gamePath,
      installPath: options.installPath,
      fileName: "esm",
      isExtname: true,
      isInstall: options.isInstall,
      useSymlink: options.useSymlink
    }),
    ...await applyFileOnlyStrategy({
      modRoot: options.modRoot,
      gamePath: options.gamePath,
      installPath: options.installPath,
      fileName: "esl",
      isExtname: true,
      isInstall: options.isInstall,
      useSymlink: options.useSymlink
    })
  ]);
}

async function planOblivionPluginsStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
}) {
  return planFileSiblingStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    fileName: "esp",
    isExtname: true
  });
}

async function updateOblivionPluginsTxt(options: {
  gamePath: string;
  installPath: string;
  files: string[];
  isInstall: boolean;
}) {
  const names = pluginFileNames(options.files).filter((name) => name.toLowerCase().endsWith(".esp"));
  if (names.length === 0) return;

  const pluginsPath = safeJoin(options.gamePath, options.installPath, "Plugins.txt");
  let entries = (await readTextFile(pluginsPath))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const name of names) {
    if (options.isInstall) {
      if (!entries.includes(name)) entries.push(name);
    } else {
      entries = entries.filter((line) => line !== name);
    }
  }

  await writeTextFile(pluginsPath, entries.join("\n") + "\n");
}

async function applyOblivionPluginsStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const files = await listFiles(options.modRoot);
  await updateOblivionPluginsTxt({
    gamePath: options.gamePath,
    installPath: options.installPath,
    files,
    isInstall: options.isInstall
  });

  return applyFileSiblingStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    fileName: "esp",
    isExtname: true,
    isInstall: options.isInstall,
    useSymlink: options.useSymlink
  });
}

async function ensureNoMansSkyModsEnabled(gamePath: string) {
  const disabledFile = safeJoin(gamePath, "GAMEDATA", "PCBANKS", "DISABLEMODS.TXT");
  const backupFile = safeJoin(gamePath, "GAMEDATA", "PCBANKS", "DISABLEMODS.TXT.bak");

  if (existsSync(disabledFile)) {
    if (existsSync(backupFile)) {
      await rm(disabledFile, { force: true });
    } else {
      await rename(disabledFile, backupFile);
    }
  }
}

async function numberedRecordsPath(modRoot: string, listFileName: string) {
  return join(modRoot, listFileName);
}

async function readNumberedRecords(modRoot: string, listFileName: string): Promise<Array<[string, string]>> {
  return (await readTextFile(await numberedRecordsPath(modRoot, listFileName)))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|").slice(0, 2) as [string, string])
    .filter((record) => record[0] && record[1]);
}

async function writeNumberedRecords(modRoot: string, listFileName: string, records: Array<[string, string]>) {
  await writeTextFile(await numberedRecordsPath(modRoot, listFileName), records.map((record) => record.join("|")).join("\n"));
}

async function nextNumberedName(options: {
  gamePath: string;
  installPath: string;
  prefix: string;
  extension: string;
  startIndex: number;
  records: Array<[string, string]>;
}) {
  const targetRoot = safeJoin(options.gamePath, options.installPath);
  const existing = existsSync(targetRoot)
    ? (await readdir(targetRoot))
      .map((file) => {
        const match = file.match(new RegExp(`^${options.prefix}(\\d+)\\.${options.extension}$`, "iu"));
        return match ? Number(match[1]) : 0;
      })
    : [];
  const recordNumbers = options.records.map((record) => {
    const match = record[1].match(new RegExp(`^${options.prefix}(\\d+)\\.${options.extension}$`, "iu"));
    return match ? Number(match[1]) : 0;
  });
  const maxNumber = Math.max(options.startIndex - 1, ...existing, ...recordNumbers);

  return `${options.prefix}${maxNumber + 1}.${options.extension}`;
}

async function planNumberedPakStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  extension: string;
  prefix: string;
  startIndex: number;
  listFileName: string;
}) {
  const files = (await listFiles(options.modRoot)).filter((file) => getExtension(file) === options.extension);
  const records = await readNumberedRecords(options.modRoot, options.listFileName);
  const targets: string[] = [];

  for (const file of files) {
    const targetName = records.find((record) => record[0] === file)?.[1] ?? await nextNumberedName({
      gamePath: options.gamePath,
      installPath: options.installPath,
      prefix: options.prefix,
      extension: options.extension,
      startIndex: options.startIndex,
      records: [
        ...records,
        ...targets.map((target) => [file, basename(target)] as [string, string])
      ]
    });
    targets.push(safeJoin(options.gamePath, options.installPath, targetName));
  }

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function applyNumberedPakStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  extension: string;
  prefix: string;
  startIndex: number;
  listFileName: string;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const files = (await listFiles(options.modRoot)).filter((file) => getExtension(file) === options.extension);
  let records = await readNumberedRecords(options.modRoot, options.listFileName);
  const deployed: string[] = [];

  for (const file of files) {
    let record = records.find((item) => item[0] === file);

    if (options.isInstall) {
      if (!record) {
        record = [file, await nextNumberedName({ ...options, records })];
        records.push(record);
      }

      deployed.push(...await copyOrRemoveFile(
        join(options.modRoot, file),
        safeJoin(options.gamePath, options.installPath, record[1]),
        true,
        options.gamePath,
        options.useSymlink
      ));
    } else if (record) {
      await rm(safeJoin(options.gamePath, options.installPath, record[1]), { force: true });
      records = records.filter((item) => item !== record);
    }
  }

  await writeNumberedRecords(options.modRoot, options.listFileName, records);
  return deployed;
}

async function readWatchDogsRecords(modRoot: string, listFileName: string): Promise<Array<[string, string, string]>> {
  return (await readTextFile(join(modRoot, listFileName)))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|").slice(0, 3) as [string, string, string])
    .filter((record) => record[0] && record[1] && record[2]);
}

async function writeWatchDogsRecords(modRoot: string, listFileName: string, records: Array<[string, string, string]>) {
  await writeTextFile(join(modRoot, listFileName), records.map((record) => record.join("|")).join("\n"));
}

async function nextWatchDogsPatchName(gamePath: string, installPath: string, records: Array<[string, string, string]>) {
  const targetRoot = safeJoin(gamePath, installPath);
  const existing = existsSync(targetRoot)
    ? (await readdir(targetRoot))
      .map((file) => Number(file.match(/^patch(\d+)\.dat$/iu)?.[1] ?? 0))
    : [];
  const recordNumbers = records.map((record) => Number(record[2].match(/^patch(\d+)\.(dat|fat)$/iu)?.[1] ?? 0));
  return `patch${Math.max(0, ...existing, ...recordNumbers) + 1}`;
}

async function planWatchDogsPatchStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  listFileName: string;
}) {
  const records = await readWatchDogsRecords(options.modRoot, options.listFileName);
  const files = (await listFiles(options.modRoot))
    .filter((file) => ["dat", "fat"].includes(getExtension(file)))
    .sort((left, right) => left.localeCompare(right));
  const targets: string[] = [];

  for (const file of files) {
    const existing = records.find((record) => record[0] === file)?.[2];
    const patchName = existing ?? `${await nextWatchDogsPatchName(options.gamePath, options.installPath, [
      ...records,
      ...targets.map((target) => ["", "", basename(target)] as [string, string, string])
    ])}.${getExtension(file)}`;
    targets.push(safeJoin(options.gamePath, options.installPath, patchName));
  }

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function applyWatchDogsPatchStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  listFileName: string;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  let records = await readWatchDogsRecords(options.modRoot, options.listFileName);
  const files = (await listFiles(options.modRoot))
    .filter((file) => ["dat", "fat"].includes(getExtension(file)))
    .sort((left, right) => {
      const leftStem = basename(left).replace(/\.(dat|fat)$/iu, "");
      const rightStem = basename(right).replace(/\.(dat|fat)$/iu, "");
      return leftStem.localeCompare(rightStem) || getExtension(left).localeCompare(getExtension(right));
    });
  const patchByStem = new Map<string, string>();
  const deployed: string[] = [];

  for (const file of files) {
    const stem = basename(file).replace(/\.(dat|fat)$/iu, "");
    let record = records.find((item) => item[0] === file);

    if (options.isInstall) {
      if (!record) {
        const patchStem = patchByStem.get(stem) ?? await nextWatchDogsPatchName(options.gamePath, options.installPath, records);
        patchByStem.set(stem, patchStem);
        record = [file, basename(file), `${patchStem}.${getExtension(file)}`];
        records.push(record);
      }

      deployed.push(...await copyOrRemoveFile(
        join(options.modRoot, file),
        safeJoin(options.gamePath, options.installPath, record[2]),
        true,
        options.gamePath,
        options.useSymlink
      ));
    } else if (record) {
      await rm(safeJoin(options.gamePath, options.installPath, record[2]), { force: true });
      records = records.filter((item) => item !== record);
    }
  }

  await writeWatchDogsRecords(options.modRoot, options.listFileName, records);
  return deployed;
}

async function ensureMiChangShengModBin(gamePath: string) {
  const legacyTarget = safeJoin(gamePath, "本地Mod测试", ["G", "m", "m"].join(""), "Mod.bin");
  const target = safeJoin(gamePath, "本地Mod测试", "Mayfly", "Mod.bin");
  if (existsSync(legacyTarget)) return;
  if (existsSync(target)) return;

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from("0001000000ffffffff", "hex"));
}

async function planMiChangShengLinkedFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  rootFile: string;
}) {
  const files = await listFiles(options.modRoot);
  const folders = [...new Set(files
    .filter((file) => basename(file).toLowerCase() === options.rootFile.toLowerCase())
    .map((file) => dirname(file))
  )];

  return uniqueRelativeTargets(
    options.gamePath,
    folders.map((folder) => safeJoin(options.gamePath, options.installPath, basename(folder)))
  );
}

async function applyMiChangShengLinkedFolderStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  rootFile: string;
  isInstall: boolean;
}) {
  await ensureMiChangShengModBin(options.gamePath);
  const files = await listFiles(options.modRoot);
  const folders = [...new Set(files
    .filter((file) => basename(file).toLowerCase() === options.rootFile.toLowerCase())
    .map((file) => dirname(file))
  )];
  const deployed: string[] = [];

  for (const folder of folders) {
    const source = join(options.modRoot, folder);
    const target = safeJoin(options.gamePath, options.installPath, basename(folder));
    const deployedFolder = relative(options.gamePath, target).replace(/\\/g, "/");

    if (options.isInstall) {
      if (existsSync(target)) {
        throw new Error(`目标目录已存在，已阻止覆盖：${deployedFolder}`);
      }

      await mkdir(dirname(target), { recursive: true });
      await symlink(source, target, process.platform === "win32" ? "junction" : "dir");
      deployed.push(deployedFolder);
    } else {
      await rm(target, { recursive: true, force: true });
      await deleteEmptyParents(options.gamePath, dirname(target));
    }
  }

  return deployed;
}

function findLegendPortraitSourceFolders(files: string[], portraitFolders: string[]) {
  const portraitFolderSet = new Set(portraitFolders.map((folder) => folder.toLowerCase()));
  const folders = new Set<string>();

  for (const file of files) {
    const parts = normalizePathParts(file);
    const index = parts.findIndex((part) => portraitFolderSet.has(part.toLowerCase()));

    if (index === -1) continue;

    folders.add(parts.slice(0, index).join("/"));
  }

  return [...folders].filter(Boolean);
}

async function planLegendPortraitsStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  portraitFolders: string[];
}) {
  const files = await listFiles(options.modRoot);
  const folders = findLegendPortraitSourceFolders(files, options.portraitFolders);

  return uniqueRelativeTargets(
    options.gamePath,
    folders.map((folder) => safeJoin(options.gamePath, options.installPath, basename(folder)))
  );
}

async function applyLegendPortraitsStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  portraitFolders: string[];
  isInstall: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const folders = findLegendPortraitSourceFolders(files, options.portraitFolders);
  const deployed: string[] = [];

  for (const folder of folders) {
    const source = join(options.modRoot, folder);
    const target = safeJoin(options.gamePath, options.installPath, basename(folder));
    const deployedFolder = relative(options.gamePath, target).replace(/\\/g, "/");

    if (options.isInstall) {
      if (existsSync(target)) {
        throw new Error(`目标目录已存在，已阻止覆盖：${deployedFolder}`);
      }

      await mkdir(dirname(target), { recursive: true });
      await symlink(source, target, process.platform === "win32" ? "junction" : "dir");
      deployed.push(deployedFolder);
    } else {
      await rm(target, { recursive: true, force: true });
      await deleteEmptyParents(options.gamePath, dirname(target));
    }
  }

  return deployed;
}

async function applyInzoiModKitStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  isInstall: boolean;
}) {
  if (options.isInstall) {
    const files = await listFiles(options.modRoot);
    for (const file of files) {
      if (basename(file) !== "mod_manifest.json") continue;
      const manifestPath = join(options.modRoot, file);
      const data = JSON.parse(await readTextFile(manifestPath, "{}")) as Record<string, unknown>;
      data.bEnable = true;
      await writeTextFile(manifestPath, JSON.stringify(data, null, 4));
    }
  }

  return applyFileStrategy({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    installPath: options.installPath,
    fileName: "mod_manifest.json",
    commonParent: false,
    isInstall: options.isInstall
  });
}

function escapeXmlValue(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function unescapeXmlValue(value: string) {
  return value
    .replace(/&apos;/gu, "'")
    .replace(/&quot;/gu, "\"")
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}

function readXmlChildText(xml: string, tagName: string) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = xml.match(new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)</${escapedTag}>`, "iu"));
  return match ? unescapeXmlValue(match[1].trim()) : "";
}

function readXmlAttribute(xml: string, attributeName: string) {
  const escapedAttribute = attributeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = xml.match(new RegExp(`\\b${escapedAttribute}\\s*=\\s*["']([^"']*)["']`, "iu"));
  return match ? unescapeXmlValue(match[1].trim()) : "";
}

interface Bg3ModuleAttribute {
  id: string;
  type: string;
  value: string;
}

const BG3_DEFAULT_MODSETTINGS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<save>
    <version major="4" minor="0" revision="9" build="331" />
    <region id="ModuleSettings">
        <node id="root">
            <children>
                <node id="ModOrder">
                    <children />
                </node>
                <node id="Mods">
                    <children>
                    </children>
                </node>
            </children>
        </node>
    </region>
</save>`;

function bg3ModsNodePattern() {
  return /(<node\b(?=[^>]*\bid=["']Mods["'])[^>]*>\s*<children>)([\s\S]*?)(<\/children>\s*<\/node>)/iu;
}

function normalizeBg3SelfClosingChildren(xml: string) {
  return xml.replace(
    /(<node\b(?=[^>]*\bid=["']Mods["'])[^>]*>\s*)<children\s*\/>(\s*<\/node>)/iu,
    "$1<children>\n                    </children>$2"
  );
}

function bg3ModuleShortDescNodePattern() {
  return /<node\b(?=[^>]*\bid=["']ModuleShortDesc["'])[^>]*>[\s\S]*?<\/node>/giu;
}

function bg3AttributeXml(attribute: Bg3ModuleAttribute) {
  return `                    <attribute id="${escapeXmlValue(attribute.id)}" type="${escapeXmlValue(attribute.type)}" value="${escapeXmlValue(attribute.value)}" />`;
}

function bg3ModuleShortDescXml(attributes: Bg3ModuleAttribute[]) {
  return [
    "                <node id=\"ModuleShortDesc\">",
    ...attributes.map(bg3AttributeXml),
    "                </node>"
  ].join("\n");
}

function parseBg3ModuleAttributes(xml: string) {
  const moduleInfo = xml.match(/<node\b(?=[^>]*\bid=["']ModuleInfo["'])[^>]*>([\s\S]*?)<\/node>/iu)?.[1] ?? xml;

  return Array.from(moduleInfo.matchAll(/<attribute\b([^>]*)\/?>/giu))
    .map((match) => ({
      id: readXmlAttribute(match[1] ?? "", "id"),
      type: readXmlAttribute(match[1] ?? "", "type"),
      value: readXmlAttribute(match[1] ?? "", "value")
    }))
    .filter((attribute) => attribute.id && attribute.type);
}

function removeBg3ModuleShortDescByUuid(childrenXml: string, uuid: string) {
  return childrenXml.replace(bg3ModuleShortDescNodePattern(), (nodeXml) =>
    parseBg3ModuleAttributes(nodeXml).find((attribute) => attribute.id === "UUID")?.value === uuid ? "" : nodeXml
  );
}

function upsertBg3Modsettings(options: {
  xml: string;
  attributes: Bg3ModuleAttribute[];
  isInstall: boolean;
}) {
  const uuid = options.attributes.find((attribute) => attribute.id === "UUID")?.value;
  if (!uuid) return options.xml;

  const normalizedXml = normalizeBg3SelfClosingChildren(options.xml);
  const sourceXml = bg3ModsNodePattern().test(normalizedXml)
    ? normalizedXml
    : BG3_DEFAULT_MODSETTINGS_XML;

  return sourceXml.replace(bg3ModsNodePattern(), (_match, open: string, children: string, close: string) => {
    const filteredChildren = removeBg3ModuleShortDescByUuid(children, uuid).trimEnd();
    const nextChildren = options.isInstall
      ? `${filteredChildren}${filteredChildren ? "\n" : "\n"}${bg3ModuleShortDescXml(options.attributes)}\n            `
      : `${filteredChildren}${filteredChildren ? "\n            " : ""}`;

    return `${open}${nextChildren}${close}`;
  });
}

function resolveManagedToolCandidate(candidates: string[] | undefined, fileName: string) {
  const normalizedFileName = fileName.toLowerCase();

  for (const candidate of candidates ?? []) {
    if (basename(candidate).toLowerCase() === normalizedFileName && existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function loadBg3ModDataFromPak(assemblyPath: string, pakPath: string) {
  const xml = await invokeManagedTool<string>({
    assemblyPath,
    typeName: "BaldursGate3.Program",
    methodName: "LoadModDataFromPakAsync",
    payload: pakPath
  });

  return parseBg3ModuleAttributes(String(xml || ""))
    .filter((attribute) => [
      "Folder",
      "MD5",
      "Name",
      "UUID",
      "Version64",
      "PublishHandle"
    ].includes(attribute.id));
}

async function applyBg3PakStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  managedToolFileName: string;
  managedToolCandidates?: string[];
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const files = (await listFiles(options.modRoot)).filter((file) => getExtension(file) === "pak");
  if (files.length === 0) return [];

  const toolPath = resolveManagedToolCandidate(options.managedToolCandidates, options.managedToolFileName);
  if (!toolPath) {
    throw new Error(`未找到博德之门3前置工具 ${options.managedToolFileName}，请先把该工具 Mod 导入当前游戏。`);
  }

  const modsettingsPath = safeJoin(
    options.gamePath,
    "Local",
    "Larian Studios",
    "Baldur's Gate 3",
    "PlayerProfiles",
    "Public",
    "modsettings.lsx"
  );
  let modsettingsXml = await readTextFile(modsettingsPath, BG3_DEFAULT_MODSETTINGS_XML);
  const deployed: string[] = [];

  for (const file of files) {
    const source = join(options.modRoot, file);
    const metadata = await loadBg3ModDataFromPak(toolPath, source);
    const uuid = metadata.find((attribute) => attribute.id === "UUID")?.value;

    if (!uuid) {
      throw new Error(`无法从 ${basename(file)} 读取 BG3 Mod UUID。`);
    }

    deployed.push(...await copyOrRemoveFile(
      source,
      safeJoin(options.gamePath, options.installPath, basename(file)),
      options.isInstall,
      options.gamePath,
      options.useSymlink
    ));
    modsettingsXml = upsertBg3Modsettings({
      xml: modsettingsXml,
      attributes: metadata,
      isInstall: options.isInstall
    });
  }

  await writeTextFile(modsettingsPath, modsettingsXml.trimEnd() + "\n");
  return deployed;
}

function redDeadDefaultModsXml() {
  return "<ModsManager><Mods /><LoadOrder /></ModsManager>";
}

function parseRedDeadModsXml(raw: string) {
  const source = raw.trim() || redDeadDefaultModsXml();
  const modsBlock = source.match(/<Mods\b[^>]*>([\s\S]*?)<\/Mods>/iu)?.[1] ?? "";
  const loadOrderBlock = source.match(/<LoadOrder\b[^>]*>([\s\S]*?)<\/LoadOrder>/iu)?.[1] ?? "";
  const mods = new Map<string, {
    folder: string;
    name: string;
    enabled: string;
    overwrite: string;
    disabledGroups: string;
  }>();
  const modMatches = modsBlock.matchAll(/<Mod\b([^>]*)>([\s\S]*?)<\/Mod>/giu);

  for (const match of modMatches) {
    const folder = readXmlAttribute(match[1] ?? "", "folder");
    if (!folder) continue;

    const body = match[2] ?? "";
    mods.set(folder, {
      folder,
      name: readXmlChildText(body, "Name") || folder,
      enabled: readXmlChildText(body, "Enabled") || "false",
      overwrite: readXmlChildText(body, "Overwrite") || "false",
      disabledGroups: readXmlChildText(body, "DisabledGroups")
    });
  }

  const loadOrder = Array.from(loadOrderBlock.matchAll(/<Mod\b[^>]*>([\s\S]*?)<\/Mod>/giu))
    .map((match) => unescapeXmlValue((match[1] ?? "").trim()))
    .filter(Boolean);

  return { mods, loadOrder };
}

function serializeRedDeadModsXml(data: ReturnType<typeof parseRedDeadModsXml>) {
  const mods = Array.from(data.mods.values())
    .map((mod) => [
      `        <Mod folder="${escapeXmlValue(mod.folder)}">`,
      `            <Name>${escapeXmlValue(mod.name)}</Name>`,
      `            <Enabled>${escapeXmlValue(mod.enabled)}</Enabled>`,
      `            <Overwrite>${escapeXmlValue(mod.overwrite)}</Overwrite>`,
      `            <DisabledGroups>${escapeXmlValue(mod.disabledGroups)}</DisabledGroups>`,
      "        </Mod>"
    ].join("\n"))
    .join("\n");
  const loadOrder = [...new Set(data.loadOrder)]
    .map((folder) => `        <Mod>${escapeXmlValue(folder)}</Mod>`)
    .join("\n");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<ModsManager>",
    "    <Mods>",
    mods,
    "    </Mods>",
    "    <LoadOrder>",
    loadOrder,
    "    </LoadOrder>",
    "</ModsManager>"
  ].filter((line) => line !== "").join("\n") + "\n";
}

async function updateRedDeadInstallXml(options: {
  gamePath: string;
  installXmlPath: string;
  isInstall: boolean;
}) {
  const installXml = await readTextFile(options.installXmlPath);
  const folder = basename(dirname(options.installXmlPath));
  const name = readXmlChildText(installXml, "Name") || folder;
  const modsXmlPath = safeJoin(options.gamePath, "lml", "mods.xml");
  const modsXml = parseRedDeadModsXml(await readTextFile(modsXmlPath, redDeadDefaultModsXml()));
  const current = modsXml.mods.get(folder);

  modsXml.mods.set(folder, {
    folder,
    name: current?.name || name,
    enabled: String(options.isInstall),
    overwrite: current?.overwrite || "false",
    disabledGroups: current?.disabledGroups || ""
  });

  if (!modsXml.loadOrder.includes(folder)) {
    modsXml.loadOrder.push(folder);
  }

  await writeTextFile(modsXmlPath, serializeRedDeadModsXml(modsXml));
}

async function updateAllRedDeadInstallXml(options: {
  modRoot: string;
  gamePath: string;
  isInstall: boolean;
}) {
  const files = await listFiles(options.modRoot);
  const installXmlFiles = files.filter((file) => basename(file).toLowerCase() === "install.xml");

  for (const file of installXmlFiles) {
    await updateRedDeadInstallXml({
      gamePath: options.gamePath,
      installXmlPath: join(options.modRoot, file),
      isInstall: options.isInstall
    });
  }

  return installXmlFiles;
}

function redDeadInstallXmlFolders(modRoot: string, installXmlFiles: string[]) {
  return [...new Set(installXmlFiles.map((file) => dirname(file) || "."))].map((folder) => ({
    relativeFolder: folder,
    sourceFolder: folder === "." ? modRoot : join(modRoot, folder),
    targetFolderName: folder === "." ? sanitizeFileName(basename(modRoot)) : basename(folder)
  }));
}

async function planRedDeadLmlStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
}) {
  const files = await listFiles(options.modRoot);
  const folders = redDeadInstallXmlFolders(
    options.modRoot,
    files.filter((file) => basename(file).toLowerCase() === "install.xml")
  );
  const targets: string[] = [];

  for (const folder of folders) {
    const folderFiles = await listFiles(folder.sourceFolder);
    for (const file of folderFiles) {
      if (isPassFile(file)) continue;
      targets.push(safeJoin(options.gamePath, options.installPath, folder.targetFolderName, file));
    }
  }

  return uniqueRelativeTargets(options.gamePath, targets);
}

async function applyRedDeadLmlStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  const installXmlFiles = await updateAllRedDeadInstallXml({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    isInstall: options.isInstall
  });
  const folders = redDeadInstallXmlFolders(options.modRoot, installXmlFiles);
  const deployed: string[] = [];

  if (folders.length === 0) {
    throw new Error("未找到 RDR2 LML 需要的 install.xml。");
  }

  for (const folder of folders) {
    const folderFiles = await listFiles(folder.sourceFolder);
    for (const file of folderFiles) {
      if (isPassFile(file)) continue;
      deployed.push(...await copyOrRemoveFile(
        join(folder.sourceFolder, file),
        safeJoin(options.gamePath, options.installPath, folder.targetFolderName, file),
        options.isInstall,
        options.gamePath,
        options.useSymlink
      ));
    }
  }

  return deployed;
}

async function applyRedDeadAsiStrategy(options: {
  modRoot: string;
  gamePath: string;
  installPath: string;
  fileName: string;
  isExtname?: boolean;
  isInstall: boolean;
  useSymlink?: boolean;
}) {
  await updateAllRedDeadInstallXml({
    modRoot: options.modRoot,
    gamePath: options.gamePath,
    isInstall: options.isInstall
  });

  return applyFileSiblingStrategy(options);
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
      { name: "Mod packages", extensions: [...ARCHIVE_EXTENSIONS, "rar", "7z"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});

electron.ipcMain.handle("dialog:openModSource", async () => {
  const result = await electron.dialog.showOpenDialog({
    properties: ["openFile", "openDirectory", "multiSelections"],
    filters: [
      { name: "Mod packages", extensions: [...ARCHIVE_EXTENSIONS, "rar", "7z"] },
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
  const url = new URL(targetUrl);
  if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
    throw new Error("不支持打开此链接。");
  }
  await electron.shell.openExternal(targetUrl);
  return true;
});

electron.ipcMain.handle("net:fetchJson", async (_event, options: {
  url: string;
  proxyUrl?: string;
}) => fetchRemoteJson(options));

electron.ipcMain.handle("shell:fileUrl", async (_event, targetPath: string) => {
  if (!targetPath) return "";
  const resolvedPath = resolve(targetPath);
  const mimeTypes: Record<string, string> = {
    bmp: "image/bmp",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp"
  };
  const mimeType = mimeTypes[getPathExtension(resolvedPath)];

  if (mimeType && existsSync(resolvedPath)) {
    const imageData = await readFile(resolvedPath);
    return `data:${mimeType};base64,${imageData.toString("base64")}`;
  }

  return pathToFileURL(resolvedPath).toString();
});

electron.ipcMain.handle("app:openDevTools", async () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools();
  }
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

electron.ipcMain.handle("app:checkUpdate", async (_event, options: {
  updateUrl: string;
  currentVersion?: string;
  proxyUrl?: string;
}) => checkAppUpdate(options));

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

electron.ipcMain.handle("translate:text", async (_event, options: {
  text: string;
  provider?: string;
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
}) => enqueueTranslation(() =>
  translateTextByProvider({
    ...options,
    text: String(options.text || ""),
    targetLang: "zh-CN",
    sourceLang: options.sourceLang || "auto"
  })
));

electron.ipcMain.handle("nexus:startOAuthLogin", async (_event, options?: {
  proxyUrl?: string;
}) => startNexusOAuthLogin(options?.proxyUrl ?? ""));

electron.ipcMain.handle("nexus:cancelOAuthLogin", async () => {
  if (!activeNexusOAuth) return false;

  activeNexusOAuth.finish(new Error("已取消 Nexus 网页登录。"));
  return true;
});

electron.ipcMain.handle("nexus:validateApiKey", async (_event, options: string | {
  apiKey: string;
  proxyUrl?: string;
}) => {
  const apiKey = typeof options === "string" ? options : options.apiKey;
  const proxyUrl = typeof options === "string" ? "" : options.proxyUrl;
  const response = await fetchWithProxy(`${NEXUS_API_URL}/v1/users/validate.json`, {
    method: "GET",
    headers: nexusHeaders({ apiKey }, true),
    proxyUrl
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
    query ModsListing($count: Int = 0, $facets: ModsFacet, $filter: ModsFilter, $offset: Int, $sort: [ModsSort!]) {
      mods(count: $count, facets: $facets, filter: $filter, offset: $offset, sort: $sort, viewUserBlockedContent: false) {
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
    facets: {
      categoryName: options.facets?.categoryName ? [options.facets.categoryName] : [],
      languageName: options.facets?.languageName ? [options.facets.languageName] : [],
      tag: options.facets?.tag ? [options.facets.tag] : []
    },
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
        : {})
    }
  };
  const response = await fetchWithProxy(NEXUS_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...nexusHeaders({
        apiKey: options.apiKey,
        accessToken: options.accessToken
      }, true)
    },
    body: JSON.stringify({ query: gql, variables }),
    proxyUrl: options.proxyUrl
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
  accessToken?: string;
  gameDomain: string;
  modId: string;
  proxyUrl?: string;
}) => {
  const gameDomain = options.gameDomain.trim();
  const modId = options.modId.trim();
  const headers = nexusHeaders({
    apiKey: options.apiKey,
    accessToken: options.accessToken
  }, true);
  const detailResponse = await fetchWithProxy(`${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}.json`, {
    method: "GET",
    headers,
    proxyUrl: options.proxyUrl
  });
  const detail = await readJsonResponse<Record<string, unknown>>(detailResponse, "获取 NexusMods Mod 详情失败。");
  const filesResponse = await fetchWithProxy(`${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}/files.json`, {
    method: "GET",
    headers,
    proxyUrl: options.proxyUrl
  });
  const filesPayload = await readJsonResponse<{
    files?: Array<Record<string, unknown>>;
  }>(filesResponse, "获取 NexusMods 文件列表失败。");
  const imagesResponse = await fetchWithProxy(`${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}/images.json`, {
    method: "GET",
    headers,
    proxyUrl: options.proxyUrl
  });
  const imagesPayload = await imagesResponse.json().catch(() => []) as Array<Record<string, unknown>> | { images?: Array<Record<string, unknown>> };
  const images = Array.isArray(imagesPayload)
    ? imagesPayload
    : Array.isArray(imagesPayload.images)
      ? imagesPayload.images
      : [];

  return normalizeNexusDetail(detail, filesPayload.files ?? [], imagesResponse.ok ? images : [], gameDomain);
});

electron.ipcMain.handle("nexus:getDownloadUrl", async (_event, options: {
  apiKey: string;
  accessToken?: string;
  gameDomain: string;
  modId: string;
  fileId: string;
  proxyUrl?: string;
  key?: string;
  expires?: string;
}) => {
  const gameDomain = options.gameDomain.trim();
  const modId = options.modId.trim();
  const fileId = options.fileId.trim();
  const downloadLinkUrl = new URL(
    `${NEXUS_API_URL}/v1/games/${gameDomain}/mods/${modId}/files/${fileId}/download_link.json`
  );
  const nexusDownloadKey = options.key?.trim();
  const nexusDownloadExpires = options.expires?.trim();

  if (nexusDownloadKey) {
    downloadLinkUrl.searchParams.set("key", nexusDownloadKey);

    if (nexusDownloadExpires) {
      downloadLinkUrl.searchParams.set("expires", nexusDownloadExpires);
    }
  }

  const response = await fetchWithProxy(downloadLinkUrl, {
    method: "GET",
    headers: nexusHeaders({
      apiKey: options.apiKey,
      accessToken: options.accessToken
    }, true),
    proxyUrl: options.proxyUrl
  });
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

function totalBytesFromHeaders(headers: Headers, startingBytes: number, receivedBytes: number) {
  const contentRange = headers.get("content-range") ?? "";
  const rangeTotal = contentRange.match(/\/(\d+)$/u)?.[1];
  if (rangeTotal) return Number(rangeTotal);

  const contentLength = Number(headers.get("content-length") ?? 0);
  if (contentLength > 0) return startingBytes + contentLength;

  return receivedBytes;
}

electron.ipcMain.handle("downloads:downloadFile", async (_event, options: {
  taskId?: string;
  url: string;
  outputPath: string;
  resume?: boolean;
  proxyUrl?: string;
  engine?: "builtin" | "aria2";
  aria2ExecutablePath?: string;
  aria2MaxConnections?: number;
}) => {
  if (process.platform === "darwin" && options.engine === "aria2") {
    throw new Error("aria2 is not available in the macOS build; use the built-in downloader.");
  }

  if (options.engine === "aria2") {
    return downloadWithAria2({
      taskId: options.taskId,
      url: options.url,
      outputPath: options.outputPath,
      resume: options.resume,
      aria2ExecutablePath: options.aria2ExecutablePath,
      aria2MaxConnections: options.aria2MaxConnections
    });
  }

  const taskId = options.taskId?.trim();
  const controller = new AbortController();
  let startingBytes = 0;

  if (taskId) {
    downloadControllers.get(taskId)?.abort();
    downloadControllers.set(taskId, controller);
  }

  if (options.resume && existsSync(options.outputPath)) {
    const outputStat = await stat(options.outputPath);
    startingBytes = outputStat.size;
  }

  let response: Response;
  try {
    response = await fetchWithProxy(options.url, {
      signal: controller.signal,
      headers: {
        "user-agent": "mayflyMods",
        ...(startingBytes > 0 ? { range: `bytes=${startingBytes}-` } : {})
      },
      proxyUrl: options.proxyUrl
    });
  } catch (caught) {
    if (taskId && downloadControllers.get(taskId) === controller) {
      downloadControllers.delete(taskId);
    }
    throw caught;
  }

  if (!response.ok || !response.body) {
    if (taskId && downloadControllers.get(taskId) === controller) {
      downloadControllers.delete(taskId);
    }
    throw new Error(`下载失败：HTTP ${response.status}`);
  }

  const shouldAppend = startingBytes > 0 && response.status === 206;
  if (startingBytes > 0 && !shouldAppend) {
    startingBytes = 0;
  }

  await mkdir(dirname(options.outputPath), { recursive: true });
  const file = await open(options.outputPath, shouldAppend ? "a" : "w");
  let receivedBytes = startingBytes;

  try {
    const reader = response.body.getReader();
    let lastReportTime = 0;
    const totalBytes = totalBytesFromHeaders(response.headers, startingBytes, receivedBytes);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      await file.write(Buffer.from(value));

      const now = Date.now();
      if (taskId && mainWindow && now - lastReportTime > 250) {
        mainWindow.webContents.send("downloads:progress", {
          taskId,
          receivedBytes,
          totalBytes: totalBytes || receivedBytes
        });
        lastReportTime = now;
      }
    }
  } finally {
    await file.close();
    if (taskId && downloadControllers.get(taskId) === controller) {
      downloadControllers.delete(taskId);
    }
  }

  return {
    outputPath: options.outputPath,
    receivedBytes,
    totalBytes: totalBytesFromHeaders(response.headers, startingBytes, receivedBytes) || receivedBytes
  };
});

electron.ipcMain.handle("downloads:cancel", async (_event, taskId: string) => {
  const aria2Task = aria2Tasks.get(taskId);
  if (aria2Task && aria2Runtime) {
    aria2Task.cancelled = true;
    await aria2Rpc(aria2Runtime, "aria2.forceRemove", [aria2Task.gid]).catch(() => undefined);
    return true;
  }

  const controller = downloadControllers.get(taskId);
  if (!controller) return false;

  controller.abort();
  downloadControllers.delete(taskId);
  return true;
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

electron.ipcMain.handle("package:exportMods", async (event, options: {
  mods: Array<{
    rootPath: string;
    folderName: string;
  }>;
  manifest: Record<string, unknown>;
  outputPath: string;
  operationId?: string;
}) => {
  const output = resolve(options.outputPath);
  const operationId = options.operationId || randomUUID();
  await mkdir(dirname(output), { recursive: true });

  if (existsSync(output)) {
    throw new Error("导出失败：目标文件已存在，请换一个文件名。");
  }

  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(options.manifest, null, 2), "utf-8"));
  const report = (payload: Omit<PackageProgressPayload, "operationId" | "operation">) => {
    sendPackageProgress(event.sender, {
      operationId,
      operation: "export",
      ...payload
    });
  };

  report({
    phase: "准备中",
    current: 0,
    total: options.mods.length,
    message: "正在扫描 Mod 文件..."
  });
  await yieldToRenderer();

  const scannedMods: Array<{
    rootPath: string;
    folderName: string;
    files: string[];
  }> = [];

  for (let index = 0; index < options.mods.length; index += 1) {
    const mod = options.mods[index];
    const rootPath = resolve(mod.rootPath);
    const folderName = sanitizeFileName(mod.folderName);

    const files = existsSync(rootPath) ? await listFiles(rootPath) : [];
    scannedMods.push({ rootPath, folderName, files });
    report({
      phase: "扫描文件",
      current: index + 1,
      total: Math.max(options.mods.length, 1),
      message: `正在扫描 Mod ${index + 1} / ${options.mods.length}`
    });
    await yieldToRenderer();
  }

  const totalFiles = scannedMods.reduce((total, mod) => total + mod.files.length, 0);
  const progressTotal = Math.max(totalFiles, 1);
  let processedFiles = 0;
  let lastReportAt = 0;

  report({
    phase: "写入文件",
    current: 0,
    total: progressTotal,
    message: "正在写入整合包..."
  });
  await yieldToRenderer();

  for (const mod of scannedMods) {
    for (const file of mod.files) {
      const sourcePath = resolve(mod.rootPath, file);
      const entryPath = join(mod.folderName, file).replace(/\\/g, "/");
      zip.addFile(entryPath, await readFile(sourcePath));
      processedFiles += 1;

      const now = Date.now();
      if (processedFiles === totalFiles || now - lastReportAt >= 100) {
        report({
          phase: "写入文件",
          current: processedFiles,
          total: progressTotal,
          message: `已写入 ${processedFiles} / ${totalFiles || 0} 个文件`
        });
        lastReportAt = now;
        await yieldToRenderer();
      }
    }
  }

  report({
    phase: "压缩中",
    current: progressTotal,
    total: progressTotal,
    message: "正在生成压缩文件..."
  });
  await yieldToRenderer();
  zip.writeZip(output);
  const outputStat = await stat(output);
  report({
    phase: "完成",
    current: progressTotal,
    total: progressTotal,
    message: "整合包导出完成"
  });

  return {
    outputPath: output,
    size: outputStat.size
  };
});

electron.ipcMain.handle("package:readManifest", async (_event, packagePath: string) => {
  const zip = new AdmZip(resolve(packagePath));
  const manifestEntry = zip.getEntry("manifest.json");

  if (!manifestEntry) {
    throw new Error("整合包缺少 manifest.json。");
  }

  return JSON.parse(manifestEntry.getData().toString("utf-8")) as Record<string, unknown>;
});

electron.ipcMain.handle("package:importGamePack", async (event, options: {
  packagePath: string;
  storagePath: string;
  gameName: string;
  overwrite?: boolean;
  operationId?: string;
}) => {
  const packagePath = resolve(options.packagePath);
  const gameRoot = join(resolve(options.storagePath), "mods", sanitizeFileName(options.gameName));
  const operationId = options.operationId || randomUUID();
  const zip = new AdmZip(packagePath);
  const manifestEntry = zip.getEntry("manifest.json");

  if (!manifestEntry) {
    throw new Error("整合包缺少 manifest.json。");
  }

  const manifest = JSON.parse(manifestEntry.getData().toString("utf-8")) as {
    format?: string;
    mods?: Array<Record<string, unknown>>;
  };

  if (manifest.format !== "mayfly-game-pack" || !Array.isArray(manifest.mods)) {
    throw new Error("这不是 Mayfly 游戏整合包。");
  }

  const report = (payload: Omit<PackageProgressPayload, "operationId" | "operation">) => {
    sendPackageProgress(event.sender, {
      operationId,
      operation: "import",
      ...payload
    });
  };

  const fileEntries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const entriesByFolder = new Map<string, typeof fileEntries>();
  for (const entry of fileEntries) {
    const separatorIndex = entry.entryName.indexOf("/");
    if (separatorIndex <= 0) continue;

    const folder = sanitizeFileName(entry.entryName.slice(0, separatorIndex));
    const folderEntries = entriesByFolder.get(folder) ?? [];
    folderEntries.push(entry);
    entriesByFolder.set(folder, folderEntries);
  }

  const validMods = manifest.mods
    .map((mod) => sanitizeFileName(String(mod.folder || mod.id || mod.name || "")))
    .filter((folder) => Boolean(folder) && (entriesByFolder.get(folder)?.length ?? 0) > 0);
  const totalFiles = validMods.reduce(
    (total, folder) => total + (entriesByFolder.get(folder)?.length ?? 0),
    0
  );
  const progressTotal = Math.max(totalFiles, 1);
  let processedFiles = 0;
  let lastReportAt = 0;

  report({
    phase: "准备中",
    current: 0,
    total: progressTotal,
    message: `准备导入 ${validMods.length} 个 Mod...`
  });
  await yieldToRenderer();

  await mkdir(gameRoot, { recursive: true });
  const importedMods: Array<{ folder: string; rootPath: string; files: string[]; coverImage?: string }> = [];

  for (const mod of manifest.mods) {
    const folder = sanitizeFileName(String(mod.folder || mod.id || mod.name || ""));
    if (!folder) continue;

    const prefix = `${folder}/`;
    const rootPath = safeJoin(gameRoot, folder);
    const entries = (entriesByFolder.get(folder) ?? []).filter((entry) =>
      entry.entryName.startsWith(prefix) && !entry.entryName.includes("..")
    );

    if (entries.length === 0) continue;

    if (existsSync(rootPath)) {
      if (!options.overwrite) {
        throw new Error(`整合包恢复失败：目标 Mod 目录已存在：${folder}`);
      }

      await rm(rootPath, { recursive: true, force: true });
    }

    for (const entry of entries) {
      const relativeEntry = entry.entryName.slice(prefix.length);
      if (!relativeEntry) continue;
      const target = safeJoin(rootPath, relativeEntry);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.getData());
      processedFiles += 1;

      const now = Date.now();
      if (processedFiles === totalFiles || now - lastReportAt >= 100) {
        report({
          phase: "写入文件",
          current: processedFiles,
          total: progressTotal,
          message: `已导入 ${processedFiles} / ${totalFiles || 0} 个文件`
        });
        lastReportAt = now;
        await yieldToRenderer();
      }
    }

    const files = await listFiles(rootPath);
    importedMods.push({
      folder,
      rootPath,
      files,
      coverImage: findCoverImage(files)
    });
  }

  report({
    phase: "完成",
    current: progressTotal,
    total: progressTotal,
    message: `已导入 ${importedMods.length} 个 Mod`
  });

  return {
    manifest,
    mods: importedMods
  };
});

electron.ipcMain.handle("mods:importFolder", async (_event, options: {
  sourcePath: string;
  storagePath: string;
  gameId: string;
  gameName?: string;
  modId: string;
}) => {
  const sourceStat = await stat(options.sourcePath);
  const gameFolderName = sanitizeFileName(options.gameName || options.gameId);
  const modRoot = join(options.storagePath, "mods", gameFolderName, options.modId);
  await mkdir(modRoot, { recursive: true });

  if (sourceStat.isDirectory()) {
    await cp(options.sourcePath, modRoot, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  } else if (ARCHIVE_EXTENSIONS.includes(getPathExtension(options.sourcePath))) {
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

electron.ipcMain.handle("mods:copyCoverImage", async (_event, options: {
  sourcePath: string;
  modRoot: string;
}) => {
  const sourcePath = resolve(options.sourcePath);
  const modRoot = resolve(options.modRoot);
  const sourceStat = await stat(sourcePath);

  if (!sourceStat.isFile()) {
    throw new Error("预览图必须是图片文件。");
  }

  const extension = getPathExtension(sourcePath);
  if (!["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(extension)) {
    throw new Error("预览图只支持 JPG、PNG、WEBP、GIF 或 BMP 图片。");
  }

  const metadataRoot = safeJoin(modRoot, MOD_PREVIEW_FOLDER);
  await mkdir(metadataRoot, { recursive: true });

  for (const entry of await readdir(metadataRoot, { withFileTypes: true })) {
    if (entry.isFile() && /^cover\./iu.test(entry.name)) {
      await rm(join(metadataRoot, entry.name), { force: true });
    }
  }

  const targetPath = safeJoin(metadataRoot, `cover.${extension}`);
  await copyFile(sourcePath, targetPath);

  return {
    coverImage: `${MOD_PREVIEW_FOLDER}/cover.${extension}`
  };
});

electron.ipcMain.handle("mods:migrateCoverImage", async (_event, options: {
  modRoot: string;
  coverImage: string;
}) => {
  const currentCover = options.coverImage.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!/^\.mayfly\/preview\./iu.test(currentCover)) {
    return { coverImage: options.coverImage };
  }

  const sourcePath = safeJoin(resolve(options.modRoot), currentCover);
  if (!existsSync(sourcePath)) {
    return { coverImage: options.coverImage };
  }

  const extension = getPathExtension(sourcePath);
  const targetRoot = safeJoin(resolve(options.modRoot), MOD_PREVIEW_FOLDER);
  const targetPath = safeJoin(targetRoot, `cover.${extension}`);
  await mkdir(targetRoot, { recursive: true });
  await copyFile(sourcePath, targetPath);
  await rm(safeJoin(resolve(options.modRoot), ".mayfly"), { recursive: true, force: true });

  return {
    coverImage: `${MOD_PREVIEW_FOLDER}/cover.${extension}`
  };
});

electron.ipcMain.handle("mods:migrateCacheFolder", async (_event, options: {
  sourcePath: string;
  storagePath: string;
  gameName: string;
  folderName: string;
}) => {
  const sourceRoot = resolve(options.sourcePath);
  const targetRoot = join(
    resolve(options.storagePath),
    "mods",
    sanitizeFileName(options.gameName),
    sanitizeFileName(options.folderName)
  );

  if (!existsSync(sourceRoot)) {
    throw new Error("旧 Mod 缓存目录不存在，无法迁移。");
  }

  if (resolve(sourceRoot) !== resolve(targetRoot)) {
    if (existsSync(targetRoot)) {
      throw new Error(`目标缓存目录已存在，无法迁移：${targetRoot}`);
    }

    await mkdir(dirname(targetRoot), { recursive: true });
    await cp(sourceRoot, targetRoot, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
    await rm(sourceRoot, { recursive: true, force: true });
  }

  const files = await listFiles(targetRoot);

  return {
    rootPath: targetRoot,
    files,
    manifest: await readManifest(targetRoot, files),
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
  targetFolderName?: string;
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
    targetScope?: InstallTargetScope;
    documentsGameFolder?: string;
    iniFileName?: string;
    localAppDataGameFolder?: string;
    pluginsHeader?: string;
    updateGeneralTestFiles?: boolean;
    extension?: string;
    prefix?: string;
    startIndex?: number;
    listFileName?: string;
    rootFile?: string;
    portraitFolders?: string[];
    managedToolFileName?: string;
    reason?: string;
  };
  useSymlink?: boolean;
}) => {
  const installPath = options.strategy.installPath ?? "";
  const targetScope = normalizeTargetScope(options.strategy.targetScope);
  assertPlatformInstallStrategy(process.platform, options.strategy.kind, targetScope);
  const targetRoot = getTargetScopeRoot(options.gamePath, targetScope);
  let targetFiles: string[] = [];

  switch (options.strategy.kind) {
    case "general":
      targetFiles = await planGeneralStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        keepPath: options.strategy.keepPath
      });
      break;
    case "folder":
      targetFiles = await planFolderStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        folderName: options.strategy.folderName ?? "",
        include: options.strategy.include,
        spare: options.strategy.spare
      });
      break;
    case "folderRoot":
      targetFiles = await planFolderRootStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        targetFolderName: options.targetFolderName
      });
      break;
    case "file":
      targetFiles = await planFileStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname,
        useSymlink: options.useSymlink
      });
      break;
    case "fileSibling":
      targetFiles = await planFileSiblingStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname,
        pass: options.strategy.pass
      });
      break;
    case "fileOnly":
      targetFiles = await planFileOnlyStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname
      });
      break;
    case "folderParent":
      targetFiles = await planFolderParentStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        folderName: options.strategy.folderName ?? "",
        useSymlink: options.useSymlink
      });
      break;
    case "fileMap":
      targetFiles = await planFileMapStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        dictionaryFile: options.strategy.dictionaryFile ?? ""
      });
      break;
    case "fileIntoParentFolder":
      targetFiles = await planFileIntoParentFolderStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: options.strategy.fileName ?? "",
        isExtname: options.strategy.isExtname,
        requireParent: options.strategy.requireParent
      });
      break;
    case "bethesdaData":
      targetFiles = await planBethesdaDataStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        folderName: options.strategy.folderName ?? ""
      });
      break;
    case "bethesdaPluginFiles":
      targetFiles = await planBethesdaPluginFilesStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath
      });
      break;
    case "oblivionPlugins":
      targetFiles = await planOblivionPluginsStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath
      });
      break;
    case "noMansSkyMods":
      targetFiles = await planGeneralStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        keepPath: options.strategy.keepPath
      });
      break;
    case "numberedPak":
      targetFiles = await planNumberedPakStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        extension: options.strategy.extension ?? "pak",
        prefix: options.strategy.prefix ?? "data",
        startIndex: options.strategy.startIndex ?? 2,
        listFileName: options.strategy.listFileName ?? "pakList.txt"
      });
      break;
    case "watchDogsPatch":
      targetFiles = await planWatchDogsPatchStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        listFileName: options.strategy.listFileName ?? "pakList.txt"
      });
      break;
    case "michangshengLinkedFolder":
      targetFiles = await planMiChangShengLinkedFolderStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        rootFile: options.strategy.rootFile ?? "mod.bin"
      });
      break;
    case "michangshengDllPlugins":
      targetFiles = await planFileOnlyStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: "dll",
        isExtname: true
      });
      break;
    case "legendPortraits":
      targetFiles = await planLegendPortraitsStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        portraitFolders: options.strategy.portraitFolders ?? []
      });
      break;
    case "inzoiModKit":
      targetFiles = await planFileStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: "mod_manifest.json"
      });
      break;
    case "bg3Pak":
      targetFiles = await planFileOnlyStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: "pak",
        isExtname: true
      });
      break;
    case "redDeadAsi":
      targetFiles = await planFileSiblingStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath,
        fileName: options.strategy.fileName ?? "asi",
        isExtname: options.strategy.isExtname
      });
      break;
    case "redDeadLml":
      targetFiles = await planRedDeadLmlStrategy({
        modRoot: options.modRoot,
        gamePath: targetRoot,
        installPath
      });
      break;
    case "manual":
      throw new Error(options.strategy.reason || "该 Mod 类型需要手动安装。");
    default:
      throw new Error(`未知安装策略: ${options.strategy.kind}`);
  }

  return {
    targetFiles: targetFiles.map((file) => formatScopedFile(targetScope, file)),
    conflicts: options.useSymlink && options.strategy.kind === "folderRoot"
      ? []
      : targetFiles
        .filter((file) => existsSync(safeJoin(targetRoot, file)))
        .map((file) => formatScopedFile(targetScope, file))
  };
});

electron.ipcMain.handle("mods:applyStrategy", async (_event, options: {
  modRoot: string;
  gamePath: string;
  targetFolderName?: string;
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
    targetScope?: InstallTargetScope;
    documentsGameFolder?: string;
    iniFileName?: string;
    localAppDataGameFolder?: string;
    pluginsHeader?: string;
    updateGeneralTestFiles?: boolean;
    extension?: string;
    prefix?: string;
    startIndex?: number;
    listFileName?: string;
    rootFile?: string;
    portraitFolders?: string[];
    managedToolFileName?: string;
    reason?: string;
  };
  isInstall: boolean;
  useSymlink?: boolean;
  managedToolCandidates?: string[];
}) => {
  const installPath = options.strategy.installPath ?? "";
  const targetScope = normalizeTargetScope(options.strategy.targetScope);
  assertPlatformInstallStrategy(process.platform, options.strategy.kind, targetScope);
  const targetRoot = getTargetScopeRoot(options.gamePath, targetScope);
  let deployedFiles: string[] = [];

  try {
    switch (options.strategy.kind) {
      case "general":
        deployedFiles = await applyGeneralStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          keepPath: options.strategy.keepPath,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "folder":
        deployedFiles = await applyFolderStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          folderName: Array.isArray(options.strategy.folderName)
            ? (options.strategy.folderName[0] ?? "")
            : (options.strategy.folderName ?? ""),
          include: options.strategy.include,
          spare: options.strategy.spare,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "folderRoot":
        deployedFiles = await applyFolderRootStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          targetFolderName: options.targetFolderName,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "file":
        deployedFiles = await applyFileStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          commonParent: options.strategy.commonParent,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "fileSibling":
        deployedFiles = await applyFileSiblingStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          pass: options.strategy.pass,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "fileOnly":
        deployedFiles = await applyFileOnlyStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "folderParent":
        deployedFiles = await applyFolderParentStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          folderName: options.strategy.folderName ?? "",
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "fileMap":
        deployedFiles = await applyFileMapStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          dictionaryFile: options.strategy.dictionaryFile ?? "",
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "fileIntoParentFolder":
        deployedFiles = await applyFileIntoParentFolderStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: options.strategy.fileName ?? "",
          isExtname: options.strategy.isExtname,
          requireParent: options.strategy.requireParent,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "bethesdaData":
        deployedFiles = await applyBethesdaDataStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          folderName: options.strategy.folderName ?? "",
          documentsGameFolder: options.strategy.documentsGameFolder ?? "",
          iniFileName: options.strategy.iniFileName ?? "",
          localAppDataGameFolder: options.strategy.localAppDataGameFolder ?? "",
          pluginsHeader: options.strategy.pluginsHeader,
          updateGeneralTestFiles: options.strategy.updateGeneralTestFiles,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "bethesdaPluginFiles":
        deployedFiles = await applyBethesdaPluginFilesStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          documentsGameFolder: options.strategy.documentsGameFolder ?? "",
          iniFileName: options.strategy.iniFileName ?? "",
          localAppDataGameFolder: options.strategy.localAppDataGameFolder ?? "",
          pluginsHeader: options.strategy.pluginsHeader,
          updateGeneralTestFiles: options.strategy.updateGeneralTestFiles,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "oblivionPlugins":
        deployedFiles = await applyOblivionPluginsStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "noMansSkyMods":
        if (options.isInstall) {
          await ensureNoMansSkyModsEnabled(targetRoot);
        }
        deployedFiles = await applyGeneralStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          keepPath: options.strategy.keepPath,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "numberedPak":
        deployedFiles = await applyNumberedPakStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          extension: options.strategy.extension ?? "pak",
          prefix: options.strategy.prefix ?? "data",
          startIndex: options.strategy.startIndex ?? 2,
          listFileName: options.strategy.listFileName ?? "pakList.txt",
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "watchDogsPatch":
        deployedFiles = await applyWatchDogsPatchStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          listFileName: options.strategy.listFileName ?? "pakList.txt",
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "michangshengLinkedFolder":
        deployedFiles = await applyMiChangShengLinkedFolderStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          rootFile: options.strategy.rootFile ?? "mod.bin",
          isInstall: options.isInstall
        });
        break;
      case "michangshengDllPlugins":
        await ensureMiChangShengModBin(targetRoot);
        deployedFiles = await applyFileOnlyStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: "dll",
          isExtname: true,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "legendPortraits":
        deployedFiles = await applyLegendPortraitsStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          portraitFolders: options.strategy.portraitFolders ?? [],
          isInstall: options.isInstall
        });
        break;
      case "inzoiModKit":
        deployedFiles = await applyInzoiModKitStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          isInstall: options.isInstall
        });
        break;
      case "bg3Pak":
        deployedFiles = await applyBg3PakStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          managedToolFileName: options.strategy.managedToolFileName ?? "BaldursGate3.dll",
          managedToolCandidates: options.managedToolCandidates,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "redDeadAsi":
        deployedFiles = await applyRedDeadAsiStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          fileName: options.strategy.fileName ?? "asi",
          isExtname: options.strategy.isExtname,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "redDeadLml":
        deployedFiles = await applyRedDeadLmlStrategy({
          modRoot: options.modRoot,
          gamePath: targetRoot,
          installPath,
          isInstall: options.isInstall,
          useSymlink: options.useSymlink
        });
        break;
      case "manual":
        throw new Error(options.strategy.reason || "该 Mod 类型需要手动安装。");
      default:
        throw new Error(`未知安装策略: ${options.strategy.kind}`);
    }

    return {
      deployedFiles: deployedFiles.map((file) => formatScopedFile(targetScope, file))
    };
  } catch (error) {
    if (options.isInstall && deployedFiles.length > 0) {
      try {
        await deleteRelativeFiles(
          options.gamePath,
          deployedFiles.map((file) => formatScopedFile(targetScope, file))
        );
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

registerNxmProtocol();

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
  console.log("==================================================");
  console.log("[mayflyMods 防伪声明] b战：清梦与狗不得使用，其他人随意使用，不过分抄袭套壳即可");
  console.log("==================================================");
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

electron.app.on("will-quit", () => {
  aria2Tasks.forEach((task) => {
    task.cancelled = true;
  });
  aria2Tasks.clear();
  aria2Runtime?.process.kill();
  aria2Runtime = null;
});
