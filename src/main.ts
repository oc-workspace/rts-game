import * as THREE from "three";
import "./styles.css";

const FIXED_STEP = 1 / 60;
const SCENE_SEED = 20260810;
const GROUND_Y = -18;
const SHIP_Y = GROUND_Y + 5;

type ShipClassId = "scout" | "striker" | "carrier";
type Faction = "player" | "enemy";
type UnitState = "idle" | "moving" | "attacking" | "destroyed";

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
  selected: boolean;
  destroyed: boolean;
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
  selectedUnitIds: Set<string>;
  aimedTargetId: string | null;
  lastOrder: MoveOrder | AttackOrder | null;
  statusMessage: string;
  winner: Faction | null;
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
    maxHealth: 80,
    weaponRange: 34,
    damage: 9,
    cooldown: 0.65,
    scale: 0.8,
  },
  striker: {
    id: "striker",
    name: "EMBER STRIKER",
    role: "LINE COMBAT",
    speed: 12,
    maxHealth: 120,
    weaponRange: 38,
    damage: 14,
    cooldown: 0.9,
    scale: 1,
  },
  carrier: {
    id: "carrier",
    name: "BASTION CARRIER",
    role: "HEAVY COMMAND",
    speed: 8,
    maxHealth: 200,
    weaponRange: 46,
    damage: 20,
    cooldown: 1.4,
    scale: 1.25,
  },
};

const app = getElement<HTMLDivElement>("#app");
const runtimeStatus = getElement<HTMLElement>("#runtime-status");
const simulationStatus = getElement<HTMLElement>("#simulation-status");
const unitCount = getElement<HTMLElement>("#unit-count");
const fpsValue = getElement<HTMLElement>("#fps-value");
const fatalError = getElement<HTMLElement>("#fatal-error");
const fatalErrorMessage = getElement<HTMLElement>("#fatal-error-message");
const unitCard = getElement<HTMLElement>("#unit-card");
const selectedUnitName = getElement<HTMLElement>("#selected-unit-name");
const selectedUnitClass = getElement<HTMLElement>("#selected-unit-class");
const selectedUnitHealth = getElement<HTMLElement>("#selected-unit-health");
const selectedUnitTarget = getElement<HTMLElement>("#selected-unit-target");
const selectedUnitWeapon = getElement<HTMLElement>("#selected-unit-weapon");
const selectedUnitOrder = getElement<HTMLElement>("#selected-unit-order");

const random = createSeededRandom(SCENE_SEED);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020617);
scene.fog = new THREE.FogExp2(0x020617, 0.00022);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 12000);
const initialCameraFocus = new THREE.Vector3(0, -12, 0);
const initialCameraPosition = new THREE.Vector3(0, 74, 158);
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
  renderer.toneMappingExposure = 1.15;
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

scene.add(new THREE.HemisphereLight(0x9bdcff, 0x07111f, 1.5));

const keyLight = new THREE.DirectionalLight(0xbbe7ff, 2.8);
keyLight.position.set(80, 120, 50);
scene.add(keyLight);

const starfield = createStarfield(random, 2200);
scene.add(starfield);

const rangeGrid = new THREE.PolarGridHelper(
  82,
  20,
  12,
  64,
  0x164e63,
  0x0f2940,
);
rangeGrid.position.y = GROUND_Y;
const rangeGridMaterial = Array.isArray(rangeGrid.material)
  ? rangeGrid.material[0]
  : rangeGrid.material;
rangeGridMaterial.transparent = true;
rangeGridMaterial.opacity = 0.32;
scene.add(rangeGrid);

const beacon = createNavigationBeacon();
scene.add(beacon);

const targetMarker = createTargetMarker();
targetMarker.visible = false;
scene.add(targetMarker);

const world = createWorldState();
const shipViews = new Map<string, ShipView>();
for (const unit of world.units.values()) {
  const view = createShipView(unit);
  shipViews.set(unit.id, view);
  scene.add(view.group);
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
  beacon.rotation.y += step * 0.18;
  beacon.children[1].rotation.z -= step * 0.3;
  beacon.children[2].rotation.z += step * 0.22;
  rangeGrid.rotation.y += step * 0.006;

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
      unit.state = "idle";
      state.statusMessage = "TARGET LOST";
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
      unit.state = "idle";
      state.statusMessage = "AT POSITION";
      targetMarker.visible = false;
    }
    return;
  }

  unit.state = "idle";
}

function updateEnemyBehavior(state: WorldState, unit: Unit, step: number): void {
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

    const thrusterPulse = 0.86 + Math.sin(simulationTime * 8) * 0.14;
    for (const thruster of view.thrusterGlows) {
      thruster.scale.set(1, thrusterPulse, 1);
    }

    const selectionPulse = 1 + Math.sin(simulationTime * 4) * 0.06;
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
      setSelection(hit.id);
    } else if (hit?.owner === "enemy" && getSelectedUnit()) {
      world.aimedTargetId = hit.id;
      world.statusMessage =
        "TARGET LOCK · " + hit.id.toUpperCase() + " · RIGHT CLICK TO ATTACK";
      updateUnitCard();
    } else {
      setSelection(null);
    }
    return;
  }

  if (event.button === 2) {
    if (hit?.owner === "enemy") {
      issueAttackOrder(hit.id);
      return;
    }

    const target = getGroundTarget(event);
    if (target && world.selectedUnitIds.size > 0) {
      issueMoveOrder(target);
    }
  }
}

function handlePointerMove(event: PointerEvent): void {
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
    x: THREE.MathUtils.clamp(pointerWorld.x, -74, 74),
    y: SHIP_Y,
    z: THREE.MathUtils.clamp(pointerWorld.z, -74, 74),
  };
}

function updatePointer(event: PointerEvent): void {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
}

function setSelection(unitId: string | null): void {
  world.selectedUnitIds.clear();
  world.aimedTargetId = null;

  for (const unit of world.units.values()) {
    unit.selected = unit.id === unitId && unit.owner === "player";
    if (unit.selected) {
      world.selectedUnitIds.add(unit.id);
    }
  }

  world.statusMessage = unitId
    ? "SELECTED · RIGHT CLICK MOVE OR ATTACK"
    : "SELECT A PLAYER UNIT";
  updateUnitCard();
}

function issueMoveOrder(target: Vec3): void {
  const selectedIds = [...world.selectedUnitIds];
  const order: MoveOrder = {
    type: "move",
    sourceUnitIds: selectedIds,
    targetPosition: target,
    createdAt: simulationTime,
  };
  world.lastOrder = order;
  world.statusMessage = "MOVE ORDER · " + formatPosition(target);

  for (const unitId of selectedIds) {
    const unit = world.units.get(unitId);
    if (unit && !unit.destroyed) {
      unit.targetPosition = { ...target };
      unit.targetUnitId = null;
      unit.state = "moving";
    }
  }
  updateUnitCard();
}

function issueAttackOrder(targetId: string): void {
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
  world.statusMessage = "ATTACK ORDER · " + targetId.toUpperCase();

  for (const unitId of selectedIds) {
    const unit = world.units.get(unitId);
    if (unit && !unit.destroyed) {
      unit.targetUnitId = targetId;
      unit.targetPosition = null;
      unit.state = "attacking";
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
      unit.state = "idle";
    }
  }
  world.lastOrder = null;
  world.statusMessage = "STOPPED";
  updateUnitCard();
}

function updateUnitCard(): void {
  const unit = getSelectedUnit();
  if (!unit) {
    unitCard.hidden = true;
    return;
  }

  const shipClass = getShipClass(unit);
  const target = unit.targetUnitId
    ? world.units.get(unit.targetUnitId)
    : world.aimedTargetId
      ? world.units.get(world.aimedTargetId)
      : null;
  unitCard.hidden = false;
  selectedUnitName.textContent = unit.id.toUpperCase();
  selectedUnitClass.textContent = shipClass.name + " // " + shipClass.role;
  selectedUnitHealth.textContent = unit.health + " / " + shipClass.maxHealth;
  selectedUnitTarget.textContent = target
    ? target.id.toUpperCase() + " // " + getShipClass(target).name
    : "NONE";
  selectedUnitWeapon.textContent =
    unit.cooldownRemaining > 0
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

  for (const initialUnit of createInitialUnits()) {
    const unit = world.units.get(initialUnit.id);
    if (!unit) {
      continue;
    }
    Object.assign(unit, initialUnit);
    const view = shipViews.get(unit.id);
    if (view) {
      view.group.visible = true;
    }
  }

  clearCombatEffects();
  world.selectedUnitIds.clear();
  world.statusMessage = "ENCOUNTER RESET";
  targetMarker.visible = false;
  setSelection(null);
  resetCamera();
}

function createWorldState(): WorldState {
  return {
    seed: SCENE_SEED,
    units: new Map(createInitialUnits().map((unit) => [unit.id, unit])),
    selectedUnitIds: new Set(),
    aimedTargetId: null,
    lastOrder: null,
    statusMessage: "SELECT A PLAYER UNIT",
    winner: null,
  };
}

function createInitialUnits(): Unit[] {
  return [
    createUnit("scout-01", "player", "scout", -34, 28, 0),
    createUnit("striker-01", "enemy", "striker", 12, -8, Math.PI),
    createUnit("carrier-01", "enemy", "carrier", 36, -30, Math.PI),
  ];
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
    selected: false,
    destroyed: false,
  };
}

function createShipView(unit: Unit): ShipView {
  const shipClass = getShipClass(unit);
  const group = new THREE.Group();
  group.name = unit.id + "-view";
  group.userData.unitId = unit.id;
  group.scale.setScalar(shipClass.scale);

  const factionColor = unit.owner === "player" ? 0x22d3ee : 0xf97316;
  const accentColor = unit.owner === "player" ? 0x9be7f5 : 0xfde68a;
  const hullMaterial = new THREE.MeshStandardMaterial({
    color: factionColor,
    emissive: unit.owner === "player" ? 0x063b52 : 0x5b2108,
    emissiveIntensity: 1.8,
    metalness: 0.9,
    roughness: 0.24,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: factionColor,
    emissiveIntensity: 2.4,
    metalness: 0.8,
    roughness: 0.18,
  });
  const engineMaterial = new THREE.MeshBasicMaterial({
    color: accentColor,
    transparent: true,
    opacity: 0.86,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  if (unit.classId === "scout") {
    const hull = new THREE.Mesh(
      new THREE.ConeGeometry(3.5, 11, 6),
      hullMaterial,
    );
    hull.rotation.x = Math.PI / 2;
    hull.scale.set(0.82, 0.58, 1.35);
    group.add(hull);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(9, 0.65, 2.6), hullMaterial);
    wing.position.set(0, -0.55, -0.8);
    wing.rotation.y = Math.PI / 12;
    group.add(wing);

    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 18, 10),
      trimMaterial,
    );
    cockpit.position.set(0, 1.15, 1.7);
    cockpit.scale.set(0.8, 0.55, 1.25);
    group.add(cockpit);
  } else if (unit.classId === "striker") {
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(6.5, 2.8, 11),
      hullMaterial,
    );
    hull.position.y = -0.2;
    hull.rotation.y = Math.PI / 4;
    group.add(hull);

    const prow = new THREE.Mesh(
      new THREE.ConeGeometry(2.8, 7, 4),
      trimMaterial,
    );
    prow.rotation.x = Math.PI / 2;
    prow.position.z = 4.5;
    prow.scale.set(0.72, 0.5, 1);
    group.add(prow);

    for (const x of [-3.7, 3.7]) {
      const gun = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.55, 4.8, 10),
        trimMaterial,
      );
      gun.rotation.x = Math.PI / 2;
      gun.position.set(x, 0.3, 1.2);
      group.add(gun);
    }
  } else {
    const hull = new THREE.Mesh(
      new THREE.CylinderGeometry(4.6, 5.8, 13, 8),
      hullMaterial,
    );
    hull.rotation.x = Math.PI / 2;
    group.add(hull);

    const commandDeck = new THREE.Mesh(
      new THREE.BoxGeometry(7.5, 2.2, 5.5),
      trimMaterial,
    );
    commandDeck.position.y = 2.1;
    commandDeck.position.z = 0.8;
    group.add(commandDeck);

    const spine = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 3.5, 16),
      hullMaterial,
    );
    spine.position.y = 1.3;
    group.add(spine);
  }

  const thrusterGlows: THREE.Mesh[] = [];
  const thrusterCount = unit.classId === "carrier" ? 3 : 2;
  for (let index = 0; index < thrusterCount; index += 1) {
    const x = (index - (thrusterCount - 1) / 2) * 2.1;
    const thruster = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.92, 3.4, 12),
      engineMaterial,
    );
    thruster.rotation.x = Math.PI / 2;
    thruster.position.set(x, -0.35, -5.2);
    group.add(thruster);
    thrusterGlows.push(thruster);
  }

  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(4.7, 5.05, 48),
    new THREE.MeshBasicMaterial({
      color: factionColor,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.position.y = GROUND_Y - SHIP_Y + 0.2;
  selectionRing.visible = false;
  group.add(selectionRing);

  const shipLight = new THREE.PointLight(factionColor, 16, 42, 2);
  shipLight.position.set(0, 0.5, 0);
  group.add(shipLight);

  group.position.set(unit.position.x, unit.position.y, unit.position.z);
  group.rotation.y = unit.heading;
  return { group, selectionRing, thrusterGlows };
}

function createAttackEffect(attacker: Unit, target: Unit): void {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(attacker.position.x, attacker.position.y, attacker.position.z),
    new THREE.Vector3(target.position.x, target.position.y, target.position.z),
  ]);
  const material = new THREE.LineBasicMaterial({
    color: attacker.owner === "player" ? 0x67e8f9 : 0xfb923c,
    transparent: true,
    opacity: 0.96,
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
  const geometry = new THREE.SphereGeometry(2.8, 16, 10);
  const material = new THREE.MeshBasicMaterial({
    color: unit.owner === "player" ? 0x67e8f9 : 0xfb923c,
    transparent: true,
    opacity: 0.95,
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
    new THREE.RingGeometry(2.3, 2.6, 32),
    new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  marker.add(ring);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 8),
    new THREE.MeshBasicMaterial({
      color: 0xfef3c7,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  core.position.y = 0.35;
  marker.add(core);
  return marker;
}

function createNavigationBeacon(): THREE.Group {
  const group = new THREE.Group();
  group.position.set(0, -5, 0);

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0x164e63,
    emissive: 0x0891b2,
    emissiveIntensity: 2.8,
    metalness: 0.85,
    roughness: 0.24,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(7, 2), coreMaterial);
  group.add(core);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(14, 0.22, 8, 96),
    ringMaterial,
  );
  innerRing.rotation.x = Math.PI / 2.8;
  group.add(innerRing);

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(24, 0.12, 8, 128),
    ringMaterial.clone(),
  );
  outerRing.rotation.x = -Math.PI / 3.2;
  group.add(outerRing);

  const beaconLight = new THREE.PointLight(0x22d3ee, 95, 180, 2);
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

    const hue = 0.52 + nextRandom() * 0.12;
    color.setHSL(hue, 0.55, 0.55 + nextRandom() * 0.35);
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 2.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.86,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
  });
  return new THREE.Points(geometry, material);
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
