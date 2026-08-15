import * as THREE from "three";

interface StrikerAssetMaterials {
  hull: THREE.MeshStandardMaterial;
  armor: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
}

interface StrikerAssetBundle {
  template: THREE.Group;
  baseColor: THREE.Texture;
  roughness: THREE.Texture;
}

const STRIKER_ASSET_ID = "striker-near-v1";
const STRIKER_ASSET_ROOT = new URL(
  "assets/ships/striker/v1/",
  document.baseURI,
);

let strikerAssetPromise: Promise<StrikerAssetBundle | null> | null = null;
let strikerAssetWarningLogged = false;

export function installStrikerAsset(
  detailGroup: THREE.Group,
  fallbackGroup: THREE.Group,
  materials: StrikerAssetMaterials,
): void {
  detailGroup.userData.strikerAssetId = STRIKER_ASSET_ID;
  detailGroup.userData.strikerAssetMode = "procedural-fallback";
  if (isStrikerFallbackForced()) {
    detailGroup.userData.strikerAssetMode = "forced-procedural-fallback";
    return;
  }

  void loadStrikerAsset().then((bundle) => {
    if (!bundle || !detailGroup.parent?.parent) {
      return;
    }

    applyStrikerTextures(materials, bundle);
    const importedMeshes = createImportedMeshes(bundle.template, materials);
    if (importedMeshes.length === 0) {
      return;
    }

    fallbackGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
    detailGroup.remove(fallbackGroup);
    for (const mesh of importedMeshes) {
      detailGroup.add(mesh);
    }
    detailGroup.userData.strikerAssetMode = "external-pbr";
    detailGroup.userData.strikerAssetMeshCount = importedMeshes.length;
  });
}

function isStrikerFallbackForced(): boolean {
  return new URLSearchParams(window.location.search).get("strikerAsset") ===
    "fallback";
}

function loadStrikerAsset(): Promise<StrikerAssetBundle | null> {
  if (strikerAssetPromise) {
    return strikerAssetPromise;
  }

  strikerAssetPromise = Promise.all([
    import("three/addons/loaders/GLTFLoader.js"),
    loadTexture("striker-hull-basecolor.png", true),
    loadTexture("striker-hull-roughness.png", false),
  ])
    .then(async ([{ GLTFLoader }, baseColor, roughness]) => {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(
        new URL("striker-v1.gltf", STRIKER_ASSET_ROOT).href,
      );
      return {
        template: gltf.scene,
        baseColor,
        roughness,
      };
    })
    .catch((error: unknown) => {
      if (!strikerAssetWarningLogged) {
        strikerAssetWarningLogged = true;
        console.warn(
          "Striker external asset unavailable; using procedural fallback.",
          error,
        );
      }
      return null;
    });
  return strikerAssetPromise;
}

async function loadTexture(
  filename: string,
  useSrgb: boolean,
): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(
    new URL(filename, STRIKER_ASSET_ROOT).href,
  );
  texture.name = STRIKER_ASSET_ID + "-" + filename;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = 4;
  if (useSrgb) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}

function applyStrikerTextures(
  materials: StrikerAssetMaterials,
  bundle: StrikerAssetBundle,
): void {
  const materialTuning: Array<[THREE.MeshStandardMaterial, number]> = [
    [materials.hull, 0.15],
    [materials.armor, 0.1],
    [materials.panel, 0.18],
  ];
  for (const [material, lightnessOffset] of materialTuning) {
    material.map = bundle.baseColor;
    material.roughnessMap = bundle.roughness;
    material.color.offsetHSL(0, 0, lightnessOffset);
    material.needsUpdate = true;
  }
}

function createImportedMeshes(
  template: THREE.Group,
  materials: StrikerAssetMaterials,
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  template.updateMatrixWorld(true);
  template.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const sourceMaterials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    const resolvedMaterials = sourceMaterials.map((material) =>
      resolveMaterial(material.name, materials)
    );
    const mesh = new THREE.Mesh(
      geometry,
      resolvedMaterials.length === 1 ? resolvedMaterials[0] : resolvedMaterials,
    );
    mesh.name = child.name || STRIKER_ASSET_ID + "-mesh-" + meshes.length;
    mesh.userData.assetId = STRIKER_ASSET_ID;
    meshes.push(mesh);
  });
  return meshes;
}

function resolveMaterial(
  name: string,
  materials: StrikerAssetMaterials,
): THREE.MeshStandardMaterial {
  if (name.includes("armor")) {
    return materials.armor;
  }
  if (name.includes("panel")) {
    return materials.panel;
  }
  return materials.hull;
}
