const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

function normalizeDirection(direction, fallback) {
  let x;
  let z;
  if (Array.isArray(direction)) {
    [x, z] = direction;
  } else if (direction && typeof direction === "object") {
    x = direction.x;
    z = direction.z;
  }
  x = Number.isFinite(x) ? x : fallback.x;
  z = Number.isFinite(z) ? z : fallback.z;
  const length = Math.hypot(x, z);
  if (length < 1e-6) return { ...fallback };
  return { x: x / length, z: z / length };
}

/**
 * Small under-damped impulse envelope used by every generated-flora role.
 * It is independent of wall-clock time and clamps/substeps large `dt` values,
 * so replaying a fixed simulation produces the same pose.
 *
 * @param {object} opts
 * @param {number} opts.strength
 * @param {number} opts.stiffness
 * @param {number} opts.damping
 * @param {number} opts.maxValue
 * @param {{x: number, z: number}} opts.fallbackDirection
 */
export function createTouchEnvelope(opts) {
  const strength = clamp(opts.strength, 0.01, 4);
  const stiffness = clamp(opts.stiffness, 1, 120);
  const damping = clamp(opts.damping, 0.1, 40);
  const maxValue = clamp(opts.maxValue, 0.01, 1);
  const fallbackDirection = normalizeDirection(opts.fallbackDirection, { x: 1, z: 0 });

  let value = 0;
  let velocity = 0;
  let direction = fallbackDirection;
  const snapshot = {
    value: 0,
    velocity: 0,
    direction: { x: fallbackDirection.x, z: fallbackDirection.z },
    active: false,
  };

  const stepOnce = (dt) => {
    const acceleration = -stiffness * value - damping * velocity;
    velocity += acceleration * dt;
    value = clamp(value + velocity * dt, -maxValue, maxValue);
    if (Math.abs(value) < 1e-5 && Math.abs(velocity) < 1e-5) {
      value = 0;
      velocity = 0;
    }
  };

  return {
    trigger(amount = 1, nextDirection) {
      const impulse = clamp(Number(amount) || 0, -2, 2);
      direction = normalizeDirection(nextDirection, fallbackDirection);
      velocity = clamp(velocity + impulse * strength, -maxValue * 12, maxValue * 12);
      return this.snapshot();
    },
    update(dt) {
      let remaining = clamp(Number(dt) || 0, 0, 0.1);
      while (remaining > 0) {
        const h = Math.min(remaining, 1 / 120);
        stepOnce(h);
        remaining -= h;
      }
      return this.snapshot();
    },
    reset() {
      value = 0;
      velocity = 0;
      direction = fallbackDirection;
      return this.snapshot();
    },
    snapshot() {
      snapshot.value = value;
      snapshot.velocity = velocity;
      snapshot.direction.x = direction.x;
      snapshot.direction.z = direction.z;
      snapshot.active = value !== 0 || velocity !== 0;
      return snapshot;
    },
  };
}
