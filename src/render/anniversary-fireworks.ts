import * as THREE from "three";

const MAX_ACTIVE_BURSTS = 12;
const BURST_LIFETIME = 2.6;

interface ScheduledBurst {
  delay: number;
  origin: THREE.Vector3;
  palette: number[];
  particleCount: number;
}

interface ActiveBurst {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  age: number;
  lifetime: number;
  baseSize: number;
}

export interface FireworksLaunchOptions {
  highQuality: boolean;
  reducedMotion: boolean;
}

const PALETTES = [
  [0xffd875, 0xff8f6b, 0xfff0b8],
  [0x72dfff, 0x8f9dff, 0xe6f8ff],
  [0xff78bd, 0xb68cff, 0xffd7ed],
  [0x7effbb, 0x74cfff, 0xe4fff3],
];

/** Lightweight world-space particle celebration that does not touch simulation state. */
export class AnniversaryFireworks {
  private readonly scene: THREE.Scene;
  private readonly activeBursts: ActiveBurst[] = [];
  private scheduledBursts: ScheduledBurst[] = [];
  private celebrationTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get isActive(): boolean {
    return this.scheduledBursts.length > 0 || this.activeBursts.length > 0;
  }

  get activeBurstCount(): number {
    return this.activeBursts.length;
  }

  launch(options: FireworksLaunchOptions): void {
    const burstCount = options.reducedMotion ? 3 : options.highQuality ? 8 : 5;
    const particleCount = options.reducedMotion
      ? 26
      : options.highQuality
        ? 82
        : 48;

    this.celebrationTime = 0;
    this.scheduledBursts = Array.from({ length: burstCount }, (_, index) => {
      const lane = index % 4;
      const row = Math.floor(index / 4);
      return {
        delay: options.reducedMotion ? index * 0.42 : index * 0.19 + row * 0.12,
        origin: new THREE.Vector3(
          -48 + lane * 32 + (Math.random() - 0.5) * 10,
          24 + row * 23 + Math.random() * 13,
          -18 + Math.random() * 27,
        ),
        palette: PALETTES[index % PALETTES.length],
        particleCount,
      };
    });
  }

  update(delta: number): void {
    this.celebrationTime += delta;

    const readyBursts = this.scheduledBursts.filter(
      (burst) => burst.delay <= this.celebrationTime,
    );
    this.scheduledBursts = this.scheduledBursts.filter(
      (burst) => burst.delay > this.celebrationTime,
    );
    readyBursts.forEach((burst) => this.createBurst(burst));

    for (let index = this.activeBursts.length - 1; index >= 0; index -= 1) {
      const burst = this.activeBursts[index];
      burst.age += delta;

      if (burst.age >= burst.lifetime) {
        this.removeBurst(index);
        continue;
      }

      const positions = burst.points.geometry.attributes.position
        .array as Float32Array;
      const drag = Math.pow(0.985, delta * 60);
      for (let particle = 0; particle < positions.length; particle += 3) {
        burst.velocities[particle] *= drag;
        burst.velocities[particle + 1] =
          burst.velocities[particle + 1] * drag - 10.5 * delta;
        burst.velocities[particle + 2] *= drag;
        positions[particle] += burst.velocities[particle] * delta;
        positions[particle + 1] += burst.velocities[particle + 1] * delta;
        positions[particle + 2] += burst.velocities[particle + 2] * delta;
      }
      burst.points.geometry.attributes.position.needsUpdate = true;

      const progress = burst.age / burst.lifetime;
      burst.points.material.opacity = Math.min(1, (1 - progress) * 1.8);
      burst.points.material.size = burst.baseSize * (0.9 + progress * 0.45);
    }
  }

  dispose(): void {
    this.scheduledBursts = [];
    while (this.activeBursts.length > 0) {
      this.removeBurst(this.activeBursts.length - 1);
    }
  }

  private createBurst(config: ScheduledBurst): void {
    if (this.activeBursts.length >= MAX_ACTIVE_BURSTS) {
      this.removeBurst(0);
    }

    const positions = new Float32Array(config.particleCount * 3);
    const velocities = new Float32Array(config.particleCount * 3);
    const colors = new Float32Array(config.particleCount * 3);
    const color = new THREE.Color();

    for (let index = 0; index < config.particleCount; index += 1) {
      const offset = index * 3;
      const theta = Math.random() * Math.PI * 2;
      const cosPhi = Math.random() * 2 - 1;
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      const speed = 13 + Math.random() * 22;

      positions[offset] = (Math.random() - 0.5) * 0.7;
      positions[offset + 1] = (Math.random() - 0.5) * 0.7;
      positions[offset + 2] = (Math.random() - 0.5) * 0.7;
      velocities[offset] = Math.cos(theta) * sinPhi * speed;
      velocities[offset + 1] = cosPhi * speed + 4.5;
      velocities[offset + 2] = Math.sin(theta) * sinPhi * speed;

      color.setHex(config.palette[index % config.palette.length]);
      const brightness = 0.82 + Math.random() * 0.18;
      colors[offset] = color.r * brightness;
      colors[offset + 1] = color.g * brightness;
      colors[offset + 2] = color.b * brightness;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const baseSize = 2.1 + Math.random() * 1.1;
    const material = new THREE.PointsMaterial({
      size: baseSize,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.position.copy(config.origin);
    points.frustumCulled = false;
    points.renderOrder = 20;
    this.scene.add(points);
    this.activeBursts.push({
      points,
      velocities,
      age: 0,
      lifetime: BURST_LIFETIME + Math.random() * 0.45,
      baseSize,
    });
  }

  private removeBurst(index: number): void {
    const [burst] = this.activeBursts.splice(index, 1);
    if (!burst) {
      return;
    }
    this.scene.remove(burst.points);
    burst.points.geometry.dispose();
    burst.points.material.dispose();
  }
}
