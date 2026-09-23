const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const ts = require("typescript");

const helperPath = join(__dirname, "../src/utils/platform-path.ts");
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

const { dirnamePlatformPath, joinPlatformPath } = moduleRecord.exports;
assert.equal(joinPlatformPath("darwin", "/tmp/游戏 Mods", "mods", "角色.zip"), "/tmp/游戏 Mods/mods/角色.zip");
assert.equal(dirnamePlatformPath("darwin", "/Users/a/Game.app"), "/Users/a");
assert.equal(joinPlatformPath("win32", "C:\\Games", "mods", "a.zip"), "C:\\Games\\mods\\a.zip");
assert.equal(joinPlatformPath("win32", "\\\\server\\share", "mods"), "\\\\server\\share\\mods");
assert.equal(joinPlatformPath("win32", "C:\\", "mods"), "C:\\mods");
assert.equal(dirnamePlatformPath("win32", "C:\\Games\\game.exe"), "C:\\Games");
assert.equal(dirnamePlatformPath("win32", "C:\\game.exe"), "C:\\");
assert.throws(() => joinPlatformPath("darwin", "", "mods"), /root path/i);

process.stdout.write("platform path checks passed\n");
