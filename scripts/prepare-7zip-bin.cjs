const { access, chmod, stat } = require("node:fs/promises");
const { constants } = require("node:fs");
const { path7za } = require("7zip-bin");

async function main() {
  if (process.platform !== "darwin") return;

  const currentMode = (await stat(path7za)).mode;
  await chmod(path7za, currentMode | 0o111);
  await access(path7za, constants.X_OK);
  process.stdout.write(`Prepared macOS 7-Zip executable: ${path7za}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
