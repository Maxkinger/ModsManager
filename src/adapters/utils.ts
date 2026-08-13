import type { GameAdapter, GamePreset, ModTypeRule } from "@/types/domain";

export function pathParts(filePath: string) {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

export function baseName(filePath: string) {
  return pathParts(filePath).pop() ?? filePath;
}

export function extension(filePath: string) {
  const name = baseName(filePath).toLowerCase();
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1);
}

export function hasFile(files: string[], fileName: string) {
  return files.some((file) => baseName(file).toLowerCase() === fileName.toLowerCase());
}

export function hasExtension(files: string[], ext: string) {
  const normalized = ext.replace(/^\./, "").toLowerCase();
  return files.some((file) => extension(file) === normalized);
}

export function hasPathPart(files: string[], part: string) {
  return files.some((file) =>
    pathParts(file).some((item) => item.toLowerCase() === part.toLowerCase())
  );
}

export function manualRule(id = "manual", name = "未知"): ModTypeRule {
  return {
    id,
    name,
    install: {
      kind: "manual",
      reason: "该类型暂未实现自动安装，请手动处理。"
    }
  };
}

export function createCatalogAdapter(preset: GamePreset): GameAdapter {
  const typeNames = preset.typeNames.length > 0 ? preset.typeNames : ["通用类型"];
  const modTypes = typeNames.map<ModTypeRule>((name, index) => {
    const lowerName = name.toLowerCase();

    if (lowerName.includes("pak")) {
      return {
        id: String(index + 1),
        name,
        install: { kind: "general", installPath: "Content/Paks/~mods" }
      };
    }

    if (lowerName.includes("bepinex")) {
      return {
        id: String(index + 1),
        name,
        install: { kind: "fileSibling", installPath: "", fileName: "winhttp.dll" }
      };
    }

    if (lowerName.includes("plugin") || lowerName.includes("plugins")) {
      return {
        id: String(index + 1),
        name,
        install: { kind: "folder", installPath: "BepInEx/plugins", folderName: "plugins", spare: true }
      };
    }

    if (lowerName.includes("mods")) {
      return {
        id: String(index + 1),
        name,
        install: { kind: "folder", installPath: "mods", folderName: "mods", spare: true }
      };
    }

    if (lowerName.includes("根目录") || lowerName.includes("通用")) {
      return {
        id: String(index + 1),
        name,
        install: { kind: "general", installPath: "", keepPath: true }
      };
    }

    return {
      id: String(index + 1),
      name,
      install: { kind: "general", installPath: "", keepPath: true }
    };
  });

  return {
    presetId: preset.id,
    name: preset.name,
    modTypes: modTypes.length > 0 ? modTypes : [manualRule()],
    checkModType(files) {
      const pakRule = modTypes.find((rule) => rule.name.toLowerCase().includes("pak"));
      const bepinexRule = modTypes.find((rule) => rule.name.toLowerCase().includes("bepinex"));
      const pluginRule = modTypes.find((rule) => rule.name.toLowerCase().includes("plugin"));
      const modsRule = modTypes.find((rule) => rule.name.toLowerCase().includes("mods"));

      if (pakRule && hasExtension(files, "pak")) return pakRule.id;
      if (bepinexRule && hasFile(files, "winhttp.dll")) return bepinexRule.id;
      if (pluginRule && (hasExtension(files, "dll") || hasPathPart(files, "plugins"))) {
        return pluginRule.id;
      }
      if (modsRule && hasPathPart(files, "mods")) return modsRule.id;

      return modTypes[0]?.id ?? "manual";
    }
  };
}
