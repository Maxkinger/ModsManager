const MACOS_GAME_INSTALL_STRATEGIES = new Set([
  "general",
  "folder",
  "folderRoot",
  "file",
  "fileSibling",
  "manual"
]);

export function assertPlatformInstallStrategy(platform: string, kind: string, targetScope: string) {
  if (platform !== "darwin") return;

  if (targetScope !== "game") {
    throw new Error("macOS installs are currently limited to the selected game directory.");
  }

  if (!MACOS_GAME_INSTALL_STRATEGIES.has(kind)) {
    throw new Error(`Install strategy "${kind}" is not supported on macOS.`);
  }
}
