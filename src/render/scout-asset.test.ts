import { describe, expect, it } from "vitest";
import manifest from "../../public/assets/ships/scout/v1/asset-manifest.json";

describe("scout near asset manifest", () => {
  it("records a bounded glTF pilot with a procedural fallback", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.assetId).toBe("scout-near-v1");
    expect(manifest.model.format).toBe("glTF 2.0");
    expect(manifest.model.meshCount).toBe(5);
    expect(manifest.model.triangleCount).toBe(124);
    expect(manifest.runtime.nearDetailMeshCount).toBeLessThanOrEqual(
      manifest.runtime.nearDetailMeshBudget,
    );
    expect(manifest.runtime.fallback).toContain("procedural");
    expect(manifest.runtime.debugOverride).toContain("scoutAsset=fallback");
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
