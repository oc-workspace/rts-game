import * as THREE from "three";
import { GROUND_Y, SHIP_CLASSES, SHIP_Y } from "../game/encounter";
import type { Faction, ShipClassId, Unit } from "../game/types";

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
  accent: THREE.MeshStandardMaterial;
  engine: THREE.MeshBasicMaterial;
  engineCore: THREE.MeshBasicMaterial;
}

interface SurfaceTextures {
  hull: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  registry: THREE.CanvasTexture;
  damage: THREE.CanvasTexture;
}

let surfaceTextures: SurfaceTextures | null = null;

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
    const threshold = 0.22 + index * 0.2;
    overlay.visible =
      !useDistantLod && quality === "high" && damage > threshold;
    const material = overlay.material as THREE.MeshBasicMaterial;
    material.opacity = THREE.MathUtils.clamp(
      (damage - threshold) * 1.8,
      0.18,
      0.78,
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
  group.add(
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
  group.add(dorsalArmor);

  const dorsalSpine = new THREE.Mesh(
    new THREE.BoxGeometry(0.86, 0.34, 7.2),
    materials.panel,
  );
  dorsalSpine.position.set(0, 1.72, -0.55);
  group.add(dorsalSpine);

  const sensorCanopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.82, 16, 8),
    materials.panel,
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
    group.add(wing);

    const radiator = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.72, 2.9),
      materials.panel,
    );
    radiator.position.set(side * 2.05, 0.28, -1.62);
    radiator.rotation.z = side * -0.12;
    group.add(radiator);

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
}

function buildStriker(group: THREE.Group, materials: MaterialSet): void {
  group.add(
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
  group.add(prowArmor);

  const centerKeel = new THREE.Mesh(
    createAngularHullGeometry(1.4, 10.6, 0.42),
    materials.panel,
  );
  centerKeel.name = "striker-center-keel";
  centerKeel.position.set(0, 2.62, -0.8);
  group.add(centerKeel);

  const commandBlister = new THREE.Mesh(
    createAngularHullGeometry(2.8, 3.4, 0.78),
    materials.panel,
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
    group.add(armorPlate);

    const shoulderSponson = new THREE.Mesh(
      createAngularHullGeometry(2.6, 6.2, 1.15),
      materials.armor,
    );
    shoulderSponson.name = "striker-shoulder-sponson";
    shoulderSponson.position.set(side * 4.72, 1.08, 0.72);
    shoulderSponson.rotation.y = side * -0.08;
    group.add(shoulderSponson);

    const gunMount = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.15, 1, 6),
      materials.panel,
    );
    gunMount.position.set(side * 3.55, 1.3, 3.25);
    group.add(gunMount);

    const recoilBlock = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.72, 1.65),
      materials.armor,
    );
    recoilBlock.name = "striker-recoil-block";
    recoilBlock.position.set(side * 3.55, 1.52, 2.7);
    group.add(recoilBlock);

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
    group.add(radiator);
  }

  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 9.5), materials.accent);
  strip.position.set(0, 2.88, -0.9);
  group.add(strip);
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
    materials.accent,
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
      map: textures.hull,
      roughnessMap: textures.roughness,
      emissive: 0x030405,
      emissiveIntensity: 0.12,
      metalness: 0.7,
      roughness: 0.48,
      flatShading: true,
    }),
    panel: new THREE.MeshStandardMaterial({
      color: palette.panel,
      map: textures.hull,
      roughnessMap: textures.roughness,
      metalness: 0.58,
      roughness: 0.7,
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
  const dimensions = classId === "carrier"
    ? [5.2, 8]
    : classId === "striker"
      ? [4.2, 5.8]
      : [2.8, 4.8];
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(dimensions[0], dimensions[1]),
    new THREE.MeshBasicMaterial({
      color: accent,
      map: getSurfaceTextures().registry,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
    }),
  );
  decal.rotation.x = -Math.PI / 2;
  const height = classId === "carrier" ? 3.52 : classId === "striker" ? 2.58 : 1.72;
  decal.position.set(0, height, -0.4);
  decal.name = "registry-decal";
  return decal;
}

function createDamageOverlays(classId: ShipClassId): THREE.Mesh[] {
  const top = classId === "carrier" ? 3.58 : classId === "striker" ? 2.64 : 1.78;
  const size = classId === "carrier" ? 5.4 : classId === "striker" ? 4.2 : 3.2;
  const positions = [
    { x: -0.22, z: 1.4, rotation: 0.2 },
    { x: 0.3, z: -1.6, rotation: -0.7 },
    { x: -0.34, z: -3.4, rotation: 0.95 },
  ];
  return positions.map((position, index) => {
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(
        size * (1 - index * 0.12),
        size * (1 - index * 0.12),
      ),
      new THREE.MeshBasicMaterial({
        color: 0x16110f,
        map: getSurfaceTextures().damage,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        side: THREE.DoubleSide,
      }),
    );
    overlay.rotation.set(-Math.PI / 2, 0, position.rotation);
    overlay.position.set(position.x * size, top + index * 0.015, position.z);
    overlay.visible = false;
    overlay.name = "damage-overlay-" + index;
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
    roughness: createCanvasTexture(128, (context, size) => {
      context.fillStyle = "#b8b8b8";
      context.fillRect(0, 0, size, size);
      for (let index = 0; index < 300; index += 1) {
        const shade = 108 + ((index * 29) % 72);
        context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
        context.fillRect((index * 53) % size, (index * 97) % size, 1, 1);
      }
    }),
    registry: createCanvasTexture(128, (context, size) => {
      context.clearRect(0, 0, size, size);
      context.fillStyle = "rgba(255, 255, 255, 0.92)";
      context.fillRect(13, 11, 5, 48);
      context.fillRect(23, 11, 2, 48);
      context.fillRect(13, 66, 58, 3);
      context.fillRect(13, 75, 37, 2);
      context.font = "700 13px monospace";
      context.fillText("KHEPRI", 34, 27);
      context.font = "700 9px monospace";
      context.fillText("NAVAL // 07", 34, 44);
      context.strokeStyle = "rgba(255, 255, 255, 0.7)";
      context.strokeRect(91.5, 10.5, 22, 22);
      context.beginPath();
      context.moveTo(92, 33);
      context.lineTo(113, 11);
      context.stroke();
    }),
    damage: createCanvasTexture(128, (context, size) => {
      context.clearRect(0, 0, size, size);
      const gradient = context.createRadialGradient(64, 64, 3, 64, 64, 58);
      gradient.addColorStop(0, "rgba(5, 2, 1, 0.98)");
      gradient.addColorStop(0.26, "rgba(38, 13, 8, 0.8)");
      gradient.addColorStop(0.58, "rgba(20, 13, 10, 0.34)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
      context.strokeStyle = "rgba(7, 3, 2, 0.92)";
      context.lineWidth = 3;
      for (let branch = 0; branch < 7; branch += 1) {
        const angle = branch * 2.41;
        context.beginPath();
        context.moveTo(64, 64);
        context.lineTo(64 + Math.cos(angle) * 24, 64 + Math.sin(angle) * 24);
        context.lineTo(64 + Math.cos(angle + 0.18) * 47, 64 + Math.sin(angle + 0.18) * 47);
        context.stroke();
      }
    }),
  };
  surfaceTextures.hull.colorSpace = THREE.SRGBColorSpace;
  surfaceTextures.registry.colorSpace = THREE.SRGBColorSpace;
  surfaceTextures.registry.wrapS = THREE.ClampToEdgeWrapping;
  surfaceTextures.registry.wrapT = THREE.ClampToEdgeWrapping;
  surfaceTextures.registry.repeat.set(1, 1);
  surfaceTextures.damage.wrapS = THREE.ClampToEdgeWrapping;
  surfaceTextures.damage.wrapT = THREE.ClampToEdgeWrapping;
  surfaceTextures.damage.repeat.set(1, 1);
  return surfaceTextures;
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
