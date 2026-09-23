import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function isInside(rootPath: string, targetPath: string) {
  const pathFromRoot = relative(resolve(rootPath), resolve(targetPath));
  return pathFromRoot === "" || (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

function unsafeTarget(targetPath: string): Error {
  return new Error(`Target path escapes its allowed root: ${targetPath}`);
}

export function assertPathsDisjoint(sourcePath: string, targetPath: string): void {
  if (isInside(sourcePath, targetPath) || isInside(targetPath, sourcePath)) {
    throw new Error(`Source and target paths overlap: ${sourcePath} -> ${targetPath}`);
  }
}

export async function assertSafeTarget(
  rootPath: string,
  targetPath: string,
  options: { allowTargetSymlink?: boolean } = {}
): Promise<void> {
  if (!rootPath.trim() || !targetPath.trim()) {
    throw new Error("A root and target path are required.");
  }

  const absoluteRoot = resolve(rootPath);
  const absoluteTarget = isAbsolute(targetPath) ? resolve(targetPath) : resolve(absoluteRoot, targetPath);
  if (!isInside(absoluteRoot, absoluteTarget)) {
    throw unsafeTarget(targetPath);
  }

  const relativePath = relative(absoluteRoot, absoluteTarget);
  if (relativePath.split(sep).includes("..")) {
    throw unsafeTarget(targetPath);
  }

  let realRoot: string;
  try {
    realRoot = await realpath(absoluteRoot);
  } catch {
    throw new Error(`Allowed root does not exist: ${rootPath}`);
  }

  const parts = relativePath.split(sep).filter(Boolean);
  let currentPath = realRoot;

  for (const part of parts.slice(0, -1)) {
    const nextPath = resolve(currentPath, part);
    let info;
    try {
      info = await lstat(nextPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }

    if (info.isSymbolicLink()) {
      let realNextPath: string;
      try {
        realNextPath = await realpath(nextPath);
      } catch {
        throw new Error(`Target path contains an unresolved symbolic link: ${nextPath}`);
      }
      if (!isInside(realRoot, realNextPath)) {
        throw unsafeTarget(targetPath);
      }
      currentPath = realNextPath;
    } else {
      currentPath = nextPath;
    }
  }

  if (parts.length > 0 && !options.allowTargetSymlink) {
    try {
      if ((await lstat(absoluteTarget)).isSymbolicLink()) {
        throw new Error(`Target path cannot be a symbolic link: ${absoluteTarget}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
