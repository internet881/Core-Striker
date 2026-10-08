/**
 * Core Striker Authoritative Physics Engine
 * Pure 2D kinetic shuffleboard simulation (Zero Rotational Spin)
 * Deterministic fixed-step 60 Hz simulation.
 */

const SpatialHashGrid = require('./spatial_grid');

const WORLD = {
  R_ORBIT: 1080,
  R_BOUNDARY: 950,
  R_ARENA: 890,
  R_CORE: 48,
  R_SINGULARITY: 15,
  PUCK_RADIUS: 8.5,
  ICE_FRICTION: 0.992,
  pegBounce: 0.85,
  bumperBounce: 1.15
};

const MAP_SIZES = {
  small: { id: "small", scale: 600 / 890, rArena: 600, rBoundary: 650, rOrbit: 750 },
  medium: { id: "medium", scale: 1.0, rArena: 890, rBoundary: 950, rOrbit: 1080 },
  large: { id: "large", scale: 1350 / 890, rArena: 1350, rBoundary: 1440, rOrbit: 1600 },
  colossal: { id: "colossal", scale: 1800 / 890, rArena: 1800, rBoundary: 1920, rOrbit: 2150 }
};

function createMap(mapId = "citadel", scale = 1.0) {
  const pegs = [];
  const s = scale;
  const pegScale = Math.min(1.35, Math.max(0.75, Math.sqrt(s)));

  if (mapId === "citadel") {
    const innerCount = 8;
    const rInner = 140 * s;
    for (let i = 0; i < innerCount; i++) {
      const theta = (i / innerCount) * Math.PI * 2;
      pegs.push({
        x: Math.cos(theta) * rInner,
        y: Math.sin(theta) * rInner,
        r: 8.5 * pegScale,
        isBumper: false
      });
    }

    const midCount = 12;
    const rMid = 280 * s;
    for (let i = 0; i < midCount; i++) {
      const theta = (i / midCount) * Math.PI * 2 + (Math.PI / 12);
      pegs.push({
        x: Math.cos(theta) * rMid,
        y: Math.sin(theta) * rMid,
        r: 9 * pegScale,
        isBumper: false
      });
    }
  } else if (mapId === "pachinko") {
    const rows = Math.round(6 * Math.min(1.4, Math.sqrt(s)));
    const spacing = 80 * s;
    for (let row = -rows; row <= rows; row++) {
      const maxCols = rows - Math.abs(row);
      for (let col = -maxCols; col <= maxCols; col++) {
        const x = col * spacing + (Math.abs(row) % 2 === 1 ? spacing * 0.5 : 0);
        const y = row * spacing;
        const dist = Math.hypot(x, y);
        if (dist > 70 * s && dist <= 360 * s) {
          pegs.push({
            x,
            y,
            r: 8 * pegScale,
            isBumper: false
          });
        }
      }
    }
  } else if (mapId === "crossfire") {
    const corners = [
      { x: 250 * s, y: 250 * s }, { x: -250 * s, y: 250 * s },
      { x: 250 * s, y: -250 * s }, { x: -250 * s, y: -250 * s }
    ];
    for (const c of corners) {
      pegs.push({ x: c.x, y: c.y, r: 15 * pegScale, isBumper: true });
    }
    for (let d = 130 * s; d <= 330 * s; d += 80 * s) {
      pegs.push({ x: d, y: 35 * s, r: 8.5 * pegScale, isBumper: false });
      pegs.push({ x: d, y: -35 * s, r: 8.5 * pegScale, isBumper: false });
      pegs.push({ x: -d, y: 35 * s, r: 8.5 * pegScale, isBumper: false });
      pegs.push({ x: -d, y: -35 * s, r: 8.5 * pegScale, isBumper: false });
      pegs.push({ x: 35 * s, y: d, r: 8.5 * pegScale, isBumper: false });
      pegs.push({ x: -35 * s, y: d, r: 8.5 * pegScale, isBumper: false });
      pegs.push({ x: 35 * s, y: -d, r: 8.5 * pegScale, isBumper: false });
      pegs.push({ x: -35 * s, y: -d, r: 8.5 * pegScale, isBumper: false });
    }
  } else if (mapId === "bullseye_funnel") {
    const rings = [150 * s, 280 * s];
    rings.forEach((r, rIdx) => {
      const count = 18 + rIdx * 8;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        const isGate = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].some(gate => Math.abs(theta - gate) < 0.24);
        if (!isGate) {
          pegs.push({
            x: Math.cos(theta) * r,
            y: Math.sin(theta) * r,
            r: 8.5 * pegScale,
            isBumper: false
          });
        }
      }
    });
  }

  return { id: mapId, pegs };
}

class PhysicsEngine {
  constructor(config = {}) {
    this.friction = config.iceFriction || WORLD.ICE_FRICTION;
    this.iceFriction = this.friction;
    this.pegBounce = config.pegBounce || WORLD.pegBounce;
    this.bumperBounce = config.bumperBounce || WORLD.bumperBounce;
    this.setSize(config.mapSize || "medium", config.mapLayout || "citadel");
    this.spatialGrid = new SpatialHashGrid(36);
  }

  setSize(sizeId, mapLayout = null) {
    const conf = MAP_SIZES[sizeId] || MAP_SIZES.medium;
    this.sizeId = conf.id;
    this.scale = conf.scale;
    this.rArena = conf.rArena;
    this.rBoundary = conf.rBoundary;
    this.rOrbit = conf.rOrbit;
    if (mapLayout) this.mapLayout = mapLayout;
    this.setMap(this.mapLayout || "citadel", this.scale);
  }

  setMap(mapLayout, scale = null) {
    const s = (scale !== null && scale !== undefined) ? scale : (this.scale || 1.0);
    this.mapLayout = (typeof mapLayout === 'string') ? mapLayout : (this.mapLayout || "citadel");
    if (typeof mapLayout === 'object' && mapLayout !== null && Array.isArray(mapLayout.pegs)) {
      this.map = mapLayout;
    } else {
      this.map = createMap(this.mapLayout, s);
    }
  }

  /**
   * Advances the 60 Hz physics step for all pucks on the board.
   * Returns state delta and events (knockouts, settled pucks, collisions).
   */
  step(pucks, players) {
    const events = [];
    const movingPucks = [];
    const playerMap = new Map();
    if (players) {
      for (const p of players) {
        playerMap.set(p.id, p);
      }
    }

    // 1. Clear spatial grid and insert all valid pucks
    this.spatialGrid.clear();
    for (let i = pucks.length - 1; i >= 0; i--) {
      const puck = pucks[i];
      if (puck.isKnockedOut || puck.isRetired) {
        continue;
      }
      this.spatialGrid.insert(puck);
      if (!puck.settled) {
        movingPucks.push(puck);
      }
    }

    // If no pucks are moving, early exit to conserve CPU
    if (movingPucks.length === 0) {
      return { events, activeCount: 0 };
    }

    // 2. Linear motion & settlement integration
    for (let i = 0; i < movingPucks.length; i++) {
      const puck = movingPucks[i];
      puck.age = (puck.age || 0) + 1;

      const dist = Math.hypot(puck.x, puck.y);
      if (dist < (puck.minDistance || Infinity)) {
        puck.minDistance = dist;
      }

      const boundaryRadius = this.rBoundary || WORLD.R_BOUNDARY;
      const orbitRadius = this.rOrbit || WORLD.R_ORBIT;
      if (dist < boundaryRadius) {
        puck.hasEnteredArena = true;
      }

      // Check boundary exit
      const isOutsideBoundary = puck.hasEnteredArena && dist >= boundaryRadius;
      const isWildMiss = !puck.hasEnteredArena && dist > orbitRadius * 1.15 && puck.age > 25;

      // Knockout detection (ejected by opponent)
      if (isOutsideBoundary && puck.lastBumperId != null && puck.lastBumperId !== puck.playerId) {
        const bumper = playerMap.get(puck.lastBumperId);
        if (bumper) {
          bumper.knockouts = (bumper.knockouts || 0) + 1;
        }
        puck.isKnockedOut = true;
        puck.settled = true;
        puck.vx = 0;
        puck.vy = 0;

        events.push({
          type: "KNOCKOUT",
          puckId: puck.id,
          victimPlayerId: puck.playerId,
          bumperPlayerId: puck.lastBumperId,
          x: puck.x,
          y: puck.y
        });
        continue;
      }

      if (isOutsideBoundary || isWildMiss) {
        puck.isRetired = true;
        puck.settled = true;
        puck.vx = 0;
        puck.vy = 0;
        events.push({
          type: "OUT_OF_BOUNDS",
          puckId: puck.id,
          playerId: puck.playerId
        });
        continue;
      }

      // Smooth linear friction
      puck.vx *= this.friction;
      puck.vy *= this.friction;

      puck.x += puck.vx * 0.45;
      puck.y += puck.vy * 0.45;

      // Settlement check
      const speed = Math.hypot(puck.vx, puck.vy);
      if (speed < 0.22 && puck.age > 35) {
        puck.settleTimer = (puck.settleTimer || 0) + 1;
        if (puck.settleTimer > 35) {
          puck.settled = true;
          puck.vx = 0;
          puck.vy = 0;

          // Check if settled outside the scoring arena ring
          const arenaRadius = this.rArena || WORLD.R_ARENA;
          if (dist > arenaRadius) {
            if (puck.lastBumperId != null && puck.lastBumperId !== puck.playerId) {
              const bumper = playerMap.get(puck.lastBumperId);
              if (bumper) bumper.knockouts = (bumper.knockouts || 0) + 1;
              puck.isKnockedOut = true;
              events.push({
                type: "KNOCKOUT",
                puckId: puck.id,
                victimPlayerId: puck.playerId,
                bumperPlayerId: puck.lastBumperId,
                x: puck.x,
                y: puck.y
              });
            } else {
              puck.isRetired = true;
              events.push({ type: "RING_OUT", puckId: puck.id, playerId: puck.playerId });
            }
          } else {
            // Check for Crokinole standstill foul rule:
            if (puck.mustHitOpponent && !puck.hasHitOpponent) {
              puck.isFouled = true;
              puck.isKnockedOut = true;
              events.push({
                type: "PUCK_FOULED",
                puckId: puck.id,
                playerId: puck.playerId,
                playerName: puck.playerName,
                x: puck.x,
                y: puck.y
              });
            } else {
              const rawMm = Number((dist * 0.5).toFixed(2));
              events.push({
                type: "PUCK_SETTLED",
                puckId: puck.id,
                playerId: puck.playerId,
                x: puck.x,
                y: puck.y,
                distMm: rawMm
              });
            }
          }
        }
      } else if (speed >= 0.22) {
        puck.settleTimer = 0;
        puck.settled = false;
      }
    }

    // 3. Puck-to-Peg Ricochet Collisions
    if (!this.map || !Array.isArray(this.map.pegs)) {
      this.setMap(this.map);
    }
    const pegs = (this.map && Array.isArray(this.map.pegs)) ? this.map.pegs : [];

    for (let i = 0; i < movingPucks.length; i++) {
      const puck = movingPucks[i];
      if (puck.settled || puck.isKnockedOut || puck.isRetired) continue;

      for (let j = 0; j < pegs.length; j++) {
        const peg = pegs[j];
        const dx = puck.x - peg.x;
        const dy = puck.y - peg.y;
        const dist = Math.hypot(dx, dy);
        const minDist = WORLD.PUCK_RADIUS + peg.r;

        if (dist < minDist) {
          const overlap = Math.min(minDist - dist, 8);
          const nx = dist > 0.001 ? (dx / dist) : 1;
          const ny = dist > 0.001 ? (dy / dist) : 0;

          puck.x += nx * overlap;
          puck.y += ny * overlap;

          const vn = puck.vx * nx + puck.vy * ny;
          if (vn < 0) {
            const restitution = peg.isBumper ? this.bumperBounce : this.pegBounce;
            puck.vx -= (1 + restitution) * vn * nx;
            puck.vy -= (1 + restitution) * vn * ny;

            const spd = Math.hypot(puck.vx, puck.vy);
            if (spd > 26) {
              puck.vx = (puck.vx / spd) * 26;
              puck.vy = (puck.vy / spd) * 26;
            }

            events.push({
              type: "PEG_HIT",
              puckId: puck.id,
              pegIndex: j,
              isBumper: peg.isBumper,
              x: peg.x,
              y: peg.y
            });
          }
        }
      }
    }

    // 4. Broadphase Puck-to-Puck Bumping Collisions via Spatial Hash Grid
    const candidatePairs = this.spatialGrid.findCandidatePairs(movingPucks);
    const diam = WORLD.PUCK_RADIUS * 2;

    for (let k = 0; k < candidatePairs.length; k++) {
      const [p1, p2] = candidatePairs[k];
      if (p1.isKnockedOut || p2.isKnockedOut || p1.isRetired || p2.isRetired) continue;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);

      if (dist < diam) {
        const overlap = Math.min((diam - dist) * 0.5, 6);
        const nx = dist > 0.001 ? (dx / dist) : 1;
        const ny = dist > 0.001 ? (dy / dist) : 0;
        const restitution = 0.88;

        // Bumper credit tracking
        p1.lastBumperId = p2.playerId;
        p2.lastBumperId = p1.playerId;

        // Wake up sleeping puck if struck
        p1.settled = false;
        p1.settleTimer = 0;
        p2.settled = false;
        p2.settleTimer = 0;

        // Opponent contact detection for Crokinole / Core Striker rule:
        if (p1.team && p2.team && p1.team !== p2.team) {
          p1.hasHitOpponent = true;
          p2.hasHitOpponent = true;
          events.push({
            type: "OPPONENT_HIT",
            puck1Id: p1.id,
            puck2Id: p2.id,
            p1Name: p1.playerName,
            p2Name: p2.playerName
          });
        }

        p1.x -= nx * overlap;
        p1.y -= ny * overlap;
        p2.x += nx * overlap;
        p2.y += ny * overlap;

        const kx = p1.vx - p2.vx;
        const ky = p1.vy - p2.vy;
        const p = 2 * (nx * kx + ny * ky) / 2;

        p1.vx -= p * nx * restitution;
        p1.vy -= p * ny * restitution;
        p2.vx += p * nx * restitution;
        p2.vy += p * ny * restitution;

        const spd1 = Math.hypot(p1.vx, p1.vy);
        if (spd1 > 26) {
          p1.vx = (p1.vx / spd1) * 26;
          p1.vy = (p1.vy / spd1) * 26;
        }
        const spd2 = Math.hypot(p2.vx, p2.vy);
        if (spd2 > 26) {
          p2.vx = (p2.vx / spd2) * 26;
          p2.vy = (p2.vy / spd2) * 26;
        }

        events.push({
          type: "PUCK_BUMP",
          puck1Id: p1.id,
          puck2Id: p2.id,
          x: (p1.x + p2.x) * 0.5,
          y: (p1.y + p2.y) * 0.5
        });
      }
    }

    return { events, activeCount: movingPucks.length };
  }
}

module.exports = {
  WORLD,
  MAP_SIZES,
  PhysicsEngine,
  createMap
};
