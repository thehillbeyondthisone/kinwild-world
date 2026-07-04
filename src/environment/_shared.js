import { state, DENSITY_BASE } from "../state.js";
import { LOWFX, LOWFX_DENSITY } from "../lowfx.js";

export const lowfxScale = (n) => (LOWFX ? Math.max(1, Math.round(n * LOWFX_DENSITY)) : n);

// Ground-cover counts were tuned against DENSITY_BASE; scale linearly with the
// current ISLAND_SIZE so larger worlds keep the same per-area density. The
// optional `gain` lets a specific layer be visually denser than the historical
// baseline (grass and wildflowers were tuned too sparse for the new size).
export const coverScale = (n, gain = 1) =>
  lowfxScale(Math.round(n * (state.ISLAND_SIZE / DENSITY_BASE) * gain));
