import { describe, expect, it } from "vitest";
import manifest from "../../public/assets/ships/striker/v1/asset-manifest.json";

describe("striker near asset manifest", () => {
  it("records a bounded glTF pilot with a procedural fallback", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.assetId).toBe("striker-near-v1");
    expect(manifest.shipClass).toBe("striker");
    expect(manifest.model.format).toBe("glTF 2.0");
    expect(manifest.model.meshCount).toBe(6);
    expect(manifest.model.triangleCount).toBe(156);
    expect(manifest.runtime.nearDetailMeshCount).toBeLessThanOrEqual(
      manifest.runtime.nearDetailMeshBudget,
    );
    expect(manifest.runtime.fallback).toContain("procedural");
    expect(manifest.runtime.debugOverride).toContain("strikerAsset=fallback");
  });

  it("keeps the striker wider than the scout pilot", () => {
    expect(manifest.model.dimensions.width).toBeGreaterThan(12);
    expect(manifest.model.dimensions.width).toBeGreaterThan(
      manifest.model.dimensions.length * 0.8,
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
