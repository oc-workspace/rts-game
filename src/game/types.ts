export type ShipClassId = "scout" | "striker" | "carrier";
export type Faction = "player" | "enemy";
export type UnitState = "idle" | "moving" | "attacking" | "destroyed";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type UnitOrder =
  | { type: "move"; targetPosition: Vec3 }
  | { type: "attack"; targetUnitId: string };

export interface ShipClass {
  id: ShipClassId;
  name: string;
  role: string;
  speed: number;
  maxHealth: number;
  weaponRange: number;
  damage: number;
  cooldown: number;
  scale: number;
}

export interface Unit {
  id: string;
  owner: Faction;
  classId: ShipClassId;
  spawnPosition: Vec3;
  position: Vec3;
  heading: number;
  targetPosition: Vec3 | null;
  targetUnitId: string | null;
  health: number;
  cooldownRemaining: number;
  state: UnitState;
  orderQueue: UnitOrder[];
  selected: boolean;
  destroyed: boolean;
}

export interface NeutralObject {
  id: string;
  position: Vec3;
  scale: number;
  rotation: Vec3;
  spin: Vec3;
}

export interface MoveOrder {
  type: "move";
  sourceUnitIds: string[];
  targetPosition: Vec3;
  createdAt: number;
}

export interface AttackOrder {
  type: "attack";
  sourceUnitIds: string[];
  targetUnitId: string;
  createdAt: number;
}

export interface WorldState {
  seed: number;
  units: Map<string, Unit>;
  neutrals: Map<string, NeutralObject>;
  selectedUnitIds: Set<string>;
  groups: Map<number, Set<string>>;
  aimedTargetId: string | null;
  lastOrder: MoveOrder | AttackOrder | null;
  statusMessage: string;
  winner: Faction | null;
  playerHasEngaged: boolean;
}

