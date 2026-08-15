import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "public/assets/ships/carrier/v1");

const MATERIALS = [
  {
    name: "carrier-hull",
    pbrMetallicRoughness: {
      baseColorFactor: [0.5, 0.53, 0.54, 1],
      metallicFactor: 0.78,
      roughnessFactor: 0.58,
    },
  },
  {
    name: "carrier-armor",
    pbrMetallicRoughness: {
      baseColorFactor: [0.61, 0.64, 0.65, 1],
      metallicFactor: 0.84,
      roughnessFactor: 0.46,
    },
  },
  {
    name: "carrier-panel",
    pbrMetallicRoughness: {
      baseColorFactor: [0.25, 0.28, 0.29, 1],
      metallicFactor: 0.6,
      roughnessFactor: 0.76,
    },
  },
];

function createSurface() {
  return { positions: [], normals: [], uvs: [] };
}

function pushTriangle(surface, points, normal, uvs) {
  for (let index = 0; index < 3; index += 1) {
    surface.positions.push(...points[index]);
    surface.normals.push(...normal);
    surface.uvs.push(...uvs[index]);
  }
}

function addPrism(surface, polygon, bottom, top) {
  const xs = polygon.map(([x]) => x);
  const zs = polygon.map(([, z]) => z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const uvFor = ([x, z]) => [
    (x - minX) / Math.max(maxX - minX, 0.001),
    (z - minZ) / Math.max(maxZ - minZ, 0.001),
  ];

  for (let index = 1; index < polygon.length - 1; index += 1) {
    const a = polygon[0];
    const b = polygon[index];
    const c = polygon[index + 1];
    pushTriangle(
      surface,
      [[a[0], top, a[1]], [b[0], top, b[1]], [c[0], top, c[1]]],
      [0, 1, 0],
      [uvFor(a), uvFor(b), uvFor(c)],
    );
    pushTriangle(
      surface,
      [[a[0], bottom, a[1]], [c[0], bottom, c[1]], [b[0], bottom, b[1]]],
      [0, -1, 0],
      [uvFor(a), uvFor(c), uvFor(b)],
    );
  }

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const edgeX = next[0] - current[0];
    const edgeZ = next[1] - current[1];
    const edgeLength = Math.hypot(edgeX, edgeZ) || 1;
    const normal = [edgeZ / edgeLength, 0, -edgeX / edgeLength];
    const lowerCurrent = [current[0], bottom, current[1]];
    const lowerNext = [next[0], bottom, next[1]];
    const upperNext = [next[0], top, next[1]];
    const upperCurrent = [current[0], top, current[1]];
    pushTriangle(surface, [lowerCurrent, lowerNext, upperNext], normal, [[0, 0], [1, 0], [1, 1]]);
    pushTriangle(surface, [lowerCurrent, upperNext, upperCurrent], normal, [[0, 0], [1, 1], [0, 1]]);
  }
}

const hull = createSurface();
addPrism(
  hull,
  [[0, 12.4], [3.8, 10.2], [5.7, 5.4], [5.6, -8.9], [3.7, -12.4], [-3.7, -12.4], [-5.6, -8.9], [-5.7, 5.4], [-3.8, 10.2]],
  -2.1,
  2.05,
);

const commandSpine = createSurface();
addPrism(
  commandSpine,
  [[0, 9], [2.1, 6.5], [2.2, -8.4], [1.5, -10], [-1.5, -10], [-2.2, -8.4], [-2.1, 6.5]],
  2.05,
  3.35,
);

const prowDeck = createSurface();
addPrism(prowDeck, [[0, 12.75], [4.3, 8.8], [4, 5], [-4, 5], [-4.3, 8.8]], 2.05, 2.85);

const aftDeck = createSurface();
addPrism(aftDeck, [[-3.9, -11], [3.9, -11], [4.3, -5.5], [-4.3, -5.5]], 2.05, 2.52);

const leftHangar = createSurface();
addPrism(
  leftHangar,
  [[-4.9, 8.2], [-8.4, 7.2], [-9.2, 4], [-9.15, -8.5], [-8, -10.2], [-5.1, -9.5], [-4.8, -5]],
  -1.6,
  1.7,
);

const rightHangar = createSurface();
addPrism(
  rightHangar,
  [[4.9, 8.2], [4.8, -5], [5.1, -9.5], [8, -10.2], [9.15, -8.5], [9.2, 4], [8.4, 7.2]],
  -1.6,
  1.7,
);

const hangarDoors = createSurface();
addPrism(hangarDoors, [[-8.65, -7.6], [-5.55, -7.6], [-5.55, 4.8], [-8.65, 4.8]], 1.7, 1.94);
addPrism(hangarDoors, [[5.55, -7.6], [8.65, -7.6], [8.65, 4.8], [5.55, 4.8]], 1.7, 1.94);

const launchBrows = createSurface();
addPrism(launchBrows, [[-8.9, 4.1], [-5.25, 4.1], [-5.05, 7.5], [-8.3, 7.15]], 1.94, 2.4);
addPrism(launchBrows, [[5.25, 4.1], [8.9, 4.1], [8.3, 7.15], [5.05, 7.5]], 1.94, 2.4);

const outerRails = createSurface();
addPrism(outerRails, [[-9.6, -9], [-9.05, -9], [-9.05, 5.2], [-9.6, 5.2]], -0.2, 1.15);
addPrism(outerRails, [[9.05, -9], [9.6, -9], [9.6, 5.2], [9.05, 5.2]], -0.2, 1.15);

const functionalPanels = createSurface();
addPrism(functionalPanels, [[-9.84, -7.4], [-9.58, -7.4], [-9.58, -1.8], [-9.84, -1.8]], 0, 1.75);
addPrism(functionalPanels, [[9.58, -7.4], [9.84, -7.4], [9.84, -1.8], [9.58, -1.8]], 0, 1.75);
addPrism(functionalPanels, [[-4.65, -8.8], [-3.7, -8.8], [-3.7, 4.1], [-4.65, 4.1]], 2.05, 2.34);
addPrism(functionalPanels, [[3.7, -8.8], [4.65, -8.8], [4.65, 4.1], [3.7, 4.1]], 2.05, 2.34);

const meshSpecs = [
  { name: "carrier-primary-hull", material: 0, surface: hull },
  { name: "carrier-command-spine", material: 1, surface: commandSpine },
  { name: "carrier-prow-deck", material: 1, surface: prowDeck },
  { name: "carrier-aft-deck", material: 2, surface: aftDeck },
  { name: "carrier-left-hangar", material: 1, surface: leftHangar },
  { name: "carrier-right-hangar", material: 1, surface: rightHangar },
  { name: "carrier-hangar-doors", material: 2, surface: hangarDoors },
  { name: "carrier-launch-brows", material: 1, surface: launchBrows },
  { name: "carrier-outer-rails", material: 1, surface: outerRails },
  { name: "carrier-functional-panels", material: 2, surface: functionalPanels },
];

const binaryChunks = [];
const bufferViews = [];
const accessors = [];
const meshes = [];
let byteOffset = 0;

function appendFloatBuffer(values, type, itemSize, includeBounds = false) {
  const typed = new Float32Array(values);
  const bytes = Buffer.from(typed.buffer);
  const bufferView = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target: 34962 });
  binaryChunks.push(bytes);
  byteOffset += bytes.byteLength;
  const accessor = { bufferView, componentType: 5126, count: values.length / itemSize, type };
  if (includeBounds) {
    accessor.min = Array.from({ length: itemSize }, (_, axis) => Math.min(...values.filter((_, index) => index % itemSize === axis)));
    accessor.max = Array.from({ length: itemSize }, (_, axis) => Math.max(...values.filter((_, index) => index % itemSize === axis)));
  }
  accessors.push(accessor);
  return accessors.length - 1;
}

for (const spec of meshSpecs) {
  const positionAccessor = appendFloatBuffer(spec.surface.positions, "VEC3", 3, true);
  const normalAccessor = appendFloatBuffer(spec.surface.normals, "VEC3", 3);
  const uvAccessor = appendFloatBuffer(spec.surface.uvs, "VEC2", 2);
  meshes.push({
    name: spec.name,
    primitives: [{ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor, TEXCOORD_0: uvAccessor }, material: spec.material, mode: 4 }],
    extras: { semantic: MATERIALS[spec.material].name },
  });
}

const binary = Buffer.concat(binaryChunks);
const gltf = {
  asset: { version: "2.0", generator: "rts-game scripts/build-carrier-model.mjs", extras: { coordinateSystem: "right-handed, Y-up, +Z bow", assetId: "carrier-near-v1" } },
  scene: 0,
  scenes: [{ name: "carrier-near-v1", nodes: meshSpecs.map((_, index) => index) }],
  nodes: meshSpecs.map((spec, index) => ({ name: spec.name, mesh: index })),
  meshes,
  materials: MATERIALS,
  buffers: [{ uri: "carrier-v1.bin", byteLength: binary.byteLength }],
  bufferViews,
  accessors,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "carrier-v1.bin"), binary);
await writeFile(path.join(outputDirectory, "carrier-v1.gltf"), JSON.stringify(gltf, null, 2) + "\n");

const triangleCount = meshSpecs.reduce((total, spec) => total + spec.surface.positions.length / 9, 0);
console.log(`Built carrier-near-v1: ${meshSpecs.length} meshes, ${triangleCount} triangles, ${binary.byteLength} bytes`);
