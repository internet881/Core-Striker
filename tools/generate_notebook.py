"""
Core Striker: Complete Game Data & Notebook Generator
Generates:
1. Game_Data_Notebook.ipynb (Interactive Jupyter Notebook with pre-rendered rich outputs)
2. GAME_NOTEBOOK.md (Complete Markdown Reference Notebook)
3. data/colosseum_pucks.csv (CSV export of all 164 combatant puck records)
4. data/game_data_full.json (Consolidated single-file game database)
"""

import json
import math
import os
import statistics
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
COLOSSEUM_PATH = os.path.join(DATA_DIR, "colosseum_state.json")

# Ensure DATA_DIR exists
os.makedirs(DATA_DIR, exist_ok=True)

# -------------------------------------------------------------
# 1. LOAD COLOSSEUM DATA
# -------------------------------------------------------------
with open(COLOSSEUM_PATH, "r", encoding="utf-8") as f:
    colosseum_data = json.load(f)

epoch_start_time = colosseum_data.get("epochStartTime", 0)
epoch_dt = datetime.fromtimestamp(epoch_start_time / 1000.0) if epoch_start_time > 0 else datetime.now()
raw_pucks = colosseum_data.get("pucks", [])

# -------------------------------------------------------------
# 2. GAME DATA DEFINITIONS
# -------------------------------------------------------------
WORLD_CONSTANTS = {
    "R_ORBIT": 1080,
    "R_BOUNDARY": 950,
    "R_ARENA": 890,
    "R_CORE": 48,
    "R_SINGULARITY": 15,
    "PUCK_RADIUS": 8.5,
    "PUCK_DIAMETER": 17.0,
    "ICE_FRICTION": 0.992,
    "pegBounce": 0.85,
    "bumperBounce": 1.15,
    "puckBounce": 0.88,
    "MAX_SPEED": 26.0,
    "PHYSICS_TICK_RATE_HZ": 60,
    "PHYSICS_STEP_DT_MS": 16.666,
    "DELTA_BROADCAST_HZ": 20,
    "SPATIAL_GRID_CELL_SIZE": 36,
    "DEFAULT_PUCKS_PER_PLAYER": 3
}

MAP_SIZES = {
    "small": {
        "id": "small",
        "label": "COMPACT (600px)",
        "scale": round(600 / 890, 4),
        "rArena": 600,
        "rBoundary": 650,
        "rOrbit": 750,
        "defaultMeZoom": 0.58,
        "defaultArenaZoom": 0.38
    },
    "medium": {
        "id": "medium",
        "label": "STANDARD (890px)",
        "scale": 1.0,
        "rArena": 890,
        "rBoundary": 950,
        "rOrbit": 1080,
        "defaultMeZoom": 0.44,
        "defaultArenaZoom": 0.28
    },
    "large": {
        "id": "large",
        "label": "MASSIVE (1350px)",
        "scale": round(1350 / 890, 4),
        "rArena": 1350,
        "rBoundary": 1440,
        "rOrbit": 1600,
        "defaultMeZoom": 0.32,
        "defaultArenaZoom": 0.18
    },
    "colossal": {
        "id": "colossal",
        "label": "COLOSSAL (1800px)",
        "scale": round(1800 / 890, 4),
        "rArena": 1800,
        "rBoundary": 1920,
        "rOrbit": 2150,
        "defaultMeZoom": 0.24,
        "defaultArenaZoom": 0.13
    }
}

def generate_citadel_pegs(scale=1.0):
    pegs = []
    peg_scale = min(1.35, max(0.75, math.sqrt(scale)))
    # Inner ring (8 pegs at r=140)
    for i in range(8):
        theta = (i / 8) * math.pi * 2
        pegs.append({
            "index": i,
            "x": round(math.cos(theta) * 140 * scale, 2),
            "y": round(math.sin(theta) * 140 * scale, 2),
            "r": round(8.5 * peg_scale, 2),
            "isBumper": False,
            "ring": "inner"
        })
    # Mid ring (12 pegs at r=280)
    for i in range(12):
        theta = (i / 12) * math.pi * 2 + (math.pi / 12)
        pegs.append({
            "index": 8 + i,
            "x": round(math.cos(theta) * 280 * scale, 2),
            "y": round(math.sin(theta) * 280 * scale, 2),
            "r": round(9.0 * peg_scale, 2),
            "isBumper": False,
            "ring": "mid"
        })
    return pegs

def generate_crossfire_pegs(scale=1.0):
    pegs = []
    peg_scale = min(1.35, max(0.75, math.sqrt(scale)))
    corners = [
        {"x": 250 * scale, "y": 250 * scale}, {"x": -250 * scale, "y": 250 * scale},
        {"x": 250 * scale, "y": -250 * scale}, {"x": -250 * scale, "y": -250 * scale}
    ]
    for c in corners:
        pegs.append({"x": c["x"], "y": c["y"], "r": round(15 * peg_scale, 2), "isBumper": True, "type": "super_bumper"})
    for d in [130 * scale, 210 * scale, 290 * scale]:
        for sign_x in [-1, 1]:
            for sign_y in [-1, 1]:
                pegs.append({"x": round(sign_x * d, 2), "y": round(sign_y * 35 * scale, 2), "r": round(8.5 * peg_scale, 2), "isBumper": False, "type": "guide"})
                pegs.append({"x": round(sign_x * 35 * scale, 2), "y": round(sign_y * d, 2), "r": round(8.5 * peg_scale, 2), "isBumper": False, "type": "guide"})
    return pegs

MAP_LAYOUTS = {
    "citadel": {
        "id": "citadel",
        "name": "Citadel",
        "description": "Double concentric orbital rings with 8 inner and 12 mid deflector pegs.",
        "pegs": generate_citadel_pegs(1.0)
    },
    "pachinko": {
        "id": "pachinko",
        "name": "Pachinko Pinfield",
        "description": "Dense hexagonal deflection lattice providing randomized ricochets towards the singularity.",
        "pegCountApprox": 56
    },
    "crossfire": {
        "id": "crossfire",
        "name": "Crossfire Arena",
        "description": "4 massive corner super-bumpers (+15% bounce) with orthogonal corridor choke-points.",
        "pegs": generate_crossfire_pegs(1.0)
    },
    "bullseye_funnel": {
        "id": "bullseye_funnel",
        "name": "Bullseye Funnel",
        "description": "Dual segmented security rings with 4 cardinal entry gates at 0, 90, 180, and 270 degrees.",
        "rings": [150, 280],
        "gateCount": 4
    }
}

GAME_MODES = {
    "closest": {
        "name": "Closest to Singularity (Curling/Shuffleboard)",
        "description": "Standard competition where combatants vie for closest millimeter proximity to the center [0,0].",
        "scoringRules": ["closest_single", "player_best_avg", "all_pucks_avg", "all_pucks_total"]
    },
    "koth": {
        "name": "King of the Hill (KOTH)",
        "description": "Territory control. A circular zone of radius 75 units continuously accrues points for the team with dominant presence.",
        "zoneRadius": 75
    },
    "most_hits": {
        "name": "Most Hits Time Attack",
        "description": "Combatants have 90 seconds to trigger maximum peg deflections and puck collisions.",
        "matchDurationSec": 90
    },
    "24h_colosseum": {
        "name": "24-Hour Colosseum (Persistent Epoch)",
        "description": "Persistent asynchronous multiplayer arena where pucks remain settled on the ice for 24 hours.",
        "roomCode": "GLOBAL-24H-COLOSSEUM",
        "epochDurationHours": 24
    },
    "24h_barrage": {
        "name": "24-Hour Barrage",
        "description": "Mass synchronized salvo arena where combatants commit shots for simultaneous release.",
        "roomCode": "GLOBAL-24H-BARRAGE"
    }
}

SCORING_RULES = {
    "closest_single": {
        "name": "CLOSEST PUCK",
        "description": "The combatant or team with the single nearest puck to the center [0,0] claims victory."
    },
    "player_best_avg": {
        "name": "PLAYER BEST AVG",
        "description": "Scores are determined by averaging each player's top-performing puck."
    },
    "all_pucks_avg": {
        "name": "ALL PUCKS AVG",
        "description": "Team score is the arithmetic mean distance of all placed pucks."
    },
    "all_pucks_total": {
        "name": "ALL PUCKS TOTAL",
        "description": "Cumulative aggregate distance of all placed pucks. Lowest total wins."
    }
}

NAMES_CRIMSON = [
    "Nova", "Dash", "Striker", "Ace", "Pixel",
    "Turbo", "Cosmo", "Radar", "Echo", "Comet"
]

NAMES_COBALT = [
    "Frost", "Vector", "Glitch", "Aero", "Zephyr",
    "Zero", "Blizzard", "Titan", "Pulse", "Vortex",
    "Specter", "Byte", "Drifter", "Storm", "Neon"
]

FFA_PALETTES = [
    "#ff204e", "#00d2ff", "#ffb703", "#06d6a0", "#b5179e",
    "#4cc9f0", "#f72585", "#7209b7", "#3a0ca3", "#4361ee",
    "#e63946", "#f1faee", "#a8dadc", "#457b9d", "#1d3557"
]

# -------------------------------------------------------------
# 3. PUCKS DATA PROCESSING
# -------------------------------------------------------------
processed_pucks = []
for p in raw_pucks:
    x = float(p.get("x", 0.0))
    y = float(p.get("y", 0.0))
    dist = math.hypot(x, y)
    dist_mm = round(dist * 0.5, 2)
    angle_rad = math.atan2(y, x)
    angle_deg = round(math.degrees(angle_rad), 2)
    
    # Determine arena zone
    if dist < WORLD_CONSTANTS["R_SINGULARITY"]:
        zone = "Singularity Core"
    elif dist < WORLD_CONSTANTS["R_CORE"]:
        zone = "Core Vault"
    elif dist < 140:
        zone = "Inner Orbit (<140)"
    elif dist < 280:
        zone = "Mid Orbit (140-280)"
    elif dist <= WORLD_CONSTANTS["R_ARENA"]:
        zone = "Outer Arena (280-890)"
    else:
        zone = "Perimeter Zone (>890)"

    processed_pucks.append({
        "id": p.get("id"),
        "playerId": p.get("playerId"),
        "playerName": p.get("playerName", f"Combatant-{p.get('playerId')}"),
        "team": p.get("team", "solo"),
        "x": round(x, 2),
        "y": round(y, 2),
        "distance": round(dist, 2),
        "distanceMm": dist_mm,
        "polarAngleDeg": angle_deg,
        "zone": zone,
        "ageTicks": p.get("age", 0),
        "settled": p.get("settled", True),
        "settleTimer": p.get("settleTimer", 0),
        "isKnockedOut": p.get("isKnockedOut", False),
        "isRetired": p.get("isRetired", False),
        "lastBumperId": p.get("lastBumperId"),
        "minDistance": round(float(p.get("minDistance", dist)), 2),
        "minDistanceMm": round(float(p.get("minDistance", dist)) * 0.5, 2),
        "gridKey": p.get("_gridKey", "unknown"),
        "hasEnteredArena": p.get("hasEnteredArena", True)
    })

# Sort by proximity to center (closest first)
processed_pucks.sort(key=lambda item: item["distance"])
for rank, item in enumerate(processed_pucks, start=1):
    item["rank"] = rank

distances = [p["distance"] for p in processed_pucks]
distances_mm = [p["distanceMm"] for p in processed_pucks]

stats_summary = {
    "totalPucks": len(processed_pucks),
    "uniquePlayers": len(set(p["playerId"] for p in processed_pucks)),
    "uniqueTeams": len(set(p["team"] for p in processed_pucks)),
    "minDistanceUnits": min(distances) if distances else 0,
    "minDistanceMm": min(distances_mm) if distances_mm else 0,
    "maxDistanceUnits": max(distances) if distances else 0,
    "maxDistanceMm": max(distances_mm) if distances_mm else 0,
    "meanDistanceUnits": round(statistics.mean(distances), 2) if distances else 0,
    "meanDistanceMm": round(statistics.mean(distances_mm), 2) if distances_mm else 0,
    "medianDistanceUnits": round(statistics.median(distances), 2) if distances else 0,
    "medianDistanceMm": round(statistics.median(distances_mm), 2) if distances_mm else 0,
    "stdDevUnits": round(statistics.stdev(distances), 2) if len(distances) > 1 else 0,
    "closestCombatant": processed_pucks[0]["playerName"] if processed_pucks else "N/A",
    "closestTeam": processed_pucks[0]["team"] if processed_pucks else "N/A"
}

# -------------------------------------------------------------
# 4. EXPORT CSV & UNIFIED JSON
# -------------------------------------------------------------
csv_path = os.path.join(DATA_DIR, "colosseum_pucks.csv")
with open(csv_path, "w", encoding="utf-8") as f:
    headers = [
        "rank", "id", "playerId", "playerName", "team", "x", "y",
        "distance", "distanceMm", "polarAngleDeg", "zone", "ageTicks",
        "settled", "settleTimer", "isKnockedOut", "isRetired",
        "lastBumperId", "minDistance", "minDistanceMm", "gridKey", "hasEnteredArena"
    ]
    f.write(",".join(headers) + "\n")
    for p in processed_pucks:
        row = [str(p[h]) for h in headers]
        f.write(",".join(row) + "\n")
print(f"Exported CSV to: {csv_path}")

full_db = {
    "game": "Core Striker (Spinning Wheel Game)",
    "version": "2.4.0",
    "generatedAt": datetime.now().isoformat(),
    "worldConstants": WORLD_CONSTANTS,
    "mapSizes": MAP_SIZES,
    "mapLayouts": MAP_LAYOUTS,
    "gameModes": GAME_MODES,
    "scoringRules": SCORING_RULES,
    "combatantRosters": {
        "namesCrimson": NAMES_CRIMSON,
        "namesCobalt": NAMES_COBALT,
        "ffaPalettes": FFA_PALETTES
    },
    "colosseumEpoch": {
        "epochStartTime": epoch_start_time,
        "epochStartDate": epoch_dt.isoformat(),
        "summary": stats_summary,
        "pucks": processed_pucks
    }
}

json_path = os.path.join(DATA_DIR, "game_data_full.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(full_db, f, indent=2)
print(f"Exported unified JSON database to: {json_path}")

# -------------------------------------------------------------
# 5. GENERATE SVG ARENA MAP (Vector Graphic)
# -------------------------------------------------------------
def generate_arena_svg():
    # Viewbox centered on [0,0] from -1150 to 1150
    vb_min = -1150
    vb_size = 2300
    citadel_pegs = generate_citadel_pegs(1.0)
    
    svg = []
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb_min} {vb_min} {vb_size} {vb_size}" width="100%" height="800" style="background:#090d16; border-radius:12px; font-family:system-ui, sans-serif;">')
    
    # Definitions for gradients & glow filters
    svg.append('''<defs>
      <radialGradient id="arenaGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#1e293b" stop-opacity="0.8"/>
        <stop offset="80%" stop-color="#0f172a" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#020617" stop-opacity="1"/>
      </radialGradient>
      <filter id="coreGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="puckGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>''')
    
    # Outer arena background
    svg.append(f'<circle cx="0" cy="0" r="{WORLD_CONSTANTS["R_ARENA"]}" fill="url(#arenaGlow)" stroke="#38bdf8" stroke-width="4" stroke-opacity="0.6"/>')
    svg.append(f'<circle cx="0" cy="0" r="{WORLD_CONSTANTS["R_BOUNDARY"]}" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="12,12" stroke-opacity="0.4"/>')
    svg.append(f'<circle cx="0" cy="0" r="{WORLD_CONSTANTS["R_ORBIT"]}" fill="none" stroke="#64748b" stroke-width="1.5" stroke-dasharray="6,6" stroke-opacity="0.3"/>')
    
    # Concentric rings
    svg.append(f'<circle cx="0" cy="0" r="280" fill="none" stroke="#334155" stroke-width="1.5" stroke-dasharray="4,4"/>')
    svg.append(f'<circle cx="0" cy="0" r="140" fill="none" stroke="#475569" stroke-width="1.5" stroke-dasharray="4,4"/>')
    svg.append(f'<circle cx="0" cy="0" r="{WORLD_CONSTANTS["R_CORE"]}" fill="none" stroke="#c084fc" stroke-width="2" stroke-opacity="0.7"/>')
    svg.append(f'<circle cx="0" cy="0" r="{WORLD_CONSTANTS["R_SINGULARITY"]}" fill="#fbbf24" filter="url(#coreGlow)"/>')
    
    # Crosshairs
    svg.append(f'<line x1="-{WORLD_CONSTANTS["R_ARENA"]}" y1="0" x2="{WORLD_CONSTANTS["R_ARENA"]}" y2="0" stroke="#1e293b" stroke-width="1"/>')
    svg.append(f'<line x1="0" y1="-{WORLD_CONSTANTS["R_ARENA"]}" x2="0" y2="{WORLD_CONSTANTS["R_ARENA"]}" stroke="#1e293b" stroke-width="1"/>')
    
    # Citadel Pegs
    for peg in citadel_pegs:
        svg.append(f'<circle cx="{peg["x"]}" cy="{peg["y"]}" r="{peg["r"]}" fill="#38bdf8" stroke="#0284c7" stroke-width="2" opacity="0.85"/>')
        svg.append(f'<circle cx="{peg["x"]}" cy="{peg["y"]}" r="3" fill="#ffffff" opacity="0.9"/>')
    
    # Pucks (164 combatants)
    for p in processed_pucks:
        rank = p["rank"]
        x, y = p["x"], p["y"]
        # Palette color based on team or rank
        if rank == 1:
            color = "#facc15" # Gold for #1
        elif rank == 2:
            color = "#e2e8f0" # Silver
        elif rank == 3:
            color = "#fb923c" # Bronze
        elif "crimson" in p["team"].lower():
            color = "#ff204e"
        elif "cobalt" in p["team"].lower():
            color = "#00d2ff"
        else:
            color = FFA_PALETTES[p["playerId"] % len(FFA_PALETTES)]
            
        r_draw = WORLD_CONSTANTS["PUCK_RADIUS"]
        svg.append(f'<circle cx="{x}" cy="{y}" r="{r_draw}" fill="{color}" stroke="#ffffff" stroke-width="1" opacity="0.85">')
        svg.append(f'<title>Rank #{rank}: {p["playerName"]} ({p["team"]})\nDistance: {p["distanceMm"]} mm\nCoords: ({x}, {y})</title>')
        svg.append('</circle>')
        
    # Highlight #1 Leader with targeting crosshair
    if processed_pucks:
        p1 = processed_pucks[0]
        svg.append(f'<circle cx="{p1["x"]}" cy="{p1["y"]}" r="22" fill="none" stroke="#facc15" stroke-width="2.5" stroke-dasharray="6,4" filter="url(#coreGlow)"/>')
        svg.append(f'<text x="{p1["x"] + 28}" y="{p1["y"] + 6}" fill="#facc15" font-size="28" font-weight="bold" filter="url(#coreGlow)">#1 {p1["playerName"]} ({p1["distanceMm"]} mm)</text>')
        
    # Legend Overlay
    svg.append('''<g transform="translate(-1100, -1100)">
      <rect width="420" height="240" rx="8" fill="#0f172a" fill-opacity="0.9" stroke="#334155" stroke-width="1.5"/>
      <text x="20" y="32" fill="#f8fafc" font-size="20" font-weight="bold">CORE STRIKER: 24H COLOSSEUM</text>
      <text x="20" y="58" fill="#94a3b8" font-size="14">Epoch Active Pucks: ''' + str(len(processed_pucks)) + '''</text>
      
      <circle cx="30" cy="88" r="8.5" fill="#facc15" stroke="#fff"/>
      <text x="50" y="94" fill="#cbd5e1" font-size="14">#1 Leader (Singularity Bullseye)</text>
      
      <circle cx="30" cy="118" r="8.5" fill="#ff204e" stroke="#fff"/>
      <text x="50" y="124" fill="#cbd5e1" font-size="14">Crimson Combatants</text>
      
      <circle cx="30" cy="148" r="8.5" fill="#00d2ff" stroke="#fff"/>
      <text x="50" y="154" fill="#cbd5e1" font-size="14">Cobalt Combatants</text>
      
      <circle cx="30" cy="178" r="8.5" fill="#a855f7" stroke="#fff"/>
      <text x="50" y="184" fill="#cbd5e1" font-size="14">FFA Combatants (15 Colors)</text>
      
      <circle cx="30" cy="208" r="7" fill="#38bdf8" stroke="#0284c7" stroke-width="2"/>
      <text x="50" y="214" fill="#cbd5e1" font-size="14">Citadel Deflector Pegs (20 total)</text>
    </g>''')
    
    svg.append('</svg>')
    return "".join(svg)

arena_svg_content = generate_arena_svg()

# -------------------------------------------------------------
# 6. BUILD JUPYTER NOTEBOOK (.ipynb)
# -------------------------------------------------------------
notebook_cells = []

def add_md(text):
    notebook_cells.append({
        "cell_type": "markdown",
        "metadata": {},
        "source": [line + "\n" for line in text.strip().split("\n")]
    })

def add_code(code, outputs=None):
    notebook_cells.append({
        "cell_type": "code",
        "execution_count": len([c for c in notebook_cells if c["cell_type"] == "code"]) + 1,
        "metadata": {},
        "outputs": outputs or [],
        "source": [line + "\n" for line in code.strip().split("\n")]
    })

# CELL 1: Header Markdown
add_md("""
# 🎮 Core Striker: Complete Game Data & Analytical Notebook
### *Comprehensive Telemetry, Physics Specifications, Map Geometries & 24-Hour Colosseum Dataset*

Welcome to the authoritative data science notebook for **Core Striker (Spinning Wheel Game)**.
This notebook consolidates all mathematical constants, simulation rules, arena dimensions, map geometries, and the live 24-hour persistent epoch match dataset into an executable, interactive document.

---

### 📌 Architecture Summary
- **Simulation**: Authoritative 2D kinetic shuffleboard simulation (zero rotational spin, curling friction, elastic peg & puck ricochets).
- **Network Engine**: Fixed-step 60 Hz physics ticks with 20 Hz delta broadcasts and client-side hermite/linear reconciliation.
- **Broadphase Collision**: Dynamic Spatial Hash Grid (cell size: 36 units) achieving $O(N)$ pair resolution across 1,000+ combatants.
- **Active Arena**: `GLOBAL-24H-COLOSSEUM` persistent epoch containing 164 live combatant pucks.
""")

# CELL 2: Code Imports & Setup
code_setup = """
import json
import math
import statistics
import os
from datetime import datetime
from IPython.display import display, HTML, SVG

print("🚀 Core Striker Analytical Suite Initialized.")
"""
add_code(code_setup, outputs=[
    {
        "name": "stdout",
        "output_type": "stream",
        "text": ["🚀 Core Striker Analytical Suite Initialized.\n"]
    }
])

# CELL 3: World & Physical Constants Markdown
add_md("""
## ⚙️ Section 1: Physical Constants & Simulation Dynamics

The physics engine is governed by fixed deterministic constants defined in `server/physics.js`.
Movement incorporates pure sliding friction (curling glide) with zero rotational angular momentum.
""")

# CELL 4: World Constants Code
code_world = f"""
WORLD_CONSTANTS = {json.dumps(WORLD_CONSTANTS, indent=2)}

# Display formatted table of World Constants
html_rows = "".join([f"<tr><td style='padding:6px 12px; font-weight:bold; color:#38bdf8;'>{k}</td><td style='padding:6px 12px; text-align:right;'>{v}</td></tr>" for k, v in WORLD_CONSTANTS.items()])
display(HTML(f'''
<div style="background:#0f172a; padding:16px; border-radius:8px; border:1px solid #334155; max-width:650px;">
  <h3 style="color:#f8fafc; margin-top:0;">🌌 Physics Engine Constants</h3>
  <table style="width:100%; border-collapse:collapse; color:#cbd5e1;">
    <thead>
      <tr style="border-bottom:2px solid #475569; text-align:left;">
        <th style="padding:8px 12px; color:#94a3b8;">Constant Key</th>
        <th style="padding:8px 12px; text-align:right; color:#94a3b8;">Value</th>
      </tr>
    </thead>
    <tbody>
      {html_rows}
    </tbody>
  </table>
</div>
'''))
"""
add_code(code_world, outputs=[
    {
        "data": {
            "text/html": [
                '<div style="background:#0f172a; padding:16px; border-radius:8px; border:1px solid #334155; max-width:650px;">\n'
                '  <h3 style="color:#f8fafc; margin-top:0;">🌌 Physics Engine Constants</h3>\n'
                '  <table style="width:100%; border-collapse:collapse; color:#cbd5e1;">\n'
                '    <thead>\n'
                '      <tr style="border-bottom:2px solid #475569; text-align:left;">\n'
                '        <th style="padding:8px 12px; color:#94a3b8;">Constant Key</th>\n'
                '        <th style="padding:8px 12px; text-align:right; color:#94a3b8;">Value</th>\n'
                '      </tr>\n'
                '    </thead>\n'
                '    <tbody>\n'
                + "".join([f"<tr><td style='padding:6px 12px; font-weight:bold; color:#38bdf8;'>{k}</td><td style='padding:6px 12px; text-align:right;'>{v}</td></tr>" for k, v in WORLD_CONSTANTS.items()]) +
                '    </tbody>\n'
                '  </table>\n'
                '</div>\n'
            ],
            "text/plain": ["<IPython.core.display.HTML object>"]
        },
        "metadata": {},
        "output_type": "display_data"
    }
])

# CELL 5: Map Sizes Markdown
add_md("""
## 🗺️ Section 2: Arena Map Sizes & Scale Configurations

The game features 4 dynamic viewport and arena scaling profiles.
All radial thresholds (`R_ARENA`, `R_BOUNDARY`, `R_ORBIT`) and camera zoom ratios dynamically scale based on the active preset.
""")

# CELL 6: Map Sizes Code
code_sizes = f"""
MAP_SIZES = {json.dumps(MAP_SIZES, indent=2)}

html_sizes = ""
for size_key, conf in MAP_SIZES.items():
    html_sizes += f'''
    <tr style="border-bottom:1px solid #1e293b;">
      <td style="padding:8px 12px; font-weight:bold; color:#f8fafc;">{conf['label']}</td>
      <td style="padding:8px 12px; text-align:center;">{conf['scale']}</td>
      <td style="padding:8px 12px; text-align:center; color:#38bdf8;">{conf['rArena']} px</td>
      <td style="padding:8px 12px; text-align:center; color:#ef4444;">{conf['rBoundary']} px</td>
      <td style="padding:8px 12px; text-align:center; color:#94a3b8;">{conf['rOrbit']} px</td>
      <td style="padding:8px 12px; text-align:center;">{conf['defaultMeZoom']}x / {conf['defaultArenaZoom']}x</td>
    </tr>
    '''

display(HTML(f'''
<div style="background:#0f172a; padding:16px; border-radius:8px; border:1px solid #334155;">
  <h3 style="color:#f8fafc; margin-top:0;">📐 Arena Scale Presets</h3>
  <table style="width:100%; border-collapse:collapse; color:#cbd5e1;">
    <thead>
      <tr style="border-bottom:2px solid #475569; text-align:center;">
        <th style="padding:8px 12px; text-align:left; color:#94a3b8;">Preset</th>
        <th style="padding:8px 12px; color:#94a3b8;">Scale Factor</th>
        <th style="padding:8px 12px; color:#94a3b8;">Playable Arena</th>
        <th style="padding:8px 12px; color:#94a3b8;">Reset Boundary</th>
        <th style="padding:8px 12px; color:#94a3b8;">Launcher Orbit</th>
        <th style="padding:8px 12px; color:#94a3b8;">Camera Zooms (Me / Arena)</th>
      </tr>
    </thead>
    <tbody>
      {html_sizes}
    </tbody>
  </table>
</div>
'''))
"""
add_code(code_sizes, outputs=[
    {
        "data": {
            "text/html": [
                '<div style="background:#0f172a; padding:16px; border-radius:8px; border:1px solid #334155;">\n'
                '  <h3 style="color:#f8fafc; margin-top:0;">📐 Arena Scale Presets</h3>\n'
                '  <table style="width:100%; border-collapse:collapse; color:#cbd5e1;">\n'
                '    <thead>\n'
                '      <tr style="border-bottom:2px solid #475569; text-align:center;">\n'
                '        <th style="padding:8px 12px; text-align:left; color:#94a3b8;">Preset</th>\n'
                '        <th style="padding:8px 12px; color:#94a3b8;">Scale Factor</th>\n'
                '        <th style="padding:8px 12px; color:#94a3b8;">Playable Arena</th>\n'
                '        <th style="padding:8px 12px; color:#94a3b8;">Reset Boundary</th>\n'
                '        <th style="padding:8px 12px; color:#94a3b8;">Launcher Orbit</th>\n'
                '        <th style="padding:8px 12px; color:#94a3b8;">Camera Zooms (Me / Arena)</th>\n'
                '      </tr>\n'
                '    </thead>\n'
                '    <tbody>\n'
                + "".join([f'<tr style="border-bottom:1px solid #1e293b;"><td style="padding:8px 12px; font-weight:bold; color:#f8fafc;">{conf["label"]}</td><td style="padding:8px 12px; text-align:center;">{conf["scale"]}</td><td style="padding:8px 12px; text-align:center; color:#38bdf8;">{conf["rArena"]} px</td><td style="padding:8px 12px; text-align:center; color:#ef4444;">{conf["rBoundary"]} px</td><td style="padding:8px 12px; text-align:center; color:#94a3b8;">{conf["rOrbit"]} px</td><td style="padding:8px 12px; text-align:center;">{conf["defaultMeZoom"]}x / {conf["defaultArenaZoom"]}x</td></tr>' for conf in MAP_SIZES.values()]) +
                '    </tbody>\n'
                '  </table>\n'
                '</div>\n'
            ],
            "text/plain": ["<IPython.core.display.HTML object>"]
        },
        "metadata": {},
        "output_type": "display_data"
    }
])

# CELL 7: Map Layouts Markdown
add_md("""
## 🛡️ Section 3: Procedural Map Layouts & Obstacle Geometries

The physics engine features 4 procedural obstacle layouts:
1. **Citadel**: Double concentric orbital rings (8 inner pegs at $r=140$, 12 mid pegs at $r=280$).
2. **Pachinko**: Hexagonal deflection lattice between radii $70$ and $360$.
3. **Crossfire**: 4 corner super-bumpers ($e = 1.15$) with orthogonal corridor guides.
4. **Bullseye Funnel**: Segmented perimeter rings with 4 cardinal directional gates.
""")

# CELL 8: Map Layouts Code
code_layouts = f"""
MAP_LAYOUTS = {json.dumps(MAP_LAYOUTS, indent=2)}

print(f"Citadel Peg Count: {{len(MAP_LAYOUTS['citadel']['pegs'])}}")
print(f"Crossfire Obstacle Count: {{len(MAP_LAYOUTS['crossfire']['pegs'])}}")

citadel_pegs = MAP_LAYOUTS['citadel']['pegs']
inner_pegs = [p for p in citadel_pegs if p['ring'] == 'inner']
mid_pegs = [p for p in citadel_pegs if p['ring'] == 'mid']

print(f"  - Inner Ring (r=140): {{len(inner_pegs)}} pegs")
print(f"  - Mid Ring (r=280): {{len(mid_pegs)}} pegs")
"""
add_code(code_layouts, outputs=[
    {
        "name": "stdout",
        "output_type": "stream",
        "text": [
            "Citadel Peg Count: 20\n",
            "Crossfire Obstacle Count: 28\n",
            "  - Inner Ring (r=140): 8 pegs\n",
            "  - Mid Ring (r=280): 12 pegs\n"
        ]
    }
])

# CELL 9: Game Modes Markdown
add_md("""
## 🏆 Section 4: Game Modes, Scoring Rules & Team Rosters

Core Striker supports both synchronous multiplayer rounds and persistent 24-hour endurance arenas.
""")

# CELL 10: Game Modes Code
code_modes = f"""
GAME_MODES = {json.dumps(GAME_MODES, indent=2)}
SCORING_RULES = {json.dumps(SCORING_RULES, indent=2)}
NAMES_CRIMSON = {json.dumps(NAMES_CRIMSON)}
NAMES_COBALT = {json.dumps(NAMES_COBALT)}
FFA_PALETTES = {json.dumps(FFA_PALETTES)}

html_modes = "".join([f"<li><strong style='color:#38bdf8;'>{v['name']}:</strong> <span style='color:#cbd5e1;'>{v['description']}</span></li>" for v in GAME_MODES.values()])
html_rules = "".join([f"<li><strong style='color:#facc15;'>{v['name']}:</strong> <span style='color:#cbd5e1;'>{v['description']}</span></li>" for v in SCORING_RULES.values()])
swatches = "".join([f"<span style='display:inline-block; width:22px; height:22px; background:{c}; border-radius:50%; margin-right:6px;' title='{c}'></span>" for c in FFA_PALETTES])

display(HTML(f'''
<div style="background:#0f172a; padding:16px; border-radius:8px; border:1px solid #334155;">
  <h3 style="color:#f8fafc; margin-top:0;">🎮 Game Modes & Scoring Systems</h3>
  <ul style="line-height:1.8;">{html_modes}</ul>
  <h4 style="color:#f8fafc;">⚖️ Scoring Rules:</h4>
  <ul style="line-height:1.8;">{html_rules}</ul>
  <h4 style="color:#f8fafc;">🎨 15-Color Free-For-All Palette Swatches:</h4>
  <div>{swatches}</div>
</div>
'''))
"""
add_code(code_modes, outputs=[
    {
        "data": {
            "text/html": [
                '<div style="background:#0f172a; padding:16px; border-radius:8px; border:1px solid #334155;">\n'
                '  <h3 style="color:#f8fafc; margin-top:0;">🎮 Game Modes & Scoring Systems</h3>\n'
                '  <ul style="line-height:1.8;">'
                + "".join([f"<li><strong style='color:#38bdf8;'>{v['name']}:</strong> <span style='color:#cbd5e1;'>{v['description']}</span></li>" for v in GAME_MODES.values()]) +
                '</ul>\n'
                '  <h4 style="color:#f8fafc;">⚖️ Scoring Rules:</h4>\n'
                '  <ul style="line-height:1.8;">'
                + "".join([f"<li><strong style='color:#facc15;'>{v['name']}:</strong> <span style='color:#cbd5e1;'>{v['description']}</span></li>" for v in SCORING_RULES.values()]) +
                '</ul>\n'
                '  <h4 style="color:#f8fafc;">🎨 15-Color Free-For-All Palette Swatches:</h4>\n'
                '  <div>'
                + "".join([f"<span style='display:inline-block; width:22px; height:22px; background:{c}; border-radius:50%; margin-right:6px;' title='{c}'></span>" for c in FFA_PALETTES]) +
                '</div>\n'
                '</div>\n'
            ],
            "text/plain": ["<IPython.core.display.HTML object>"]
        },
        "metadata": {},
        "output_type": "display_data"
    }
])

# CELL 11: Colosseum Dataset Analysis Markdown
add_md("""
## 📊 Section 5: Live 24-Hour Colosseum Dataset Analysis (`colosseum_state.json`)

The active room `GLOBAL-24H-COLOSSEUM` records every puck that has entered and settled in the arena over the 24-hour epoch.
Below, we inspect global summary statistics, proximity metrics, and distribution percentiles across all 164 combatants.
""")

# CELL 12: Ingestion & Stats Code
code_puck_stats = f"""
# Load and transform pucks dataset
pucks = {json.dumps(processed_pucks, indent=2)}
summary = {json.dumps(stats_summary, indent=2)}

print(f"Total Settled Combatant Pucks: {{len(pucks)}}")
print(f"Unique Combatant Players: {{summary['uniquePlayers']}}")
print(f"Closest Puck: {{summary['closestCombatant']}} at {{summary['minDistanceMm']}} mm ({{summary['minDistanceUnits']}} units)")
print(f"Mean Distance to Singularity: {{summary['meanDistanceMm']}} mm ({{summary['meanDistanceUnits']}} units)")
print(f"Median Distance: {{summary['medianDistanceMm']}} mm ({{summary['medianDistanceUnits']}} units)")
print(f"Standard Deviation: {{summary['stdDevUnits']}} units")

display(HTML(f'''
<div style="display:flex; gap:16px; flex-wrap:wrap; margin:16px 0;">
  <div style="flex:1; min-width:180px; background:#1e293b; padding:16px; border-radius:8px; border-top:4px solid #38bdf8;">
    <div style="color:#94a3b8; font-size:12px; text-transform:uppercase;">Total Pucks</div>
    <div style="color:#f8fafc; font-size:28px; font-weight:bold; margin-top:4px;">{{len(pucks)}}</div>
  </div>
  <div style="flex:1; min-width:180px; background:#1e293b; padding:16px; border-radius:8px; border-top:4px solid #facc15;">
    <div style="color:#94a3b8; font-size:12px; text-transform:uppercase;">Closest To Center</div>
    <div style="color:#f8fafc; font-size:28px; font-weight:bold; margin-top:4px;">{{summary['minDistanceMm']}} mm</div>
    <div style="color:#facc15; font-size:12px;">{{summary['closestCombatant']}}</div>
  </div>
  <div style="flex:1; min-width:180px; background:#1e293b; padding:16px; border-radius:8px; border-top:4px solid #4ade80;">
    <div style="color:#94a3b8; font-size:12px; text-transform:uppercase;">Mean Distance</div>
    <div style="color:#f8fafc; font-size:28px; font-weight:bold; margin-top:4px;">{{summary['meanDistanceMm']}} mm</div>
  </div>
  <div style="flex:1; min-width:180px; background:#1e293b; padding:16px; border-radius:8px; border-top:4px solid #c084fc;">
    <div style="color:#94a3b8; font-size:12px; text-transform:uppercase;">Median Distance</div>
    <div style="color:#f8fafc; font-size:28px; font-weight:bold; margin-top:4px;">{{summary['medianDistanceMm']}} mm</div>
  </div>
</div>
'''))
"""
add_code(code_puck_stats, outputs=[
    {
        "name": "stdout",
        "output_type": "stream",
        "text": [
            f"Total Settled Combatant Pucks: {len(processed_pucks)}\n",
            f"Unique Combatant Players: {stats_summary['uniquePlayers']}\n",
            f"Closest Puck: {stats_summary['closestCombatant']} at {stats_summary['minDistanceMm']} mm ({stats_summary['minDistanceUnits']} units)\n",
            f"Mean Distance to Singularity: {stats_summary['meanDistanceMm']} mm ({stats_summary['meanDistanceUnits']} units)\n",
            f"Median Distance: {stats_summary['medianDistanceMm']} mm ({stats_summary['medianDistanceUnits']} units)\n",
            f"Standard Deviation: {stats_summary['stdDevUnits']} units\n"
        ]
    },
    {
        "data": {
            "text/html": [
                f'''<div style="display:flex; gap:16px; flex-wrap:wrap; margin:16px 0;">
  <div style="flex:1; min-width:180px; background:#1e293b; padding:16px; border-radius:8px; border-top:4px solid #38bdf8;">
    <div style="color:#94a3b8; font-size:12px; text-transform:uppercase;">Total Pucks</div>
    <div style="color:#f8fafc; font-size:28px; font-weight:bold; margin-top:4px;">{len(processed_pucks)}</div>
  </div>
  <div style="flex:1; min-width:180px; background:#1e293b; padding:16px; border-radius:8px; border-top:4px solid #facc15;">
    <div style="color:#94a3b8; font-size:12px; text-transform:uppercase;">Closest To Center</div>
    <div style="color:#f8fafc; font-size:28px; font-weight:bold; margin-top:4px;">{stats_summary['minDistanceMm']} mm</div>
    <div style="color:#facc15; font-size:12px;">{stats_summary['closestCombatant']}</div>
  </div>
  <div style="flex:1; min-width:180px; background:#1e293b; padding:16px; border-radius:8px; border-top:4px solid #4ade80;">
    <div style="color:#94a3b8; font-size:12px; text-transform:uppercase;">Mean Distance</div>
    <div style="color:#f8fafc; font-size:28px; font-weight:bold; margin-top:4px;">{stats_summary['meanDistanceMm']} mm</div>
  </div>
  <div style="flex:1; min-width:180px; background:#1e293b; padding:16px; border-radius:8px; border-top:4px solid #c084fc;">
    <div style="color:#94a3b8; font-size:12px; text-transform:uppercase;">Median Distance</div>
    <div style="color:#f8fafc; font-size:28px; font-weight:bold; margin-top:4px;">{stats_summary['medianDistanceMm']} mm</div>
  </div>
</div>'''
            ],
            "text/plain": ["<IPython.core.display.HTML object>"]
        },
        "metadata": {},
        "output_type": "display_data"
    }
])

# CELL 13: Leaderboard Markdown
add_md("""
## 🥇 Section 6: Colosseum Proximity Standings & Top Combatants

Here is the official leaderboard ranking the top combatants currently holding position in the Colosseum.
Rank 1 `Bot-0015` penetrated straight through the Citadel deflector rings into the Singularity Core ($d = 7.91$ mm), holding the ultimate bullseye position!
""")

# CELL 14: Leaderboard Table Code
top_15 = processed_pucks[:15]
top_15_rows = ""
for p in top_15:
    badge = "🥇" if p["rank"] == 1 else ("🥈" if p["rank"] == 2 else ("🥉" if p["rank"] == 3 else f"#{p['rank']}"))
    top_15_rows += f"""
    <tr style="border-bottom:1px solid #1e293b;">
      <td style="padding:6px 12px; font-weight:bold; color:#facc15;">{badge}</td>
      <td style="padding:6px 12px; font-weight:bold; color:#f8fafc;">{p['playerName']}</td>
      <td style="padding:6px 12px; color:#94a3b8;">{p['team']}</td>
      <td style="padding:6px 12px; text-align:right; font-weight:bold; color:#38bdf8;">{p['distanceMm']} mm</td>
      <td style="padding:6px 12px; text-align:right;">({p['x']}, {p['y']})</td>
      <td style="padding:6px 12px; text-align:center; color:#c084fc;">{p['zone']}</td>
      <td style="padding:6px 12px; text-align:right; color:#64748b;">{p['gridKey']}</td>
      <td style="padding:6px 12px; text-align:right; color:#4ade80;">{p['ageTicks']} ticks</td>
    </tr>
    """

code_leaderboard = f"""
# Render Top 15 Proximity Leaderboard
display(HTML(f'''
<div style="background:#0f172a; padding:16px; border-radius:8px; border:1px solid #334155; overflow-x:auto;">
  <h3 style="color:#f8fafc; margin-top:0;">🏆 Top 15 Proximity Leaderboard (Closest to Singularity Core)</h3>
  <table style="width:100%; border-collapse:collapse; color:#cbd5e1; font-size:13px;">
    <thead>
      <tr style="border-bottom:2px solid #475569; text-align:left;">
        <th style="padding:8px 12px; color:#94a3b8;">Rank</th>
        <th style="padding:8px 12px; color:#94a3b8;">Player Name</th>
        <th style="padding:8px 12px; color:#94a3b8;">Team</th>
        <th style="padding:8px 12px; text-align:right; color:#94a3b8;">Distance</th>
        <th style="padding:8px 12px; text-align:right; color:#94a3b8;">Cartesian (X, Y)</th>
        <th style="padding:8px 12px; text-align:center; color:#94a3b8;">Zone</th>
        <th style="padding:8px 12px; text-align:right; color:#94a3b8;">Spatial Cell</th>
        <th style="padding:8px 12px; text-align:right; color:#94a3b8;">Age</th>
      </tr>
    </thead>
    <tbody>
      {top_15_rows}
    </tbody>
  </table>
</div>
'''))
"""
add_code(code_leaderboard, outputs=[
    {
        "data": {
            "text/html": [
                f'''<div style="background:#0f172a; padding:16px; border-radius:8px; border:1px solid #334155; overflow-x:auto;">
  <h3 style="color:#f8fafc; margin-top:0;">🏆 Top 15 Proximity Leaderboard (Closest to Singularity Core)</h3>
  <table style="width:100%; border-collapse:collapse; color:#cbd5e1; font-size:13px;">
    <thead>
      <tr style="border-bottom:2px solid #475569; text-align:left;">
        <th style="padding:8px 12px; color:#94a3b8;">Rank</th>
        <th style="padding:8px 12px; color:#94a3b8;">Player Name</th>
        <th style="padding:8px 12px; color:#94a3b8;">Team</th>
        <th style="padding:8px 12px; text-align:right; color:#94a3b8;">Distance</th>
        <th style="padding:8px 12px; text-align:right; color:#94a3b8;">Cartesian (X, Y)</th>
        <th style="padding:8px 12px; text-align:center; color:#94a3b8;">Zone</th>
        <th style="padding:8px 12px; text-align:right; color:#94a3b8;">Spatial Cell</th>
        <th style="padding:8px 12px; text-align:right; color:#94a3b8;">Age</th>
      </tr>
    </thead>
    <tbody>
      {top_15_rows}
    </tbody>
  </table>
</div>'''
            ],
            "text/plain": ["<IPython.core.display.HTML object>"]
        },
        "metadata": {},
        "output_type": "display_data"
    }
])

# CELL 15: Zonal Breakdown Markdown
add_md("""
## 🎯 Section 7: Zonal Dispersion & Spatial Grid Analysis

How are the pucks distributed across concentric rings within the arena?
""")

# CELL 16: Zonal Breakdown Code
zone_counts = {}
for p in processed_pucks:
    z = p["zone"]
    zone_counts[z] = zone_counts.get(z, 0) + 1

zone_rows = ""
for z, count in zone_counts.items():
    pct = round((count / len(processed_pucks)) * 100, 1)
    bar_width = int(pct * 2.5)
    zone_rows += f"""
    <tr style="border-bottom:1px solid #1e293b;">
      <td style="padding:8px 12px; font-weight:bold; color:#f8fafc;">{z}</td>
      <td style="padding:8px 12px; text-align:center; font-weight:bold; color:#38bdf8;">{count}</td>
      <td style="padding:8px 12px; text-align:center; color:#94a3b8;">{pct}%</td>
      <td style="padding:8px 12px;">
        <div style="background:#334155; border-radius:4px; height:12px; width:250px;">
          <div style="background:#38bdf8; height:12px; border-radius:4px; width:{bar_width}px;"></div>
        </div>
      </td>
    </tr>
    """

code_zones = f"""
# Compute zonal dispersion
zone_counts = {json.dumps(zone_counts, indent=2)}

display(HTML(f'''
<div style="background:#0f172a; padding:16px; border-radius:8px; border:1px solid #334155; max-width:700px;">
  <h3 style="color:#f8fafc; margin-top:0;">🌐 Zonal Distribution Breakdown</h3>
  <table style="width:100%; border-collapse:collapse; color:#cbd5e1;">
    <thead>
      <tr style="border-bottom:2px solid #475569; text-align:left;">
        <th style="padding:8px 12px; color:#94a3b8;">Arena Zone</th>
        <th style="padding:8px 12px; text-align:center; color:#94a3b8;">Puck Count</th>
        <th style="padding:8px 12px; text-align:center; color:#94a3b8;">Share</th>
        <th style="padding:8px 12px; color:#94a3b8;">Visual Proportion</th>
      </tr>
    </thead>
    <tbody>
      {zone_rows}
    </tbody>
  </table>
</div>
'''))
"""
add_code(code_zones, outputs=[
    {
        "data": {
            "text/html": [
                f'''<div style="background:#0f172a; padding:16px; border-radius:8px; border:1px solid #334155; max-width:700px;">
  <h3 style="color:#f8fafc; margin-top:0;">🌐 Zonal Distribution Breakdown</h3>
  <table style="width:100%; border-collapse:collapse; color:#cbd5e1;">
    <thead>
      <tr style="border-bottom:2px solid #475569; text-align:left;">
        <th style="padding:8px 12px; color:#94a3b8;">Arena Zone</th>
        <th style="padding:8px 12px; text-align:center; color:#94a3b8;">Puck Count</th>
        <th style="padding:8px 12px; text-align:center; color:#94a3b8;">Share</th>
        <th style="padding:8px 12px; color:#94a3b8;">Visual Proportion</th>
      </tr>
    </thead>
    <tbody>
      {zone_rows}
    </tbody>
  </table>
</div>'''
            ],
            "text/plain": ["<IPython.core.display.HTML object>"]
        },
        "metadata": {},
        "output_type": "display_data"
    }
])

# CELL 17: Interactive SVG Map Markdown
add_md("""
## 🌌 Section 8: Interactive 2D Top-Down Colosseum Arena Map

Below is a vector visualization rendering:
- Concentric boundaries: Singularity Core ($r=15$), Core Vault ($r=48$), Inner Peg Ring ($r=140$), Mid Peg Ring ($r=280$), Playable Arena Floor ($r=890$), Out-of-Bounds Boundary ($r=950$), Launcher Orbit ($r=1080$).
- All 20 Citadel deflector pegs.
- All 164 live combatant pucks plotted at their exact Cartesian coordinates.
- **#1 Leader `Bot-0015`** highlighted with a pulsing golden targeting reticle and distance callout!
""")

# CELL 18: SVG Display Code
code_svg = """
# Render top-down arena map
from tools.generate_notebook import generate_arena_svg
svg_content = generate_arena_svg()
display(SVG(svg_content))
"""
add_code(code_svg, outputs=[
    {
        "data": {
            "image/svg+xml": [arena_svg_content],
            "text/plain": ["<IPython.core.display.SVG object>"]
        },
        "metadata": {},
        "output_type": "display_data"
    }
])

# CELL 19: Export Utilities Markdown
add_md("""
## 💾 Section 9: Data Export Utilities

The dataset has been exported into:
1. `data/colosseum_pucks.csv` - Tabular comma-separated values ready for Pandas, Excel, or SQL databases.
2. `data/game_data_full.json` - Complete hierarchical schema containing all constants, maps, rules, and pucks.
""")

# CELL 20: Export Verification Code
clean_csv_path = csv_path.replace("\\", "/")
clean_json_path = json_path.replace("\\", "/")
code_export = f"""
import os
csv_stat = os.stat("{clean_csv_path}")
json_stat = os.stat("{clean_json_path}")

print(f"✅ CSV Export Verified: {{csv_stat.st_size}} bytes -> data/colosseum_pucks.csv")
print(f"✅ JSON Database Verified: {{json_stat.st_size}} bytes -> data/game_data_full.json")
"""
add_code(code_export, outputs=[
    {
        "name": "stdout",
        "output_type": "stream",
        "text": [
            f"✅ CSV Export Verified: {os.stat(csv_path).st_size} bytes -> data/colosseum_pucks.csv\\n",
            f"✅ JSON Database Verified: {os.stat(json_path).st_size} bytes -> data/game_data_full.json\\n"
        ]
    }
])

# -------------------------------------------------------------
# 7. WRITE Game_Data_Notebook.ipynb
# -------------------------------------------------------------
notebook_json = {
    "cells": notebook_cells,
    "metadata": {
        "language_info": {
            "name": "python",
            "version": "3.10.0"
        },
        "orig_nbformat": 4
    },
    "nbformat": 4,
    "nbformat_minor": 2
}

notebook_path = os.path.join(BASE_DIR, "Game_Data_Notebook.ipynb")
with open(notebook_path, "w", encoding="utf-8") as f:
    json.dump(notebook_json, f, indent=1)
print(f"Successfully generated Jupyter Notebook at: {notebook_path}")

# -------------------------------------------------------------
# 8. WRITE GAME_NOTEBOOK.md (Markdown Reference Notebook)
# -------------------------------------------------------------
md_notebook_path = os.path.join(BASE_DIR, "GAME_NOTEBOOK.md")

with open(md_notebook_path, "w", encoding="utf-8") as f:
    f.write(f"""# 🎮 Core Striker: Complete Game Data & Analytical Notebook
> **Authoritative Game Data Handbook & Dataset Reference for *Core Striker (Spinning Wheel Game)***  
> *Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*

---

## 📌 1. Game Overview & System Architecture

**Core Striker** is an authoritative 2D kinetic shuffleboard/curling simulation set in a radial arena. Combatants launch pucks from an orbital track ($R = 1080$), ricocheting off procedural deflector pegs and competing combatants to achieve closest proximity to the central Singularity Core ($R = 15$).

### Key Architectural Specifications:
| Specification | Value | Description |
| :--- | :--- | :--- |
| **Physics Step Rate** | `60 Hz` (16.666 ms) | Fixed-step deterministic kinetic integration |
| **Network Broadcast** | `20 Hz` (50 ms) | Delta snapshot broadcast over WebSockets |
| **Rotational Spin** | `0` (Zero Rotational Spin) | Pure 2D translational momentum |
| **Broadphase Collision** | Spatial Hash Grid | Grid cell size `36 units`, $O(N)$ pair resolution |
| **Active Epoch Room** | `GLOBAL-24H-COLOSSEUM` | 24-hour persistent endurance arena |
| **Total Settled Pucks** | `{len(processed_pucks)}` | Live combatants currently on the ice |

---

## ⚙️ 2. World Dimensions & Physical Constants

| Constant | Value | Units | Description |
| :--- | :--- | :--- | :--- |
| `R_ORBIT` | `1080` | px / units | Outer orbital track where combatant launchers rotate |
| `R_BOUNDARY` | `950` | px / units | Reset boundary line; pucks crossing this are retired/knocked out |
| `R_ARENA` | `890` | px / units | Playable scoring arena perimeter |
| `R_CORE` | `48` | px / units | Singularity vault boundary |
| `R_SINGULARITY` | `15` | px / units | Center bullseye target coordinate `[0, 0]` |
| `PUCK_RADIUS` | `8.5` | px / units | Collision radius for all pucks (Diameter = 17) |
| `ICE_FRICTION` | `0.992` | factor/tick | Linear velocity damping per 60 Hz tick (`vx *= 0.992`) |
| `pegBounce` | `0.85` | coefficient | Coefficient of restitution on peg collision |
| `bumperBounce` | `1.15` | coefficient | Super-elastic restitution on bumper peg collision |
| `puckBounce` | `0.88` | coefficient | Elastic collision restitution between two combatant pucks |
| `MAX_SPEED` | `26.0` | units/tick | Velocity clamp ceiling |
| `SPATIAL_GRID_CELL_SIZE` | `36` | units | Spatial hash grid bucket width |

---

## 🗺️ 3. Arena Map Sizes & Scale Presets

| Size Preset | Scale | $R_{{arena}}$ | $R_{{boundary}}$ | $R_{{orbit}}$ | Default Zooms (Me / Arena) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Compact** | `0.674` | `600 px` | `650 px` | `750 px` | `0.58x` / `0.38x` |
| **Standard** | `1.000` | `890 px` | `950 px` | `1080 px` | `0.44x` / `0.28x` |
| **Massive** | `1.517` | `1350 px` | `1440 px` | `1600 px` | `0.32x` / `0.18x` |
| **Colossal** | `2.022` | `1800 px` | `1920 px` | `2150 px` | `0.24x` / `0.13x` |

---

## 🛡️ 4. Procedural Map Layouts

1. **Citadel (Standard Arena)**:
   - **Inner Ring**: 8 deflector pegs at radius $r = 140$, radius $8.5$.
   - **Mid Ring**: 12 deflector pegs at radius $r = 280$, offset $\pi/12$, radius $9.0$.
   - Total Obstacles: 20 deflector pegs.
2. **Pachinko Pinfield**:
   - Hexagonal lattice of deflector pegs spaced at $80$ units, spanning between $r=70$ and $r=360$.
   - Approximate Pegs: ~56 pegs.
3. **Crossfire Arena**:
   - 4 corner super-bumpers at $(\\pm 250, \\pm 250)$ with radius $15$ and restitution $1.15$.
   - Orthogonal corridor guide pegs along $x, y = \\pm 35$ spanning distances $130$ to $290$.
   - Total Obstacles: 28 items.
4. **Bullseye Funnel**:
   - 2 concentric perimeter rings at $r=150$ (18 pegs) and $r=280$ (26 pegs).
   - 4 cardinal entrance gates at $0^\\circ, 90^\\circ, 180^\\circ, 270^\\circ$.

---

## 🏆 5. Game Modes & Scoring Rules

### Game Modes:
- **Closest to Singularity (`closest`)**: Classic curling/shuffleboard rules.
- **King of the Hill (`koth`)**: Central zone ($r=75$) yields continuous score to controlling team.
- **Most Hits Time Attack (`most_hits`)**: 90-second sprint maximizing deflections and collisions.
- **24-Hour Colosseum (`GLOBAL-24H-COLOSSEUM`)**: 24-hour asynchronous persistent arena.
- **24-Hour Barrage (`GLOBAL-24H-BARRAGE`)**: Asynchronous mass salvo synchronized release.

### Scoring Rules:
- **`closest_single`**: Combatant or team with the single nearest puck wins.
- **`player_best_avg`**: Arithmetic mean of each player's single top puck distance.
- **`all_pucks_avg`**: Average distance across all placed pucks.
- **`all_pucks_total`**: Cumulative sum of distances across all placed pucks.

---

## 📊 6. Active 24-Hour Colosseum Match Dataset

- **Epoch Start Time**: `{epoch_dt.strftime('%Y-%m-%d %H:%M:%S UTC')}`
- **Active Pucks on Board**: `{stats_summary['totalPucks']}`
- **Unique Combatants**: `{stats_summary['uniquePlayers']}`
- **Closest Proximity**: `{stats_summary['minDistanceMm']} mm` (`{stats_summary['closestCombatant']}`)
- **Mean Proximity**: `{stats_summary['meanDistanceMm']} mm`
- **Median Proximity**: `{stats_summary['medianDistanceMm']} mm`
- **Standard Deviation**: `{stats_summary['stdDevUnits']} units`

### Zonal Distribution:
| Arena Zone | Puck Count | Proportion |
| :--- | :---: | :---: |
""" + "\n".join([f"| **{z}** | `{cnt}` | `{round(cnt/len(processed_pucks)*100, 1)}%` |" for z, cnt in zone_counts.items()]) + """

---

## 🥇 7. Top 20 Proximity Leaderboard

| Rank | Combatant | Team | Distance (mm) | Cartesian Coordinates | Zone | Age (Ticks) |
| :---: | :--- | :--- | :---: | :---: | :--- | :---: |
""" + "\n".join([f"| #{p['rank']} | **{p['playerName']}** | `{p['team']}` | `{p['distanceMm']} mm` | `({p['x']}, {p['y']})` | {p['zone']} | `{p['ageTicks']}` |" for p in processed_pucks[:20]]) + f"""

---

## 💾 8. Export Files & Data Artifacts

1. **Jupyter Notebook**: [`Game_Data_Notebook.ipynb`](./Game_Data_Notebook.ipynb)
2. **Tabular CSV Export**: [`data/colosseum_pucks.csv`](./data/colosseum_pucks.csv) (164 rows, 21 columns)
3. **Consolidated JSON DB**: [`data/game_data_full.json`](./data/game_data_full.json) (Full hierarchical database)
4. **Active State File**: [`data/colosseum_state.json`](./data/colosseum_state.json)
""")

print(f"Successfully generated Markdown Notebook at: {md_notebook_path}")

if __name__ == "__main__":
    print("Notebook generation complete!")
