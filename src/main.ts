import * as THREE from "three";
import {
  BATTLEFIELD_RADIUS,
  createEncounter,
  createSeededRandom,
  DEFAULT_SEED,
  GROUND_Y,
  SHIP_CLASSES,
  SHIP_Y,
  STRESS_UNIT_COUNTS,
} from "./game/encounter";
import type { StressUnitCount } from "./game/encounter";
import {
  activateNextOrder,
  getFormationTarget,
  queueUnitOrder,
} from "./game/orders";
import type {
  AttackOrder,
  Faction,
  MoveOrder,
  NeutralObject,
  ShipClass,
  ShipClassId,
  Unit,
  UnitOrder,
  Vec3,
  WorldState,
} from "./game/types";
import {
  createDistantShipBatch,
  createShipVisual,
  updateShipVisual,
} from "./render/ship-visuals";
import type { EffectsQuality, ShipView } from "./render/ship-visuals";
import {
  ENVIRONMENT_RENDER_ORDER,
  ENVIRONMENT_VISUAL_BASELINE,
  getCombatEffectActiveBudget,
} from "./render/environment-visuals";
import {
  createAudioEventBus,
  createAudioUnitRef,
} from "./audio/audio-events";
import "./styles.css";

const FIXED_STEP = 1 / 60;
const SCENE_SEED = readSeedFromUrl();
const SCENE_STRESS_UNIT_COUNT = readStressUnitCountFromUrl();
const RENDER_PIXEL_RATIO = readRenderPixelRatio();
const CAPTURE_FRAME_ENABLED = new URLSearchParams(window.location.search)
  .get("captureFrame") === "1";
const LONG_FRAME_THRESHOLD_MS = 1000 / 30;
const FLEET_LIST_LIMIT = 10;
const MAX_SHIP_LIGHTS = 12;
const DEFAULT_DETAIL_DISTANCE = 180;
const STRESS_DETAIL_DISTANCE = 105;
const SHIP_CLASS_IDS: ShipClassId[] = ["scout", "striker", "carrier"];
const MAX_COMBAT_EFFECTS =
  ENVIRONMENT_VISUAL_BASELINE.combatFeedback.objectPoolLimit;

type CombatEffectKind = "line" | "burst";

interface DistantShipBatch {
  mesh: THREE.InstancedMesh;
  unitIds: string[];
}

interface CombatEffect {
  kind: CombatEffectKind;
  object: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial | THREE.MeshBasicMaterial;
  ttl: number;
  maxTtl: number;
  baseScale: number;
}

type BattleLogTone = "system" | "friendly" | "hostile" | "result";

interface BattleLogEntry {
  id: number;
  time: number;
  message: string;
  tone: BattleLogTone;
}

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
const encounterSeed = getElement<HTMLElement>("#encounter-seed");
const friendlyStatus = getElement<HTMLElement>("#friendly-status");
const hostileStatus = getElement<HTMLElement>("#hostile-status");
const lossStatus = getElement<HTMLElement>("#loss-status");
const commandStatus = getElement<HTMLElement>("#command-status");
const copySeedButton = getElement<HTMLButtonElement>("#copy-seed");
const restartEncounterButton = getElement<HTMLButtonElement>("#restart-encounter");
const newEncounterButton = getElement<HTMLButtonElement>("#new-encounter");
const seedActionStatus = getElement<HTMLElement>("#seed-action-status");
const battleLogList = getElement<HTMLOListElement>("#battle-log");
const battleLogCount = getElement<HTMLElement>("#battle-log-count");
const unitScaleSelect = getElement<HTMLSelectElement>("#unit-scale");
const effectsQualityToggle = getElement<HTMLInputElement>("#effects-quality");
const effectsQualityValue = getElement<HTMLElement>("#effects-quality-value");
const visibleUnitCount = getElement<HTMLElement>("#visible-unit-count");
const frameCost = getElement<HTMLElement>("#frame-cost");
const longFrameCountValue = getElement<HTMLElement>("#long-frame-count");
const drawCallCount = getElement<HTMLElement>("#draw-call-count");
const minimapCanvas = getElement<HTMLCanvasElement>("#minimap");
const selectionBox = getElement<HTMLDivElement>("#selection-box");
const quickStartPanel = getElement<HTMLElement>("#quick-start-panel");
const quickStartClose = getElement<HTMLButtonElement>("#quick-start-close");
const helpToggle = getElement<HTMLButtonElement>("#help-toggle");
const minimapContext = minimapCanvas.getContext("2d");

const random = createSeededRandom(SCENE_SEED);
const scene = new THREE.Scene();
scene.background = new THREE.Color(ENVIRONMENT_VISUAL_BASELINE.background.clearColor);
scene.fog = new THREE.FogExp2(
  ENVIRONMENT_VISUAL_BASELINE.background.fogColor,
  ENVIRONMENT_VISUAL_BASELINE.background.fogDensity,
);

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
    preserveDrawingBuffer: CAPTURE_FRAME_ENABLED,
  });
  renderer.setPixelRatio(RENDER_PIXEL_RATIO);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = ENVIRONMENT_VISUAL_BASELINE.postProcess.toneMappingExposure;
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

const starfield = createStarfield(
  random,
  ENVIRONMENT_VISUAL_BASELINE.background.starCount,
);
starfield.renderOrder = ENVIRONMENT_RENDER_ORDER.starfield;
scene.add(starfield);

const spaceDust = createSpaceDust(
  random,
  ENVIRONMENT_VISUAL_BASELINE.background.dustCount,
);
spaceDust.renderOrder = ENVIRONMENT_RENDER_ORDER.spaceDust;
scene.add(spaceDust);

const distantPlanet = createDistantPlanet();
distantPlanet.renderOrder = ENVIRONMENT_RENDER_ORDER.distantPlanet;
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
rangeGrid.renderOrder = ENVIRONMENT_RENDER_ORDER.rangeGrid;
scene.add(rangeGrid);

const beacon = createNavigationBeacon();
scene.add(beacon);
const beaconInnerRing = beacon.getObjectByName("beacon-inner-ring");
const beaconOuterRing = beacon.getObjectByName("beacon-outer-ring");

const targetMarker = createTargetMarker();
targetMarker.visible = false;
targetMarker.renderOrder = ENVIRONMENT_RENDER_ORDER.targetMarker;
scene.add(targetMarker);

const world = createWorldState();
const shipViews = new Map<string, ShipView>();
const distantShipBatches = new Map<string, DistantShipBatch>();
const distantShipTransform = new THREE.Object3D();
for (const owner of ["player", "enemy"] as Faction[]) {
  for (const classId of SHIP_CLASS_IDS) {
    const key = getDistantShipBatchKey(owner, classId);
    const mesh = createDistantShipBatch(owner, classId, 200);
    mesh.userData.batchKey = key;
    distantShipBatches.set(key, { mesh, unitIds: [] });
    scene.add(mesh);
  }
}
let encounterUnitCount: StressUnitCount | null = SCENE_STRESS_UNIT_COUNT;
unitScaleSelect.value = encounterUnitCount ? String(encounterUnitCount) : "";
let effectsQuality: EffectsQuality = readEffectsQuality();
effectsQualityToggle.checked = effectsQuality === "high";
updateEffectsQualityLabel();
const neutralViews = new Map<string, THREE.Group>();
for (const unit of world.units.values()) {
  const view = createShipVisual(unit);
  shipViews.set(unit.id, view);
  scene.add(view.group);
}
for (const neutral of world.neutrals.values()) {
  const view = createNeutralView(neutral);
  neutralViews.set(neutral.id, view);
  scene.add(view);
}

const combatEffects: CombatEffect[] = [];
const combatEffectPool: Record<CombatEffectKind, CombatEffect[]> = {
  line: [],
  burst: [],
};
let combatEffectObjectCount = 0;
const audioEventBus = createAudioEventBus((event) => {
  window.dispatchEvent(new CustomEvent("rts-audio-event", { detail: event }));
  document.documentElement.dataset.audioEventCount = String(
    audioEventBus.history().length,
  );
  document.documentElement.dataset.audioLastCue = event.cue;
});
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y);
const pointerWorld = new THREE.Vector3();
const projectionViewMatrix = new THREE.Matrix4();
const viewFrustum = new THREE.Frustum();
const visibilitySphere = new THREE.Sphere();

let paused = false;
let accumulator = 0;
let simulationTime = 0;
let previousTime = performance.now();
const captureFrameReadyAt = previousTime + 4000;
let captureFrameSaved = false;
let frameCounter = 0;
let fpsWindowStart = previousTime;
let simulationWindowMs = 0;
let renderWindowMs = 0;
let longFrameCount = 0;
let detailedShipCount = 0;
let isPanning = false;
let lastPointerX = 0;
let lastPointerY = 0;
let isSelecting = false;
let selectionStartX = 0;
let selectionStartY = 0;
let selectionEndX = 0;
let selectionEndY = 0;
let lastTacticalHudUpdate = 0;
let battleLogVersion = 0;
let renderedBattleLogVersion = -1;
let renderedFleetSignature = "";
const battleLogEntries: BattleLogEntry[] = [];

runtimeStatus.textContent = "SYSTEM ONLINE";
simulationStatus.textContent = "RUNNING";
addBattleLog("system", "ENCOUNTER INITIALIZED · " + getEncounterSummary());
emitAudioEvent({
  type: "alert",
  cue: "encounter-start",
  time: simulationTime,
  channel: "warning",
  priority: "normal",
  position: cameraFocus,
  metadata: { seed: SCENE_SEED },
});
applyInspectionPresetFromUrl();
updateTelemetry(previousTime);
updateUnitCard();
renderPresentation();

window.addEventListener("resize", handleResize);
window.addEventListener("keydown", handleKeyDown);
copySeedButton.addEventListener("click", copyEncounterLink);
restartEncounterButton.addEventListener("click", resetEncounter);
newEncounterButton.addEventListener("click", startNewEncounter);
unitScaleSelect.addEventListener("change", handleUnitScaleChange);
effectsQualityToggle.addEventListener("change", handleEffectsQualityChange);
minimapCanvas.addEventListener("pointerdown", handleMinimapPointerDown);
minimapCanvas.addEventListener("keydown", handleMinimapKeyDown);
quickStartClose.addEventListener("click", hideQuickStart);
helpToggle.addEventListener("click", showQuickStart);
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
  const rawFrameMs = now - previousTime;
  const frameDelta = Math.min(rawFrameMs / 1000, 0.25);
  previousTime = now;
  accumulator += frameDelta;
  if (rawFrameMs > LONG_FRAME_THRESHOLD_MS && !document.hidden) {
    longFrameCount += 1;
  }

  const simulationStart = performance.now();
  while (accumulator >= FIXED_STEP) {
    if (!paused) {
      updateSimulation(world, FIXED_STEP);
    }
    accumulator -= FIXED_STEP;
  }
  simulationWindowMs += performance.now() - simulationStart;

  const renderStart = performance.now();
  renderPresentation();
  renderer.render(scene, camera);
  captureRenderedFrame(now);
  renderWindowMs += performance.now() - renderStart;
  updateTelemetry(now);
  requestAnimationFrame(render);
}

function captureRenderedFrame(now: number): void {
  if (
    !CAPTURE_FRAME_ENABLED ||
    captureFrameSaved ||
    now < captureFrameReadyAt
  ) {
    return;
  }
  const image = document.createElement("img");
  image.id = "qa-capture-frame";
  image.hidden = true;
  image.alt = "";
  image.src = renderer.domElement.toDataURL("image/jpeg", 0.92);
  document.body.append(image);
  document.documentElement.dataset.captureFrame = "ready";
  captureFrameSaved = true;
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
  emitAudioEvent({
    type: "attack",
    cue: "weapon-fire",
    time: simulationTime,
    channel: "combat",
    priority: "normal",
    intensity: 0.55 + attackerClass.damage / 220,
    source: getAudioUnitRef(attacker),
    target: getAudioUnitRef(target),
    position: attacker.position,
    metadata: { damage: attackerClass.damage },
  });
  createAttackEffect(attacker, target);
  emitAudioEvent({
    type: "hit",
    cue: "weapon-hit",
    time: simulationTime,
    channel: "combat",
    priority: target.health <= 0 ? "high" : "normal",
    intensity: target.health <= 0 ? 1 : 0.72,
    source: getAudioUnitRef(attacker),
    target: getAudioUnitRef(target),
    position: target.position,
    metadata: { remainingHealth: target.health },
  });
  addBattleLog(
    attacker.owner === "player" ? "friendly" : "hostile",
    attacker.id.toUpperCase() + " HIT " + target.id.toUpperCase() +
      " · -" + attackerClass.damage,
  );

  if (attacker.owner === "player") {
    state.statusMessage =
      "HIT " + target.id.toUpperCase() + " · -" + attackerClass.damage;
  } else if (target.selected) {
    state.statusMessage =
      "INCOMING FIRE · " + attacker.id.toUpperCase();
    emitAudioEvent({
      type: "alert",
      cue: "incoming-fire",
      time: simulationTime,
      channel: "warning",
      priority: "high",
      intensity: 0.9,
      source: getAudioUnitRef(attacker),
      target: getAudioUnitRef(target),
      position: target.position,
    });
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
  emitAudioEvent({
    type: "destroyed",
    cue: "unit-destroyed",
    time: simulationTime,
    channel: "combat",
    priority: "high",
    intensity: 1,
    source: getAudioUnitRef(attacker),
    target: getAudioUnitRef(unit),
    position: unit.position,
  });
  state.statusMessage =
    unit.id.toUpperCase() + " DESTROYED BY " + attacker.id.toUpperCase();
  addBattleLog("result", state.statusMessage);
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
    emitAudioEvent({
      type: "alert",
      cue: "victory",
      time: simulationTime,
      channel: "warning",
      priority: "critical",
      intensity: 1,
      position: cameraFocus,
    });
    addBattleLog("result", state.statusMessage);
  } else if (!playerAlive && enemyAlive) {
    state.winner = "enemy";
    state.statusMessage = "DEFEAT · SCOUT DESTROYED";
    paused = true;
    emitAudioEvent({
      type: "alert",
      cue: "defeat",
      time: simulationTime,
      channel: "warning",
      priority: "critical",
      intensity: 1,
      position: cameraFocus,
    });
    addBattleLog("result", state.statusMessage);
  }
}

function updateCombatEffects(step: number): void {
  for (let index = combatEffects.length - 1; index >= 0; index -= 1) {
    const effect = combatEffects[index];
    effect.ttl -= step;
    effect.material.opacity = Math.max(0, effect.ttl / effect.maxTtl);
    effect.object.scale.setScalar(
      effect.baseScale * (1 + (1 - effect.ttl / effect.maxTtl) * 0.35),
    );

    if (effect.ttl <= 0) {
      combatEffects.splice(index, 1);
      releaseCombatEffect(effect);
    }
  }
}

function renderPresentation(): void {
  const useDistantBatches = world.units.size >= 50;
  const detailDistance = world.units.size >= 50
    ? STRESS_DETAIL_DISTANCE
    : DEFAULT_DETAIL_DISTANCE;
  const detailDistanceSquared = detailDistance * detailDistance;
  let remainingShipLights = MAX_SHIP_LIGHTS;
  detailedShipCount = 0;

  for (const batch of distantShipBatches.values()) {
    batch.mesh.count = 0;
    batch.unitIds.length = 0;
  }

  for (const unit of world.units.values()) {
    const view = shipViews.get(unit.id);
    if (!view) {
      continue;
    }

    const deltaX = camera.position.x - unit.position.x;
    const deltaY = camera.position.y - unit.position.y;
    const deltaZ = camera.position.z - unit.position.z;
    const cameraDistanceSquared =
      deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
    const useDistantLod =
      !unit.selected && cameraDistanceSquared > detailDistanceSquared;
    const enableShipLight = !useDistantLod && remainingShipLights > 0;
    if (!useDistantLod) {
      detailedShipCount += 1;
    }
    if (enableShipLight) {
      remainingShipLights -= 1;
    }
    updateShipVisual(
      view,
      unit,
      simulationTime,
      effectsQuality,
      useDistantLod,
      enableShipLight,
      !useDistantBatches,
    );

    if (useDistantBatches && useDistantLod && !unit.destroyed) {
      const batch = distantShipBatches.get(
        getDistantShipBatchKey(unit.owner, unit.classId),
      );
      if (batch) {
        const instanceId = batch.unitIds.length;
        distantShipTransform.position.set(
          unit.position.x,
          unit.position.y,
          unit.position.z,
        );
        distantShipTransform.rotation.set(0, unit.heading, 0);
        distantShipTransform.scale.setScalar(SHIP_CLASSES[unit.classId].scale);
        distantShipTransform.updateMatrix();
        batch.mesh.setMatrixAt(instanceId, distantShipTransform.matrix);
        batch.unitIds.push(unit.id);
      }
    }
  }

  for (const batch of distantShipBatches.values()) {
    batch.mesh.count = batch.unitIds.length;
    batch.mesh.visible = batch.mesh.count > 0;
    if (batch.mesh.count > 0) {
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
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
      targetMarker.position.set(
        target.position.x,
        GROUND_Y + ENVIRONMENT_VISUAL_BASELINE.targetMarker.groundOffset,
        target.position.z,
      );
      targetMarker.visible = true;
      return;
    }
  }

  if (selected.targetPosition) {
    targetMarker.position.set(
      selected.targetPosition.x,
      GROUND_Y + ENVIRONMENT_VISUAL_BASELINE.targetMarker.groundOffset,
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
    frameCost.textContent =
      (simulationWindowMs / frameCounter).toFixed(2) + " / " +
      (renderWindowMs / frameCounter).toFixed(2) + " MS";
    visibleUnitCount.textContent =
      getVisibleUnitCount() + " / " + detailedShipCount;
    longFrameCountValue.textContent = String(longFrameCount);
    drawCallCount.textContent = String(renderer.info.render.calls);
    frameCounter = 0;
    fpsWindowStart = now;
    simulationWindowMs = 0;
    renderWindowMs = 0;
  }

  if (now - lastTacticalHudUpdate >= 100) {
    lastTacticalHudUpdate = now;
    const units = [...world.units.values()];
    const aliveCount = units.filter((unit) => !unit.destroyed).length;
    const playerAlive = units.filter(
      (unit) => unit.owner === "player" && !unit.destroyed,
    ).length;
    const enemyAlive = units.filter(
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
    updateUnitCard();
    updateFleetHud();
    updateEncounterHud();
    updateBattleLog();
    updateMinimap();
  }
}

function getVisibleUnitCount(): number {
  camera.updateMatrixWorld();
  projectionViewMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  viewFrustum.setFromProjectionMatrix(projectionViewMatrix);

  let count = 0;
  for (const unit of world.units.values()) {
    if (unit.destroyed) {
      continue;
    }
    const radius = unit.classId === "carrier"
      ? 13
      : unit.classId === "striker"
        ? 10
        : 8;
    visibilitySphere.center.set(unit.position.x, unit.position.y, unit.position.z);
    visibilitySphere.radius = radius;
    if (viewFrustum.intersectsSphere(visibilitySphere)) {
      count += 1;
    }
  }
  return count;
}

function updateFleetHud(): void {
  const playerUnits = [...world.units.values()].filter(
    (unit) => unit.owner === "player",
  );
  const displayUnits = playerUnits.slice(0, FLEET_LIST_LIMIT);
  const selectedOutsideLimit = playerUnits.find(
    (unit, index) => unit.selected && index >= FLEET_LIST_LIMIT,
  );
  if (selectedOutsideLimit) {
    displayUnits[displayUnits.length - 1] = selectedOutsideLimit;
  }
  const entries = displayUnits.map((unit) => {
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
    return { unit, label: unit.id.toUpperCase() + "  " + status + queue };
  });

  const groups = [...world.groups.entries()]
    .filter(([, ids]) => ids.size > 0)
    .map(([number, ids]) => "G" + number + " " + ids.size)
    .join("  ·  ");
  const groupLabel = groups || "NO GROUPS";
  const signature = entries.map(({ unit, label }) =>
    unit.id + ":" + unit.selected + ":" + unit.destroyed + ":" + label
  ).join("|") + "//" + groupLabel + "//" + playerUnits.length;
  if (signature === renderedFleetSignature) {
    return;
  }

  renderedFleetSignature = signature;
  fleetList.replaceChildren();
  for (const { unit, label } of entries) {
    const entry = document.createElement("li");
    entry.className = "fleet-list__entry";
    if (unit.selected) {
      entry.classList.add("fleet-list__entry--selected");
    }
    if (unit.destroyed) {
      entry.classList.add("fleet-list__entry--destroyed");
    }
    entry.textContent = label;
    fleetList.append(entry);
  }
  if (playerUnits.length > displayUnits.length) {
    const summary = document.createElement("li");
    summary.className = "fleet-list__entry fleet-list__entry--summary";
    summary.textContent =
      "+ " + (playerUnits.length - displayUnits.length) + " UNITS";
    fleetList.append(summary);
  }
  groupValues.textContent = groupLabel;
}

function updateEncounterHud(): void {
  const units = [...world.units.values()];
  const playerTotal = units.filter((unit) => unit.owner === "player").length;
  const enemyTotal = units.filter((unit) => unit.owner === "enemy").length;
  const playerAlive = units.filter(
    (unit) => unit.owner === "player" && !unit.destroyed,
  ).length;
  const enemyAlive = units.filter(
    (unit) => unit.owner === "enemy" && !unit.destroyed,
  ).length;
  const queuedOrders = units.reduce(
    (total, unit) => total + unit.orderQueue.length,
    0,
  );

  encounterSeed.textContent = String(world.seed >>> 0);
  friendlyStatus.textContent = playerAlive + " / " + playerTotal;
  hostileStatus.textContent = enemyAlive + " / " + enemyTotal;
  lossStatus.textContent =
    (playerTotal - playerAlive) + " / " + (enemyTotal - enemyAlive);
  commandStatus.textContent = world.selectedUnitIds.size + " / " + queuedOrders;
}

function updateBattleLog(): void {
  if (renderedBattleLogVersion === battleLogVersion) {
    return;
  }

  renderedBattleLogVersion = battleLogVersion;
  battleLogList.replaceChildren();
  const visibleEntries = battleLogEntries.slice(-8).reverse();
  for (const logEntry of visibleEntries) {
    const entry = document.createElement("li");
    entry.className = "battle-log__entry battle-log__entry--" + logEntry.tone;
    const time = document.createElement("span");
    time.className = "battle-log__time";
    time.textContent = "T+" + logEntry.time.toFixed(1).padStart(5, "0");
    const message = document.createElement("span");
    message.textContent = logEntry.message;
    entry.append(time, message);
    battleLogList.append(entry);
  }
  battleLogCount.textContent = String(battleLogEntries.length).padStart(2, "0");
}

function addBattleLog(tone: BattleLogTone, message: string): void {
  battleLogVersion += 1;
  battleLogEntries.push({
    id: battleLogVersion,
    time: simulationTime,
    message,
    tone,
  });
  if (battleLogEntries.length > 40) {
    battleLogEntries.shift();
  }
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

  const footprint = getCameraGroundFootprint();
  if (footprint.length === 4) {
    minimapContext.strokeStyle = "rgba(216, 223, 225, 0.62)";
    minimapContext.lineWidth = 1;
    minimapContext.beginPath();
    footprint.forEach((position, index) => {
      const point = toMap(position);
      if (index === 0) {
        minimapContext.moveTo(point.x, point.y);
      } else {
        minimapContext.lineTo(point.x, point.y);
      }
    });
    minimapContext.closePath();
    minimapContext.stroke();
  }

  const focusPoint = toMap({
    x: cameraFocus.x,
    y: GROUND_Y,
    z: cameraFocus.z,
  });
  minimapContext.strokeStyle = "rgba(216, 223, 225, 0.9)";
  minimapContext.beginPath();
  minimapContext.moveTo(focusPoint.x - 3, focusPoint.y);
  minimapContext.lineTo(focusPoint.x + 3, focusPoint.y);
  minimapContext.moveTo(focusPoint.x, focusPoint.y - 3);
  minimapContext.lineTo(focusPoint.x, focusPoint.y + 3);
  minimapContext.stroke();
}

function getCameraGroundFootprint(): Vec3[] {
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const footprint: Vec3[] = [];

  for (const [x, y] of corners) {
    const point = new THREE.Vector3(x, y, 0.5).unproject(camera);
    const direction = point.sub(camera.position).normalize();
    if (Math.abs(direction.y) < 0.0001) {
      return [];
    }
    const distance = (GROUND_Y - camera.position.y) / direction.y;
    if (distance <= 0) {
      return [];
    }
    const groundPoint = camera.position.clone().addScaledVector(direction, distance);
    footprint.push({ x: groundPoint.x, y: GROUND_Y, z: groundPoint.z });
  }

  return footprint;
}

function handleMinimapPointerDown(event: PointerEvent): void {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const bounds = minimapCanvas.getBoundingClientRect();
  focusCameraFromMinimap(
    (event.clientX - bounds.left) / bounds.width,
    (event.clientY - bounds.top) / bounds.height,
  );
}

function handleMinimapKeyDown(event: KeyboardEvent): void {
  const offsets: Record<string, { x: number; z: number }> = {
    ArrowLeft: { x: -8, z: 0 },
    ArrowRight: { x: 8, z: 0 },
    ArrowUp: { x: 0, z: -8 },
    ArrowDown: { x: 0, z: 8 },
  };

  if (event.key === "Enter") {
    event.preventDefault();
    focusCameraFromMinimap(0.5, 0.5);
    return;
  }

  const offset = offsets[event.key];
  if (!offset) {
    return;
  }
  event.preventDefault();
  cameraFocus.x = THREE.MathUtils.clamp(
    cameraFocus.x + offset.x,
    -BATTLEFIELD_RADIUS,
    BATTLEFIELD_RADIUS,
  );
  cameraFocus.z = THREE.MathUtils.clamp(
    cameraFocus.z + offset.z,
    -BATTLEFIELD_RADIUS,
    BATTLEFIELD_RADIUS,
  );
  applyCameraTransform();
}

function focusCameraFromMinimap(normalizedX: number, normalizedY: number): void {
  cameraFocus.x = THREE.MathUtils.clamp(
    normalizedX * BATTLEFIELD_RADIUS * 2 - BATTLEFIELD_RADIUS,
    -BATTLEFIELD_RADIUS,
    BATTLEFIELD_RADIUS,
  );
  cameraFocus.z = THREE.MathUtils.clamp(
    normalizedY * BATTLEFIELD_RADIUS * 2 - BATTLEFIELD_RADIUS,
    -BATTLEFIELD_RADIUS,
    BATTLEFIELD_RADIUS,
  );
  applyCameraTransform();
  world.statusMessage = "CAMERA FOCUS · " + formatPosition(cameraFocus);
  seedActionStatus.textContent = world.statusMessage;
  seedActionStatus.classList.remove("seed-action-status--error");
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
    addBattleLog("system", paused ? "SIMULATION PAUSED" : "SIMULATION RESUMED");
    emitUiAudio(paused ? "ui-pause" : "ui-resume", "normal");
  }

  if (key === "n") {
    resetEncounter();
  }

  if (key === "s") {
    stopSelectedUnits();
  }

  if (key === "h") {
    if (quickStartPanel.hidden) {
      showQuickStart();
    } else {
      hideQuickStart();
    }
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

function hideQuickStart(): void {
  quickStartPanel.hidden = true;
  helpToggle.hidden = false;
}

function showQuickStart(): void {
  quickStartPanel.hidden = false;
  helpToggle.hidden = true;
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
      emitUiAudio("ui-target-lock", "normal", { targetId: hit.id });
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
  const pickTargets: THREE.Object3D[] = [];
  for (const view of shipViews.values()) {
    if (view.group.visible && view.detailGroup.visible) {
      pickTargets.push(view.group);
    }
  }
  for (const batch of distantShipBatches.values()) {
    if (batch.mesh.visible && batch.mesh.count > 0) {
      pickTargets.push(batch.mesh);
    }
  }
  const intersections = raycaster.intersectObjects(
    pickTargets,
    true,
  );

  for (const intersection of intersections) {
    if (
      intersection.object instanceof THREE.InstancedMesh &&
      intersection.instanceId !== undefined
    ) {
      const batchKey = intersection.object.userData.batchKey;
      const batch = typeof batchKey === "string"
        ? distantShipBatches.get(batchKey)
        : undefined;
      const unitId = batch?.unitIds[intersection.instanceId];
      const unit = unitId ? world.units.get(unitId) : undefined;
      if (unit && !unit.destroyed) {
        return unit;
      }
    }

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
  emitUiAudio("ui-select", "normal", { count: world.selectedUnitIds.size });
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
  emitUiAudio("ui-select", "normal", { count: world.selectedUnitIds.size });
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
  emitUiAudio(queue ? "ui-queue-move" : "ui-move-order", "normal", {
    count: selectedIds.length,
  });
  addBattleLog("friendly", world.statusMessage + " · " + selectedIds.length + " UNITS");

  selectedIds.forEach((unitId, index) => {
    const unit = world.units.get(unitId);
    if (unit && !unit.destroyed) {
      const nextOrder: UnitOrder = {
        type: "move",
        targetPosition: getFormationTarget(target, index, selectedIds.length),
      };
      queueUnitOrder(unit, nextOrder, queue);
    }
  });
  updateUnitCard();
}

function issueAttackOrder(targetId: string, queue = false): void {
  const target = world.units.get(targetId);
  const selectedIds = [...world.selectedUnitIds];
  if (!target || target.destroyed || selectedIds.length === 0) {
    world.statusMessage = "SELECT A PLAYER UNIT FIRST";
    emitUiAudio("ui-error", "high", { reason: "attack-without-selection" });
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
  emitUiAudio(queue ? "ui-queue-attack" : "ui-attack-order", "normal", {
    count: selectedIds.length,
    targetId,
  });
  addBattleLog("friendly", world.statusMessage + " · " + selectedIds.length + " UNITS");

  for (const unitId of selectedIds) {
    const unit = world.units.get(unitId);
    if (unit && !unit.destroyed) {
      const nextOrder: UnitOrder = { type: "attack", targetUnitId: targetId };
      queueUnitOrder(unit, nextOrder, queue);
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
  emitUiAudio("ui-stop-order", "normal", { count: world.selectedUnitIds.size });
  addBattleLog("system", "STOP ORDER · " + world.selectedUnitIds.size + " UNITS");
  updateUnitCard();
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

function applyInspectionPresetFromUrl(): void {
  const searchParams = new URLSearchParams(window.location.search);
  const inspectUnitId = searchParams.get("inspectUnit")?.trim().toLowerCase();
  const captureUnitId = searchParams.get("captureUnit")?.trim().toLowerCase();
  const requestedUnitId = captureUnitId || inspectUnitId;
  if (!requestedUnitId) {
    return;
  }
  const unit = [...world.units.values()].find(
    (candidate) =>
      candidate.owner === "player" &&
      candidate.id.toLowerCase() === requestedUnitId,
  );
  if (!unit) {
    return;
  }

  if (inspectUnitId) {
    setSelection(unit.id);
  }
  cameraFocus.set(unit.position.x, initialCameraFocus.y, unit.position.z);
  cameraZoom = captureUnitId
    ? unit.classId === "carrier" ? 0.36 : 0.28
    : 0.55;
  applyCameraTransform();
  paused = true;
  simulationStatus.textContent = "PAUSED";
  world.statusMessage = (captureUnitId ? "CAPTURE · " : "INSPECT · ") +
    unit.id.toUpperCase();
  addBattleLog("system", world.statusMessage);
}

function applyCameraTransform(): void {
  camera.position.copy(cameraFocus).addScaledVector(cameraOffset, cameraZoom);
  camera.lookAt(cameraFocus);
}

function resetEncounter(): void {
  loadEncounter(world.seed, "ENCOUNTER RESTARTED");
}

function startNewEncounter(): void {
  const seedBuffer = new Uint32Array(1);
  crypto.getRandomValues(seedBuffer);
  const nextSeed = seedBuffer[0] === world.seed
    ? (seedBuffer[0] + 1) >>> 0
    : seedBuffer[0];
  const url = getEncounterUrl(nextSeed);
  window.history.replaceState(null, "", url);
  loadEncounter(nextSeed, "NEW ENCOUNTER GENERATED");
}

function handleUnitScaleChange(): void {
  encounterUnitCount = parseStressUnitCount(unitScaleSelect.value);
  window.history.replaceState(null, "", getEncounterUrl(world.seed));
  loadEncounter(
    world.seed,
    "FLEET SCALE · " + (encounterUnitCount ?? "SKIRMISH"),
  );
}

async function copyEncounterLink(): Promise<void> {
  const url = getEncounterUrl(world.seed).toString();
  try {
    if (!navigator.clipboard) {
      throw new Error("Clipboard API unavailable");
    }
    await navigator.clipboard.writeText(url);
    seedActionStatus.textContent = "LINK COPIED · " + String(world.seed >>> 0);
    seedActionStatus.classList.remove("seed-action-status--error");
    addBattleLog("system", "ENCOUNTER LINK COPIED");
  } catch {
    seedActionStatus.textContent = "COPY FAILED · USE ADDRESS BAR";
    seedActionStatus.classList.add("seed-action-status--error");
    addBattleLog("system", "ENCOUNTER LINK COPY FAILED");
  }
}

function getEncounterUrl(seed: number): URL {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", String(seed >>> 0));
  if (encounterUnitCount) {
    url.searchParams.set("units", String(encounterUnitCount));
  } else {
    url.searchParams.delete("units");
  }
  url.searchParams.delete("rev");
  return url;
}

function readRenderPixelRatio(): number {
  const requested = Number(
    new URLSearchParams(window.location.search).get("pixelRatio"),
  );
  return requested === 1 ? 1 : Math.min(window.devicePixelRatio, 2);
}

function loadEncounter(seed: number, statusMessage: string): void {
  paused = false;
  simulationTime = 0;
  accumulator = 0;
  world.seed = seed >>> 0;
  world.winner = null;
  world.lastOrder = null;
  world.aimedTargetId = null;
  world.playerHasEngaged = false;
  world.groups.clear();
  clearDistantShipBatches();

  const encounter = createEncounter(world.seed, encounterUnitCount ?? undefined);
  const freshUnits = new Map(encounter.units.map((unit) => [unit.id, unit]));

  for (const [id, view] of shipViews) {
    if (!freshUnits.has(id)) {
      removeSceneObject(view.group);
      shipViews.delete(id);
    }
  }

  for (const unit of freshUnits.values()) {
    if (!shipViews.has(unit.id)) {
      const view = createShipVisual(unit);
      shipViews.set(unit.id, view);
      scene.add(view.group);
    }
    const view = shipViews.get(unit.id);
    if (view) {
      view.group.visible = true;
    }
  }
  world.units = freshUnits;

  for (const view of neutralViews.values()) {
    removeSceneObject(view);
  }
  neutralViews.clear();
  world.neutrals = new Map(
    encounter.neutrals.map((neutral) => [neutral.id, neutral]),
  );
  for (const neutral of world.neutrals.values()) {
    const view = createNeutralView(neutral);
    neutralViews.set(neutral.id, view);
    scene.add(view);
  }

  clearCombatEffects();
  world.selectedUnitIds.clear();
  world.statusMessage = statusMessage;
  targetMarker.visible = false;
  resetCamera();
  battleLogEntries.length = 0;
  renderedBattleLogVersion = -1;
  renderedFleetSignature = "";
  resetPerformanceMetrics();
  addBattleLog("system", statusMessage + " · " + getEncounterSummary());
  emitAudioEvent({
    type: "alert",
    cue: "encounter-start",
    time: simulationTime,
    channel: "warning",
    priority: "normal",
    position: cameraFocus,
    metadata: { seed: world.seed },
  });
  seedActionStatus.textContent = statusMessage;
  seedActionStatus.classList.remove("seed-action-status--error");
  updateUnitCard();
  updateFleetHud();
  updateEncounterHud();
  updateBattleLog();
  updateMinimap();
}

function removeSceneObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const renderable = child as THREE.Mesh;
    if (renderable.geometry instanceof THREE.BufferGeometry) {
      geometries.add(renderable.geometry);
    }
    if (Array.isArray(renderable.material)) {
      renderable.material.forEach((material) => materials.add(material));
    } else if (renderable.material instanceof THREE.Material) {
      materials.add(renderable.material);
    }
  });
  scene.remove(object);
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function getEncounterSummary(): string {
  const playerCount = [...world.units.values()].filter(
    (unit) => unit.owner === "player",
  ).length;
  const enemyCount = [...world.units.values()].filter(
    (unit) => unit.owner === "enemy",
  ).length;
  return playerCount + "V" + enemyCount + " · SEED " + String(world.seed >>> 0);
}

function resetPerformanceMetrics(): void {
  frameCounter = 0;
  fpsWindowStart = performance.now();
  simulationWindowMs = 0;
  renderWindowMs = 0;
  longFrameCount = 0;
  longFrameCountValue.textContent = "0";
  frameCost.textContent = "-- / -- MS";
}

function getDistantShipBatchKey(
  owner: Faction,
  classId: ShipClassId,
): string {
  return owner + ":" + classId;
}

function clearDistantShipBatches(): void {
  for (const batch of distantShipBatches.values()) {
    batch.mesh.count = 0;
    batch.mesh.visible = false;
    batch.unitIds.length = 0;
  }
}

function readEffectsQuality(): EffectsQuality {
  return window.localStorage.getItem("rts-effects-quality") === "low"
    ? "low"
    : "high";
}

function handleEffectsQualityChange(): void {
  effectsQuality = effectsQualityToggle.checked ? "high" : "low";
  window.localStorage.setItem("rts-effects-quality", effectsQuality);
  updateEffectsQualityLabel();
  emitUiAudio("ui-toggle-effects", "low", { quality: effectsQuality });
  addBattleLog("system", "VISUAL EFFECTS · " + effectsQuality.toUpperCase());
}

function updateEffectsQualityLabel(): void {
  effectsQualityValue.textContent = effectsQuality.toUpperCase();
}

function createWorldState(): WorldState {
  const encounter = createEncounter(
    SCENE_SEED,
    SCENE_STRESS_UNIT_COUNT ?? undefined,
  );
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

function createNeutralView(neutral: NeutralObject): THREE.Group {
  const group = new THREE.Group();
  group.name = neutral.id + "-view";
  group.renderOrder = ENVIRONMENT_RENDER_ORDER.asteroid;
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
      emissiveIntensity:
        ENVIRONMENT_VISUAL_BASELINE.asteroid.bodyEmissiveIntensity,
      metalness: ENVIRONMENT_VISUAL_BASELINE.asteroid.bodyMetalness,
      roughness: ENVIRONMENT_VISUAL_BASELINE.asteroid.bodyRoughness,
      flatShading: true,
    }),
  );
  body.scale.set(1.1, 0.72, 1.22);
  group.add(body);

  const facet = new THREE.Mesh(
    new THREE.TetrahedronGeometry(0.85, 0),
    new THREE.MeshStandardMaterial({
      color: 0x20292b,
      metalness: ENVIRONMENT_VISUAL_BASELINE.asteroid.facetMetalness,
      roughness: ENVIRONMENT_VISUAL_BASELINE.asteroid.facetRoughness,
      flatShading: true,
    }),
  );
  facet.position.set(0.6, 0.7, 0.35);
  facet.rotation.set(0.2, 0.5, -0.3);
  group.add(facet);
  return group;
}

function readSeedFromUrl(): number {
  const rawSeed = new URLSearchParams(window.location.search).get("seed");
  if (!rawSeed) {
    return DEFAULT_SEED;
  }

  const parsedSeed = Number.parseInt(rawSeed, 10);
  return Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : DEFAULT_SEED;
}

function readStressUnitCountFromUrl(): StressUnitCount | null {
  return parseStressUnitCount(
    new URLSearchParams(window.location.search).get("units") ?? "",
  );
}

function parseStressUnitCount(value: string): StressUnitCount | null {
  const parsed = Number.parseInt(value, 10);
  return STRESS_UNIT_COUNTS.includes(parsed as StressUnitCount)
    ? parsed as StressUnitCount
    : null;
}

function formatSeedLabel(seed: number): string {
  return "RTS-P6-" + String(seed >>> 0).slice(-6).padStart(6, "0");
}

function emitAudioEvent(input: Parameters<typeof audioEventBus.emit>[0]): void {
  audioEventBus.emit(input);
}

function emitUiAudio(
  cue: string,
  priority: "high" | "normal" | "low" = "normal",
  metadata?: Readonly<Record<string, string | number | boolean>>,
): void {
  emitAudioEvent({
    type: "ui",
    cue,
    time: simulationTime,
    channel: "ui",
    priority,
    metadata,
  });
}

function getAudioUnitRef(unit: Unit) {
  return createAudioUnitRef({
    id: unit.id,
    owner: unit.owner,
    classId: unit.classId,
  });
}

function createAttackEffect(attacker: Unit, target: Unit): void {
  if (combatEffects.length >= getCombatEffectActiveBudget(effectsQuality)) {
    return;
  }
  const effect = acquireCombatEffect("line");
  if (effect) {
    const positions = effect.geometry.getAttribute("position") as THREE.BufferAttribute;
    positions.setXYZ(
      0,
      attacker.position.x,
      attacker.position.y,
      attacker.position.z,
    );
    positions.setXYZ(
      1,
      target.position.x,
      target.position.y,
      target.position.z,
    );
    positions.needsUpdate = true;
    effect.material.color.setHex(
      attacker.owner === "player" ? 0x8fcbd2 : 0xd7a188,
    );
    effect.material.opacity = effectsQuality === "high"
      ? ENVIRONMENT_VISUAL_BASELINE.combatFeedback.highLineOpacity
      : ENVIRONMENT_VISUAL_BASELINE.combatFeedback.lowLineOpacity;
    activateCombatEffect(effect, 0.16, 1);
  }

  if (effectsQuality === "high") {
    createHitFlash(target, attacker.owner);
  }
}

function createHitFlash(target: Unit, attackerOwner: Faction): void {
  if (combatEffects.length >= getCombatEffectActiveBudget(effectsQuality)) {
    return;
  }
  const effect = acquireCombatEffect("burst");
  if (!effect) {
    return;
  }
  effect.material.color.setHex(
    attackerOwner === "player" ? 0xbdebf0 : 0xf0ae92,
  );
  effect.material.opacity = 0.88;
  effect.object.position.set(
    target.position.x,
    target.position.y,
    target.position.z,
  );
  activateCombatEffect(effect, 0.24, 0.86);
}

function createImpactEffect(unit: Unit): void {
  if (combatEffects.length >= getCombatEffectActiveBudget(effectsQuality)) {
    return;
  }
  const effect = acquireCombatEffect("burst");
  if (!effect) {
    return;
  }
  effect.material.color.setHex(
    unit.owner === "player" ? 0x8fcbd2 : 0xd7a188,
  );
  effect.material.opacity = 0.76;
  effect.object.position.set(unit.position.x, unit.position.y, unit.position.z);
  activateCombatEffect(effect, 0.6, 2.35);
}

function clearCombatEffects(): void {
  while (combatEffects.length > 0) {
    const effect = combatEffects.pop();
    if (effect) {
      releaseCombatEffect(effect);
    }
  }
}

function acquireCombatEffect(kind: CombatEffectKind): CombatEffect | null {
  const pooled = combatEffectPool[kind].pop();
  if (pooled) {
    return pooled;
  }
  if (combatEffectObjectCount >= MAX_COMBAT_EFFECTS) {
    return null;
  }

  combatEffectObjectCount += 1;
  if (kind === "line") {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    (geometry.getAttribute("position") as THREE.BufferAttribute).setUsage(
      THREE.DynamicDrawUsage,
    );
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const object = new THREE.Line(geometry, material);
    object.renderOrder = ENVIRONMENT_RENDER_ORDER.combatFeedback;
    return {
      kind,
      object,
      geometry,
      material,
      ttl: 0,
      maxTtl: 0,
      baseScale: 1,
    };
  }

  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const object = new THREE.Mesh(geometry, material);
  object.renderOrder = ENVIRONMENT_RENDER_ORDER.combatFeedback;
  return {
    kind,
    object,
    geometry,
    material,
    ttl: 0,
    maxTtl: 0,
    baseScale: 1,
  };
}

function activateCombatEffect(
  effect: CombatEffect,
  ttl: number,
  baseScale: number,
): void {
  effect.ttl = ttl;
  effect.maxTtl = ttl;
  effect.baseScale = baseScale;
  effect.object.scale.setScalar(baseScale);
  scene.add(effect.object);
  combatEffects.push(effect);
}

function releaseCombatEffect(effect: CombatEffect): void {
  scene.remove(effect.object);
  effect.material.opacity = 0;
  combatEffectPool[effect.kind].push(effect);
}

function createTargetMarker(): THREE.Group {
  const marker = new THREE.Group();
  marker.name = "combat-target-marker";

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.05, 3.2, 48, 1, 0.15, Math.PI * 1.55),
    new THREE.MeshBasicMaterial({
      color: 0xc99a69,
      transparent: true,
      opacity: ENVIRONMENT_VISUAL_BASELINE.targetMarker.ringOpacity,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  marker.add(ring);

  const bracketMaterial = new THREE.MeshBasicMaterial({
    color: 0xd9b48a,
    transparent: true,
    opacity: ENVIRONMENT_VISUAL_BASELINE.targetMarker.bracketOpacity,
    blending: THREE.AdditiveBlending,
    depthTest: false,
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
    opacity: ENVIRONMENT_VISUAL_BASELINE.background.starOpacity,
    blending: THREE.AdditiveBlending,
    depthTest: false,
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
    opacity: ENVIRONMENT_VISUAL_BASELINE.background.dustOpacity,
    depthTest: false,
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
      opacity: ENVIRONMENT_VISUAL_BASELINE.background.distantPlanetOpacity,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  group.add(atmosphere);
  return group;
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
