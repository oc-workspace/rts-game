import { BATTLEFIELD_RADIUS, SHIP_Y } from "./encounter";
import type { Unit, UnitOrder, Vec3 } from "./types";

export function hasActiveOrder(unit: Unit): boolean {
  return Boolean(unit.targetPosition || unit.targetUnitId);
}

export function applyOrder(unit: Unit, order: UnitOrder): void {
  if (order.type === "move") {
    unit.targetPosition = { ...order.targetPosition };
    unit.targetUnitId = null;
    unit.state = "moving";
  } else {
    unit.targetUnitId = order.targetUnitId;
    unit.targetPosition = null;
    unit.state = "attacking";
  }
}

export function queueUnitOrder(
  unit: Unit,
  order: UnitOrder,
  append: boolean,
): void {
  if (append && hasActiveOrder(unit)) {
    unit.orderQueue.push(cloneOrder(order));
    return;
  }

  unit.orderQueue = [];
  applyOrder(unit, order);
}

export function activateNextOrder(unit: Unit): boolean {
  const nextOrder = unit.orderQueue.shift();
  if (!nextOrder) {
    return false;
  }

  applyOrder(unit, nextOrder);
  return true;
}

export function getFormationTarget(
  target: Vec3,
  index: number,
  count: number,
): Vec3 {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const row = Math.floor(index / columns);
  const column = index % columns;
  const width = Math.min(columns, count - row * columns);
  const offsetX = (column - (width - 1) / 2) * 4.5;
  const offsetZ = -row * 4.5;
  return {
    x: clamp(target.x + offsetX, -BATTLEFIELD_RADIUS, BATTLEFIELD_RADIUS),
    y: SHIP_Y,
    z: clamp(target.z + offsetZ, -BATTLEFIELD_RADIUS, BATTLEFIELD_RADIUS),
  };
}

function cloneOrder(order: UnitOrder): UnitOrder {
  return order.type === "move"
    ? { type: "move", targetPosition: { ...order.targetPosition } }
    : { type: "attack", targetUnitId: order.targetUnitId };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

