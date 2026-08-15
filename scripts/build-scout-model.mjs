import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(
  root,
  "public/assets/ships/scout/v1",
);

const MATERIALS = [
  {
    name: "scout-hull",
    pbrMetallicRoughness: {
      baseColorFactor: [0.52, 0.55, 0.56, 1],
      metallicFactor: 0.72,
      roughnessFactor: 0.56,
    },
  },
  {
    name: "scout-armor",
    pbrMetallicRoughness: {
      baseColorFactor: [0.62, 0.65, 0.66, 1],
      metallicFactor: 0.8,
      roughnessFactor: 0.44,
    },
  },
  {
    name: "scout-panel",
    pbrMetallicRoughness: {
      baseColorFactor: [0.24, 0.27, 0.28, 1],
      metallicFactor: 0.58,
      roughnessFactor: 0.74,
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
  [[0, 6.75], [2, 2.7], [3.1, -3], [1.9, -6.75], [-1.9, -6.75], [-3.1, -3], [-2, 2.7]],
  -1.05,
  1.05,
);

const dorsalArmor = createSurface();
addPrism(
  dorsalArmor,
  [[0, 4.35], [1.15, 2.1], [1.7, -2.15], [1.05, -3.45], [-1.05, -3.45], [-1.7, -2.15], [-1.15, 2.1]],
  1.05,
  1.42,
);

const leftWing = createSurface();
addPrism(
  leftWing,
  [[-1.75, 2.15], [-3.05, 1.45], [-4.9, -0.45], [-4.55, -4.3], [-2.2, -4.5], [-1.68, -0.95]],
  -0.64,
  -0.18,
);

const rightWing = createSurface();
addPrism(
  rightWing,
  [[1.75, 2.15], [1.68, -0.95], [2.2, -4.5], [4.55, -4.3], [4.9, -0.45], [3.05, 1.45]],
  -0.64,
  -0.18,
);

const utilityPanels = createSurface();
addPrism(utilityPanels, [[-0.43, 3.05], [0.43, 3.05], [0.43, -4.15], [-0.43, -4.15]], 1.42, 1.72);
addPrism(utilityPanels, [[-2.17, -0.17], [-1.93, -0.17], [-1.93, -3.07], [-2.17, -3.07]], -0.08, 0.64);
addPrism(utilityPanels, [[1.93, -0.17], [2.17, -0.17], [2.17, -3.07], [1.93, -3.07]], -0.08, 0.64);

const meshSpecs = [
  { name: "scout-primary-hull", material: 0, surface: hull },
  { name: "scout-dorsal-armor", material: 1, surface: dorsalArmor },
  { name: "scout-left-wing", material: 1, surface: leftWing },
  { name: "scout-right-wing", material: 1, surface: rightWing },
  { name: "scout-utility-panels", material: 2, surface: utilityPanels },
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
    generator: "rts-game scripts/build-scout-model.mjs",
    extras: {
      coordinateSystem: "right-handed, Y-up, +Z bow",
      assetId: "scout-near-v1",
    },
  },
  scene: 0,
  scenes: [{ name: "scout-near-v1", nodes: meshSpecs.map((_, index) => index) }],
  nodes: meshSpecs.map((spec, index) => ({ name: spec.name, mesh: index })),
  meshes,
  materials: MATERIALS,
  buffers: [{ uri: "scout-v1.bin", byteLength: binary.byteLength }],
  bufferViews,
  accessors,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "scout-v1.bin"), binary);
await writeFile(
  path.join(outputDirectory, "scout-v1.gltf"),
  JSON.stringify(gltf, null, 2) + "\n",
);

const triangleCount = meshSpecs.reduce(
  (total, spec) => total + spec.surface.positions.length / 9,
  0,
);
console.log(
  `Built scout-near-v1: ${meshSpecs.length} meshes, ${triangleCount} triangles, ${binary.byteLength} bytes`,
);
