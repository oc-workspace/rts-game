import * as THREE from "three";
import "./styles.css";

const FIXED_STEP = 1 / 60;
const DEFAULT_SEED = 20260810;
const SCENE_SEED = readSeedFromUrl();
const BATTLEFIELD_RADIUS = 72;
const GROUND_Y = -18;
const SHIP_Y = GROUND_Y + 5;

type ShipClassId = "scout" | "striker" | "carrier";
type Faction = "player" | "enemy";
type UnitState = "idle" | "moving" | "attacking" | "destroyed";
type UnitOrder =
  | { type: "move"; targetPosition: Vec3 }
  | { type: "attack"; targetUnitId: string };

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface ShipClass {
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

interface Unit {
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

interface NeutralObject {
  id: string;
  position: Vec3;
  scale: number;
  rotation: Vec3;
  spin: Vec3;
}

interface MoveOrder {
  type: "move";
  sourceUnitIds: string[];
  targetPosition: Vec3;
  createdAt: number;
}

interface AttackOrder {
  type: "attack";
  sourceUnitIds: string[];
  targetUnitId: string;
  createdAt: number;
}

interface WorldState {
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

interface ShipView {
  group: THREE.Group;
  selectionRing: THREE.Mesh;
  thrusterGlows: THREE.Mesh[];
}

interface CombatEffect {
  object: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial | THREE.MeshBasicMaterial;
  ttl: number;
  maxTtl: number;
}

const SHIP_CLASSES: Record<ShipClassId, ShipClass> = {
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

const app = getElement<HTMLDivElement>("#app");
const runtimeStatus = getElement<HTMLElement>("#runtime-status");
const simulationStatus = getElement<HTMLElement>("#simulation-status");
const unitCount = getElement<HTMLElement>("#unit-count");
const fpsValue = getElement<HTMLElement>("#fps-value");
const seedValue = getElement<HTMLElement>("#seed-value");
const encounterValue = getElement<HTMLElement>("#encounter-value");
const fatalError = getElement<HTMLElement>("#fatal-error");
const fatalErrorMessage = getElement<HTMLElement>("#fatal-error-message");
const unitCard = getElement<HTMLElement>("#unit-card");
const selectedUnitName = getElement<HTMLElement>("#selected-unit-name");
const selectedUnitClass = getElement<HTMLElement>("#selected-unit-class");
const selectedUnitHealth = getElement<HTMLElement>("#selected-unit-health");
const selectedUnitTarget = getElement<HTMLElement>("#selected-unit-target");
const selectedUnitWeapon = getElement<HTMLElement>("#selected-unit-weapon");
const selectedUnitOrder = getElement<HTMLElement>("#selected-unit-order");
const fleetList = getElement<HTMLUListElement>("#fleet-list");
const groupValues = getElement<HTMLElement>("#group-values");
const minimapCanvas = getElement<HTMLCanvasElement>("#minimap");
const selectionBox = getElement<HTMLDivElement>("#selection-box");
const minimapContext = minimapCanvas.getContext("2d");

const random = createSeededRandom(SCENE_SEED);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04090e);
scene.fog = new THREE.FogExp2(0x04090e, 0.00022);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 12000);
const initialCameraFocus = new THREE.Vector3(4, -10, 0);
const initialCameraPosition = new THREE.Vector3(60, 50, 112);
const cameraOffset = new THREE.Vector3().subVectors(
  initialCameraPosition,
  initialCameraFocus,
);
const cameraFocus = initialCameraFocus.clone();
let cameraZoom = 1;

camera.position.copy(initialCameraPosition);
camera.lookAt(cameraFocus);

let renderer: THREE.WebGLRenderer;

try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.setAttribute("aria-label", "3D deep space test range");
  app.append(renderer.domElement);
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : "浏览器没有提供可用的 WebGL 渲染能力。";
  fatalErrorMessage.textContent = message;
  fatalError.hidden = false;
  runtimeStatus.textContent = "RENDERER OFFLINE";
  runtimeStatus.parentElement?.classList.add("status-cluster--error");
  throw error;
}

scene.add(new THREE.HemisphereLight(0x98aab2, 0x08090a, 1.35));
scene.add(new THREE.AmbientLight(0x26323a, 0.5));

const keyLight = new THREE.DirectionalLight(0xd2d8da, 4.2);
keyLight.position.set(-90, 120, 86);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x527b91, 3.1);
rimLight.position.set(110, 24, -120);
scene.add(rimLight);

const warmFill = new THREE.DirectionalLight(0x8b756c, 1.0);
warmFill.position.set(-70, 8, -80);
scene.add(warmFill);

const starfield = createStarfield(random, 1700);
scene.add(starfield);

const spaceDust = createSpaceDust(random, 260);
scene.add(spaceDust);

const distantPlanet = createDistantPlanet();
scene.add(distantPlanet);

const rangeGrid = new THREE.PolarGridHelper(
  82,
  20,
  12,
  64,
  0x263942,
  0x111b20,
);
rangeGrid.position.y = GROUND_Y;
const rangeGridMaterial = Array.isArray(rangeGrid.material)
  ? rangeGrid.material[0]
  : rangeGrid.material;
rangeGridMaterial.transparent = true;
rangeGridMaterial.opacity = 0.2;
scene.add(rangeGrid);

const beacon = createNavigationBeacon();
scene.add(beacon);
const beaconInnerRing = beacon.getObjectByName("beacon-inner-ring");
const beaconOuterRing = beacon.getObjectByName("beacon-outer-ring");

const targetMarker = createTargetMarker();
targetMarker.visible = false;
scene.add(targetMarker);

const world = createWorldState();
const shipViews = new Map<string, ShipView>();
const neutralViews = new Map<string, THREE.Group>();
for (const unit of world.units.values()) {
  const view = createShipView(unit);
  shipViews.set(unit.id, view);
  scene.add(view.group);
}
for (const neutral of world.neutrals.values()) {
  const view = createNeutralView(neutral);
  neutralViews.set(neutral.id, view);
  scene.add(view);
}

const combatEffects: CombatEffect[] = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y);
const pointerWorld = new THREE.Vector3();

let paused = false;
let accumulator = 0;
let simulationTime = 0;
let previousTime = performance.now();
let frameCounter = 0;
let fpsWindowStart = previousTime;
let isPanning = false;
let lastPointerX = 0;
let lastPointerY = 0;
let isSelecting = false;
let selectionStartX = 0;
let selectionStartY = 0;
let selectionEndX = 0;
let selectionEndY = 0;

runtimeStatus.textContent = "SYSTEM ONLINE";
simulationStatus.textContent = "RUNNING";
updateTelemetry(previousTime);
updateUnitCard();
renderPresentation();

window.addEventListener("resize", handleResize);
window.addEventListener("keydown", handleKeyDown);
renderer.domElement.addEventListener("pointerdown", handlePointerDown);
renderer.domElement.addEventListener("pointermove", handlePointerMove);
renderer.domElement.addEventListener("pointerup", handlePointerUp);
renderer.domElement.addEventListener("pointercancel", handlePointerUp);
renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
renderer.domElement.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
requestAnimationFrame(render);

function render(now: number): void {
  const frameDelta = Math.min((now - previousTime) / 1000, 0.25);
  previousTime = now;
  accumulator += frameDelta;

  while (accumulator >= FIXED_STEP) {
    if (!paused) {
      updateSimulation(world, FIXED_STEP);
    }
    accumulator -= FIXED_STEP;
  }

  renderPresentation();
  renderer.render(scene, camera);
  updateTelemetry(now);
  requestAnimationFrame(render);
}

function updateSimulation(state: WorldState, step: number): void {
  simulationTime += step;
  beacon.rotation.y += step * 0.055;
  if (beaconInnerRing) {
    beaconInnerRing.rotation.z -= step * 0.12;
  }
  if (beaconOuterRing) {
    beaconOuterRing.rotation.z += step * 0.08;
  }
  rangeGrid.rotation.y += step * 0.006;

  for (const neutral of state.neutrals.values()) {
    const view = neutralViews.get(neutral.id);
    if (!view) {
      continue;
    }
    view.rotation.x += neutral.spin.x * step;
    view.rotation.y += neutral.spin.y * step;
    view.rotation.z += neutral.spin.z * step;
  }

  for (const unit of state.units.values()) {
    if (unit.destroyed) {
      continue;
    }
    unit.cooldownRemaining = Math.max(0, unit.cooldownRemaining - step);
  }

  for (const unit of state.units.values()) {
    if (unit.destroyed) {
      continue;
    }

    if (unit.owner === "enemy") {
      updateEnemyBehavior(state, unit, step);
    } else {
      updatePlayerBehavior(state, unit, step);
    }
  }

  updateCombatEffects(step);
  checkBattleOutcome(state);
}

function updatePlayerBehavior(state: WorldState, unit: Unit, step: number): void {
  if (unit.targetUnitId) {
    const target = state.units.get(unit.targetUnitId);
    if (!target || target.destroyed) {
      unit.targetUnitId = null;
      if (!activateNextOrder(unit)) {
        unit.state = "idle";
        state.statusMessage = "TARGET LOST";
      }
      return;
    }

    const distance = distanceBetween(unit.position, target.position);
    unit.heading = Math.atan2(
      target.position.x - unit.position.x,
      target.position.z - unit.position.z,
    );

    if (distance <= getShipClass(unit).weaponRange) {
      unit.state = "attacking";
      if (unit.cooldownRemaining <= 0) {
        performAttack(state, unit, target);
      }
    } else {
      unit.state = "moving";
      advanceUnitToward(unit, target.position, step);
    }
    return;
  }

  if (unit.targetPosition) {
    unit.state = "moving";
    const arrived = advanceUnitToward(unit, unit.targetPosition, step);
    if (arrived) {
      unit.targetPosition = null;
      if (!activateNextOrder(unit)) {
        unit.state = "idle";
        state.statusMessage = "AT POSITION";
        targetMarker.visible = false;
      }
    }
    return;
  }

  unit.state = "idle";
}

function activateNextOrder(unit: Unit): boolean {
  const nextOrder = unit.orderQueue.shift();
  if (!nextOrder) {
    return false;
  }

  if (nextOrder.type === "move") {
    unit.targetPosition = { ...nextOrder.targetPosition };
    unit.targetUnitId = null;
    unit.state = "moving";
  } else {
    unit.targetUnitId = nextOrder.targetUnitId;
    unit.targetPosition = null;
    unit.state = "attacking";
  }
  return true;
}

function updateEnemyBehavior(state: WorldState, unit: Unit, step: number): void {
  if (!state.playerHasEngaged && unit.health >= getShipClass(unit).maxHealth) {
    unit.targetUnitId = null;
    unit.state = "idle";
    return;
  }

  const target = findNearestLivingUnit(state, "player", unit.position);
  if (!target) {
    unit.state = "idle";
    return;
  }

  const distance = distanceBetween(unit.position, target.position);
  const aggroRange = getShipClass(unit).weaponRange + 18;
  if (distance > aggroRange && unit.health >= getShipClass(unit).maxHealth) {
    unit.state = "idle";
    return;
  }

  unit.targetUnitId = target.id;
  unit.heading = Math.atan2(
    target.position.x - unit.position.x,
    target.position.z - unit.position.z,
  );

  if (distance <= getShipClass(unit).weaponRange) {
    unit.state = "attacking";
    if (unit.cooldownRemaining <= 0) {
      performAttack(state, unit, target);
    }
  } else {
    unit.state = "moving";
    advanceUnitToward(unit, target.position, step);
  }
}

function performAttack(state: WorldState, attacker: Unit, target: Unit): void {
  const attackerClass = getShipClass(attacker);
  attacker.cooldownRemaining = attackerClass.cooldown;
  target.health = Math.max(0, target.health - attackerClass.damage);
  createAttackEffect(attacker, target);

  if (attacker.owner === "player") {
    state.statusMessage =
      "HIT " + target.id.toUpperCase() + " · -" + attackerClass.damage;
  } else if (target.selected) {
    state.statusMessage =
      "INCOMING FIRE · " + attacker.id.toUpperCase();
  }

  if (target.health <= 0) {
    destroyUnit(state, target, attacker);
  }
}

function destroyUnit(state: WorldState, unit: Unit, attacker: Unit): void {
  unit.destroyed = true;
  unit.state = "destroyed";
  unit.targetUnitId = null;
  unit.targetPosition = null;
  unit.selected = false;
  unit.orderQueue = [];
  state.selectedUnitIds.delete(unit.id);
  if (state.aimedTargetId === unit.id) {
    state.aimedTargetId = null;
  }

  const view = shipViews.get(unit.id);
  if (view) {
    view.group.visible = false;
  }
  createImpactEffect(unit);
  state.statusMessage =
    unit.id.toUpperCase() + " DESTROYED BY " + attacker.id.toUpperCase();
  updateUnitCard();
}

function checkBattleOutcome(state: WorldState): void {
  if (state.winner) {
    return;
  }

  const playerAlive = [...state.units.values()].some(
    (unit) => unit.owner === "player" && !unit.destroyed,
  );
  const enemyAlive = [...state.units.values()].some(
    (unit) => unit.owner === "enemy" && !unit.destroyed,
  );

  if (!enemyAlive && playerAlive) {
    state.winner = "player";
    state.statusMessage = "VICTORY · ENEMY FLEET DESTROYED";
    paused = true;
  } else if (!playerAlive && enemyAlive) {
    state.winner = "enemy";
    state.statusMessage = "DEFEAT · SCOUT DESTROYED";
    paused = true;
  }
}

function updateCombatEffects(step: number): void {
  for (let index = combatEffects.length - 1; index >= 0; index -= 1) {
    const effect = combatEffects[index];
    effect.ttl -= step;
    effect.material.opacity = Math.max(0, effect.ttl / effect.maxTtl);
    effect.object.scale.setScalar(1 + (1 - effect.ttl / effect.maxTtl) * 0.35);

    if (effect.ttl <= 0) {
      scene.remove(effect.object);
      effect.geometry.dispose();
      effect.material.dispose();
      combatEffects.splice(index, 1);
    }
  }
}

function renderPresentation(): void {
  for (const unit of world.units.values()) {
    const view = shipViews.get(unit.id);
    if (!view) {
      continue;
    }

    view.group.visible = !unit.destroyed;
    view.group.position.set(
      unit.position.x,
      unit.position.y,
      unit.position.z,
    );
    view.group.rotation.y = unit.heading;
    view.selectionRing.visible = unit.selected && unit.owner === "player";

    const thrusterPulse = 0.94 + Math.sin(simulationTime * 8) * 0.06;
    for (const thruster of view.thrusterGlows) {
      thruster.scale.set(1, thrusterPulse, 1);
    }

    const selectionPulse = 1 + Math.sin(simulationTime * 4) * 0.018;
    view.selectionRing.scale.setScalar(selectionPulse);
  }

  updateTargetMarker();
}

function updateTargetMarker(): void {
  const selected = getSelectedUnit();
  if (!selected || world.winner) {
    targetMarker.visible = false;
    return;
  }

  if (selected.targetUnitId) {
    const target = world.units.get(selected.targetUnitId);
    if (target && !target.destroyed) {
      targetMarker.position.set(target.position.x, GROUND_Y + 0.12, target.position.z);
      targetMarker.visible = true;
      return;
    }
  }

  if (selected.targetPosition) {
    targetMarker.position.set(
      selected.targetPosition.x,
      GROUND_Y + 0.12,
      selected.targetPosition.z,
    );
    targetMarker.visible = true;
    return;
  }

  targetMarker.visible = false;
}

function updateTelemetry(now: number): void {
  frameCounter += 1;
  const elapsed = now - fpsWindowStart;

  if (elapsed >= 500) {
    fpsValue.textContent = String(Math.round((frameCounter * 1000) / elapsed));
    frameCounter = 0;
    fpsWindowStart = now;
  }

  const aliveCount = [...world.units.values()].filter(
    (unit) => !unit.destroyed,
  ).length;
  const playerAlive = [...world.units.values()].filter(
    (unit) => unit.owner === "player" && !unit.destroyed,
  ).length;
  const enemyAlive = [...world.units.values()].filter(
    (unit) => unit.owner === "enemy" && !unit.destroyed,
  ).length;
  seedValue.textContent = formatSeedLabel(world.seed);
  encounterValue.textContent = playerAlive + "V" + enemyAlive;
  unitCount.textContent = String(aliveCount);
  simulationStatus.textContent = world.winner
    ? world.winner === "player"
      ? "VICTORY"
      : "DEFEAT"
    : paused
      ? "PAUSED"
      : "RUNNING";
  runtimeStatus.textContent =
    "SYSTEM ONLINE · T+" + simulationTime.toFixed(1).padStart(6, "0");
  updateFleetHud();
  updateMinimap();
}

function updateFleetHud(): void {
  const playerUnits = [...world.units.values()].filter(
    (unit) => unit.owner === "player",
  );
  fleetList.replaceChildren();

  for (const unit of playerUnits) {
    const entry = document.createElement("li");
    entry.className = "fleet-list__entry";
    if (unit.selected) {
      entry.classList.add("fleet-list__entry--selected");
    }
    if (unit.destroyed) {
      entry.classList.add("fleet-list__entry--destroyed");
    }
    const status = unit.destroyed
      ? "LOST"
      : unit.state === "attacking"
        ? "ENGAGED"
        : unit.state === "moving"
          ? "MOVING"
          : "READY";
    const queue = unit.orderQueue.length > 0
      ? " · Q" + unit.orderQueue.length
      : "";
    entry.textContent =
      unit.id.toUpperCase() + "  " + status + queue;
    fleetList.append(entry);
  }

  const groups = [...world.groups.entries()]
    .filter(([, ids]) => ids.size > 0)
    .map(([number, ids]) => "G" + number + " " + ids.size)
    .join("  ·  ");
  groupValues.textContent = groups || "NO GROUPS";
}

function updateMinimap(): void {
  if (!minimapContext) {
    return;
  }

  const width = minimapCanvas.width;
  const height = minimapCanvas.height;
  minimapContext.clearRect(0, 0, width, height);
  minimapContext.fillStyle = "#071015";
  minimapContext.fillRect(0, 0, width, height);
  minimapContext.strokeStyle = "rgba(108, 146, 155, 0.24)";
  minimapContext.lineWidth = 1;
  minimapContext.strokeRect(0.5, 0.5, width - 1, height - 1);
  minimapContext.beginPath();
  minimapContext.moveTo(width / 2, 0);
  minimapContext.lineTo(width / 2, height);
  minimapContext.moveTo(0, height / 2);
  minimapContext.lineTo(width, height / 2);
  minimapContext.stroke();

  const toMap = (position: Vec3): { x: number; y: number } => ({
    x: ((position.x + BATTLEFIELD_RADIUS) / (BATTLEFIELD_RADIUS * 2)) * width,
    y: ((position.z + BATTLEFIELD_RADIUS) / (BATTLEFIELD_RADIUS * 2)) * height,
  });

  for (const neutral of world.neutrals.values()) {
    const point = toMap(neutral.position);
    minimapContext.fillStyle = "rgba(111, 129, 132, 0.6)";
    minimapContext.beginPath();
    minimapContext.arc(point.x, point.y, Math.max(1.5, neutral.scale * 1.2), 0, Math.PI * 2);
    minimapContext.fill();
  }

  for (const unit of world.units.values()) {
    if (unit.destroyed) {
      continue;
    }
    const point = toMap(unit.position);
    minimapContext.fillStyle = unit.owner === "player" ? "#78b9c2" : "#bd6d58";
    minimapContext.beginPath();
    minimapContext.arc(point.x, point.y, unit.selected ? 3.4 : 2.2, 0, Math.PI * 2);
    minimapContext.fill();
    if (unit.selected) {
      minimapContext.strokeStyle = "rgba(163, 218, 223, 0.9)";
      minimapContext.beginPath();
      minimapContext.arc(point.x, point.y, 5.4, 0, Math.PI * 2);
      minimapContext.stroke();
    }
  }
}

function handleResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.repeat) {
    return;
  }

  const key = event.key.toLowerCase();

  if (key === "r") {
    resetCamera();
  }

  if (key === "p") {
    paused = !paused;
    simulationStatus.textContent = paused ? "PAUSED" : "RUNNING";
  }

  if (key === "n") {
    resetEncounter();
  }

  if (key === "s") {
    stopSelectedUnits();
  }

  if (/^[1-9]$/.test(key)) {
    const groupNumber = Number(key);
    if (event.ctrlKey) {
      assignControlGroup(groupNumber);
    } else {
      selectControlGroup(groupNumber);
    }
  }
}

function handlePointerDown(event: PointerEvent): void {
  if (event.button === 1) {
    isPanning = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
    return;
  }

  const hit = pickUnit(event);

  if (event.button === 0) {
    if (hit?.owner === "player") {
      setSelection(hit.id, event.shiftKey);
    } else if (hit?.owner === "enemy" && getSelectedUnit()) {
      world.aimedTargetId = hit.id;
      world.statusMessage =
        "TARGET LOCK · " + hit.id.toUpperCase() + " · RIGHT CLICK TO ATTACK";
      updateUnitCard();
    } else {
      if (!event.shiftKey) {
        setSelection(null);
      }
      const bounds = renderer.domElement.getBoundingClientRect();
      selectionStartX = event.clientX - bounds.left;
      selectionStartY = event.clientY - bounds.top;
      selectionEndX = selectionStartX;
      selectionEndY = selectionStartY;
      isSelecting = true;
      renderer.domElement.setPointerCapture(event.pointerId);
      updateSelectionBox();
    }
    return;
  }

  if (event.button === 2) {
    if (hit?.owner === "enemy") {
      issueAttackOrder(hit.id, event.shiftKey);
      return;
    }

    const target = getGroundTarget(event);
    if (target && world.selectedUnitIds.size > 0) {
      issueMoveOrder(target, event.shiftKey);
    }
  }
}

function handlePointerMove(event: PointerEvent): void {
  if (isSelecting) {
    const bounds = renderer.domElement.getBoundingClientRect();
    selectionEndX = event.clientX - bounds.left;
    selectionEndY = event.clientY - bounds.top;
    updateSelectionBox();
    return;
  }

  if (!isPanning) {
    return;
  }

  const deltaX = event.clientX - lastPointerX;
  const deltaY = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;

  cameraFocus.x -= deltaX * 0.16 * cameraZoom;
  cameraFocus.z += deltaY * 0.16 * cameraZoom;
  applyCameraTransform();
}

function handlePointerUp(event: PointerEvent): void {
  if (isSelecting) {
    const distance = Math.hypot(
      selectionEndX - selectionStartX,
      selectionEndY - selectionStartY,
    );
    if (distance >= 6) {
      selectUnitsInBox(event.shiftKey);
    }
    isSelecting = false;
    selectionBox.hidden = true;
  }

  isPanning = false;
  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
}

function handleWheel(event: WheelEvent): void {
  event.preventDefault();
  cameraZoom = THREE.MathUtils.clamp(
    cameraZoom * Math.exp(event.deltaY * 0.001),
    0.55,
    2.2,
  );
  applyCameraTransform();
}

function pickUnit(event: PointerEvent): Unit | null {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const intersections = raycaster.intersectObjects(
    [...shipViews.values()].map((view) => view.group),
    true,
  );

  for (const intersection of intersections) {
    let object: THREE.Object3D | null = intersection.object;
    while (object) {
      const unitId = object.userData.unitId;
      if (typeof unitId === "string") {
        const unit = world.units.get(unitId);
        if (unit && !unit.destroyed) {
          return unit;
        }
      }
      object = object.parent;
    }
  }
  return null;
}

function getGroundTarget(event: PointerEvent): Vec3 | null {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.ray.intersectPlane(groundPlane, pointerWorld);
  if (!hit) {
    return null;
  }

  return {
    x: THREE.MathUtils.clamp(pointerWorld.x, -BATTLEFIELD_RADIUS, BATTLEFIELD_RADIUS),
    y: SHIP_Y,
    z: THREE.MathUtils.clamp(pointerWorld.z, -BATTLEFIELD_RADIUS, BATTLEFIELD_RADIUS),
  };
}

function updatePointer(event: PointerEvent): void {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
}

function setSelection(unitId: string | null, additive = false): void {
  if (!additive) {
    world.selectedUnitIds.clear();
  }
  world.aimedTargetId = null;

  for (const unit of world.units.values()) {
    if (unit.id !== unitId) {
      if (!additive) {
        unit.selected = false;
      }
      continue;
    }
    if (unit.owner === "player" && !unit.destroyed) {
      if (additive && unit.selected) {
        unit.selected = false;
        world.selectedUnitIds.delete(unit.id);
      } else {
        unit.selected = true;
        world.selectedUnitIds.add(unit.id);
      }
    }
  }

  world.statusMessage = formatSelectionStatus();
  updateUnitCard();
}

function selectUnitsInBox(additive: boolean): void {
  const minX = Math.min(selectionStartX, selectionEndX);
  const maxX = Math.max(selectionStartX, selectionEndX);
  const minY = Math.min(selectionStartY, selectionEndY);
  const maxY = Math.max(selectionStartY, selectionEndY);
  const bounds = renderer.domElement.getBoundingClientRect();
  const selectedIds = new Set(additive ? world.selectedUnitIds : []);

  if (!additive) {
    for (const unit of world.units.values()) {
      unit.selected = false;
    }
  }

  for (const unit of world.units.values()) {
    if (unit.owner !== "player" || unit.destroyed) {
      continue;
    }
    const projected = new THREE.Vector3(
      unit.position.x,
      unit.position.y,
      unit.position.z,
    ).project(camera);
    const screenX = ((projected.x + 1) / 2) * bounds.width;
    const screenY = ((-projected.y + 1) / 2) * bounds.height;
    if (
      screenX >= minX &&
      screenX <= maxX &&
      screenY >= minY &&
      screenY <= maxY
    ) {
      unit.selected = true;
      selectedIds.add(unit.id);
    }
  }

  world.selectedUnitIds = selectedIds;
  world.aimedTargetId = null;
  world.statusMessage = formatSelectionStatus();
  updateUnitCard();
}

function updateSelectionBox(): void {
  const minX = Math.min(selectionStartX, selectionEndX);
  const minY = Math.min(selectionStartY, selectionEndY);
  selectionBox.style.left = minX + "px";
  selectionBox.style.top = minY + "px";
  selectionBox.style.width = Math.abs(selectionEndX - selectionStartX) + "px";
  selectionBox.style.height = Math.abs(selectionEndY - selectionStartY) + "px";
  selectionBox.hidden = false;
}

function formatSelectionStatus(): string {
  const count = world.selectedUnitIds.size;
  return count === 0
    ? "SELECT A PLAYER UNIT"
    : count === 1
      ? "SELECTED · RIGHT CLICK MOVE OR ATTACK"
      : count + " UNITS SELECTED · RIGHT CLICK TO COMMAND";
}

function assignControlGroup(groupNumber: number): void {
  const selectedIds = new Set(
    [...world.selectedUnitIds].filter((id) => {
      const unit = world.units.get(id);
      return Boolean(unit && unit.owner === "player" && !unit.destroyed);
    }),
  );
  if (selectedIds.size === 0) {
    world.statusMessage = "SELECT UNITS BEFORE ASSIGNING GROUP";
  } else {
    world.groups.set(groupNumber, selectedIds);
    world.statusMessage = "GROUP " + groupNumber + " ASSIGNED · " + selectedIds.size + " UNITS";
  }
  updateUnitCard();
  updateFleetHud();
}

function selectControlGroup(groupNumber: number): void {
  const group = world.groups.get(groupNumber);
  if (!group) {
    world.statusMessage = "GROUP " + groupNumber + " EMPTY";
    updateUnitCard();
    return;
  }

  const liveIds = [...group].filter((id) => {
    const unit = world.units.get(id);
    return Boolean(unit && unit.owner === "player" && !unit.destroyed);
  });
  world.groups.set(groupNumber, new Set(liveIds));
  world.selectedUnitIds.clear();
  for (const unit of world.units.values()) {
    unit.selected = liveIds.includes(unit.id);
    if (unit.selected) {
      world.selectedUnitIds.add(unit.id);
    }
  }
  world.aimedTargetId = null;
  world.statusMessage = "GROUP " + groupNumber + " SELECTED · " + liveIds.length + " UNITS";
  updateUnitCard();
}

function issueMoveOrder(target: Vec3, queue = false): void {
  const selectedIds = [...world.selectedUnitIds];
  const order: MoveOrder = {
    type: "move",
    sourceUnitIds: selectedIds,
    targetPosition: target,
    createdAt: simulationTime,
  };
  world.lastOrder = order;
  world.statusMessage = (queue ? "QUEUED MOVE · " : "MOVE ORDER · ") + formatPosition(target);

  selectedIds.forEach((unitId, index) => {
    const unit = world.units.get(unitId);
    if (unit && !unit.destroyed) {
      const nextOrder: UnitOrder = {
        type: "move",
        targetPosition: getFormationTarget(target, index, selectedIds.length),
      };
      if (queue && hasActiveOrder(unit)) {
        unit.orderQueue.push(nextOrder);
      } else {
        unit.orderQueue = [];
        applyOrder(unit, nextOrder);
      }
    }
  });
  updateUnitCard();
}

function issueAttackOrder(targetId: string, queue = false): void {
  const target = world.units.get(targetId);
  const selectedIds = [...world.selectedUnitIds];
  if (!target || target.destroyed || selectedIds.length === 0) {
    world.statusMessage = "SELECT A PLAYER UNIT FIRST";
    updateUnitCard();
    return;
  }

  const order: AttackOrder = {
    type: "attack",
    sourceUnitIds: selectedIds,
    targetUnitId: targetId,
    createdAt: simulationTime,
  };
  world.lastOrder = order;
  world.aimedTargetId = null;
  world.playerHasEngaged = true;
  world.statusMessage =
    (queue ? "QUEUED ATTACK · " : "ATTACK ORDER · ") + targetId.toUpperCase();

  for (const unitId of selectedIds) {
    const unit = world.units.get(unitId);
    if (unit && !unit.destroyed) {
      const nextOrder: UnitOrder = { type: "attack", targetUnitId: targetId };
      if (queue && hasActiveOrder(unit)) {
        unit.orderQueue.push(nextOrder);
      } else {
        unit.orderQueue = [];
        applyOrder(unit, nextOrder);
      }
    }
  }
  updateUnitCard();
}

function stopSelectedUnits(): void {
  for (const unitId of world.selectedUnitIds) {
    const unit = world.units.get(unitId);
    if (unit && !unit.destroyed) {
      unit.targetPosition = null;
      unit.targetUnitId = null;
      unit.orderQueue = [];
      unit.state = "idle";
    }
  }
  world.lastOrder = null;
  world.statusMessage = "STOPPED";
  updateUnitCard();
}

function hasActiveOrder(unit: Unit): boolean {
  return Boolean(unit.targetPosition || unit.targetUnitId);
}

function applyOrder(unit: Unit, order: UnitOrder): void {
  if (order.type === "move") {
    unit.targetPosition = { ...order.targetPosition };
    unit.targetUnitId = null;
    unit.state = "moving";
  } else {
    unit.targetUnitId = order.targetUnitId;
    unit.targetPosition = null;
    unit.state = "attacking";
  }
}

function getFormationTarget(target: Vec3, index: number, count: number): Vec3 {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const row = Math.floor(index / columns);
  const column = index % columns;
  const width = Math.min(columns, count - row * columns);
  const offsetX = (column - (width - 1) / 2) * 4.5;
  const offsetZ = -row * 4.5;
  return {
    x: THREE.MathUtils.clamp(
      target.x + offsetX,
      -BATTLEFIELD_RADIUS,
      BATTLEFIELD_RADIUS,
    ),
    y: SHIP_Y,
    z: THREE.MathUtils.clamp(
      target.z + offsetZ,
      -BATTLEFIELD_RADIUS,
      BATTLEFIELD_RADIUS,
    ),
  };
}

function updateUnitCard(): void {
  const selectedUnits = [...world.selectedUnitIds]
    .map((id) => world.units.get(id))
    .filter((unit): unit is Unit => Boolean(unit && !unit.destroyed));
  const unit = selectedUnits[0] ?? null;
  if (!unit) {
    unitCard.hidden = true;
    return;
  }

  const shipClass = getShipClass(unit);
  const totalHealth = selectedUnits.reduce((sum, selected) => sum + selected.health, 0);
  const totalMaxHealth = selectedUnits.reduce(
    (sum, selected) => sum + getShipClass(selected).maxHealth,
    0,
  );
  const target = unit.targetUnitId
    ? world.units.get(unit.targetUnitId)
    : world.aimedTargetId
      ? world.units.get(world.aimedTargetId)
      : null;
  unitCard.hidden = false;
  selectedUnitName.textContent = selectedUnits.length > 1
    ? selectedUnits.length + " UNITS"
    : unit.id.toUpperCase();
  selectedUnitClass.textContent = selectedUnits.length > 1
    ? "FLEET SELECTION // MIXED CLASS"
    : shipClass.name + " // " + shipClass.role;
  selectedUnitHealth.textContent = selectedUnits.length > 1
    ? totalHealth + " / " + totalMaxHealth
    : unit.health + " / " + shipClass.maxHealth;
  selectedUnitTarget.textContent = target
    ? target.id.toUpperCase() + " // " + getShipClass(target).name
    : "NONE";
  selectedUnitWeapon.textContent = selectedUnits.length > 1
    ? "QUEUE " + selectedUnits.reduce((sum, selected) => sum + selected.orderQueue.length, 0)
    : unit.cooldownRemaining > 0
      ? "COOLDOWN " + unit.cooldownRemaining.toFixed(1) + "S"
      : "READY";
  selectedUnitOrder.textContent = world.statusMessage;
}

function getSelectedUnit(): Unit | null {
  const selectedId = [...world.selectedUnitIds][0];
  return selectedId ? world.units.get(selectedId) ?? null : null;
}

function getShipClass(unit: Unit): ShipClass {
  return SHIP_CLASSES[unit.classId];
}

function findNearestLivingUnit(
  state: WorldState,
  owner: Faction,
  position: Vec3,
): Unit | null {
  let closest: Unit | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const unit of state.units.values()) {
    if (unit.owner !== owner || unit.destroyed) {
      continue;
    }
    const distance = distanceBetween(position, unit.position);
    if (distance < closestDistance) {
      closest = unit;
      closestDistance = distance;
    }
  }
  return closest;
}

function advanceUnitToward(unit: Unit, target: Vec3, step: number): boolean {
  const deltaX = target.x - unit.position.x;
  const deltaZ = target.z - unit.position.z;
  const distance = Math.hypot(deltaX, deltaZ);

  if (distance <= 0.2) {
    unit.position.x = target.x;
    unit.position.z = target.z;
    return true;
  }

  const travel = Math.min(distance, getShipClass(unit).speed * step);
  unit.position.x += (deltaX / distance) * travel;
  unit.position.z += (deltaZ / distance) * travel;
  unit.heading = Math.atan2(deltaX, deltaZ);
  return false;
}

function resetCamera(): void {
  cameraFocus.copy(initialCameraFocus);
  cameraZoom = 1;
  applyCameraTransform();
}

function applyCameraTransform(): void {
  camera.position.copy(cameraFocus).addScaledVector(cameraOffset, cameraZoom);
  camera.lookAt(cameraFocus);
}

function resetEncounter(): void {
  paused = false;
  simulationTime = 0;
  world.winner = null;
  world.lastOrder = null;
  world.aimedTargetId = null;
  world.playerHasEngaged = false;

  const freshUnits = new Map(
    createEncounter(world.seed).units.map((unit) => [unit.id, unit]),
  );

  for (const [id, view] of shipViews) {
    if (!freshUnits.has(id)) {
      scene.remove(view.group);
      shipViews.delete(id);
    }
  }

  for (const unit of freshUnits.values()) {
    if (!shipViews.has(unit.id)) {
      const view = createShipView(unit);
      shipViews.set(unit.id, view);
      scene.add(view.group);
    }
    const view = shipViews.get(unit.id);
    if (view) {
      view.group.visible = true;
    }
  }
  world.units = freshUnits;

  clearCombatEffects();
  world.selectedUnitIds.clear();
  world.statusMessage = "ENCOUNTER RESET";
  targetMarker.visible = false;
  setSelection(null);
  resetCamera();
}

function createWorldState(): WorldState {
  const encounter = createEncounter(SCENE_SEED);
  return {
    seed: SCENE_SEED,
    units: new Map(encounter.units.map((unit) => [unit.id, unit])),
    neutrals: new Map(encounter.neutrals.map((neutral) => [neutral.id, neutral])),
    selectedUnitIds: new Set(),
    groups: new Map(),
    aimedTargetId: null,
    lastOrder: null,
    statusMessage: "SELECT A PLAYER UNIT",
    winner: null,
    playerHasEngaged: false,
  };
}

function createEncounter(seed: number): {
  units: Unit[];
  neutrals: NeutralObject[];
} {
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
    const classId =
      index === 0
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

function createNeutralView(neutral: NeutralObject): THREE.Group {
  const group = new THREE.Group();
  group.name = neutral.id + "-view";
  group.position.set(
    neutral.position.x,
    neutral.position.y,
    neutral.position.z,
  );
  group.rotation.set(
    neutral.rotation.x,
    neutral.rotation.y,
    neutral.rotation.z,
  );
  group.scale.setScalar(neutral.scale);

  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.2, 1),
    new THREE.MeshStandardMaterial({
      color: 0x3b4548,
      emissive: 0x020506,
      emissiveIntensity: 0.12,
      metalness: 0.48,
      roughness: 0.82,
      flatShading: true,
    }),
  );
  body.scale.set(1.1, 0.72, 1.22);
  group.add(body);

  const facet = new THREE.Mesh(
    new THREE.TetrahedronGeometry(0.85, 0),
    new THREE.MeshStandardMaterial({
      color: 0x20292b,
      metalness: 0.58,
      roughness: 0.76,
      flatShading: true,
    }),
  );
  facet.position.set(0.6, 0.7, 0.35);
  facet.rotation.set(0.2, 0.5, -0.3);
  group.add(facet);
  return group;
}

function createShipView(unit: Unit): ShipView {
  const shipClass = getShipClass(unit);
  const group = new THREE.Group();
  group.name = unit.id + "-view";
  group.userData.unitId = unit.id;
  group.scale.setScalar(shipClass.scale);

  const factionColor = unit.owner === "player" ? 0x5ca7b2 : 0xa45748;
  const accentColor = unit.owner === "player" ? 0x83c1ca : 0xcf7157;
  const hullMaterial = new THREE.MeshStandardMaterial({
    color: unit.owner === "player" ? 0x3a484d : 0x41413f,
    emissive: unit.owner === "player" ? 0x020a0d : 0x090302,
    emissiveIntensity: 0.28,
    metalness: 0.62,
    roughness: 0.5,
    flatShading: true,
  });
  const armorMaterial = new THREE.MeshStandardMaterial({
    color: unit.owner === "player" ? 0x52636a : 0x5b5956,
    emissive: 0x030405,
    emissiveIntensity: 0.12,
    metalness: 0.7,
    roughness: 0.4,
    flatShading: true,
  });
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: unit.owner === "player" ? 0x1d272c : 0x242322,
    metalness: 0.58,
    roughness: 0.62,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: factionColor,
    emissive: factionColor,
    emissiveIntensity: 0.62,
    metalness: 0.48,
    roughness: 0.32,
  });
  const engineMaterial = new THREE.MeshBasicMaterial({
    color: accentColor,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  if (unit.classId === "scout") {
    const hull = new THREE.Mesh(createAngularHullGeometry(6.2, 13.5, 2.1), hullMaterial);
    group.add(hull);

    const dorsalArmor = new THREE.Mesh(
      createAngularHullGeometry(3.4, 7.8, 0.75),
      armorMaterial,
    );
    dorsalArmor.position.set(0, 1.25, 0.45);
    group.add(dorsalArmor);

    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(4.8, 0.46, 2.2),
        armorMaterial,
      );
      wing.position.set(side * 3.5, -0.5, -1.2);
      wing.rotation.y = side * -0.22;
      group.add(wing);

      const panelStrip = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.12, 5.1),
        accentMaterial,
      );
      panelStrip.position.set(side * 1.45, 1.47, -0.25);
      group.add(panelStrip);
    }

    const sensor = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.62, 0),
      accentMaterial,
    );
    sensor.position.set(0, 1.88, 3.1);
    group.add(sensor);
  } else if (unit.classId === "striker") {
    const hull = new THREE.Mesh(createAngularHullGeometry(9.4, 15.2, 3.2), hullMaterial);
    group.add(hull);

    const prowArmor = new THREE.Mesh(
      createAngularHullGeometry(5.2, 8.4, 1.05),
      armorMaterial,
    );
    prowArmor.position.set(0, 2.0, 2.7);
    group.add(prowArmor);

    for (const side of [-1, 1]) {
      const armorPlate = new THREE.Mesh(
        createAngularHullGeometry(4.4, 8.6, 0.72),
        armorMaterial,
      );
      armorPlate.position.set(side * 3.45, 0.7, -0.8);
      armorPlate.rotation.y = side * 0.09;
      group.add(armorPlate);

      const gunMount = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.15, 1.0, 6),
        panelMaterial,
      );
      gunMount.position.set(side * 3.55, 1.3, 3.25);
      group.add(gunMount);

      const gun = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.28, 4.8, 8),
        panelMaterial,
      );
      gun.rotation.x = Math.PI / 2;
      gun.position.set(side * 3.55, 1.45, 5.25);
      group.add(gun);

      const muzzle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 0.2, 8),
        accentMaterial,
      );
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.set(side * 3.55, 1.45, 7.66);
      group.add(muzzle);
    }

    const centerStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.16, 9.5),
      accentMaterial,
    );
    centerStrip.position.set(0, 2.58, -0.4);
    group.add(centerStrip);
  } else {
    const hull = new THREE.Mesh(createAngularHullGeometry(10.8, 20.5, 4.2), hullMaterial);
    group.add(hull);

    const spine = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 2.2, 17.5),
      armorMaterial,
    );
    spine.position.set(0, 2.35, -0.4);
    group.add(spine);

    for (const side of [-1, 1]) {
      const hangar = new THREE.Mesh(
        createAngularHullGeometry(3.8, 13.2, 2.8),
        armorMaterial,
      );
      hangar.position.set(side * 6.3, -0.35, -1.2);
      hangar.rotation.y = side * 0.035;
      group.add(hangar);

      const hangarDoor = new THREE.Mesh(
        new THREE.BoxGeometry(3.86, 0.18, 7.2),
        panelMaterial,
      );
      hangarDoor.position.set(side * 6.3, 1.12, -0.9);
      group.add(hangarDoor);

      const registryStripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.16, 10.5),
        accentMaterial,
      );
      registryStripe.position.set(side * 4.95, 2.25, -0.4);
      group.add(registryStripe);
    }

    const commandDeck = new THREE.Mesh(
      createAngularHullGeometry(4.6, 5.2, 2.1),
      panelMaterial,
    );
    commandDeck.position.set(0, 4.35, 1.45);
    group.add(commandDeck);

    const bridgeLight = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.18, 0.34),
      accentMaterial,
    );
    bridgeLight.position.set(0, 4.8, 4.05);
    group.add(bridgeLight);

    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 3.4, 8),
      armorMaterial,
    );
    antenna.position.set(0, 6.7, 0.8);
    group.add(antenna);
  }

  const thrusterGlows: THREE.Mesh[] = [];
  const thrusterCount = unit.classId === "carrier" ? 3 : 2;
  const thrusterSpacing = unit.classId === "carrier" ? 3.1 : 2.25;
  const thrusterZ = unit.classId === "carrier" ? -9.6 : unit.classId === "striker" ? -7.2 : -6.1;
  for (let index = 0; index < thrusterCount; index += 1) {
    const x = (index - (thrusterCount - 1) / 2) * thrusterSpacing;
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.95, 2.5, 10),
      panelMaterial,
    );
    housing.rotation.x = Math.PI / 2;
    housing.position.set(x, -0.3, thrusterZ + 0.8);
    group.add(housing);

    const thruster = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.72, 2.2, 10),
      engineMaterial,
    );
    thruster.rotation.x = Math.PI / 2;
    thruster.position.set(x, -0.3, thrusterZ - 0.8);
    group.add(thruster);
    thrusterGlows.push(thruster);
  }

  const ringRadius = unit.classId === "carrier" ? 9.1 : unit.classId === "striker" ? 7.1 : 5.8;
  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(ringRadius, ringRadius + 0.14, 64, 1, 0.22, Math.PI * 1.58),
    new THREE.MeshBasicMaterial({
      color: factionColor,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.position.y = GROUND_Y - SHIP_Y + 0.2;
  selectionRing.visible = false;
  group.add(selectionRing);

  const shipLight = new THREE.PointLight(factionColor, 3.5, 24, 2);
  shipLight.position.set(0, 0.8, -2);
  group.add(shipLight);

  group.position.set(unit.position.x, unit.position.y, unit.position.z);
  group.rotation.y = unit.heading;
  return { group, selectionRing, thrusterGlows };
}

function createAngularHullGeometry(
  width: number,
  length: number,
  height: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, length * 0.5);
  shape.lineTo(width * 0.32, length * 0.2);
  shape.lineTo(width * 0.5, -length * 0.22);
  shape.lineTo(width * 0.3, -length * 0.5);
  shape.lineTo(-width * 0.3, -length * 0.5);
  shape.lineTo(-width * 0.5, -length * 0.22);
  shape.lineTo(-width * 0.32, length * 0.2);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.16,
    bevelThickness: 0.18,
  });
  geometry.center();
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function readSeedFromUrl(): number {
  const rawSeed = new URLSearchParams(window.location.search).get("seed");
  if (!rawSeed) {
    return DEFAULT_SEED;
  }

  const parsedSeed = Number.parseInt(rawSeed, 10);
  return Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : DEFAULT_SEED;
}

function formatSeedLabel(seed: number): string {
  return "RTS-P4-" + String(seed >>> 0).slice(-6).padStart(6, "0");
}

function createAttackEffect(attacker: Unit, target: Unit): void {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(attacker.position.x, attacker.position.y, attacker.position.z),
    new THREE.Vector3(target.position.x, target.position.y, target.position.z),
  ]);
  const material = new THREE.LineBasicMaterial({
    color: attacker.owner === "player" ? 0x8fcbd2 : 0xd7a188,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
  });
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  combatEffects.push({
    object: line,
    geometry,
    material,
    ttl: 0.16,
    maxTtl: 0.16,
  });
}

function createImpactEffect(unit: Unit): void {
  const geometry = new THREE.IcosahedronGeometry(2.35, 1);
  const material = new THREE.MeshBasicMaterial({
    color: unit.owner === "player" ? 0x8fcbd2 : 0xd7a188,
    transparent: true,
    opacity: 0.76,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const impact = new THREE.Mesh(geometry, material);
  impact.position.set(unit.position.x, unit.position.y, unit.position.z);
  scene.add(impact);
  combatEffects.push({
    object: impact,
    geometry,
    material,
    ttl: 0.6,
    maxTtl: 0.6,
  });
}

function clearCombatEffects(): void {
  for (const effect of combatEffects) {
    scene.remove(effect.object);
    effect.geometry.dispose();
    effect.material.dispose();
  }
  combatEffects.length = 0;
}

function createTargetMarker(): THREE.Group {
  const marker = new THREE.Group();
  marker.name = "combat-target-marker";

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.05, 3.2, 48, 1, 0.15, Math.PI * 1.55),
    new THREE.MeshBasicMaterial({
      color: 0xc99a69,
      transparent: true,
      opacity: 0.68,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  marker.add(ring);

  const bracketMaterial = new THREE.MeshBasicMaterial({
    color: 0xd9b48a,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const horizontal = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.08, 0.08),
    bracketMaterial,
  );
  horizontal.position.y = 0.08;
  marker.add(horizontal);

  const vertical = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 1.8),
    bracketMaterial,
  );
  vertical.position.y = 0.08;
  marker.add(vertical);
  return marker;
}

function createNavigationBeacon(): THREE.Group {
  const group = new THREE.Group();
  group.position.set(2, GROUND_Y + 0.4, -4);

  const structureMaterial = new THREE.MeshStandardMaterial({
    color: 0x253137,
    emissive: 0x030708,
    emissiveIntensity: 0.12,
    metalness: 0.78,
    roughness: 0.48,
    flatShading: true,
  });
  const panelMaterial = new THREE.MeshStandardMaterial({
    color: 0x11191d,
    metalness: 0.62,
    roughness: 0.64,
  });

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.7, 3.4, 1.4, 8),
    structureMaterial,
  );
  base.position.y = 0.7;
  group.add(base);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.72, 7.5, 8),
    structureMaterial,
  );
  mast.position.y = 4.8;
  group.add(mast);

  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.82, 0),
    new THREE.MeshStandardMaterial({
      color: 0x78959d,
      emissive: 0x547c86,
      emissiveIntensity: 0.9,
      metalness: 0.54,
      roughness: 0.36,
    }),
  );
  core.position.y = 8.7;
  group.add(core);

  for (const side of [-1, 1]) {
    const stabilizer = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.35, 0.8),
      panelMaterial,
    );
    stabilizer.position.set(side * 2.2, 1.5, 0);
    stabilizer.rotation.z = side * 0.2;
    group.add(stabilizer);
  }

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x76949c,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.045, 6, 64),
    ringMaterial,
  );
  innerRing.name = "beacon-inner-ring";
  innerRing.position.y = 5.2;
  innerRing.rotation.x = Math.PI / 2.35;
  group.add(innerRing);

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(5.1, 0.035, 6, 72),
    ringMaterial.clone(),
  );
  outerRing.name = "beacon-outer-ring";
  outerRing.position.y = 4.2;
  outerRing.rotation.x = -Math.PI / 3.1;
  group.add(outerRing);

  const beaconLight = new THREE.PointLight(0x6f99a3, 7, 36, 2);
  beaconLight.position.y = 8.4;
  group.add(beaconLight);
  return group;
}

function createStarfield(
  nextRandom: () => number,
  count: number,
): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const radius = 500 + nextRandom() * 5200;
    const theta = nextRandom() * Math.PI * 2;
    const phi = Math.acos(2 * nextRandom() - 1);
    const sinPhi = Math.sin(phi);
    const offset = index * 3;

    positions[offset] = radius * sinPhi * Math.cos(theta);
    positions[offset + 1] = radius * Math.cos(phi);
    positions[offset + 2] = radius * sinPhi * Math.sin(theta);

    const hue = 0.53 + nextRandom() * 0.09;
    color.setHSL(hue, 0.22, 0.48 + nextRandom() * 0.42);
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 1.45,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
  });
  return new THREE.Points(geometry, material);
}

function createSpaceDust(
  nextRandom: () => number,
  count: number,
): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    positions[offset] = -260 + nextRandom() * 520;
    positions[offset + 1] = -90 + nextRandom() * 210;
    positions[offset + 2] = -260 - nextRandom() * 520;
    color.setHSL(0.54 + nextRandom() * 0.06, 0.18, 0.22 + nextRandom() * 0.16);
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 46,
    map: createSoftParticleTexture(),
    transparent: true,
    opacity: 0.075,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  return new THREE.Points(geometry, material);
}

function createSoftParticleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.8)");
  gradient.addColorStop(0.34, "rgba(255, 255, 255, 0.2)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDistantPlanet(): THREE.Group {
  const group = new THREE.Group();
  group.position.set(190, 42, -620);

  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(92, 32, 20),
    new THREE.MeshStandardMaterial({
      color: 0x101820,
      emissive: 0x030609,
      emissiveIntensity: 0.18,
      metalness: 0.02,
      roughness: 0.98,
    }),
  );
  group.add(planet);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(95, 32, 20),
    new THREE.MeshBasicMaterial({
      color: 0x35515f,
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  group.add(atmosphere);
  return group;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function distanceBetween(first: Vec3, second: Vec3): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function formatPosition(position: Vec3): string {
  return `${position.x.toFixed(0)} / ${position.z.toFixed(0)}`;
}

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error("Missing required UI element: " + selector);
  }
  return element;
}
