import * as THREE from "three";

interface CarrierAssetMaterials {
  hull: THREE.MeshStandardMaterial;
  armor: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
}

interface CarrierAssetBundle {
  template: THREE.Group;
  baseColor: THREE.Texture;
  roughness: THREE.Texture;
}

const CARRIER_ASSET_ID = "carrier-near-v1";
const CARRIER_ASSET_ROOT = new URL(
  "assets/ships/carrier/v1/",
  document.baseURI,
);

let carrierAssetPromise: Promise<CarrierAssetBundle | null> | null = null;
let carrierAssetWarningLogged = false;

export function installCarrierAsset(
  detailGroup: THREE.Group,
  fallbackGroup: THREE.Group,
  materials: CarrierAssetMaterials,
): void {
  detailGroup.userData.carrierAssetId = CARRIER_ASSET_ID;
  detailGroup.userData.carrierAssetMode = "procedural-fallback";
  if (isCarrierFallbackForced()) {
    detailGroup.userData.carrierAssetMode = "forced-procedural-fallback";
    return;
  }

  void loadCarrierAsset().then((bundle) => {
    if (!bundle || !detailGroup.parent?.parent) {
      return;
    }

    applyCarrierTextures(materials, bundle);
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
    detailGroup.userData.carrierAssetMode = "external-pbr";
    detailGroup.userData.carrierAssetMeshCount = importedMeshes.length;
  });
}

function isCarrierFallbackForced(): boolean {
  return new URLSearchParams(window.location.search).get("carrierAsset") ===
    "fallback";
}

function loadCarrierAsset(): Promise<CarrierAssetBundle | null> {
  if (carrierAssetPromise) {
    return carrierAssetPromise;
  }

  carrierAssetPromise = Promise.all([
    import("three/addons/loaders/GLTFLoader.js"),
    loadTexture("carrier-hull-basecolor.png", true),
    loadTexture("carrier-hull-roughness.png", false),
  ])
    .then(async ([{ GLTFLoader }, baseColor, roughness]) => {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(
        new URL("carrier-v1.gltf", CARRIER_ASSET_ROOT).href,
      );
      return { template: gltf.scene, baseColor, roughness };
    })
    .catch((error: unknown) => {
      if (!carrierAssetWarningLogged) {
        carrierAssetWarningLogged = true;
        console.warn(
          "Carrier external asset unavailable; using procedural fallback.",
          error,
        );
      }
      return null;
    });
  return carrierAssetPromise;
}

async function loadTexture(
  filename: string,
  useSrgb: boolean,
): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(
    new URL(filename, CARRIER_ASSET_ROOT).href,
  );
  texture.name = CARRIER_ASSET_ID + "-" + filename;
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

function applyCarrierTextures(
  materials: CarrierAssetMaterials,
  bundle: CarrierAssetBundle,
): void {
  const materialTuning: Array<[THREE.MeshStandardMaterial, number]> = [
    [materials.hull, 0.14],
    [materials.armor, 0.09],
    [materials.panel, 0.16],
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
  materials: CarrierAssetMaterials,
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
    mesh.name = child.name || CARRIER_ASSET_ID + "-mesh-" + meshes.length;
    mesh.userData.assetId = CARRIER_ASSET_ID;
    meshes.push(mesh);
  });
  return meshes;
}

function resolveMaterial(
  name: string,
  materials: CarrierAssetMaterials,
): THREE.MeshStandardMaterial {
  if (name.includes("armor")) {
    return materials.armor;
  }
  if (name.includes("panel")) {
    return materials.panel;
  }
  return materials.hull;
}
