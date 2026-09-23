const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const ts = require("typescript");

const helperPath = join(__dirname, "../src/utils/platform-support.ts");
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

const { assertPlatformInstallStrategy } = moduleRecord.exports;
assert.doesNotThrow(() => assertPlatformInstallStrategy("darwin", "general", "game"));
assert.doesNotThrow(() => assertPlatformInstallStrategy("darwin", "fileSibling", "game"));
assert.doesNotThrow(() => assertPlatformInstallStrategy("win32", "bethesdaData", "documents"));
assert.throws(
  () => assertPlatformInstallStrategy("darwin", "bethesdaData", "game"),
  /not supported on macOS/i
);
assert.throws(
  () => assertPlatformInstallStrategy("darwin", "general", "documents"),
  /selected game directory/i
);

process.stdout.write("platform support checks passed\n");
