const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { access } = require("node:fs/promises");
const { constants } = require("node:fs");
const { dirname, join } = require("node:path");
const { path7za } = require("7zip-bin");

async function main() {
  const packageJson = require("../package.json");
  assert(
    packageJson.build.asarUnpack.includes("node_modules/7zip-bin/**"),
    "7-Zip must remain outside app.asar so macOS can execute it"
  );

  if (process.platform !== "darwin") {
    process.stdout.write("7-Zip packaging check skipped outside macOS\n");
    return;
  }

  execFileSync(process.execPath, [join(__dirname, "prepare-7zip-bin.cjs")]);
  const packageRoot = dirname(require.resolve("7zip-bin"));
  for (const arch of ["arm64", "x64"]) {
    const executable = join(packageRoot, "mac", arch, "7za");
    await access(executable, constants.X_OK);
  }

  process.stdout.write("7-Zip arm64 and x64 packaging checks passed\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
