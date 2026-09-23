const { access, chmod, stat } = require("node:fs/promises");
const { constants } = require("node:fs");
const { dirname, join } = require("node:path");

async function main() {
  if (process.platform !== "darwin") return;

  const packageRoot = dirname(require.resolve("7zip-bin"));
  for (const arch of ["arm64", "x64"]) {
    const executable = join(packageRoot, "mac", arch, "7za");
    const currentMode = (await stat(executable)).mode;
    await chmod(executable, currentMode | 0o111);
    await access(executable, constants.X_OK);
    process.stdout.write(`Prepared macOS ${arch} 7-Zip executable: ${executable}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
