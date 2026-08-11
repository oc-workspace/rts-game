import { describe, expect, it } from "vitest";
import { BATTLEFIELD_RADIUS, SHIP_CLASSES, SHIP_Y } from "./encounter";
import {
  activateNextOrder,
  getFormationTarget,
  queueUnitOrder,
} from "./orders";
import type { Unit } from "./types";

describe("orders", () => {
  it("replaces the current order when append is false", () => {
    const unit = createUnit();
    unit.targetUnitId = "enemy-01";
    unit.orderQueue.push({ type: "attack", targetUnitId: "enemy-02" });

    queueUnitOrder(
      unit,
      { type: "move", targetPosition: { x: 10, y: SHIP_Y, z: 12 } },
      false,
    );

    expect(unit.targetUnitId).toBeNull();
    expect(unit.targetPosition).toEqual({ x: 10, y: SHIP_Y, z: 12 });
    expect(unit.orderQueue).toEqual([]);
  });

  it("appends and activates the next queued order", () => {
    const unit = createUnit();
    unit.targetPosition = { x: 2, y: SHIP_Y, z: 3 };

    queueUnitOrder(unit, { type: "attack", targetUnitId: "enemy-01" }, true);
    expect(unit.orderQueue).toHaveLength(1);

    unit.targetPosition = null;
    expect(activateNextOrder(unit)).toBe(true);
    expect(unit.targetUnitId).toBe("enemy-01");
    expect(unit.orderQueue).toEqual([]);
  });

  it("clamps formation slots to the battlefield", () => {
    for (let index = 0; index < 9; index += 1) {
      const target = getFormationTarget(
        { x: BATTLEFIELD_RADIUS, y: SHIP_Y, z: -BATTLEFIELD_RADIUS },
        index,
        9,
      );
      expect(Math.abs(target.x)).toBeLessThanOrEqual(BATTLEFIELD_RADIUS);
      expect(Math.abs(target.z)).toBeLessThanOrEqual(BATTLEFIELD_RADIUS);
    }
  });
});

function createUnit(): Unit {
  return {
    id: "p-scout-01",
    owner: "player",
    classId: "scout",
    spawnPosition: { x: 0, y: SHIP_Y, z: 0 },
    position: { x: 0, y: SHIP_Y, z: 0 },
    heading: 0,
    targetPosition: null,
    targetUnitId: null,
    health: SHIP_CLASSES.scout.maxHealth,
    cooldownRemaining: 0,
    state: "idle",
    orderQueue: [],
    selected: false,
    destroyed: false,
  };
}

