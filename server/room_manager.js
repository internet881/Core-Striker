/**
 * RoomManager - Handles multiplayer lobbies, matchmaking, 24-hour persistent arenas,
 * slot assignments, and authoritative turn-based and physics ticks.
 */

const fs = require('fs');
const path = require('path');
const { PhysicsEngine, createMap, WORLD, MAP_SIZES } = require('./physics');

const DATA_DIR = path.join(__dirname, '..', 'data');
const COLOSSEUM_FILE = path.join(DATA_DIR, 'colosseum_state.json');
const HISTORY_FILE = path.join(DATA_DIR, 'epoch_history.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class Room {
  constructor(roomCode, config = {}) {
    this.roomCode = roomCode;
    this.name = config.roomName || roomCode;
    this.config = config;
    this.isPersistent24h = config.isPersistent24h || false;
    this.fillBots = (config.fillBots !== undefined) ? !!config.fillBots : true;
    const isSim = (config.pace === "simultaneous" || config.gameMode === "simultaneous" || config.pacingMode === "simultaneous");
    this.maxPlayers = (config.maxPlayers !== undefined)
      ? parseInt(config.maxPlayers, 10)
      : (this.isPersistent24h ? 1000 : (isSim ? 10 : 4));
    this.pucksPerPlayer = config.pucksPerPlayer || 3;
    this.gameMode = isSim ? "simultaneous" : "turnBased"; // Authoritative pacing format
    this.teamFormat = config.teamFormat || "team"; // "team" (2v2 Crimson vs Cobalt or 5v5 Squad War)
    this.scoringRule = config.scoringRule || (config.gameMode === "closest" || config.gameMode === "turnBased" || config.gameMode === "simultaneous" ? "closest_single" : (config.gameMode || "closest_single"));
    this.stagedVolleys = true; // Synchronized volleys only (rapid fire disabled)
    this.currentVolleyPhase = 1;
    this.volleySettleWait = 0;
    this.mapLayout = config.mapLayout || "citadel";
    this.mapSize = config.mapSize || "medium";

    this.physics = new PhysicsEngine({
      mapLayout: this.mapLayout,
      mapSize: this.mapSize,
      iceFriction: config.iceFriction || 0.992,
      pegBounce: config.pegBounce || 0.85,
      bumperBounce: config.bumperBounce || 1.15
    });

    this.players = new Map(); // socket -> playerObject
    this.botPlayers = new Map(); // slotIndex -> botPlayerObject
    this.nextPlayerId = 1;
    this.pucks = []; // active & settled pucks in arena
    this.barrageCommitments = []; // For 24h barrage mode
    this.matchStatus = "waiting"; // "waiting", "in_round", "round_complete"
    this.currentTurnPlayerId = null;
    this.starterPlayerId = null;
    this.turnNumber = 1;
    this.roundNumber = 1;
    this.shotInFlight = false;

    // 24-Hour Epoch Tracking
    this.epochDurationMs = 24 * 60 * 60 * 1000;
    this.epochStartTime = Date.now();

    // Simulation Tick State
    this.tickInterval = null;
    this.deltaInterval = null;
    this.tickCount = 0;

    if (this.isPersistent24h) {
      this.loadColosseumState();
    }

    this.startTickLoops();
  }

  loadColosseumState() {
    try {
      if (fs.existsSync(COLOSSEUM_FILE)) {
        const raw = fs.readFileSync(COLOSSEUM_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.pucks)) {
          this.pucks = data.pucks.map(p => ({
            ...p,
            settled: true,
            vx: 0,
            vy: 0
          }));
          if (data.epochStartTime) this.epochStartTime = data.epochStartTime;
        }
      }
    } catch (e) {
      console.warn("Could not load colosseum state:", e.message);
    }
  }

  saveColosseumState(immediate = false) {
    if (!this.isPersistent24h) return;
    if (this._savePending && !immediate) return;
    this._savePending = true;

    const doSave = async () => {
      try {
        const state = {
          epochStartTime: this.epochStartTime,
          pucks: this.pucks.filter(p => p.settled && !p.isKnockedOut && !p.isRetired)
        };
        await fs.promises.writeFile(COLOSSEUM_FILE, JSON.stringify(state, null, 2));
      } catch (e) {
        console.warn("Failed saving colosseum state:", e.message);
      } finally {
        this._savePending = false;
      }
    };

    if (immediate) {
      doSave();
    } else {
      if (this._saveTimeout) clearTimeout(this._saveTimeout);
      this._saveTimeout = setTimeout(doSave, 4000);
    }
  }

  startTickLoops() {
    // 60 Hz Physics Step
    this.tickInterval = setInterval(() => {
      this.physicsTick();
    }, 16.666);

    // 20 Hz Snapshot Delta Broadcast
    this.deltaInterval = setInterval(() => {
      this.broadcastDelta();
    }, 50);
  }

  stop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.deltaInterval) clearInterval(this.deltaInterval);
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    if (this.isPersistent24h) this.saveColosseumState(true);
  }

  updateConfig(newConfig = {}) {
    this.config = Object.assign({}, this.config, newConfig);

    if (newConfig.roomName) this.name = newConfig.roomName;
    if (newConfig.pace !== undefined || newConfig.gameMode !== undefined || newConfig.pacingMode !== undefined) {
      const paceVal = newConfig.pace || newConfig.pacingMode || newConfig.gameMode;
      const isSim = (paceVal === "simultaneous" || newConfig.gameMode === "simultaneous");
      this.gameMode = isSim ? "simultaneous" : "turnBased";
    }
    if (newConfig.maxPlayers) {
      const parsedMax = parseInt(newConfig.maxPlayers, 10);
      this.maxPlayers = Math.min(Math.max(2, isFinite(parsedMax) ? parsedMax : 4), 1000);
    }
    if (newConfig.pucksPerPlayer) {
      const parsedPucks = parseInt(newConfig.pucksPerPlayer, 10);
      this.pucksPerPlayer = Math.min(Math.max(1, isFinite(parsedPucks) ? parsedPucks : 3), 10);
    }
    if (newConfig.teamFormat) this.teamFormat = newConfig.teamFormat;
    if (newConfig.scoringRule) this.scoringRule = newConfig.scoringRule;
    this.stagedVolleys = true;
    if (newConfig.mapLayout) {
      this.mapLayout = newConfig.mapLayout;
    }
    if (newConfig.mapSize) {
      this.mapSize = newConfig.mapSize;
    }
    if (newConfig.mapSize || newConfig.mapLayout) {
      if (typeof this.physics.setSize === 'function') {
        this.physics.setSize(this.mapSize || "medium", this.mapLayout || "citadel");
      } else if (typeof this.physics.setMap === 'function') {
        this.physics.setMap(this.mapLayout);
      }
    }
    if (newConfig.iceFriction) {
      const f = Number(newConfig.iceFriction);
      this.physics.friction = f;
      this.physics.iceFriction = f;
    }
    if (newConfig.pegBounce) this.physics.pegBounce = Number(newConfig.pegBounce);
    if (newConfig.bumperBounce) this.physics.bumperBounce = Number(newConfig.bumperBounce);
    if (newConfig.fillBots !== undefined) this.fillBots = !!newConfig.fillBots;

    this.ensureBotSlots();

    // Send updated config/state individually to each connected client preserving their credentials
    for (const [ws, player] of this.players.entries()) {
      this.sendTo(ws, {
        type: "ROOM_STATE",
        roomCode: this.roomCode,
        roomName: this.name,
        playerId: player.id,
        slotIndex: player.slotIndex,
        isHost: !!player.isHost,
        config: {
          maxPlayers: this.maxPlayers,
          pucksPerPlayer: this.pucksPerPlayer,
          gameMode: this.gameMode,
          teamFormat: this.teamFormat,
          scoringRule: this.scoringRule,
          stagedVolleys: this.stagedVolleys,
          fillBots: this.fillBots,
          mapLayout: this.mapLayout,
          mapSize: this.mapSize || "medium",
          iceFriction: this.physics.iceFriction,
          pegBounce: this.physics.pegBounce,
          bumperBounce: this.physics.bumperBounce,
          isPersistent24h: this.isPersistent24h,
          isBarrage: this.isBarrage
        },
        map: this.physics.map,
        players: this.getPublicPlayerList(),
        settledPucks: this.pucks.filter(p => p.settled && !p.isKnockedOut && !p.isRetired),
        epochTimeRemainingMs: Math.max(0, this.epochDurationMs - (Date.now() - this.epochStartTime))
      });
    }

    console.log(`[ROOM CONFIG UPDATED] Room ${this.roomCode}: mode=${this.gameMode}, players=${this.maxPlayers}, map=${this.mapLayout}`);
  }

  addPlayer(ws, clientInfo = {}) {
    const playerId = this.nextPlayerId++;

    // Find first available slot (0 to maxPlayers - 1)
    const occupiedSlots = new Set();
    for (const p of this.players.values()) {
      if (p.slotIndex !== undefined) occupiedSlots.add(p.slotIndex);
    }
    let slotIndex = 0;
    while (occupiedSlots.has(slotIndex) && slotIndex < this.maxPlayers) {
      slotIndex++;
    }

    // Determine team based on format and slotIndex
    let team = "crimson";
    if (this.teamFormat === "ffa") {
      team = `solo_${slotIndex + 1}`;
    } else {
      // Slot 0 = crimson, slot 1 = cobalt (opposing sides)
      team = (slotIndex % 2 === 0) ? "crimson" : "cobalt";
    }

    const name = clientInfo.name || `Striker-${playerId}`;
    let hasExistingHost = false;
    for (const p of this.players.values()) {
      if (p.isHost) {
        hasExistingHost = true;
        break;
      }
    }
    const isHost = !hasExistingHost && (clientInfo.isHost || this.players.size === 0);

    const player = {
      id: playerId,
      slotIndex,
      name,
      team,
      isHost,
      pucksLeft: this.pucksPerPlayer,
      totalPucks: this.pucksPerPlayer,
      knockouts: 0,
      shotsTaken: 0,
      ws
    };

    this.players.set(ws, player);

    // Send full initial room state
    this.sendTo(ws, {
      type: "ROOM_STATE",
      roomCode: this.roomCode,
      roomName: this.name,
      playerId,
      slotIndex,
      isHost: player.isHost,
      config: {
        maxPlayers: this.maxPlayers,
        pucksPerPlayer: this.pucksPerPlayer,
        gameMode: this.gameMode,
        teamFormat: this.teamFormat,
        scoringRule: this.scoringRule,
        stagedVolleys: this.stagedVolleys,
        mapLayout: this.mapLayout,
        mapSize: this.mapSize || "medium",
        isPersistent24h: this.isPersistent24h,
        isBarrage: this.isBarrage
      },
      map: this.physics.map,
      players: this.getPublicPlayerList(),
      settledPucks: this.pucks.filter(p => p.settled && !p.isKnockedOut && !p.isRetired),
      epochTimeRemainingMs: Math.max(0, this.epochDurationMs - (Date.now() - this.epochStartTime))
    });

    // Notify others
    this.broadcast({
      type: "PLAYER_JOINED",
      player: this.sanitizePlayer(player),
      players: this.getPublicPlayerList()
    }, ws);

    return player;
  }

  removePlayer(ws) {
    const player = this.players.get(ws);
    if (player) {
      const wasHost = !!player.isHost;
      this.players.delete(ws);

      let newHostPlayer = null;
      if (wasHost && this.players.size > 0) {
        newHostPlayer = this.players.values().next().value;
        if (newHostPlayer) {
          newHostPlayer.isHost = true;
          this.sendTo(newHostPlayer.ws, {
            type: "HOST_PROMOTED",
            isHost: true,
            playerId: newHostPlayer.id
          });
          console.log(`[HOST MIGRATED] Room ${this.roomCode}: player ${newHostPlayer.name} (#${newHostPlayer.id}) promoted to host`);
        }
      }

      this.broadcast({
        type: "PLAYER_LEFT",
        playerId: player.id,
        name: player.name,
        wasHost,
        newHostId: newHostPlayer ? newHostPlayer.id : null,
        players: this.getPublicPlayerList()
      });

      if (this.currentTurnPlayerId === player.id) {
        this.checkTurnProgression();
      }
    }
  }

  sanitizePlayer(p) {
    return {
      id: p.id,
      slotIndex: p.slotIndex,
      name: p.name,
      team: p.team,
      isHost: p.isHost,
      isBot: !!p.isBot,
      pucksLeft: p.pucksLeft,
      totalPucks: p.totalPucks,
      knockouts: p.knockouts,
      shotsTaken: p.shotsTaken
    };
  }

  ensureBotSlots() {
    if (!this.botPlayers) this.botPlayers = new Map();
    const max = parseInt(this.maxPlayers, 10) || 4;
    const occupiedSlots = new Set();
    for (const p of this.players.values()) {
      if (p.slotIndex !== undefined) occupiedSlots.add(p.slotIndex);
    }
    // Remove any bots whose slot is taken by a human OR exceeds maxPlayers!
    for (const slot of this.botPlayers.keys()) {
      if (occupiedSlots.has(slot) || slot >= max) {
        this.botPlayers.delete(slot);
      }
    }
    if (this.fillBots === false) {
      this.botPlayers.clear();
      return;
    }
    // Fill remaining slots up to max with bots
    for (let slot = 0; slot < max; slot++) {
      if (!occupiedSlots.has(slot) && !this.botPlayers.has(slot)) {
        const isCrimson = (slot % 2 === 0);
        const team = (this.teamFormat === "ffa") ? `solo_${slot + 1}` : (isCrimson ? "crimson" : "cobalt");
        const botId = 1000 + slot;
        this.botPlayers.set(slot, {
          id: botId,
          slotIndex: slot,
          name: `BOT ${slot + 1}`,
          team,
          isHost: false,
          isBot: true,
          pucksLeft: this.pucksPerPlayer,
          totalPucks: this.pucksPerPlayer,
          knockouts: 0,
          shotsTaken: 0,
          ws: null
        });
      }
    }
  }

  getAllCombatants() {
    this.ensureBotSlots();
    const combatants = [];
    for (const p of this.players.values()) {
      combatants.push(p);
    }
    for (const b of this.botPlayers.values()) {
      combatants.push(b);
    }
    combatants.sort((a, b) => a.slotIndex - b.slotIndex);
    return combatants;
  }

  getCombatant(idOrSlot) {
    for (const p of this.players.values()) {
      if (p.id === idOrSlot || p.slotIndex === idOrSlot) return p;
    }
    if (this.botPlayers) {
      for (const b of this.botPlayers.values()) {
        if (b.id === idOrSlot || b.slotIndex === idOrSlot) return b;
      }
    }
    return null;
  }

  getOpponentsOnBoard(player) {
    if (!player) return [];
    return this.pucks.filter(p => {
      if (p.isKnockedOut || p.isRetired || p.isFouled) return false;
      // Never consider shooter's own pucks as opponents
      if (p.playerId !== undefined && p.playerId === player.id) return false;
      // Determine puck's team directly or via owner lookup
      let puckTeam = p.team;
      if (!puckTeam || typeof puckTeam !== "string") {
        const owner = this.findCombatant(p.playerId, p.slotIndex);
        if (owner) puckTeam = owner.team;
      }
      // In 2v2 / team mode, teammates share the same team (crimson vs cobalt); exclude teammate pucks
      if (puckTeam && player.team && puckTeam === player.team) return false;
      const dist = Math.hypot(p.x, p.y);
      return dist <= (WORLD.R_ARENA + 25) || p.hasEnteredArena;
    });
  }

  getOrCreateBotPlayer(msg) {
    this.ensureBotSlots();
    const slot = (msg.botSlotIndex !== undefined) ? Number(msg.botSlotIndex) : 2;
    let bot = this.botPlayers.get(slot);
    if (!bot) {
      const isCrimson = (slot % 2 === 0);
      const team = msg.botTeam || (this.teamFormat === "ffa" ? `solo_${slot + 1}` : (isCrimson ? "crimson" : "cobalt"));
      bot = {
        id: msg.botPlayerId || (1000 + slot),
        slotIndex: slot,
        name: msg.botName || `BOT ${slot + 1}`,
        team,
        isHost: false,
        isBot: true,
        pucksLeft: this.pucksPerPlayer,
        totalPucks: this.pucksPerPlayer,
        knockouts: 0,
        shotsTaken: 0,
        ws: null
      };
      this.botPlayers.set(slot, bot);
    }
    return bot;
  }

  getPublicPlayerList() {
    const list = [];
    for (const c of this.getAllCombatants()) {
      list.push(this.sanitizePlayer(c));
    }
    return list;
  }

  setPlayerTeam(requesterPlayer, targetIdOrSlot, newTeam) {
    if (!requesterPlayer || !requesterPlayer.isHost) {
      console.warn(`[SET_PLAYER_TEAM REJECTED] Non-host attempted to change teams.`);
      return false;
    }
    if (this.teamFormat === "ffa") {
      console.warn(`[SET_PLAYER_TEAM REJECTED] Cannot change teams in FFA mode.`);
      return false;
    }
    const cleanTeam = (newTeam === "crimson" || newTeam === "cobalt") ? newTeam : "crimson";
    const combatant = this.getCombatant(targetIdOrSlot);
    if (combatant) {
      combatant.team = cleanTeam;
      // Also update any live pucks for this combatant
      for (const puck of this.pucks) {
        if (puck.playerId === combatant.id) {
          puck.team = cleanTeam;
        }
      }
      console.log(`[TEAM UPDATED] Room ${this.roomCode}: ${combatant.name} switched to ${cleanTeam}`);
      this.broadcast({
        type: "TEAMS_UPDATED",
        targetId: combatant.id,
        slotIndex: combatant.slotIndex,
        team: cleanTeam,
        players: this.getPublicPlayerList()
      });
      return true;
    }
    return false;
  }

  balanceTeams(requesterPlayer) {
    if (!requesterPlayer || !requesterPlayer.isHost) return false;
    if (this.teamFormat === "ffa") return false;

    const combatants = this.getAllCombatants();
    combatants.forEach((c, idx) => {
      c.team = (idx % 2 === 0) ? "crimson" : "cobalt";
      for (const puck of this.pucks) {
        if (puck.playerId === c.id) {
          puck.team = c.team;
        }
      }
    });

    console.log(`[TEAMS BALANCED] Room ${this.roomCode}: balanced ${combatants.length} combatants evenly`);
    this.broadcast({
      type: "TEAMS_UPDATED",
      players: this.getPublicPlayerList()
    });
    return true;
  }

  startRound(starter = null) {
    this.matchStatus = "in_round";
    this.roundNumber = 1;
    this.turnNumber = 1;
    this.currentVolleyPhase = 1;
    this.volleySettleWait = 0;
    this.shotInFlight = false;
    this.pucks = [];

    const combatants = this.getAllCombatants();
    for (const c of combatants) {
      c.pucksLeft = this.pucksPerPlayer;
      c.shotsTaken = 0;
      c.knockouts = 0;
    }

    const firstPlayer = starter || combatants[0];
    this.currentTurnPlayerId = firstPlayer ? firstPlayer.id : null;
    this.starterPlayerId = this.currentTurnPlayerId;

    this.broadcast({
      type: "MATCH_STARTED",
      starterId: this.currentTurnPlayerId,
      starterSlotIndex: firstPlayer ? firstPlayer.slotIndex : 0,
      config: this.config || {},
      volleyPhase: 1,
      totalVolleys: this.pucksPerPlayer,
      players: this.getPublicPlayerList()
    });

    if (firstPlayer) {
      this.broadcast({
        type: "TURN_CHANGED",
        activePlayerId: firstPlayer.id,
        activeSlotIndex: firstPlayer.slotIndex,
        turnNumber: 1,
        playerName: firstPlayer.name
      });
    }
  }

  startNextRound(starter = null) {
    this.matchStatus = "in_round";
    this.roundNumber++;
    this.turnNumber = 1;
    this.currentVolleyPhase = 1;
    this.volleySettleWait = 0;
    this.shotInFlight = false;
    this.pucks = [];

    const combatants = this.getAllCombatants();
    for (const c of combatants) {
      c.pucksLeft = this.pucksPerPlayer;
      c.shotsTaken = 0;
      c.knockouts = 0;
    }

    const firstPlayer = starter || combatants[0];
    this.currentTurnPlayerId = firstPlayer ? firstPlayer.id : null;
    this.starterPlayerId = this.currentTurnPlayerId;

    console.log(`[SERVER ROUND ADVANCE] Room ${this.roomCode} -> Round ${this.roundNumber} starting. Pucks cleared.`);

    this.broadcast({
      type: "ROUND_STARTED",
      roundNumber: this.roundNumber,
      starterId: this.currentTurnPlayerId,
      starterSlotIndex: firstPlayer ? firstPlayer.slotIndex : 0,
      volleyPhase: 1,
      totalVolleys: this.pucksPerPlayer,
      players: this.getPublicPlayerList()
    });

    if (firstPlayer) {
      this.broadcast({
        type: "TURN_CHANGED",
        activePlayerId: firstPlayer.id,
        activeSlotIndex: firstPlayer.slotIndex,
        turnNumber: 1,
        playerName: firstPlayer.name
      });
    }
  }

  replayRound(starter = null) {
    this.matchStatus = "in_round";
    this.turnNumber = 1;
    this.currentVolleyPhase = 1;
    this.volleySettleWait = 0;
    this.shotInFlight = false;
    this.pucks = [];

    const combatants = this.getAllCombatants();
    for (const c of combatants) {
      c.pucksLeft = this.pucksPerPlayer;
      c.shotsTaken = 0;
      c.knockouts = 0;
    }

    const firstPlayer = starter || combatants[0];
    this.currentTurnPlayerId = firstPlayer ? firstPlayer.id : null;
    this.starterPlayerId = this.currentTurnPlayerId;

    console.log(`[SERVER ROUND REPLAY] Room ${this.roomCode} -> Replaying Round ${this.roundNumber}. Pucks cleared.`);

    this.broadcast({
      type: "ROUND_STARTED",
      roundNumber: this.roundNumber,
      starterId: this.currentTurnPlayerId,
      starterSlotIndex: firstPlayer ? firstPlayer.slotIndex : 0,
      volleyPhase: 1,
      totalVolleys: this.pucksPerPlayer,
      players: this.getPublicPlayerList()
    });

    if (firstPlayer) {
      this.broadcast({
        type: "TURN_CHANGED",
        activePlayerId: firstPlayer.id,
        activeSlotIndex: firstPlayer.slotIndex,
        turnNumber: 1,
        playerName: firstPlayer.name
      });
    }
  }

  hasActiveHost() {
    if (this.isPersistent24h) return false;
    for (const player of this.players.values()) {
      if (player.isHost && player.ws && player.ws.readyState === 1) { // WebSocket.OPEN
        return true;
      }
    }
    return false;
  }

  physicsTick() {
    // In hosted custom rooms, the Host client's physics is authoritative.
    // The server does not run an antagonistic duplicate simulation that fights the host.
    if (this.hasActiveHost()) {
      return;
    }

    this.tickCount++;
    const combatants = this.getAllCombatants();
    const res = this.physics.step(this.pucks, combatants);

    if (res.events && res.events.length > 0) {
      for (const ev of res.events) {
        if (ev.type === "KNOCKOUT") {
          this.broadcast({
            type: "KNOCKOUT_EVENT",
            puckId: ev.puckId,
            victimPlayerId: ev.victimPlayerId,
            bumperPlayerId: ev.bumperPlayerId,
            x: ev.x,
            y: ev.y
          });
        } else if (ev.type === "OPPONENT_HIT") {
          this.broadcast({
            type: "OPPONENT_HIT",
            puck1Id: ev.puck1Id,
            puck2Id: ev.puck2Id,
            p1Name: ev.p1Name,
            p2Name: ev.p2Name
          });
        } else if (ev.type === "PUCK_FOULED") {
          this.pucks = this.pucks.filter(p => p.id !== ev.puckId);
          console.log(`[SERVER PUCK_FOULED] Room ${this.roomCode} | P${ev.playerId} (${ev.playerName}) failed to strike opponent piece before standstill! Puck ${ev.puckId} scratched.`);
          this.broadcast({
            type: "PUCK_FOULED",
            puckId: ev.puckId,
            playerId: ev.playerId,
            playerName: ev.playerName,
            x: ev.x,
            y: ev.y
          });
        } else if (ev.type === "PUCK_SETTLED") {
          this.broadcast({
            type: "PUCK_SETTLED",
            puckId: ev.puckId,
            playerId: ev.playerId,
            x: ev.x,
            y: ev.y,
            distMm: ev.distMm
          });
          if (this.isPersistent24h) {
            this.saveColosseumState();
          }
        }
      }
    }

    this.checkTurnProgression();
  }

  checkTurnProgression() {
    if (this.matchStatus !== "in_round") return;

    // Check if any pucks are still moving
    const movingPucks = this.pucks.filter(p => !p.settled && !p.isKnockedOut && !p.isRetired && !p.isFouled);
    if (movingPucks.length > 0) return;

    const combatantList = this.getAllCombatants();
    if (combatantList.length === 0) return;

    const totalRemaining = combatantList.reduce((sum, p) => sum + (p.pucksLeft || 0), 0);

    // If all pucks exhausted across all players: Round Complete!
    if (totalRemaining === 0) {
      this.matchStatus = "round_complete";
      const scores = this.calculateScores();
      const winner = this.determineWinner(scores);
      this.broadcast({
        type: "ROUND_COMPLETE",
        scores,
        winner
      });
      return;
    }

    // In simultaneous mode, advance synchronized volley waves once all combatants have fired for the wave and pucks have settled
    if (this.gameMode === "simultaneous") {
      const movingPucks = this.pucks.filter(p => !p.settled && !p.isKnockedOut && !p.isRetired && !p.isFouled);
      if (movingPucks.length > 0) {
        this.volleySettleWait = 0;
        return;
      }

      const combatants = this.getAllCombatants();
      const allFiredForWave = combatants.every(c => (c.shotsTaken >= this.currentVolleyPhase) || (c.pucksLeft <= 0));

      if (allFiredForWave) {
        this.volleySettleWait = (this.volleySettleWait || 0) + 1;
        if (this.volleySettleWait > 15) { // ~0.25s of standstill confirmation
          this.volleySettleWait = 0;
          if (this.currentVolleyPhase < this.pucksPerPlayer) {
            this.currentVolleyPhase++;
            console.log(`[SERVER VOLLEY ADVANCE] Room ${this.roomCode} -> Volley Phase ${this.currentVolleyPhase}/${this.pucksPerPlayer}`);
            this.broadcast({
              type: "VOLLEY_PHASE_CHANGED",
              volleyPhase: this.currentVolleyPhase,
              totalVolleys: this.pucksPerPlayer
            });
          }
        }
      } else {
        this.volleySettleWait = 0;
      }
      return;
    }

    // Advance turn when current shot settles in turn-based mode
    if (this.gameMode === "turnBased" || this.gameMode === "closest") {
      if (!this.shotInFlight) return; // Wait until active player fires and puck settles!
      this.shotInFlight = false;

      const currentIdx = combatantList.findIndex(p => p.id === this.currentTurnPlayerId);
      if (currentIdx === -1) {
        if (combatantList.length > 0) {
          this.currentTurnPlayerId = combatantList[0].id;
          this.broadcast({
            type: "TURN_CHANGED",
            activePlayerId: combatantList[0].id,
            activeSlotIndex: combatantList[0].slotIndex,
            turnNumber: this.turnNumber,
            playerName: combatantList[0].name
          });
        }
        return;
      }

      // Find next player in alternating sequence who has pucks remaining
      let nextIdx = (currentIdx + 1) % combatantList.length;
      let count = 0;
      while (combatantList[nextIdx].pucksLeft <= 0 && count < combatantList.length) {
        nextIdx = (nextIdx + 1) % combatantList.length;
        count++;
      }

      const nextPlayer = combatantList[nextIdx];
      if (nextPlayer && nextPlayer.pucksLeft > 0 && nextPlayer.id !== this.currentTurnPlayerId) {
        this.currentTurnPlayerId = nextPlayer.id;
        this.turnNumber++;
        this.broadcast({
          type: "TURN_CHANGED",
          activePlayerId: nextPlayer.id,
          activeSlotIndex: nextPlayer.slotIndex,
          turnNumber: this.turnNumber,
          playerName: nextPlayer.name
        });
      }
    }
  }

  calculateScores() {
    const scores = [];
    const validPucks = this.pucks.filter(p => p.settled && !p.isKnockedOut && !p.isRetired && !p.isFouled);

    for (const player of this.getAllCombatants()) {
      const playerPucks = validPucks.filter(p => p.playerId === player.id);
      let bestDist = Infinity;
      let closestPuckId = null;

      for (const puck of playerPucks) {
        const d = Math.hypot(puck.x, puck.y) * 0.5; // mm
        if (d < bestDist) {
          bestDist = d;
          closestPuckId = puck.id;
        }
      }

      const koBonus = (player.knockouts || 0) * 25.0; // 25mm deduction bonus
      const netDist = (bestDist === Infinity) ? Infinity : Math.max(0, bestDist - koBonus);

      scores.push({
        playerId: player.id,
        slotIndex: player.slotIndex,
        playerName: player.name,
        team: player.team,
        rawDistMm: bestDist === Infinity ? null : Number(bestDist.toFixed(2)),
        netDistMm: netDist === Infinity ? null : Number(netDist.toFixed(2)),
        knockouts: player.knockouts || 0,
        closestPuckId
      });
    }

    scores.sort((a, b) => {
      const da = a.netDistMm === null ? Infinity : a.netDistMm;
      const db = b.netDistMm === null ? Infinity : b.netDistMm;
      return da - db;
    });

    return scores;
  }

  determineWinner(scores) {
    if (!scores || scores.length === 0) return null;
    const top = scores[0];
    if (top.netDistMm === null) return null;
    return {
      playerId: top.playerId,
      playerName: top.playerName,
      team: top.team,
      netDistMm: top.netDistMm
    };
  }

  broadcastDelta() {
    if (this.hasActiveHost()) {
      return; // Delta broadcasts are driven directly by the Host client in hosted rooms
    }
    const activePucks = this.pucks.filter(p => !p.settled && !p.isKnockedOut && !p.isRetired && !p.isFouled);
    if (activePucks.length === 0) return;

    const delta = {
      type: "WORLD_DELTA",
      tick: this.tickCount,
      pucks: activePucks.map(p => ({
        id: p.id,
        playerId: p.playerId,
        slotIndex: p.slotIndex,
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        vx: Number(p.vx.toFixed(2)),
        vy: Number(p.vy.toFixed(2))
      }))
    };

    this.broadcast(delta);
  }

  handleHostPhysicsDelta(msg, hostWs) {
    if (!msg.pucks || !Array.isArray(msg.pucks)) return;
    for (const hp of msg.pucks) {
      let sPuck = this.pucks.find(p => p.id === hp.id);
      if (sPuck) {
        sPuck.x = hp.x;
        sPuck.y = hp.y;
        sPuck.vx = hp.vx;
        sPuck.vy = hp.vy;
        sPuck.settled = hp.settled;
      }
    }
    // Relay to any connected guest players (excluding host)
    this.broadcast({
      type: "WORLD_DELTA",
      pucks: msg.pucks
    }, hostWs);
  }

  handleHostPuckSettled(msg, hostWs) {
    let sPuck = this.pucks.find(p => p.id === msg.puckId);
    if (sPuck) {
      sPuck.x = msg.x;
      sPuck.y = msg.y;
      sPuck.settled = true;
      sPuck.vx = 0;
      sPuck.vy = 0;
    }
    
    // Relay settlement to guests
    this.broadcast({
      type: "PUCK_SETTLED",
      puckId: msg.puckId,
      playerId: msg.playerId,
      x: msg.x,
      y: msg.y,
      distMm: msg.distMm
    }, hostWs);

    this.checkTurnProgression();
  }

  handleHostEvent(msg, hostWs) {
    if (msg.eventType === "KNOCKOUT") {
      let sPuck = this.pucks.find(p => p.id === msg.puckId);
      if (sPuck) {
        sPuck.isKnockedOut = true;
        sPuck.settled = true;
      }
      this.broadcast({
        type: "KNOCKOUT_EVENT",
        puckId: msg.puckId,
        victimPlayerId: msg.victimPlayerId,
        bumperPlayerId: msg.bumperPlayerId,
        x: msg.x,
        y: msg.y
      }, hostWs);
    } else if (msg.eventType === "FOUL") {
      this.pucks = this.pucks.filter(p => p.id !== msg.puckId);
      this.broadcast({
        type: "PUCK_FOULED",
        puckId: msg.puckId,
        playerId: msg.playerId,
        playerName: msg.playerName,
        x: msg.x,
        y: msg.y
      }, hostWs);
    }
  }

  fireShot(player, shotData) {
    if (!player) return false;
    if (player.pucksLeft === undefined || player.pucksLeft === null) {
      player.pucksLeft = this.pucksPerPlayer || 3;
    }
    if (player.pucksLeft <= 0) return false;

    if (this.gameMode === "simultaneous") {
      const shotsTaken = player.shotsTaken || 0;
      if (shotsTaken >= this.currentVolleyPhase) {
        const combatants = this.getAllCombatants();
        const minShots = Math.min(...combatants.map(c => c.shotsTaken || 0));
        if (minShots >= this.currentVolleyPhase && this.currentVolleyPhase < this.pucksPerPlayer) {
          this.currentVolleyPhase = minShots + 1;
          this.broadcast({
            type: "VOLLEY_PHASE_CHANGED",
            volleyPhase: this.currentVolleyPhase,
            totalVolleys: this.pucksPerPlayer
          });
        } else {
          console.warn(`[SERVER REJECT SHOT] Player ${player.name} (P${player.id}) already fired for volley wave ${this.currentVolleyPhase}/${this.pucksPerPlayer}`);
          return false;
        }
      }
    }

    // Allow shot, decrementing remaining pucks
    player.pucksLeft = Math.max(0, player.pucksLeft - 1);
    player.shotsTaken = (player.shotsTaken || 0) + 1;

    // Use client puckId or generate one
    const puckId = shotData.puckId || `puck_${player.id}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const vx = Math.min(32, Math.max(-32, Number(shotData.vx) || 0));
    const vy = Math.min(32, Math.max(-32, Number(shotData.vy) || 0));

    // Strictly compute station spawn coordinates server-side to prevent position cheating
    const totalSlots = Math.max(2, this.maxPlayers || 2);
    const slotAngle = (player.slotIndex / totalSlots) * Math.PI * 2 + Math.PI / 2;
    const launchDist = (this.physics && this.physics.rOrbit) ? this.physics.rOrbit : WORLD.R_ORBIT;
    const angle = Number(shotData.angle !== undefined ? shotData.angle : slotAngle);
    const x = Math.cos(slotAngle) * launchDist;
    const y = Math.sin(slotAngle) * launchDist;

    const opponents = this.getOpponentsOnBoard(player);
    const mustHitOpponent = (this.gameMode === "turnBased" && opponents.length > 0);

    const puck = {
      id: puckId,
      playerId: player.id,
      slotIndex: player.slotIndex,
      playerName: player.name,
      team: player.team,
      x,
      y,
      vx,
      vy,
      age: 0,
      settled: false,
      settleTimer: 0,
      mustHitOpponent,
      hasHitOpponent: false,
      isFouled: false,
      isKnockedOut: false,
      isRetired: false,
      lastBumperId: null,
      minDistance: Infinity
    };

    // Cap total pucks in persistent rooms to prevent unbounded memory/CPU growth
    if (this.pucks.length >= 1000) {
      const settledIdx = this.pucks.findIndex(p => p.settled);
      if (settledIdx !== -1) {
        this.pucks.splice(settledIdx, 1);
      }
    }

    this.pucks.push(puck);
    this.shotInFlight = true;
    console.log(`[SERVER PUCK_SPAWNED] Room ${this.roomCode} | P${player.id} (${player.name}, slot ${player.slotIndex}) | id: ${puck.id} | mustHit: ${mustHitOpponent} | pos: (${x.toFixed(1)}, ${y.toFixed(1)}) | v: (${vx.toFixed(1)}, ${vy.toFixed(1)})`);

    this.broadcast({
      type: "PUCK_SPAWNED",
      puck: {
        id: puck.id,
        playerId: puck.playerId,
        slotIndex: puck.slotIndex,
        playerName: puck.playerName,
        team: puck.team,
        x: puck.x,
        y: puck.y,
        vx: puck.vx,
        vy: puck.vy,
        angle,
        mustHitOpponent: puck.mustHitOpponent
      },
      playerPucksLeft: player.pucksLeft
    });

    return true;
  }

  commitBarrageShot(player, shotData) {
    if (!player) return false;
    // Cap total barrage commitments in memory to prevent OOM
    if (this.barrageCommitments.length >= 2000) return false;
    // Limit active commitments to 3 per player
    const existing = this.barrageCommitments.filter(c => c.playerId === player.id);
    if (existing.length >= 3) return false;

    this.barrageCommitments.push({
      playerId: player.id,
      playerName: player.name,
      team: player.team,
      angle: Number(shotData.angle) || 0,
      vx: Math.min(32, Math.max(-32, Number(shotData.vx) || 0)),
      vy: Math.min(32, Math.max(-32, Number(shotData.vy) || 0)),
      timestamp: Date.now()
    });

    this.sendTo(player.ws, {
      type: "BARRAGE_COMMITTED",
      totalCommitted: this.barrageCommitments.length
    });

    this.broadcast({
      type: "BARRAGE_COUNT_UPDATE",
      count: this.barrageCommitments.length
    });

    return true;
  }

  triggerBarrageSimulation() {
    if (this.barrageCommitments.length === 0) return;

    for (const commit of this.barrageCommitments) {
      const launchDist = WORLD.R_ORBIT;
      const x = Math.cos(commit.angle) * launchDist;
      const y = Math.sin(commit.angle) * launchDist;

      this.pucks.push({
        id: `barrage_${commit.playerId}_${Date.now()}_${Math.random()}`,
        playerId: commit.playerId,
        playerName: commit.playerName,
        team: commit.team,
        x,
        y,
        vx: commit.vx,
        vy: commit.vy,
        age: 0,
        settled: false,
        settleTimer: 0,
        isKnockedOut: false,
        isRetired: false,
        lastBumperId: null,
        minDistance: Infinity
      });
    }

    this.broadcast({
      type: "BARRAGE_FIRING",
      count: this.barrageCommitments.length
    });

    this.barrageCommitments = [];
  }

  sendTo(ws, message) {
    if (ws && ws.readyState === 1) { // 1 = OPEN
      ws.send(JSON.stringify(message));
    }
  }

  broadcast(message, excludeWs = null) {
    const raw = JSON.stringify(message);
    for (const ws of this.players.keys()) {
      if (ws !== excludeWs && ws.readyState === 1) {
        ws.send(raw);
      }
    }
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();

    // Permanent 24-Hour Colosseum Room
    this.colosseumRoom = new Room("GLOBAL-24H-COLOSSEUM", {
      roomName: "24-Hour Global Colosseum",
      isPersistent24h: true,
      maxPlayers: 1000,
      pucksPerPlayer: 3,
      gameMode: "closest",
      teamFormat: "ffa",
      scoringRule: "closest_single",
      mapLayout: "citadel"
    });
    this.rooms.set("GLOBAL-24H-COLOSSEUM", this.colosseumRoom);

    // Permanent 24-Hour Barrage Room
    this.barrageRoom = new Room("GLOBAL-24H-BARRAGE", {
      roomName: "24-Hour Midnight Barrage Tournament",
      isBarrage: true,
      maxPlayers: 1000,
      pucksPerPlayer: 1,
      gameMode: "closest",
      teamFormat: "ffa",
      scoringRule: "closest_single",
      mapLayout: "citadel"
    });
    this.rooms.set("GLOBAL-24H-BARRAGE", this.barrageRoom);
  }

  getOrCreateRoom(roomCode, config = {}) {
    let room = this.rooms.get(roomCode);
    if (!room) {
      room = new Room(roomCode, config);
      this.rooms.set(roomCode, room);
    }
    return room;
  }

  getRoom(roomCode) {
    return this.rooms.get(roomCode);
  }

  cleanupEmptyRooms() {
    for (const [code, room] of this.rooms.entries()) {
      if (code === "GLOBAL-24H-COLOSSEUM" || code === "GLOBAL-24H-BARRAGE") {
        continue;
      }
      if (room.players.size === 0) {
        room.stop();
        this.rooms.delete(code);
      }
    }
  }
}

module.exports = new RoomManager();
