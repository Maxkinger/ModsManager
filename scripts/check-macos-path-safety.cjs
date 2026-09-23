const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const ts = require("typescript");

const helperPath = join(__dirname, "../electron/fs-safety.ts");
const source = readFileSync(helperPath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;
const moduleRecord = { exports: {} };
new Function("exports", "require", "module", compiled)(
  moduleRecord.exports,
  require,
  moduleRecord
);

const { assertSafeTarget, assertPathsDisjoint } = moduleRecord.exports;

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), "mayfly-path-safety-"));

  try {
    const gameRoot = join(tempRoot, "游戏 目录 with spaces");
    const outsideRoot = join(tempRoot, "outside");
    const outsideFile = join(outsideRoot, "outside.txt");
    await mkdir(gameRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideFile, "sentinel", "utf-8");
    await symlink(outsideRoot, join(gameRoot, "link-to-outside"), "dir");

    await assert.doesNotReject(() => assertSafeTarget(gameRoot, join(gameRoot, "Mods", "角色", "mod.txt")));
    await assert.rejects(() => assertSafeTarget(gameRoot, join(gameRoot, "..", "outside", "outside.txt")));
    await assert.rejects(() => assertSafeTarget(gameRoot, outsideFile));
    await assert.rejects(() => assertSafeTarget(gameRoot, join(gameRoot, "link-to-outside", "mod.txt")));
    assert.equal(typeof assertPathsDisjoint, "function", "copy-overlap guard should be exported");
    assert.throws(() => assertPathsDisjoint(gameRoot, join(gameRoot, "nested-target")), /overlap/u);
    assert.doesNotThrow(() => assertPathsDisjoint(gameRoot, join(tempRoot, "separate-target")));

    const installedLink = join(gameRoot, "installed-link.txt");
    await symlink(outsideFile, installedLink, "file");
    await assert.rejects(() => assertSafeTarget(gameRoot, installedLink));
    await assert.doesNotReject(() => assertSafeTarget(gameRoot, installedLink, { allowTargetSymlink: true }));
    assert.equal((await lstat(installedLink)).isSymbolicLink(), true);
    await rm(installedLink, { recursive: true, force: true });
    await assert.rejects(() => lstat(installedLink), { code: "ENOENT" });
    assert.equal(await readFile(outsideFile, "utf-8"), "sentinel");
    process.stdout.write("macOS path safety checks passed\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
