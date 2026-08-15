import * as THREE from "three";
import { GROUND_Y, SHIP_CLASSES, SHIP_Y } from "../game/encounter";
import type { Faction, ShipClassId, Unit } from "../game/types";
import { installScoutAsset } from "./scout-asset";
import { installStrikerAsset } from "./striker-asset";

export type EffectsQuality = "high" | "low";

export interface ShipView {
  group: THREE.Group;
  detailGroup: THREE.Group;
  distantHull: THREE.Mesh;
  selectionRing: THREE.Mesh;
  thrusterGlows: THREE.Mesh[];
  thrusterCores: THREE.Mesh[];
  damageOverlays: THREE.Mesh[];
  shipLight: THREE.PointLight;
}

export function createDistantShipBatch(
  owner: Faction,
  classId: ShipClassId,
  capacity: number,
): THREE.InstancedMesh {
  const source = createDistantHull(classId, getPalette(owner));
  const batch = new THREE.InstancedMesh(
    source.geometry,
    source.material,
    capacity,
  );
  batch.name = owner + "-" + classId + "-distant-batch";
  batch.count = 0;
  batch.frustumCulled = false;
  batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return batch;
}

interface ShipPalette {
  faction: number;
  accent: number;
  hull: number;
  armor: number;
  panel: number;
  emissive: number;
}

interface MaterialSet {
  hull: THREE.MeshStandardMaterial;
  armor: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  engine: THREE.MeshBasicMaterial;
  engineCore: THREE.MeshBasicMaterial;
}

interface SurfaceTextures {
  hull: THREE.CanvasTexture;
  armor: THREE.CanvasTexture;
  panel: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  panelRoughness: THREE.CanvasTexture;
  registry: Record<ShipClassId, THREE.CanvasTexture>;
  damage: THREE.CanvasTexture[];
}

let surfaceTextures: SurfaceTextures | null = null;

const REGISTRY_SPECS: Record<ShipClassId, {
  dimensions: [number, number];
  height: number;
  z: number;
  rotation: number;
}> = {
  scout: { dimensions: [2.8, 4.8], height: 1.74, z: -0.45, rotation: 0 },
  striker: { dimensions: [4.2, 5.8], height: 2.6, z: -0.95, rotation: 0 },
  carrier: { dimensions: [5.2, 8], height: 3.52, z: -0.8, rotation: 0 },
};

const DAMAGE_SPECS: Record<ShipClassId, {
  top: number;
  size: number;
  positions: Array<{ x: number; z: number; rotation: number }>;
}> = {
  scout: {
    top: 1.78,
    size: 3.2,
    positions: [
      { x: -0.6, z: 2.25, rotation: 0.18 },
      { x: 0.9, z: -0.8, rotation: -0.62 },
      { x: -1.05, z: -3.15, rotation: 1.02 },
    ],
  },
  striker: {
    top: 2.64,
    size: 4.2,
    positions: [
      { x: -1.6, z: 3.1, rotation: 0.12 },
      { x: 1.8, z: -0.35, rotation: -0.58 },
      { x: -0.7, z: -4.15, rotation: 1.08 },
    ],
  },
  carrier: {
    top: 3.58,
    size: 5.4,
    positions: [
      { x: -2.8, z: 4.75, rotation: 0.1 },
      { x: 3.2, z: -0.1, rotation: -0.7 },
      { x: -1.9, z: -5.7, rotation: 0.92 },
    ],
  },
};

const DAMAGE_THRESHOLDS = [0.18, 0.42, 0.68];

export function createShipVisual(unit: Unit): ShipView {
  const shipClass = SHIP_CLASSES[unit.classId];
  const palette = getPalette(unit.owner);
  const materials = createMaterials(palette);
  const group = new THREE.Group();
  group.name = unit.id + "-view";
  group.userData.unitId = unit.id;
  group.scale.setScalar(shipClass.scale);
  const detailGroup = new THREE.Group();
  detailGroup.name = "detail-lod";
  group.add(detailGroup);

  if (unit.classId === "scout") {
    buildScout(detailGroup, materials);
  } else if (unit.classId === "striker") {
    buildStriker(detailGroup, materials);
  } else {
    buildCarrier(detailGroup, materials);
  }

  detailGroup.add(createRegistryDecal(unit.classId, palette.accent));
  const damageOverlays = createDamageOverlays(unit.classId);
  damageOverlays.forEach((overlay) => detailGroup.add(overlay));
  const { thrusterGlows, thrusterCores } = createThrusters(
    detailGroup,
    unit.classId,
    materials,
  );
  const distantHull = createDistantHull(unit.classId, palette);
  distantHull.visible = false;
  group.add(distantHull);
  const selectionRing = createSelectionRing(unit.classId, palette.faction);
  group.add(selectionRing);

  const shipLight = new THREE.PointLight(palette.faction, 3.2, 24, 2);
  shipLight.position.set(0, 0.8, -2);
  group.add(shipLight);

  group.position.set(unit.position.x, unit.position.y, unit.position.z);
  group.rotation.y = unit.heading;
  return {
    group,
    detailGroup,
    distantHull,
    selectionRing,
    thrusterGlows,
    thrusterCores,
    damageOverlays,
    shipLight,
  };
}

export function updateShipVisual(
  view: ShipView,
  unit: Unit,
  simulationTime: number,
  quality: EffectsQuality,
  useDistantLod: boolean,
  enableShipLight: boolean,
  showIndividualDistantHull = true,
): void {
  view.group.visible = !unit.destroyed;
  view.group.position.set(unit.position.x, unit.position.y, unit.position.z);
  view.group.rotation.y = unit.heading;
  view.detailGroup.visible = !useDistantLod;
  view.distantHull.visible = useDistantLod && showIndividualDistantHull;
  view.selectionRing.visible = unit.selected && unit.owner === "player";

  const engineLoad = unit.state === "moving"
    ? 1.18
    : unit.state === "attacking"
      ? 1.04
      : 0.82;
  const pulse = 0.94 + Math.sin(simulationTime * 9 + unit.id.length) * 0.08;
  if (!useDistantLod) {
    for (const thruster of view.thrusterGlows) {
      thruster.visible = quality === "high";
      thruster.scale.set(1, engineLoad * pulse, 1);
    }
    for (const core of view.thrusterCores) {
      core.scale.set(
        1,
        engineLoad * (0.96 + Math.sin(simulationTime * 11) * 0.04),
        1,
      );
    }
  }

  const healthRatio = THREE.MathUtils.clamp(
    unit.health / SHIP_CLASSES[unit.classId].maxHealth,
    0,
    1,
  );
  const damage = 1 - healthRatio;
  for (let index = 0; index < view.damageOverlays.length; index += 1) {
    const overlay = view.damageOverlays[index];
    const threshold = DAMAGE_THRESHOLDS[index];
    overlay.visible =
      !useDistantLod && quality === "high" && damage > threshold;
    const material = overlay.material as THREE.MeshBasicMaterial;
    material.opacity = THREE.MathUtils.clamp(
      (damage - threshold) * (1.55 + index * 0.22),
      0.16,
      0.74,
    );
  }

  view.shipLight.visible =
    !useDistantLod && quality === "high" && enableShipLight;
  view.shipLight.intensity = unit.state === "moving" ? 4.1 : 2.8;
  view.selectionRing.scale.setScalar(1 + Math.sin(simulationTime * 4) * 0.018);
}

function createDistantHull(
  classId: ShipClassId,
  palette: ShipPalette,
): THREE.Mesh {
  const dimensions = classId === "carrier"
    ? [10.8, 20.5, 4.2]
    : classId === "striker"
      ? [9.4, 15.2, 3.2]
      : [6.2, 13.5, 2.1];
  const hull = new THREE.Mesh(
    createAngularHullGeometry(
      dimensions[0],
      dimensions[1],
      dimensions[2],
      false,
    ),
    new THREE.MeshStandardMaterial({
      color: palette.hull,
      emissive: palette.faction,
      emissiveIntensity: 0.16,
      metalness: 0.55,
      roughness: 0.72,
      flatShading: true,
    }),
  );
  hull.name = "distant-hull-lod";
  return hull;
}

function buildScout(group: THREE.Group, materials: MaterialSet): void {
  const fallbackCore = new THREE.Group();
  fallbackCore.name = "scout-procedural-fallback";
  group.add(fallbackCore);
  fallbackCore.add(
    new THREE.Mesh(
      createAngularHullGeometry(6.2, 13.5, 2.1),
      materials.hull,
    ),
  );
  const dorsalArmor = new THREE.Mesh(
    createAngularHullGeometry(3.4, 7.8, 0.75),
    materials.armor,
  );
  dorsalArmor.position.set(0, 1.25, 0.45);
  fallbackCore.add(dorsalArmor);

  const dorsalSpine = new THREE.Mesh(
    new THREE.BoxGeometry(0.86, 0.34, 7.2),
    materials.panel,
  );
  dorsalSpine.position.set(0, 1.72, -0.55);
  fallbackCore.add(dorsalSpine);

  const sensorCanopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 16, 8),
    materials.glass,
  );
  sensorCanopy.scale.set(1, 0.42, 1.24);
  sensorCanopy.position.set(0, 1.96, 1.18);
  group.add(sensorCanopy);

  const sensorBand = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.1, 0.22),
    materials.accent,
  );
  sensorBand.position.set(0, 2.2, 1.47);
  group.add(sensorBand);

  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(
      createAngularHullGeometry(3.9, 6.4, 0.42),
      materials.armor,
    );
    wing.position.set(side * 3.35, -0.42, -1.2);
    wing.rotation.y = side * -0.18;
    fallbackCore.add(wing);

    const radiator = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.72, 2.9),
      materials.panel,
    );
    radiator.position.set(side * 2.05, 0.28, -1.62);
    radiator.rotation.z = side * -0.12;
    fallbackCore.add(radiator);

    const wingTip = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.12, 2.7),
      materials.accent,
    );
    wingTip.position.set(side * 4.72, -0.24, -1.64);
    wingTip.rotation.y = side * -0.18;
    group.add(wingTip);

    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 5.1), materials.accent);
    strip.position.set(side * 1.45, 1.47, -0.25);
    group.add(strip);
  }

  const sensor = new THREE.Mesh(new THREE.OctahedronGeometry(0.52, 1), materials.accent);
  sensor.position.set(0, 2.02, 3.1);
  group.add(sensor);

  const sensorMast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 1.1, 8),
    materials.armor,
  );
  sensorMast.position.set(0, 2.48, 2.55);
  group.add(sensorMast);
  installScoutAsset(group, fallbackCore, materials);
}

function buildStriker(group: THREE.Group, materials: MaterialSet): void {
  const fallbackCore = new THREE.Group();
  fallbackCore.name = "striker-procedural-fallback";
  group.add(fallbackCore);
  fallbackCore.add(
    new THREE.Mesh(
      createAngularHullGeometry(9.4, 15.2, 3.2),
      materials.hull,
    ),
  );
  const prowArmor = new THREE.Mesh(
    createAngularHullGeometry(5.2, 8.4, 1.05),
    materials.armor,
  );
  prowArmor.position.set(0, 2, 2.7);
  fallbackCore.add(prowArmor);

  const centerKeel = new THREE.Mesh(
    createAngularHullGeometry(1.4, 10.6, 0.42),
    materials.panel,
  );
  centerKeel.name = "striker-center-keel";
  centerKeel.position.set(0, 2.62, -0.8);
  fallbackCore.add(centerKeel);

  const commandBlister = new THREE.Mesh(
    createAngularHullGeometry(2.8, 3.4, 0.78),
    materials.glass,
  );
  commandBlister.name = "striker-command-blister";
  commandBlister.position.set(0, 2.96, 1.55);
  group.add(commandBlister);

  const fireDirector = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.38, 0),
    materials.accent,
  );
  fireDirector.name = "striker-fire-director";
  fireDirector.position.set(0, 3.5, 2.12);
  group.add(fireDirector);

  for (const side of [-1, 1]) {
    const armorPlate = new THREE.Mesh(
      createAngularHullGeometry(4.4, 8.6, 0.72),
      materials.armor,
    );
    armorPlate.position.set(side * 3.45, 0.7, -0.8);
    armorPlate.rotation.y = side * 0.09;
    fallbackCore.add(armorPlate);

    const shoulderSponson = new THREE.Mesh(
      createAngularHullGeometry(2.6, 6.2, 1.15),
      materials.armor,
    );
    shoulderSponson.name = "striker-shoulder-sponson";
    shoulderSponson.position.set(side * 4.72, 1.08, 0.72);
    shoulderSponson.rotation.y = side * -0.08;
    fallbackCore.add(shoulderSponson);

    const gunMount = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.15, 1, 6),
      materials.panel,
    );
    gunMount.position.set(side * 3.55, 1.3, 3.25);
    fallbackCore.add(gunMount);

    const recoilBlock = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.72, 1.65),
      materials.armor,
    );
    recoilBlock.name = "striker-recoil-block";
    recoilBlock.position.set(side * 3.55, 1.52, 2.7);
    fallbackCore.add(recoilBlock);

    const gun = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.28, 4.8, 8),
      materials.panel,
    );
    gun.rotation.x = Math.PI / 2;
    gun.position.set(side * 3.55, 1.45, 5.25);
    group.add(gun);

    const barrelShroud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.48, 1.45, 8),
      materials.armor,
    );
    barrelShroud.name = "striker-barrel-shroud";
    barrelShroud.rotation.x = Math.PI / 2;
    barrelShroud.position.set(side * 3.55, 1.45, 4.12);
    group.add(barrelShroud);

    const muzzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.2, 8),
      materials.accent,
    );
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(side * 3.55, 1.45, 7.66);
    group.add(muzzle);

    const radiator = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.82, 3.5),
      materials.panel,
    );
    radiator.name = "striker-side-radiator";
    radiator.position.set(side * 5.78, 0.72, -1.72);
    radiator.rotation.z = side * -0.08;
    fallbackCore.add(radiator);
  }

  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 9.5), materials.accent);
  strip.position.set(0, 2.88, -0.9);
  group.add(strip);
  installStrikerAsset(group, fallbackCore, materials);
}

function buildCarrier(group: THREE.Group, materials: MaterialSet): void {
  const primaryHull = new THREE.Mesh(
    createAngularHullGeometry(10.8, 20.5, 4.2),
    materials.hull,
  );
  primaryHull.name = "carrier-primary-hull";
  group.add(primaryHull);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 17.5), materials.armor);
  spine.name = "carrier-command-spine";
  spine.position.set(0, 2.35, -0.4);
  group.add(spine);

  const prowArmor = new THREE.Mesh(
    createAngularHullGeometry(7.6, 6.4, 0.72),
    materials.armor,
  );
  prowArmor.name = "carrier-prow-armor";
  prowArmor.position.set(0, 2.38, 6.45);
  group.add(prowArmor);

  const aftDeck = new THREE.Mesh(
    createAngularHullGeometry(7.8, 4.8, 0.62),
    materials.panel,
  );
  aftDeck.name = "carrier-aft-deck";
  aftDeck.position.set(0, 2.24, -6.25);
  group.add(aftDeck);

  for (const side of [-1, 1]) {
    const hangar = new THREE.Mesh(
      createAngularHullGeometry(3.8, 13.2, 2.8),
      materials.armor,
    );
    hangar.name = "carrier-hangar-pod";
    hangar.position.set(side * 6.3, -0.35, -1.2);
    hangar.rotation.y = side * 0.035;
    group.add(hangar);

    const hangarDoor = new THREE.Mesh(
      new THREE.BoxGeometry(3.86, 0.18, 7.2),
      materials.panel,
    );
    hangarDoor.name = "carrier-hangar-door";
    hangarDoor.position.set(side * 6.3, 1.12, -0.9);
    group.add(hangarDoor);

    const launchBrow = new THREE.Mesh(
      createAngularHullGeometry(4.35, 2.45, 0.48),
      materials.armor,
    );
    launchBrow.name = "carrier-launch-brow";
    launchBrow.position.set(side * 6.3, 1.42, 4.05);
    launchBrow.rotation.y = side * -0.035;
    group.add(launchBrow);

    const hangarBrace = new THREE.Mesh(
      new THREE.BoxGeometry(3.98, 0.42, 0.46),
      materials.hull,
    );
    hangarBrace.name = "carrier-hangar-brace";
    hangarBrace.position.set(side * 6.3, 1.34, -0.9);
    group.add(hangarBrace);

    const outerRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.86, 9.8),
      materials.armor,
    );
    outerRail.name = "carrier-outer-armor-rail";
    outerRail.position.set(side * 8.25, 0.22, -1.25);
    group.add(outerRail);

    const radiator = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 1.55, 4.4),
      materials.panel,
    );
    radiator.name = "carrier-hangar-radiator";
    radiator.position.set(side * 8.57, 0.5, -3.15);
    radiator.rotation.z = side * -0.055;
    group.add(radiator);

    const landingGuide = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.16, 3.35),
      materials.accent,
    );
    landingGuide.name = "carrier-landing-guide";
    landingGuide.position.set(side * 6.3, 1.28, 2.15);
    group.add(landingGuide);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.16, 10.5),
      materials.accent,
    );
    stripe.name = "carrier-faction-stripe";
    stripe.position.set(side * 4.95, 2.25, -0.4);
    group.add(stripe);
  }

  const commandDeck = new THREE.Mesh(
    createAngularHullGeometry(4.6, 5.2, 2.1),
    materials.panel,
  );
  commandDeck.name = "carrier-command-deck";
  commandDeck.position.set(0, 4.35, 1.45);
  group.add(commandDeck);

  const commandTower = new THREE.Mesh(
    createAngularHullGeometry(2.8, 3.15, 1.18),
    materials.armor,
  );
  commandTower.name = "carrier-command-tower";
  commandTower.position.set(0, 5.72, 1.6);
  group.add(commandTower);

  const bridgeLight = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.18, 0.34),
    materials.glass,
  );
  bridgeLight.name = "carrier-bridge-light";
  bridgeLight.position.set(0, 4.8, 4.05);
  group.add(bridgeLight);

  const sensorBar = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.2, 0.38),
    materials.accent,
  );
  sensorBar.name = "carrier-sensor-bar";
  sensorBar.position.set(0, 6.28, 2.42);
  group.add(sensorBar);

  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 3.4, 8),
    materials.armor,
  );
  antenna.name = "carrier-antenna-mast";
  antenna.position.set(0, 6.7, 0.8);
  group.add(antenna);

  const sensorCrown = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.46, 0),
    materials.accent,
  );
  sensorCrown.name = "carrier-sensor-crown";
  sensorCrown.position.set(0, 8.46, 0.8);
  group.add(sensorCrown);
}

function createMaterials(palette: ShipPalette): MaterialSet {
  const textures = getSurfaceTextures();
  return {
    hull: new THREE.MeshStandardMaterial({
      color: palette.hull,
      map: textures.hull,
      roughnessMap: textures.roughness,
      emissive: palette.emissive,
      emissiveIntensity: 0.22,
      metalness: 0.64,
      roughness: 0.58,
      flatShading: true,
    }),
    armor: new THREE.MeshStandardMaterial({
      color: palette.armor,
      map: textures.armor,
      roughnessMap: textures.roughness,
      emissive: 0x030405,
      emissiveIntensity: 0.08,
      metalness: 0.74,
      roughness: 0.44,
      flatShading: true,
    }),
    panel: new THREE.MeshStandardMaterial({
      color: palette.panel,
      map: textures.panel,
      roughnessMap: textures.panelRoughness,
      metalness: 0.52,
      roughness: 0.78,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: palette.panel,
      map: textures.panel,
      roughnessMap: textures.panelRoughness,
      emissive: palette.faction,
      emissiveIntensity: 0.34,
      metalness: 0.8,
      roughness: 0.2,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: palette.faction,
      emissive: palette.faction,
      emissiveIntensity: 0.72,
      metalness: 0.48,
      roughness: 0.32,
    }),
    engine: new THREE.MeshBasicMaterial({
      color: palette.accent,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    engineCore: new THREE.MeshBasicMaterial({
      color: 0xe4fbff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
}

function createThrusters(
  group: THREE.Group,
  classId: ShipClassId,
  materials: MaterialSet,
): { thrusterGlows: THREE.Mesh[]; thrusterCores: THREE.Mesh[] } {
  const thrusterGlows: THREE.Mesh[] = [];
  const thrusterCores: THREE.Mesh[] = [];
  const count = classId === "carrier" ? 3 : 2;
  const spacing = classId === "carrier" ? 3.1 : 2.25;
  const z = classId === "carrier" ? -9.6 : classId === "striker" ? -7.2 : -6.1;

  for (let index = 0; index < count; index += 1) {
    const x = (index - (count - 1) / 2) * spacing;
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.95, 2.5, 10),
      materials.panel,
    );
    housing.rotation.x = Math.PI / 2;
    housing.position.set(x, -0.3, z + 0.8);
    group.add(housing);

    const glow = new THREE.Mesh(
      new THREE.ConeGeometry(0.72, 3.6, 10, 1, true),
      materials.engine,
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, -0.3, z - 1.9);
    group.add(glow);
    thrusterGlows.push(glow);

    const core = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 2.35, 8, 1, true),
      materials.engineCore,
    );
    core.rotation.x = -Math.PI / 2;
    core.position.set(x, -0.3, z - 1.32);
    group.add(core);
    thrusterCores.push(core);
  }
  return { thrusterGlows, thrusterCores };
}

function createSelectionRing(classId: ShipClassId, factionColor: number): THREE.Mesh {
  const radius = classId === "carrier" ? 9.1 : classId === "striker" ? 7.1 : 5.8;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + 0.14, 64, 1, 0.22, Math.PI * 1.58),
    new THREE.MeshBasicMaterial({
      color: factionColor,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = GROUND_Y - SHIP_Y + 0.2;
  ring.visible = false;
  return ring;
}

function createRegistryDecal(classId: ShipClassId, accent: number): THREE.Mesh {
  const spec = REGISTRY_SPECS[classId];
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.dimensions[0], spec.dimensions[1]),
    new THREE.MeshBasicMaterial({
      color: accent,
      map: getSurfaceTextures().registry[classId],
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
    }),
  );
  decal.rotation.set(-Math.PI / 2, 0, spec.rotation);
  decal.position.set(0, spec.height, spec.z);
  decal.name = classId + "-registry-decal";
  return decal;
}

function createDamageOverlays(classId: ShipClassId): THREE.Mesh[] {
  const spec = DAMAGE_SPECS[classId];
  const textures = getSurfaceTextures().damage;
  return spec.positions.map((position, index) => {
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(
        spec.size * (1 - index * 0.12),
        spec.size * (1 - index * 0.12),
      ),
      new THREE.MeshBasicMaterial({
        color: index === 0 ? 0x2a1711 : index === 1 ? 0x1c100d : 0x111315,
        map: textures[index],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        side: THREE.DoubleSide,
      }),
    );
    overlay.rotation.set(-Math.PI / 2, 0, position.rotation);
    overlay.position.set(position.x, spec.top + index * 0.015, position.z);
    overlay.visible = false;
    overlay.name = classId + "-damage-stage-" + (index + 1);
    return overlay;
  });
}

function getPalette(owner: Faction): ShipPalette {
  return owner === "player"
    ? {
        faction: 0x5ca7b2,
        accent: 0x83c1ca,
        hull: 0x46545a,
        armor: 0x607178,
        panel: 0x202b30,
        emissive: 0x020a0d,
      }
    : {
        faction: 0xa45748,
        accent: 0xcf7157,
        hull: 0x4b4946,
        armor: 0x67615d,
        panel: 0x292522,
        emissive: 0x090302,
      };
}

function getSurfaceTextures(): SurfaceTextures {
  if (surfaceTextures) {
    return surfaceTextures;
  }

  surfaceTextures = {
    hull: createCanvasTexture(128, (context, size) => {
      context.fillStyle = "#aeb4b5";
      context.fillRect(0, 0, size, size);
      context.strokeStyle = "rgba(35, 43, 45, 0.34)";
      context.lineWidth = 2;
      for (let offset = 0; offset <= size; offset += 32) {
        context.beginPath();
        context.moveTo(offset, 0);
        context.lineTo(offset, size);
        context.moveTo(0, offset);
        context.lineTo(size, offset);
        context.stroke();
      }
      context.strokeStyle = "rgba(238, 242, 242, 0.17)";
      context.lineWidth = 1;
      context.strokeRect(6.5, 6.5, 51, 25);
      context.strokeRect(70.5, 38.5, 51, 51);
      for (let index = 0; index < 180; index += 1) {
        const x = (index * 47) % size;
        const y = (index * 83) % size;
        context.fillStyle = index % 3 === 0
          ? "rgba(255,255,255,0.09)"
          : "rgba(0,0,0,0.08)";
        context.fillRect(x, y, 1, 1);
      }
    }),
    armor: createCanvasTexture(128, (context, size) => {
      context.fillStyle = "#9ea6a7";
      context.fillRect(0, 0, size, size);
      context.strokeStyle = "rgba(24, 31, 33, 0.46)";
      context.lineWidth = 2;
      for (let row = 0; row < 4; row += 1) {
        const y = 12 + row * 32;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(20 + (row % 2) * 10, y);
        context.lineTo(32 + (row % 2) * 10, y + 8);
        context.lineTo(78 + (row % 2) * 10, y + 8);
        context.lineTo(90 + (row % 2) * 10, y);
        context.lineTo(size, y);
        context.stroke();
      }
      context.fillStyle = "rgba(24, 30, 32, 0.48)";
      for (let index = 0; index < 32; index += 1) {
        context.beginPath();
        context.arc(
          8 + ((index * 37) % 112),
          8 + ((index * 61) % 112),
          1.1,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
      context.strokeStyle = "rgba(240, 244, 244, 0.12)";
      context.lineWidth = 1;
      context.strokeRect(4.5, 4.5, size - 9, size - 9);
    }),
    panel: createCanvasTexture(128, (context, size) => {
      context.fillStyle = "#7f898b";
      context.fillRect(0, 0, size, size);
      for (let offset = 0; offset < size; offset += 16) {
        context.fillStyle = offset % 32 === 0
          ? "rgba(24, 30, 31, 0.42)"
          : "rgba(236, 241, 241, 0.08)";
        context.fillRect(offset, 0, 3, size);
      }
      context.strokeStyle = "rgba(24, 31, 33, 0.5)";
      context.lineWidth = 1;
      for (let row = 0; row < 6; row += 1) {
        const y = 10 + row * 20;
        context.beginPath();
        context.moveTo(7, y);
        context.lineTo(53, y);
        context.moveTo(70, y + 5);
        context.lineTo(120, y + 5);
        context.stroke();
      }
      context.fillStyle = "rgba(10, 14, 15, 0.5)";
      for (let index = 0; index < 8; index += 1) {
        context.fillRect(16 + index * 12, 56, 7, 3);
        context.fillRect(16 + index * 12, 64, 7, 2);
      }
    }),
    roughness: createCanvasTexture(128, (context, size) => {
      context.fillStyle = "#b8b8b8";
      context.fillRect(0, 0, size, size);
      for (let index = 0; index < 300; index += 1) {
        const shade = 108 + ((index * 29) % 72);
        context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        context.fillRect((index * 53) % size, (index * 97) % size, 1, 1);
      }
    }),
    panelRoughness: createCanvasTexture(128, (context, size) => {
      context.fillStyle = "#d0d0d0";
      context.fillRect(0, 0, size, size);
      for (let offset = 0; offset < size; offset += 16) {
        const shade = offset % 32 === 0 ? 112 : 176;
        context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        context.fillRect(offset, 0, 4, size);
      }
    }),
    registry: {
      scout: createRegistryTexture("scout"),
      striker: createRegistryTexture("striker"),
      carrier: createRegistryTexture("carrier"),
    },
    damage: [
      createDamageTexture(0),
      createDamageTexture(1),
      createDamageTexture(2),
    ],
  };
  surfaceTextures.hull.colorSpace = THREE.SRGBColorSpace;
  surfaceTextures.armor.colorSpace = THREE.SRGBColorSpace;
  surfaceTextures.panel.colorSpace = THREE.SRGBColorSpace;
  for (const texture of Object.values(surfaceTextures.registry)) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
  }
  for (const texture of surfaceTextures.damage) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
  }
  return surfaceTextures;
}

function createRegistryTexture(classId: ShipClassId): THREE.CanvasTexture {
  const labels: Record<ShipClassId, { code: string; role: string }> = {
    scout: { code: "SC-01", role: "RECON" },
    striker: { code: "ST-02", role: "LINE" },
    carrier: { code: "CV-03", role: "COMMAND" },
  };
  const label = labels[classId];
  return createCanvasTexture(128, (context, size) => {
    context.clearRect(0, 0, size, size);
    context.fillStyle = "rgba(255, 255, 255, 0.94)";
    context.fillRect(10, 10, 5, 52);
    context.fillRect(20, 10, 2, 52);
    context.fillRect(10, 69, 64, 3);
    context.fillRect(10, 78, 42, 2);
    context.font = "700 13px monospace";
    context.fillText("KHEPRI", 31, 25);
    context.font = "700 10px monospace";
    context.fillText(label.code, 31, 42);
    context.font = "700 8px monospace";
    context.fillText(label.role, 31, 56);
    context.strokeStyle = "rgba(255, 255, 255, 0.76)";
    context.lineWidth = 1.5;
    context.strokeRect(91.5, 9.5, 25, 25);
    context.beginPath();
    if (classId === "scout") {
      context.moveTo(96, 29);
      context.lineTo(104, 14);
      context.lineTo(112, 29);
    } else if (classId === "striker") {
      context.arc(104, 22, 7, 0, Math.PI * 2);
      context.moveTo(104, 12);
      context.lineTo(104, 32);
      context.moveTo(94, 22);
      context.lineTo(114, 22);
    } else {
      context.moveTo(96, 15);
      context.lineTo(112, 15);
      context.lineTo(112, 29);
      context.lineTo(96, 29);
      context.closePath();
      context.moveTo(104, 12);
      context.lineTo(104, 32);
    }
    context.stroke();
  });
}

function createDamageTexture(stage: number): THREE.CanvasTexture {
  return createCanvasTexture(128, (context, size) => {
    context.clearRect(0, 0, size, size);
    const centerX = stage === 1 ? 70 : stage === 2 ? 58 : 64;
    const centerY = stage === 1 ? 56 : stage === 2 ? 68 : 64;
    const gradient = context.createRadialGradient(
      centerX,
      centerY,
      stage === 2 ? 7 : 3,
      centerX,
      centerY,
      58,
    );
    gradient.addColorStop(0, "rgba(3, 2, 2, 0.98)");
    gradient.addColorStop(0.24, stage === 0
      ? "rgba(65, 24, 12, 0.88)"
      : "rgba(30, 17, 14, 0.9)");
    gradient.addColorStop(0.58, "rgba(18, 15, 13, 0.38)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    if (stage === 2) {
      context.fillStyle = "rgba(2, 3, 3, 0.96)";
      context.beginPath();
      context.moveTo(centerX - 11, centerY - 3);
      context.lineTo(centerX - 4, centerY - 13);
      context.lineTo(centerX + 9, centerY - 8);
      context.lineTo(centerX + 13, centerY + 5);
      context.lineTo(centerX + 2, centerY + 14);
      context.lineTo(centerX - 12, centerY + 8);
      context.closePath();
      context.fill();
    }

    context.strokeStyle = stage === 0
      ? "rgba(18, 6, 3, 0.94)"
      : "rgba(4, 5, 5, 0.96)";
    context.lineWidth = stage === 2 ? 2.6 : 2;
    const branches = 6 + stage * 2;
    for (let branch = 0; branch < branches; branch += 1) {
      const angle = branch * (2.15 + stage * 0.13);
      const reach = 30 + ((branch * 13 + stage * 7) % 22);
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(
        centerX + Math.cos(angle) * reach * 0.48,
        centerY + Math.sin(angle) * reach * 0.48,
      );
      context.lineTo(
        centerX + Math.cos(angle + 0.16) * reach,
        centerY + Math.sin(angle + 0.16) * reach,
      );
      context.stroke();
    }
  });
}

function createCanvasTexture(
  size: number,
  draw: (context: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create ship surface texture");
  }
  draw(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.anisotropy = 4;
  return texture;
}

function createAngularHullGeometry(
  width: number,
  length: number,
  height: number,
  bevelEnabled = true,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, length * 0.5);
  shape.lineTo(width * 0.32, length * 0.2);
  shape.lineTo(width * 0.5, -length * 0.22);
  shape.lineTo(width * 0.3, -length * 0.5);
  shape.lineTo(-width * 0.3, -length * 0.5);
  shape.lineTo(-width * 0.5, -length * 0.22);
  shape.lineTo(-width * 0.32, length * 0.2);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    steps: 1,
    bevelEnabled,
    bevelSegments: 1,
    bevelSize: bevelEnabled ? 0.16 : 0,
    bevelThickness: bevelEnabled ? 0.18 : 0,
  });
  geometry.center();
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}
