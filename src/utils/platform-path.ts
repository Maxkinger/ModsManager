const isWindows = (platform: string) => platform === "win32";

function normalizeRoot(platform: string, root: string) {
  if (!root.trim()) {
    throw new Error("A root path is required.");
  }

  if (!isWindows(platform)) {
    const normalized = root.replace(/\\/gu, "/");
    return normalized === "/" ? "/" : normalized.replace(/\/+$/u, "");
  }

  if (/^[a-z]:[\\/]*$/iu.test(root)) {
    return `${root.slice(0, 2)}\\`;
  }

  if (/^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]*$/u.test(root)) {
    const uncParts = root.replace(/^[\\/]{2}/u, "").split(/[\\/]+/u).filter(Boolean);
    return `\\\\${uncParts.join("\\")}`;
  }

  return root.replace(/[\\/]+/gu, "\\").replace(/\\+$/u, "");
}

function normalizeSegments(segments: string[]) {
  return segments.flatMap((segment) => {
    const parts = segment.replace(/\\/gu, "/").split("/").filter((part) => part && part !== ".");
    if (parts.includes("..")) {
      throw new Error("Path segments cannot contain '..'.");
    }
    return parts;
  });
}

export function joinPlatformPath(platform: string, root: string, ...segments: string[]): string {
  const separator = isWindows(platform) ? "\\" : "/";
  const normalizedRoot = normalizeRoot(platform, root);
  const parts = normalizeSegments(segments);
  if (parts.length === 0) return normalizedRoot;

  const prefix = normalizedRoot.endsWith(separator) ? normalizedRoot : `${normalizedRoot}${separator}`;
  return `${prefix}${parts.join(separator)}`;
}

export function dirnamePlatformPath(platform: string, input: string): string {
  if (!input.trim()) {
    throw new Error("A file path is required.");
  }

  const normalized = input.replace(/\\/gu, "/");
  if (isWindows(platform) && /^[a-z]:\/*$/iu.test(normalized)) {
    return `${normalized.slice(0, 2)}\\`;
  }

  if (isWindows(platform) && /^\/{2}[^/]+\/[^/]+\/*$/u.test(normalized)) {
    return normalized.replace(/\/+$/u, "").replace(/\//gu, "\\");
  }

  const withoutTrailingSeparators = normalized.replace(/\/+$/u, "");
  const slash = withoutTrailingSeparators.lastIndexOf("/");
  let parent = slash < 0 ? "." : slash === 0 ? "/" : withoutTrailingSeparators.slice(0, slash);

  if (isWindows(platform)) {
    if (/^[a-z]:$/iu.test(parent)) parent += "/";
    parent = parent.replace(/\//gu, "\\");
  }

  return parent;
}

export function joinGameRelativePath(platform: string, root: string, relativePath: string): string {
  const value = relativePath.trim();
  const parts = value.replace(/\\/gu, "/").split("/").filter((part) => part && part !== ".");

  if (
    !value ||
    /^[\\/]/u.test(value) ||
    /^[a-z]:/iu.test(value) ||
    parts.length === 0 ||
    parts.some((part) => part === ".." || /^[a-z]:/iu.test(part))
  ) {
    return "";
  }

  try {
    return joinPlatformPath(platform, root, ...parts);
  } catch {
    return "";
  }
}
