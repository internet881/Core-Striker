/**
 * SpatialHashGrid - 2D Uniform Spatial Hash Grid for high-performance broadphase collision detection.
 * Designed to handle 1,000+ combatants (up to 3,000 pucks) at 60 Hz without $O(N^2)$ CPU starvation.
 */
class SpatialHashGrid {
  constructor(cellSize = 36) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.grid = new Map();
  }

  clear() {
    this.grid.clear();
  }

  _hash(cx, cy) {
    return `${cx},${cy}`;
  }

  insert(puck) {
    const cx = Math.floor(puck.x * this.invCellSize);
    const cy = Math.floor(puck.y * this.invCellSize);
    const key = this._hash(cx, cy);

    let cell = this.grid.get(key);
    if (!cell) {
      cell = [];
      this.grid.set(key, cell);
    }
    cell.push(puck);
    puck._gridKey = key;
  }

  /**
   * Queries nearby pucks in the 9 neighboring cells around (x, y).
   */
  getNearby(x, y) {
    const cx = Math.floor(x * this.invCellSize);
    const cy = Math.floor(y * this.invCellSize);
    const neighbors = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = this._hash(cx + dx, cy + dy);
        const cell = this.grid.get(key);
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            neighbors.push(cell[i]);
          }
        }
      }
    }
    return neighbors;
  }

  /**
   * Broadphase collision pair generator.
   * Only tests moving pucks against their spatial neighbors (both active and sleeping).
   * Avoids duplicate pairs using unique ID comparisons.
   */
  findCandidatePairs(activePucks) {
    const pairs = [];
    const checked = new Set();

    for (let i = 0; i < activePucks.length; i++) {
      const p1 = activePucks[i];
      const neighbors = this.getNearby(p1.x, p1.y);

      for (let j = 0; j < neighbors.length; j++) {
        const p2 = neighbors[j];
        if (p1.id === p2.id) continue;

        // Ensure unique pair ordering
        const pairKey = p1.id < p2.id ? `${p1.id}:${p2.id}` : `${p2.id}:${p1.id}`;
        if (!checked.has(pairKey)) {
          checked.add(pairKey);
          pairs.push([p1, p2]);
        }
      }
    }
    return pairs;
  }
}

module.exports = SpatialHashGrid;
