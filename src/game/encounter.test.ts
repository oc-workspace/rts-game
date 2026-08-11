import { describe, expect, it } from "vitest";
import {
  BATTLEFIELD_RADIUS,
  createEncounter,
  STRESS_UNIT_COUNTS,
} from "./encounter";

describe("createEncounter", () => {
  it("repeats the same encounter for the same seed", () => {
    expect(createEncounter(20260810)).toEqual(createEncounter(20260810));
  });

  it("changes the encounter for a different seed", () => {
    expect(createEncounter(20260810)).not.toEqual(createEncounter(20260811));
  });

  it("keeps fleets and neutral objects inside the battlefield", () => {
    const encounter = createEncounter(0xffffffff);
    const playerUnits = encounter.units.filter((unit) => unit.owner === "player");
    const enemyUnits = encounter.units.filter((unit) => unit.owner === "enemy");

    expect(playerUnits.length).toBeGreaterThanOrEqual(3);
    expect(playerUnits.length).toBeLessThanOrEqual(4);
    expect(enemyUnits.length).toBeGreaterThanOrEqual(3);
    expect(enemyUnits.length).toBeLessThanOrEqual(4);
    expect(encounter.neutrals.length).toBeGreaterThanOrEqual(7);
    expect(encounter.neutrals.length).toBeLessThanOrEqual(10);

    for (const object of [...encounter.units, ...encounter.neutrals]) {
      expect(Math.abs(object.position.x)).toBeLessThanOrEqual(BATTLEFIELD_RADIUS);
      expect(Math.abs(object.position.z)).toBeLessThanOrEqual(BATTLEFIELD_RADIUS);
    }
  });

  it.each(STRESS_UNIT_COUNTS)(
    "creates a deterministic %i-unit stress encounter inside the battlefield",
    (unitCount) => {
      const encounter = createEncounter(20260810, unitCount);

      expect(encounter).toEqual(createEncounter(20260810, unitCount));
      expect(encounter.units).toHaveLength(unitCount);
      expect(new Set(encounter.units.map((unit) => unit.id)).size).toBe(
        unitCount,
      );
      for (const unit of encounter.units) {
        expect(Math.abs(unit.position.x)).toBeLessThanOrEqual(BATTLEFIELD_RADIUS);
        expect(Math.abs(unit.position.z)).toBeLessThanOrEqual(BATTLEFIELD_RADIUS);
      }
    },
  );
});
