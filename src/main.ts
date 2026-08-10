import * as THREE from "three";
import "./styles.css";

const FIXED_STEP = 1 / 60;
const SCENE_SEED = 20260810;
const GROUND_Y = -18;
const SHIP_Y = GROUND_Y + 5;

type ShipClassId = "scout";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface ShipClass {
  id: ShipClassId;
  name: string;
  speed: number;
  maxHealth: number;
  silhouette: string;
}

interface Unit {
  id: string;
  owner: "player";
  classId: ShipClassId;
  position: Vec3;
  heading: number;
  target: Vec3 | null;
  health: number;
  selected: boolean;
}

interface MoveOrder {
  type: "move";
  sourceUnitIds: string[];
  targetPosition: Vec3;
  createdAt: number;
}

interface WorldState {
  seed: number;
  units: Map<string, Unit>;
  selectedUnitIds: Set<string>;
  lastOrder: MoveOrder | null;
  statusMessage: string;
}

interface ShipView {
  group: THREE.Group;
  selectionRing: THREE.Mesh;
  thrusterGlows: THREE.Mesh[];
}

const SCOUT_CLASS: ShipClass = {
  id: "scout",
  name: "AURORA SCOUT",
  speed: 18,
  maxHealth: 100,
  silhouette: "LIGHT RECON",
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

const shipView = createTestShip();
scene.add(shipView.group);

const world = createWorldState();
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
unitCount.textContent = String(world.units.size);
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
    if (!unit.target) {
      continue;
    }

    const deltaX = unit.target.x - unit.position.x;
    const deltaZ = unit.target.z - unit.position.z;
    const distance = Math.hypot(deltaX, deltaZ);

    if (distance <= 0.15) {
      unit.position.x = unit.target.x;
      unit.position.z = unit.target.z;
      unit.target = null;
      state.statusMessage = "AT POSITION";
      targetMarker.visible = false;
      continue;
    }

    const travel = Math.min(distance, SCOUT_CLASS.speed * step);
    unit.position.x += (deltaX / distance) * travel;
    unit.position.z += (deltaZ / distance) * travel;
    unit.heading = Math.atan2(deltaX, deltaZ);
  }
}

function renderPresentation(): void {
  const unit = world.units.get("scout-01");
  if (!unit) {
    return;
  }

  shipView.group.position.set(
    unit.position.x,
    unit.position.y,
    unit.position.z,
  );
  shipView.group.rotation.y = unit.heading;

  const thrusterPulse = 0.86 + Math.sin(simulationTime * 8) * 0.14;
  for (const thruster of shipView.thrusterGlows) {
    thruster.scale.set(1, thrusterPulse, 1);
  }

  const selectionPulse = 1 + Math.sin(simulationTime * 4) * 0.06;
  shipView.selectionRing.scale.setScalar(selectionPulse);
}

function updateTelemetry(now: number): void {
  frameCounter += 1;
  const elapsed = now - fpsWindowStart;

  if (elapsed >= 500) {
    fpsValue.textContent = String(Math.round((frameCounter * 1000) / elapsed));
    frameCounter = 0;
    fpsWindowStart = now;
  }

  simulationStatus.textContent = paused ? "PAUSED" : "RUNNING";
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
}

function handlePointerDown(event: PointerEvent): void {
  if (event.button === 1) {
    isPanning = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
    return;
  }

  if (event.button === 0) {
    const hit = pickUnit(event);
    setSelection(hit ? hit.id : null);
    return;
  }

  if (event.button === 2) {
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
  const intersections = raycaster.intersectObject(shipView.group, true);
  return intersections.length > 0 ? world.units.get("scout-01") ?? null : null;
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

  for (const unit of world.units.values()) {
    unit.selected = unit.id === unitId;
    if (unit.selected) {
      world.selectedUnitIds.add(unit.id);
    }
  }

  shipView.selectionRing.visible = Boolean(unitId);
  if (unitId) {
    world.statusMessage = "SELECTED · RIGHT CLICK TO MOVE";
  } else {
    world.statusMessage = "SELECT A UNIT";
  }
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
    if (unit) {
      unit.target = { ...target };
    }
  }

  targetMarker.position.set(target.x, GROUND_Y + 0.12, target.z);
  targetMarker.visible = true;
  updateUnitCard();
}

function updateUnitCard(): void {
  const unit = getSelectedUnit();
  if (!unit) {
    unitCard.hidden = true;
    return;
  }

  unitCard.hidden = false;
  selectedUnitName.textContent = unit.id.toUpperCase();
  selectedUnitClass.textContent = SCOUT_CLASS.name + " // " + SCOUT_CLASS.silhouette;
  selectedUnitHealth.textContent = unit.health + " / " + SCOUT_CLASS.maxHealth;
  selectedUnitOrder.textContent = world.statusMessage;
}

function getSelectedUnit(): Unit | null {
  const selectedId = [...world.selectedUnitIds][0];
  return selectedId ? world.units.get(selectedId) ?? null : null;
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
  const unit = world.units.get("scout-01");
  if (!unit) {
    return;
  }

  unit.position = { x: -32, y: SHIP_Y, z: 28 };
  unit.heading = 0;
  unit.target = null;
  unit.health = SCOUT_CLASS.maxHealth;
  world.lastOrder = null;
  world.statusMessage = "ENCOUNTER RESET";
  targetMarker.visible = false;
  setSelection(null);
  resetCamera();
}

function createWorldState(): WorldState {
  return {
    seed: SCENE_SEED,
    units: new Map([
      [
        "scout-01",
        {
          id: "scout-01",
          owner: "player",
          classId: SCOUT_CLASS.id,
          position: { x: -32, y: SHIP_Y, z: 28 },
          heading: 0,
          target: null,
          health: SCOUT_CLASS.maxHealth,
          selected: false,
        },
      ],
    ]),
    selectedUnitIds: new Set(),
    lastOrder: null,
    statusMessage: "SELECT A UNIT",
  };
}

function createTestShip(): ShipView {
  const group = new THREE.Group();
  group.name = "scout-01-view";

  const hullMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e7491,
    emissive: 0x063b52,
    emissiveIntensity: 1.8,
    metalness: 0.9,
    roughness: 0.24,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x94e8f8,
    emissive: 0x1e9bb7,
    emissiveIntensity: 2.4,
    metalness: 0.8,
    roughness: 0.18,
  });
  const engineMaterial = new THREE.MeshBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.86,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const hull = new THREE.Mesh(new THREE.ConeGeometry(3.5, 11, 6), hullMaterial);
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

  const thrusterGlows: THREE.Mesh[] = [];
  for (const x of [-1.65, 1.65]) {
    const thruster = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.92, 3.4, 12),
      engineMaterial,
    );
    thruster.rotation.x = Math.PI / 2;
    thruster.position.set(x, -0.35, -3.4);
    group.add(thruster);
    thrusterGlows.push(thruster);
  }

  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(4.7, 5.05, 48),
    new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
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

  const shipLight = new THREE.PointLight(0x22d3ee, 18, 42, 2);
  shipLight.position.set(0, 0.5, 0);
  group.add(shipLight);

  return { group, selectionRing, thrusterGlows };
}

function createTargetMarker(): THREE.Group {
  const marker = new THREE.Group();
  marker.name = "move-target-marker";

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
