import type {
  Faction,
  NeutralObject,
  ShipClass,
  ShipClassId,
  Unit,
} from "./types";

export const DEFAULT_SEED = 20260810;
export const BATTLEFIELD_RADIUS = 72;
export const GROUND_Y = -18;
export const SHIP_Y = GROUND_Y + 5;

export const SHIP_CLASSES: Record<ShipClassId, ShipClass> = {
  scout: {
    id: "scout",
    name: "AURORA SCOUT",
    role: "LIGHT RECON",
    speed: 18,
    maxHealth: 140,
    weaponRange: 42,
    damage: 16,
    cooldown: 0.7,
    scale: 1.05,
  },
  striker: {
    id: "striker",
    name: "EMBER STRIKER",
    role: "LINE COMBAT",
    speed: 12,
    maxHealth: 110,
    weaponRange: 34,
    damage: 8,
    cooldown: 1.1,
    scale: 1.12,
  },
  carrier: {
    id: "carrier",
    name: "BASTION CARRIER",
    role: "HEAVY COMMAND",
    speed: 8,
    maxHealth: 180,
    weaponRange: 42,
    damage: 12,
    cooldown: 1.6,
    scale: 1.18,
  },
};

export interface Encounter {
  units: Unit[];
  neutrals: NeutralObject[];
}

export function createEncounter(seed: number): Encounter {
  const encounterRandom = createSeededRandom(seed ^ 0x9e3779b9);
  const playerCount = 3 + Math.floor(encounterRandom() * 2);
  const enemyCount = 3 + Math.floor(encounterRandom() * 2);
  const playerAnchor = {
    x: -30 + encounterRandom() * 8,
    z: 24 + encounterRandom() * 8,
  };
  const enemyAnchor = {
    x: 28 - encounterRandom() * 8,
    z: -24 - encounterRandom() * 8,
  };

  return {
    units: [
      ...createFleet("player", playerCount, playerAnchor, 0, encounterRandom),
      ...createFleet("enemy", enemyCount, enemyAnchor, Math.PI, encounterRandom),
    ],
    neutrals: createNeutralObjects(encounterRandom),
  };
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createFleet(
  owner: Faction,
  count: number,
  anchor: { x: number; z: number },
  heading: number,
  nextRandom: () => number,
): Unit[] {
  const playerPattern: ShipClassId[] = ["scout", "striker", "carrier", "scout"];
  const enemyPattern: ShipClassId[] = ["striker", "carrier", "scout", "striker"];
  const pattern = owner === "player" ? playerPattern : enemyPattern;
  const prefix = owner === "player" ? "p" : "e";
  const offsets = [
    { x: 0, z: 0 },
    { x: -2.4, z: -4.2 },
    { x: 2.4, z: -4.2 },
    { x: 0, z: -8.2 },
  ];

  return Array.from({ length: count }, (_, index) => {
    const classId = index === 0
      ? pattern[0]
      : pattern[Math.floor(nextRandom() * pattern.length)];
    const offset = offsets[index] ?? {
      x: (index % 2 === 0 ? -1 : 1) * (3 + index),
      z: -10 - index * 3,
    };
    const cosine = Math.cos(heading);
    const sine = Math.sin(heading);
    const x = anchor.x + offset.x * cosine + offset.z * sine;
    const z = anchor.z - offset.x * sine + offset.z * cosine;
    return createUnit(
      prefix + "-" + classId + "-" + String(index + 1).padStart(2, "0"),
      owner,
      classId,
      x,
      z,
      heading,
    );
  });
}

function createNeutralObjects(nextRandom: () => number): NeutralObject[] {
  const count = 7 + Math.floor(nextRandom() * 4);
  return Array.from({ length: count }, (_, index) => {
    const angle = nextRandom() * Math.PI * 2;
    const radius = 16 + nextRandom() * 44;
    return {
      id: "asteroid-" + String(index + 1).padStart(2, "0"),
      position: {
        x: Math.cos(angle) * radius,
        y: GROUND_Y + 1.1 + nextRandom() * 1.4,
        z: Math.sin(angle) * radius,
      },
      scale: 0.8 + nextRandom() * 1.7,
      rotation: {
        x: nextRandom() * Math.PI,
        y: nextRandom() * Math.PI,
        z: nextRandom() * Math.PI,
      },
      spin: {
        x: -0.06 + nextRandom() * 0.12,
        y: -0.08 + nextRandom() * 0.16,
        z: -0.06 + nextRandom() * 0.12,
      },
    };
  });
}

function createUnit(
  id: string,
  owner: Faction,
  classId: ShipClassId,
  x: number,
  z: number,
  heading: number,
): Unit {
  const shipClass = SHIP_CLASSES[classId];
  const position = { x, y: SHIP_Y, z };
  return {
    id,
    owner,
    classId,
    spawnPosition: { ...position },
    position,
    heading,
    targetPosition: null,
    targetUnitId: null,
    health: shipClass.maxHealth,
    cooldownRemaining: 0,
    state: "idle",
    orderQueue: [],
    selected: false,
    destroyed: false,
  };
}

