// Factory for per-regen resource pools. Each `makePool()` call returns an
// independent pool with its own namespace — flora and fauna each get one so
// their resources don't collide. `reset()` clears the pool between world
// regens so stale (disposed) Three.js handles don't leak.

/**
 * Create a per-regen get-or-create cache for shared geometries/materials.
 * Only resources fully derived from the biome (no per-instance `Math.random`)
 * are safe to store here. Callers own their own `makePool()` instance
 * (flora and fauna each keep one) and MUST call `reset()` at the top of every
 * `generateWorld` — pooled handles are disposed when the previous world's
 * group is torn down, so a stale `get` after that point would return disposed
 * objects. Portal previews swap in a scratch instance instead of the shared
 * pool (see `withIsolatedFloraPool` / `withIsolatedCreaturePool`).
 *
 * @returns {{get: (key: string, factory: () => any) => any, reset: () => void, values: () => IterableIterator<any>}}
 *   `get` returns the cached value for `key`, creating it via `factory()` on first miss;
 *   `reset` clears the cache for a new regen;
 *   `values` snapshots currently-cached resources — used by portal preview pool
 *   isolation (disposing an isolated pool wholesale once its preview build finishes)
 *   and by pool-aware disposal on individual-reject placement paths (a skip-list so
 *   rejecting one consumer doesn't dispose a resource other consumers already share).
 */
export function makePool() {
  let map = new Map();
  const get = (key, factory) => {
    let v = map.get(key);
    if (v === undefined) {
      v = factory();
      map.set(key, v);
    }
    return v;
  };
  const reset = () => {
    map = new Map();
  };
  const values = () => map.values();
  return { get, reset, values };
}
