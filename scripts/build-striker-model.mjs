import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(
  root,
  "public/assets/ships/striker/v1",
);

const MATERIALS = [
  {
    name: "striker-hull",
    pbrMetallicRoughness: {
      baseColorFactor: [0.5, 0.53, 0.54, 1],
      metallicFactor: 0.76,
      roughnessFactor: 0.52,
    },
  },
  {
    name: "striker-armor",
    pbrMetallicRoughness: {
      baseColorFactor: [0.62, 0.64, 0.65, 1],
      metallicFactor: 0.82,
      roughnessFactor: 0.42,
    },
  },
  {
    name: "striker-panel",
    pbrMetallicRoughness: {
      baseColorFactor: [0.25, 0.27, 0.28, 1],
      metallicFactor: 0.62,
      roughnessFactor: 0.7,
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
    pushTriangle(
      surface,
      [lowerCurrent, lowerNext, upperNext],
      normal,
      [[0, 0], [1, 0], [1, 1]],
    );
    pushTriangle(
      surface,
      [lowerCurrent, upperNext, upperCurrent],
      normal,
      [[0, 0], [1, 1], [0, 1]],
    );
  }
}

const hull = createSurface();
addPrism(
  hull,
  [[0, 8.1], [3.4, 5], [5.5, 1.8], [5.8, -4.8], [3.7, -7.4], [-3.7, -7.4], [-5.8, -4.8], [-5.5, 1.8], [-3.4, 5]],
  -1.45,
  1.35,
);

const prowArmor = createSurface();
addPrism(
  prowArmor,
  [[0, 8.6], [1.7, 5.4], [2.4, 0], [1.8, -4], [-1.8, -4], [-2.4, 0], [-1.7, 5.4]],
  1.35,
  2.2,
);

const leftShoulder = createSurface();
addPrism(
  leftShoulder,
  [[-2.35, 4.55], [-4.8, 3.8], [-6.9, 1.2], [-6.6, -5.2], [-3.7, -6.3], [-2.55, -1]],
  0.2,
  1.42,
);

const rightShoulder = createSurface();
addPrism(
  rightShoulder,
  [[2.35, 4.55], [2.55, -1], [3.7, -6.3], [6.6, -5.2], [6.9, 1.2], [4.8, 3.8]],
  0.2,
  1.42,
);

const gunFoundations = createSurface();
addPrism(gunFoundations, [[-4.45, 1.2], [-2.7, 1.2], [-2.7, 5.35], [-4.45, 5.35]], 1.42, 2.05);
addPrism(gunFoundations, [[2.7, 1.2], [4.45, 1.2], [4.45, 5.35], [2.7, 5.35]], 1.42, 2.05);

const ventPanels = createSurface();
addPrism(ventPanels, [[-6.25, -4.25], [-5.55, -4.25], [-5.55, 0], [-6.25, 0]], 1.42, 1.66);
addPrism(ventPanels, [[5.55, -4.25], [6.25, -4.25], [6.25, 0], [5.55, 0]], 1.42, 1.66);
addPrism(ventPanels, [[-0.62, -5.65], [0.62, -5.65], [0.62, 2.3], [-0.62, 2.3]], 2.2, 2.48);

const meshSpecs = [
  { name: "striker-primary-hull", material: 0, surface: hull },
  { name: "striker-prow-armor", material: 1, surface: prowArmor },
  { name: "striker-left-shoulder", material: 1, surface: leftShoulder },
  { name: "striker-right-shoulder", material: 1, surface: rightShoulder },
  { name: "striker-gun-foundations", material: 1, surface: gunFoundations },
  { name: "striker-vent-panels", material: 2, surface: ventPanels },
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
  bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: bytes.byteLength,
    target: 34962,
  });
  binaryChunks.push(bytes);
  byteOffset += bytes.byteLength;
  const accessor = {
    bufferView,
    componentType: 5126,
    count: values.length / itemSize,
    type,
  };
  if (includeBounds) {
    accessor.min = Array.from({ length: itemSize }, (_, axis) =>
      Math.min(...values.filter((_, index) => index % itemSize === axis))
    );
    accessor.max = Array.from({ length: itemSize }, (_, axis) =>
      Math.max(...values.filter((_, index) => index % itemSize === axis))
    );
  }
  accessors.push(accessor);
  return accessors.length - 1;
}

for (const spec of meshSpecs) {
  const positionAccessor = appendFloatBuffer(
    spec.surface.positions,
    "VEC3",
    3,
    true,
  );
  const normalAccessor = appendFloatBuffer(spec.surface.normals, "VEC3", 3);
  const uvAccessor = appendFloatBuffer(spec.surface.uvs, "VEC2", 2);
  meshes.push({
    name: spec.name,
    primitives: [{
      attributes: {
        POSITION: positionAccessor,
        NORMAL: normalAccessor,
        TEXCOORD_0: uvAccessor,
      },
      material: spec.material,
      mode: 4,
    }],
    extras: { semantic: MATERIALS[spec.material].name },
  });
}

const binary = Buffer.concat(binaryChunks);
const gltf = {
  asset: {
    version: "2.0",
    generator: "rts-game scripts/build-striker-model.mjs",
    extras: {
      coordinateSystem: "right-handed, Y-up, +Z bow",
      assetId: "striker-near-v1",
    },
  },
  scene: 0,
  scenes: [{ name: "striker-near-v1", nodes: meshSpecs.map((_, index) => index) }],
  nodes: meshSpecs.map((spec, index) => ({ name: spec.name, mesh: index })),
  meshes,
  materials: MATERIALS,
  buffers: [{ uri: "striker-v1.bin", byteLength: binary.byteLength }],
  bufferViews,
  accessors,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "striker-v1.bin"), binary);
await writeFile(
  path.join(outputDirectory, "striker-v1.gltf"),
  JSON.stringify(gltf, null, 2) + "\n",
);

const triangleCount = meshSpecs.reduce(
  (total, spec) => total + spec.surface.positions.length / 9,
  0,
);
console.log(
  `Built striker-near-v1: ${meshSpecs.length} meshes, ${triangleCount} triangles, ${binary.byteLength} bytes`,
);
