const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const { existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, relative, resolve, isAbsolute } = require("node:path");
const AdmZip = require("adm-zip");
const ts = require("typescript");

const safetySource = readFileSync(join(__dirname, "../electron/fs-safety.ts"), "utf8");
const safetyCompiled = ts.transpileModule(safetySource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const safetyModule = { exports: {} };
new Function("exports", "require", "module", safetyCompiled)(
  safetyModule.exports,
  require,
  safetyModule
);
const { assertSafeTarget } = safetyModule.exports;

const archiveToolsPath = join(__dirname, "../electron/archive-tools.ts");
assert.equal(existsSync(archiveToolsPath), true, "7-Zip listing parser should be shared and testable");
const archiveToolsSource = readFileSync(archiveToolsPath, "utf8");
const archiveToolsCompiled = ts.transpileModule(archiveToolsSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const archiveToolsModule = { exports: {} };
new Function("exports", "require", "module", archiveToolsCompiled)(
  archiveToolsModule.exports,
  require,
  archiveToolsModule
);
const { parseSevenZipListing } = archiveToolsModule.exports;

function isSymbolicLinkEntry(entry) {
  const unixMode = (entry.header.attr >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function isPathInside(rootPath, targetPath) {
  const root = resolve(rootPath);
  const target = resolve(targetPath);
  const rel = relative(root, target);

  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function safeJoin(rootPath, ...paths) {
  if (paths.some((path) => {
    const normalized = path.replace(/\\/g, "/");
    return normalized.startsWith("/") || /^[A-Za-z]:($|\/)/u.test(normalized) || normalized.split("/").includes("..");
  })) {
    throw new Error("目标路径必须是允许目录下的相对路径。");
  }
  const target = join(rootPath, ...paths);

  if (!isPathInside(rootPath, target)) {
    throw new Error(`目标路径超出允许目录：${target}`);
  }

  return target;
}

async function extractZipLikeMain(sourcePath, targetPath) {
  const zip = new AdmZip(sourcePath);
  const entries = zip.getEntries();

  const prepared = [];
  for (const entry of entries) {
    if (isSymbolicLinkEntry(entry)) {
      throw new Error(`压缩包包含不支持的符号链接：${entry.entryName}`);
    }
    const entryTarget = safeJoin(targetPath, entry.entryName);
    await assertSafeTarget(targetPath, entryTarget);
    prepared.push({
      entry,
      entryTarget,
      data: entry.isDirectory ? null : entry.getData()
    });
  }

  for (const item of prepared) {
    if (item.entry.isDirectory) {
      await mkdir(item.entryTarget, { recursive: true });
    } else {
      await mkdir(dirname(item.entryTarget), { recursive: true });
      await writeFile(item.entryTarget, item.data);
    }
  }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "mayfly-archive-check-"));

  try {
    const parsedSevenZipEntries = parseSevenZipListing([
      "7-Zip header",
      "Listing archive: /tmp/test.zip",
      "--",
      "Path = /tmp/test.zip",
      "Type = zip",
      "Physical Size = 150",
      "----------",
      "Path = mods/file.txt",
      "Size = 2",
      "Attributes = A",
      "",
      "Path = mods/link",
      "Size = 20",
      "Symbolic Link = ../outside",
      ""
    ].join("\n"));
    assert.deepEqual(parsedSevenZipEntries, [
      { path: "mods/file.txt", isLink: false },
      { path: "mods/link", isLink: true }
    ]);

    const validZipPath = join(root, "valid.zip");
    const validTarget = join(root, "valid-target");
    await mkdir(validTarget, { recursive: true });
    const validZip = new AdmZip();
    validZip.addFile("manifest.json", Buffer.from("{\"Name\":\"Test Mod\"}", "utf-8"));
    validZip.addFile("assets/file.txt", Buffer.from("ok", "utf-8"));
    validZip.writeZip(validZipPath);

    await extractZipLikeMain(validZipPath, validTarget);

    const extracted = await readFile(join(validTarget, "assets", "file.txt"), "utf-8");
    if (extracted !== "ok") {
      throw new Error("正常 zip 解压结果不正确。");
    }

    let blocked = false;
    try {
      safeJoin(join(root, "evil-target"), "../evil.txt");
    } catch (error) {
      blocked = /超出允许目录|相对路径/u.test(error.message);
    }

    if (!blocked) {
      throw new Error("路径穿越 zip 没有被阻止。");
    }

    assert.throws(() => safeJoin(join(root, "absolute-target"), "/outside.txt"), /相对路径/u);
    assert.throws(() => safeJoin(join(root, "drive-target"), "C:\\outside.txt"), /相对路径/u);

    const traversalTarget = join(root, "traversal-target");
    await mkdir(traversalTarget, { recursive: true });
    await writeFile(join(traversalTarget, "sentinel.txt"), "unchanged", "utf-8");
    const traversalZipPath = join(root, "traversal.zip");
    const traversalZip = new AdmZip();
    traversalZip.addFile("would-have-written.txt", Buffer.from("should not exist", "utf-8"));
    const traversalEntry = traversalZip.addFile("placeholder.txt", Buffer.from("outside", "utf-8"));
    traversalEntry.entryName = "../outside.txt";
    traversalZip.writeZip(traversalZipPath);
    await assert.rejects(() => extractZipLikeMain(traversalZipPath, traversalTarget));
    if (existsSync(join(traversalTarget, "would-have-written.txt"))) {
      throw new Error("检测到路径穿越时，不能先写入同一压缩包的其他文件。");
    }
    if (await readFile(join(traversalTarget, "sentinel.txt"), "utf-8") !== "unchanged") {
      throw new Error("路径穿越压缩包改变了已有目录内容。");
    }

    const outsideFile = join(root, "symlink-outside.txt");
    await writeFile(outsideFile, "sentinel", "utf-8");
    const symlinkZipPath = join(root, "symlink.zip");
    const symlinkZip = new AdmZip();
    symlinkZip.addFile("would-have-written.txt", Buffer.from("should not exist", "utf-8"));
    const linkEntry = symlinkZip.addFile("link-to-outside", Buffer.from("../symlink-outside.txt", "utf-8"));
    linkEntry.header.attr = (0o120777 << 16) >>> 0;
    symlinkZip.writeZip(symlinkZipPath);
    await assert.rejects(() => extractZipLikeMain(symlinkZipPath, traversalTarget), /符号链接/u);
    if (existsSync(join(traversalTarget, "would-have-written.txt"))) {
      throw new Error("检测到符号链接条目时，不能先写入同一压缩包的其他文件。");
    }
    if (await readFile(outsideFile, "utf-8") !== "sentinel") {
      throw new Error("符号链接压缩包改变了外部哨兵文件。");
    }

    console.log("压缩包导入安全样例: 4");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
