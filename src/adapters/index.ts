import gamePresetsFromJson from "@/data/game-presets.json";
import { baldursGate3Adapter } from "@/adapters/baldursgate3";
import { blackWukongAdapter } from "@/adapters/blackwukong";
import { commonAdapter } from "@/adapters/common";
import { cyberpunk2077Adapter } from "@/adapters/cyberpunk2077";
import { eldenRingAdapter } from "@/adapters/eldenring";
import { createGta5Adapter } from "@/adapters/gta5";
import { catalogEngineDefinitions } from "@/adapters/engine-definitions";
import { createCatalogRuleAdapter, catalogRuleDefinitions } from "@/adapters/catalog-rule-definitions";
import { inzoiAdapter } from "@/adapters/inzoi";
import { legendOfHerosAdapter } from "@/adapters/legendofheros";
import { createReEngineAdapter, monsterHunterWorldAdapter } from "@/adapters/monsterhunter";
import { oblivionRemasteredAdapter } from "@/adapters/oblivionremastered";
import { skyrimSeAdapter } from "@/adapters/skyrimse";
import { stardewValleyAdapter } from "@/adapters/stardewvalley";
import { taleOfImmortalAdapter } from "@/adapters/taleofimmortal";
import { createCatalogAdapter } from "@/adapters/utils";
import { createMelonLoaderAdapter, createUnityAdapter } from "@/adapters/unity";
import { createUnrealAdapter } from "@/adapters/unreal";
import type { GameAdapter, GamePreset } from "@/types/domain";

const gamePresets = gamePresetsFromJson as GamePreset[];

const explicitAdapters: GameAdapter[] = [
  baldursGate3Adapter,
  cyberpunk2077Adapter,
  createGta5Adapter("gta5", "Grand Theft Auto V"),
  createGta5Adapter("gta5enhanced", "Grand Theft Auto V Enhanced"),
  inzoiAdapter,
  monsterHunterWorldAdapter,
  createReEngineAdapter("monsterhunterrise", "MonsterHunterRise"),
  createReEngineAdapter("monsterhunterwilds", "Monster Hunter Wilds"),
  legendOfHerosAdapter,
  oblivionRemasteredAdapter,
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
const engineAdapterMap = new Map(
  gamePresets
    .map((preset): [string, GameAdapter] | null => {
      const definition = catalogEngineDefinitions[preset.id];
      if (!definition) return null;

      switch (definition.kind) {
        case "unreal":
          return [preset.id, createUnrealAdapter(preset.id, preset.name, definition.basePath)];
        case "unity":
          return [preset.id, createUnityAdapter(preset.id, preset.name)];
        case "melon":
          return [preset.id, createMelonLoaderAdapter(preset.id, preset.name)];
        case "reengine":
          return [preset.id, createReEngineAdapter(preset.id, preset.name)];
        default:
          return null;
      }
    })
    .filter((entry): entry is [string, GameAdapter] => Boolean(entry))
);
const catalogAdapterMap = new Map(
  gamePresets.map((preset) => [preset.id, createCatalogAdapter(preset)])
);
const ruleAdapterMap = new Map(
  Object.entries(catalogRuleDefinitions).map(([presetId, definition]) => [
    presetId,
    createCatalogRuleAdapter(presetId, definition)
  ])
);

export function getGameAdapter(presetId: string): GameAdapter {
  return explicitAdapterMap.get(presetId) ??
    engineAdapterMap.get(presetId) ??
    ruleAdapterMap.get(presetId) ??
    catalogAdapterMap.get(presetId) ??
    commonAdapter;
}

export function getModType(adapter: GameAdapter, typeId: string) {
  return adapter.modTypes.find((type) => type.id === typeId) ?? adapter.modTypes[0];
}
