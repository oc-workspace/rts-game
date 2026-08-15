import { describe, expect, it } from "vitest";
import manifest from "../../public/assets/ships/carrier/v1/asset-manifest.json";

describe("carrier near asset manifest", () => {
  it("records a bounded glTF pilot with a procedural fallback", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.assetId).toBe("carrier-near-v1");
    expect(manifest.shipClass).toBe("carrier");
    expect(manifest.model.format).toBe("glTF 2.0");
    expect(manifest.model.meshCount).toBe(10);
    expect(manifest.model.triangleCount).toBe(252);
    expect(manifest.runtime.nearDetailMeshCount).toBeLessThanOrEqual(
      manifest.runtime.nearDetailMeshBudget,
    );
    expect(manifest.runtime.fallback).toContain("procedural");
    expect(manifest.runtime.debugOverride).toContain("carrierAsset=fallback");
  });

  it("keeps capital-ship length, beam, and vertical mass", () => {
    expect(manifest.model.dimensions.length).toBeGreaterThan(24);
    expect(manifest.model.dimensions.width).toBeGreaterThan(18);
    expect(manifest.model.dimensions.height).toBeGreaterThan(5);
    expect(manifest.model.dimensions.length).toBeGreaterThan(
      manifest.model.dimensions.width * 1.2,
    );
  });

  it("records color and roughness bitmap provenance", () => {
    expect(manifest.textures.map((texture) => texture.role)).toEqual([
      "baseColor",
      "roughness",
    ]);
    for (const texture of manifest.textures) {
      expect(texture.dimensions).toBe("512x512");
      expect(texture.source.length).toBeGreaterThan(20);
      expect(texture.rightsNote.length).toBeGreaterThan(20);
      expect(texture.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
