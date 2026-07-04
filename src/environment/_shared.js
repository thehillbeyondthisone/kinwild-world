import { state, DENSITY_BASE } from "../state.js";
import { LOWFX, LOWFX_DENSITY } from "../lowfx.js";

/**
 * Scale a base instance/particle count down for weak hardware.
 * @param {number} n - base count tuned for full-fidelity rendering.
 * @returns {number} `n` unchanged, or `n * LOWFX_DENSITY` (min 1) when `LOWFX` is active.
 */
export const lowfxScale = (n) => (LOWFX ? Math.max(1, Math.round(n * LOWFX_DENSITY)) : n);

/**
 * Scale a base ground-cover count for the current world size (and LOWFX tier).
 * Counts in the codebase were tuned against `DENSITY_BASE`; this scales linearly
 * with `state.ISLAND_SIZE` so larger worlds keep the same per-area density.
 * @param {number} n - base count tuned at `DENSITY_BASE`.
 * @param {number} [gain=1] - extra multiplier for layers that should read denser
 *   than the historical baseline (e.g. grass, wildflowers).
 * @returns {number} the density- and LOWFX-adjusted instance count.
 */
export const coverScale = (n, gain = 1) =>
  lowfxScale(Math.round(n * (state.ISLAND_SIZE / DENSITY_BASE) * gain));
