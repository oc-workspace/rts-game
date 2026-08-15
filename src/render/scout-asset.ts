import * as THREE from "three";

interface ScoutAssetMaterials {
  hull: THREE.MeshStandardMaterial;
  armor: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
}

interface ScoutAssetBundle {
  template: THREE.Group;
  baseColor: THREE.Texture;
  roughness: THREE.Texture;
}

const SCOUT_ASSET_ID = "scout-near-v1";
const SCOUT_ASSET_ROOT = new URL(
  "assets/ships/scout/v1/",
  document.baseURI,
);

let scoutAssetPromise: Promise<ScoutAssetBundle | null> | null = null;
let scoutAssetWarningLogged = false;

export function installScoutAsset(
  detailGroup: THREE.Group,
  fallbackGroup: THREE.Group,
  materials: ScoutAssetMaterials,
): void {
  detailGroup.userData.assetId = SCOUT_ASSET_ID;
  detailGroup.userData.assetMode = "procedural-fallback";
  if (isScoutFallbackForced()) {
    detailGroup.userData.assetMode = "forced-procedural-fallback";
    return;
  }

  void loadScoutAsset().then((bundle) => {
    if (!bundle || !detailGroup.parent?.parent) {
      return;
    }

    applyScoutTextures(materials, bundle);
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
    detailGroup.userData.assetMode = "external-pbr";
    detailGroup.userData.assetMeshCount = importedMeshes.length;
  });
}

function isScoutFallbackForced(): boolean {
  return new URLSearchParams(window.location.search).get("scoutAsset") ===
    "fallback";
}

function loadScoutAsset(): Promise<ScoutAssetBundle | null> {
  if (scoutAssetPromise) {
    return scoutAssetPromise;
  }

  scoutAssetPromise = Promise.all([
    import("three/addons/loaders/GLTFLoader.js"),
    loadTexture("scout-hull-basecolor.png", true),
    loadTexture("scout-hull-roughness.png", false),
  ])
    .then(async ([{ GLTFLoader }, baseColor, roughness]) => {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(
        new URL("scout-v1.gltf", SCOUT_ASSET_ROOT).href,
      );
      return {
        template: gltf.scene,
        baseColor,
        roughness,
      };
    })
    .catch((error: unknown) => {
      if (!scoutAssetWarningLogged) {
        scoutAssetWarningLogged = true;
        console.warn(
          "Scout external asset unavailable; using procedural fallback.",
          error,
        );
      }
      return null;
    });
  return scoutAssetPromise;
}

async function loadTexture(
  filename: string,
  useSrgb: boolean,
): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(
    new URL(filename, SCOUT_ASSET_ROOT).href,
  );
  texture.name = SCOUT_ASSET_ID + "-" + filename;
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

function applyScoutTextures(
  materials: ScoutAssetMaterials,
  bundle: ScoutAssetBundle,
): void {
  const materialTuning: Array<[THREE.MeshStandardMaterial, number]> = [
    [materials.hull, 0.18],
    [materials.armor, 0.12],
    [materials.panel, 0.2],
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
  materials: ScoutAssetMaterials,
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
    mesh.name = child.name || SCOUT_ASSET_ID + "-mesh-" + meshes.length;
    mesh.userData.assetId = SCOUT_ASSET_ID;
    meshes.push(mesh);
  });
  return meshes;
}

function resolveMaterial(
  name: string,
  materials: ScoutAssetMaterials,
): THREE.MeshStandardMaterial {
  if (name.includes("armor")) {
    return materials.armor;
  }
  if (name.includes("panel")) {
    return materials.panel;
  }
  return materials.hull;
}
