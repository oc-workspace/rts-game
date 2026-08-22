import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { AnniversaryFireworks } from "./anniversary-fireworks";

describe("AnniversaryFireworks", () => {
  it("launches a quality-scaled celebration and releases expired particles", () => {
    const scene = new THREE.Scene();
    const fireworks = new AnniversaryFireworks(scene);

    fireworks.launch({ highQuality: true, reducedMotion: false });
    fireworks.update(0.01);

    expect(fireworks.isActive).toBe(true);
    expect(fireworks.activeBurstCount).toBe(1);
    expect(scene.children).toHaveLength(1);

    fireworks.update(5);

    expect(fireworks.isActive).toBe(false);
    expect(fireworks.activeBurstCount).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it("uses fewer volleys when reduced motion is requested", () => {
    const scene = new THREE.Scene();
    const fireworks = new AnniversaryFireworks(scene);

    fireworks.launch({ highQuality: true, reducedMotion: true });
    fireworks.update(2);

    expect(fireworks.activeBurstCount).toBe(3);
    fireworks.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
