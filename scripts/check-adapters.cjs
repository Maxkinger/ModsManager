const { readFileSync } = require("node:fs");
const vm = require("node:vm");

function loadPresets() {
  const text = readFileSync("src/data/game-presets.ts", "utf-8");
  const script = text
    .replace(/^import[^\n]+\n/gm, "")
    .replace(/export const gamePresets[^=]*=\s*/, "module.exports = ")
    .replace(/\s+satisfies\s+GamePreset\[\];?\s*$/u, ";");
  const sandbox = { module: { exports: [] } };

  vm.runInNewContext(script, sandbox);
  return sandbox.module.exports;
}

function getExplicitAdapterIds() {
  const text = readFileSync("src/adapters/index.ts", "utf-8");
  const factoryIds = [...text.matchAll(/create(?:Gta5|ReEngine|Unreal|Unity|MelonLoader)Adapter\("([^"]+)"/gu)]
    .map((match) => match[1]);
  const namedAdapters = {
    baldursGate3Adapter: "baldursgate3",
    blackWukongAdapter: "blackwukong",
    cyberpunk2077Adapter: "cyberpunk2077",
    eldenRingAdapter: "eldenring",
    monsterHunterWorldAdapter: "monsterhunterworld",
    skyrimSeAdapter: "skyrimse",
    stardewValleyAdapter: "stardewvalley",
    taleOfImmortalAdapter: "taleofimmortal"
  };
  const namedIds = Object.entries(namedAdapters)
    .filter(([adapterName]) => text.includes(adapterName))
    .map(([, presetId]) => presetId);

  return [...new Set([...factoryIds, ...namedIds])].sort();
}

const presets = loadPresets();
const presetIds = new Set(presets.map((preset) => preset.id));
const explicitIds = getExplicitAdapterIds();
const explicitIdSet = new Set(explicitIds);
const implementedIds = presets
  .filter((preset) => preset.adapterStatus === "implemented")
  .map((preset) => preset.id)
  .sort();
const missingPresets = explicitIds.filter((id) => !presetIds.has(id));
const implementedWithoutAdapter = implementedIds.filter((id) => !explicitIdSet.has(id));
const adapterWithoutImplementedStatus = explicitIds.filter((id) => {
  const preset = presets.find((item) => item.id === id);
  return preset?.adapterStatus !== "implemented";
});

console.log(`预设数量: ${presets.length}`);
console.log(`显式 adapter: ${explicitIds.length}`);
console.log(`implemented 预设: ${implementedIds.length}`);

if (missingPresets.length > 0) {
  console.error(`缺少预设: ${missingPresets.join(", ")}`);
}

if (implementedWithoutAdapter.length > 0) {
  console.error(`标记 implemented 但没有显式 adapter: ${implementedWithoutAdapter.join(", ")}`);
}

if (adapterWithoutImplementedStatus.length > 0) {
  console.error(`有显式 adapter 但预设未标 implemented: ${adapterWithoutImplementedStatus.join(", ")}`);
}

if (
  presets.length !== 144 ||
  missingPresets.length > 0 ||
  implementedWithoutAdapter.length > 0 ||
  adapterWithoutImplementedStatus.length > 0
) {
  process.exitCode = 1;
}
