import type { GameAdapter } from "@/types/domain";
import { hasFile, hasPathPart } from "@/adapters/utils";

export const stardewValleyAdapter: GameAdapter = {
  presetId: "stardewvalley",
  name: "Stardew Valley",
  modTypes: [
    {
      id: "smapi",
      name: "SMAPI",
      install: {
        kind: "fileSibling",
        installPath: "",
        fileName: "StardewModdingAPI.exe"
      }
    },
    {
      id: "mods",
      name: "通用",
      install: {
        kind: "folder",
        installPath: "Mods",
        folderName: "Mods",
        spare: true
      }
    },
    {
      id: "unknown",
      name: "未知",
      install: {
        kind: "manual",
        reason: "该 Stardew Valley Mod 类型未知，请手动安装。"
      }
    }
  ],
  checkModType(files) {
    if (hasFile(files, "StardewModdingAPI.exe")) return "smapi";
    if (hasFile(files, "manifest.json") || hasPathPart(files, "Mods")) return "mods";
    return "unknown";
  }
};
