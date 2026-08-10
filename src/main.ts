import * as THREE from "three";
import "./styles.css";

const FIXED_STEP = 1 / 60;
const SCENE_SEED = 20260810;

const app = getElement<HTMLDivElement>("#app");
const runtimeStatus = getElement<HTMLElement>("#runtime-status");
const simulationStatus = getElement<HTMLElement>("#simulation-status");
const fpsValue = getElement<HTMLElement>("#fps-value");
const fatalError = getElement<HTMLElement>("#fatal-error");
const fatalErrorMessage = getElement<HTMLElement>("#fatal-error-message");

const random = createSeededRandom(SCENE_SEED);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020617);
scene.fog = new THREE.FogExp2(0x020617, 0.00022);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 12000);
const initialCameraPosition = new THREE.Vector3(0, 74, 158);
camera.position.copy(initialCameraPosition);
camera.lookAt(0, 0, 0);

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
rangeGrid.position.y = -18;
const rangeGridMaterial = Array.isArray(rangeGrid.material)
  ? rangeGrid.material[0]
  : rangeGrid.material;
rangeGridMaterial.transparent = true;
rangeGridMaterial.opacity = 0.32;
scene.add(rangeGrid);

const beacon = createNavigationBeacon();
scene.add(beacon);

const axisHelper = new THREE.AxesHelper(24);
axisHelper.visible = false;
scene.add(axisHelper);

let paused = false;
let accumulator = 0;
let simulationTime = 0;
let previousTime = performance.now();
let frameCounter = 0;
let fpsWindowStart = previousTime;

runtimeStatus.textContent = "SYSTEM ONLINE";
simulationStatus.textContent = "RUNNING";

window.addEventListener("resize", handleResize);
window.addEventListener("keydown", handleKeyDown);
requestAnimationFrame(render);

function render(now: number): void {
  const frameDelta = Math.min((now - previousTime) / 1000, 0.25);
  previousTime = now;
  accumulator += frameDelta;

  while (accumulator >= FIXED_STEP) {
    if (!paused) {
      updateSimulation(FIXED_STEP);
    }
    accumulator -= FIXED_STEP;
  }

  renderer.render(scene, camera);
  updateTelemetry(now);
  requestAnimationFrame(render);
}

function updateSimulation(step: number): void {
  simulationTime += step;
  beacon.rotation.y += step * 0.18;
  beacon.children[1].rotation.z -= step * 0.3;
  beacon.children[2].rotation.z += step * 0.22;
  rangeGrid.rotation.y += step * 0.006;
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
    "SYSTEM ONLINE · T+" +
    simulationTime.toFixed(1).padStart(6, "0");
}

function handleResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key.toLowerCase() === "r") {
    camera.position.copy(initialCameraPosition);
    camera.lookAt(0, 0, 0);
  }

  if (event.key.toLowerCase() === "p") {
    paused = !paused;
    simulationStatus.textContent = paused ? "PAUSED" : "RUNNING";
  }
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

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error("Missing required UI element: " + selector);
  }
  return element;
}
