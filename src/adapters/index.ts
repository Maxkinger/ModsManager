import { gamePresets } from "@/data/game-presets";
import { baldursGate3Adapter } from "@/adapters/baldursgate3";
import { blackWukongAdapter } from "@/adapters/blackwukong";
import { commonAdapter } from "@/adapters/common";
import { cyberpunk2077Adapter } from "@/adapters/cyberpunk2077";
import { eldenRingAdapter } from "@/adapters/eldenring";
import { createGta5Adapter } from "@/adapters/gta5";
import { createReEngineAdapter, monsterHunterWorldAdapter } from "@/adapters/monsterhunter";
import { skyrimSeAdapter } from "@/adapters/skyrimse";
import { stardewValleyAdapter } from "@/adapters/stardewvalley";
import { taleOfImmortalAdapter } from "@/adapters/taleofimmortal";
import { createCatalogAdapter } from "@/adapters/utils";
import { createUnityAdapter } from "@/adapters/unity";
import { createUnrealAdapter } from "@/adapters/unreal";
import type { GameAdapter } from "@/types/domain";

const explicitAdapters: GameAdapter[] = [
  baldursGate3Adapter,
  cyberpunk2077Adapter,
  createGta5Adapter("gta5", "Grand Theft Auto V"),
  createGta5Adapter("gta5enhanced", "Grand Theft Auto V Enhanced"),
  monsterHunterWorldAdapter,
  createReEngineAdapter("monsterhunterrise", "MonsterHunterRise"),
  createReEngineAdapter("monsterhunterwilds", "Monster Hunter Wilds"),
  skyrimSeAdapter,
  stardewValleyAdapter,
  taleOfImmortalAdapter,
  blackWukongAdapter,
  eldenRingAdapter,
  createUnrealAdapter("hogwartslegacy", "Hogwarts Legacy", "Phoenix"),
  createUnrealAdapter("stellarblade", "Stellar Blade", "SB"),
  createUnrealAdapter("tekken8", "Tekken 8", "Polaris"),
  createUnityAdapter("riskofrain2", "Risk of Rain 2"),
  createUnityAdapter("valheim", "Valheim"),
  createUnityAdapter("lethalcompany", "Lethal Company")
];

const explicitAdapterMap = new Map(explicitAdapters.map((adapter) => [adapter.presetId, adapter]));
const catalogAdapterMap = new Map(
  gamePresets.map((preset) => [preset.id, createCatalogAdapter(preset)])
);

export function getGameAdapter(presetId: string): GameAdapter {
  return explicitAdapterMap.get(presetId) ?? catalogAdapterMap.get(presetId) ?? commonAdapter;
}

export function getModType(adapter: GameAdapter, typeId: string) {
  return adapter.modTypes.find((type) => type.id === typeId) ?? adapter.modTypes[0];
}
