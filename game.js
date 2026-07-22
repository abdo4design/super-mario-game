// Super Plumber Bros — an original, from-scratch tribute platformer.
// All art is procedurally drawn on canvas; no external assets are used.

const TILE = 32;

// Level legend:
// '.' empty  'G' ground  '?' question block  'B' brick  'p' pipe (2 tiles wide)
// 'g' goomba spawn  'k' koopa spawn  'M' player spawn  'F' flagpole  'H' hill (decor)
// 'b' bush (decor)  'c' cloud (decor)

// A "world" bundles a tile grid with everything needed to place entities on
// it and to warp into/out of it (pipes). The overworld and the underground
// bonus room are each one of these; only one is active ("current") at a
// time, and warping just swaps which one update()/draw() read from.
function makeGridBuilder(rows, cols) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill("."));
  const set = (r, c, ch) => {
    if (r >= 0 && r < rows && c >= 0 && c < cols) grid[r][c] = ch;
  };
  const setRange = (r, c1, c2, ch) => {
    for (let c = c1; c <= c2; c++) set(r, c, ch);
  };
  const pipeLeftCols = new Set();
  const placePipe = (colLeft, topRow, height) => {
    for (let r = topRow; r < topRow + height; r++) {
      set(r, colLeft, "p");
      set(r, colLeft + 1, "p");
    }
    pipeLeftCols.add(colLeft);
  };
  // Classic ascending staircase leading up to the flag. groundRow is the
  // top row of solid ground (ROWS-2); each successive column gets one more
  // block of height. Returns the column right after the tallest step, where
  // the flag is typically planted.
  const addStaircase = (startCol, steps, groundRow) => {
    for (let i = 1; i <= steps; i++) {
      const col = startCol + i - 1;
      for (let r = groundRow - i; r < groundRow; r++) set(r, col, "G");
    }
    return startCol + steps;
  };
  return { grid, set, setRange, placePipe, addStaircase, pipeLeftCols, rows, cols };
}

function pits(b, ROWS, ranges) {
  ranges.forEach(([c1, c2]) => {
    for (let c = c1; c <= c2; c++) {
      b.set(ROWS - 2, c, ".");
      b.set(ROWS - 1, c, ".");
    }
  });
}

// Places a pipe that can actually be entered (Down/S) - it warps to the
// shared underground bonus room. Every pipe in every level uses this now,
// so any pipe you find can be entered, not just one designated pipe per
// level. Where you land back in the overworld is resolved dynamically at
// warp time (see the "RETURN" handling in update()), not fixed here.
function placeWarpPipe(b, warpPipes, colLeft, topRow, height) {
  b.placePipe(colLeft, topRow, height);
  warpPipes[`${colLeft},${topRow}`] = {
    toWorld: "underground",
    spawn: { x: 2 * TILE, y: 5 * TILE },
  };
}

// Densely scatters goombas/koopas across [startCol, endCol), skipping any
// column that isn't clear open ground (pits, pipes, blocks already placed
// there). Run this AFTER all other terrain so it only fills genuine gaps.
function scatterEnemies(b, ROWS, startCol, endCol, rand, target, koopaChance = 0.35) {
  let placed = 0;
  for (let c = startCol; c < endCol && placed < target; c += 3) {
    if (b.grid[7][c] !== "." || b.grid[ROWS - 2][c] !== "G") continue;
    b.set(7, c, rand() < koopaChance ? "k" : "g");
    placed++;
  }
  return placed;
}

function finishOverworldLevel(id, b, ROWS, COLS, blockContents, warpPipes, flagCol) {
  return {
    name: id,
    theme: "overworld",
    rows: b.grid.map((row) => row.join("")),
    ROWS,
    COLS,
    blockContents,
    pipeLeftCols: b.pipeLeftCols,
    warpPipes,
    flagRow: 4,
    flagCol,
    castleCol: flagCol + 3,
    entities: null,
  };
}

// World 1-1: the intro level. One mushroom, a warp pipe down to the
// underground bonus room, and a short staircase up to the flag.
function buildLevel1_1() {
  const ROWS = 10;
  const COLS = 120;
  const b = makeGridBuilder(ROWS, COLS);
  const blockContents = {};
  const warpPipes = {};
  const rand = mulberry32(11);

  b.setRange(ROWS - 2, 0, COLS - 1, "G");
  b.setRange(ROWS - 1, 0, COLS - 1, "G");
  // A pit right before the staircase acts as a barrier: patrolling enemies
  // turn around at its edge (same cliff-avoidance that stops them falling
  // in), so nothing can ever wander up onto the stairs while the player is
  // climbing them.
  pits(b, ROWS, [[30, 31], [80, 81], [98, 99]]);

  [8, 40, 70, 95].forEach((c) => b.set(1, c, "c"));
  [6, 25, 55, 85].forEach((c) => b.set(7, c, "H"));
  [14, 45, 75].forEach((c) => b.set(7, c, "b"));

  placeWarpPipe(b, warpPipes, 10, 6, 2);
  placeWarpPipe(b, warpPipes, 60, 6, 2);

  b.set(4, 16, "?");
  blockContents["16,4"] = "mushroom";
  b.set(4, 18, "?");
  b.set(4, 20, "?");

  scatterEnemies(b, ROWS, 22, 98, rand, 15);

  b.set(5, 2, "M");

  const afterStairs = b.addStaircase(101, 4, ROWS - 2);
  const flagCol = afterStairs + 2;
  b.set(4, flagCol, "F");

  return finishOverworldLevel("1-1", b, ROWS, COLS, blockContents, warpPipes, flagCol);
}

// Deterministic seeded RNG (mulberry32) so a given level's layout is
// stable across replays instead of reshuffling every time it's loaded.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORLDS_COUNT = 4;
const LEVELS_PER_WORLD = 8;
const POWERUP_CYCLE = ["mushroom", "star", "fireflower"];

// Procedurally builds every level except 1-1 (which is hand-authored above
// and owns the only warp pipe down to the underground bonus room). The
// level is divided into fixed-width segments after a safe starting zone;
// each segment gets exactly one feature, so hazards can never overlap by
// construction. Difficulty (level length, hazard density, enemy mix) scales
// with how far into the 32-level run this level is.
function buildGeneratedLevel(worldNum, levelNum) {
  const idx = (worldNum - 1) * LEVELS_PER_WORLD + levelNum; // 1..32
  const rand = mulberry32(worldNum * 1000 + levelNum * 37);
  const ROWS = 10;
  const startZone = 14;
  const endZone = 20; // reserved for staircase + gap + flag + castle
  const segW = 8;
  const numSegments = 14 + Math.min(16, Math.floor(idx / 2));
  const COLS = startZone + numSegments * segW + endZone;

  const b = makeGridBuilder(ROWS, COLS);
  const blockContents = {};
  const warpPipes = {};

  b.setRange(ROWS - 2, 0, COLS - 1, "G");
  b.setRange(ROWS - 1, 0, COLS - 1, "G");

  // Enemies are placed separately by scatterEnemies() below (densely, across
  // the whole level) - these segments only handle terrain/coin features.
  const featurePool = ["pit", "pipe", "coinblock", "pit", "pipe"];

  const powerupType = POWERUP_CYCLE[(idx - 1) % POWERUP_CYCLE.length];
  const giveOneUp = levelNum === LEVELS_PER_WORLD; // last level of each world

  for (let seg = 0; seg < numSegments; seg++) {
    const segStart = startZone + seg * segW;
    const center = segStart + Math.floor(segW / 2);

    if (seg === 0) {
      b.set(4, center, "?");
      blockContents[`${center},4`] = powerupType;
      continue;
    }
    if (giveOneUp && seg === numSegments - 1) {
      b.setRange(4, center - 1, center + 1, "B");
      b.set(4, center, "?");
      blockContents[`${center},4`] = "oneup";
      continue;
    }

    const choice = featurePool[Math.floor(rand() * featurePool.length)];
    if (choice === "pit") {
      // Pits widen in the back half of the campaign for an extra timing
      // challenge on top of the denser, faster enemies.
      const pitWidth = idx > 16 ? 3 : 2;
      for (let dc = 0; dc < pitWidth; dc++) {
        b.set(ROWS - 2, center + dc, ".");
        b.set(ROWS - 1, center + dc, ".");
      }
    } else if (choice === "pipe") {
      placeWarpPipe(b, warpPipes, center, ROWS - 4, 2);
    } else if (choice === "coinblock") {
      b.set(4, center, "?");
    }
  }

  b.set(5, 2, "M");

  const stairsStart = COLS - endZone + 2;
  // Enemies get first pick of the open ground; decor (purely cosmetic)
  // fills in whatever's left over so it never steals an enemy's spot.
  // Koopas (tougher - need a kick, not just a stomp, and can chain-kill)
  // become a bigger share of the mix as the campaign progresses.
  const koopaChance = Math.min(0.6, 0.2 + idx * 0.012);
  scatterEnemies(b, ROWS, 22, stairsStart - 4, rand, 15, koopaChance);

  for (let c = 4; c < COLS - 4; c += 6) {
    const r = rand();
    if (r < 0.25) b.set(1, c, "c");
    else if (r < 0.45 && b.grid[7][c] === ".") b.set(7, c, "H");
    else if (r < 0.55 && b.grid[7][c] === ".") b.set(7, c, "b");
  }

  // Barrier pit right before the stairs: patrolling enemies turn around at
  // its edge and can never wander onto the staircase.
  b.set(ROWS - 2, stairsStart - 3, ".");
  b.set(ROWS - 2, stairsStart - 2, ".");
  b.set(ROWS - 1, stairsStart - 3, ".");
  b.set(ROWS - 1, stairsStart - 2, ".");
  const afterStairs = b.addStaircase(stairsStart, 4, ROWS - 2);
  const flagCol = afterStairs + 2;
  b.set(4, flagCol, "F");

  const id = `${worldNum}-${levelNum}`;
  return finishOverworldLevel(id, b, ROWS, COLS, blockContents, warpPipes, flagCol);
}

function buildUnderground() {
  const ROWS = 8;
  const COLS = 16;
  const b = makeGridBuilder(ROWS, COLS);
  const blockContents = {};
  const warpPipes = {};

  b.setRange(0, 0, COLS - 1, "B"); // brick ceiling
  b.setRange(ROWS - 2, 0, COLS - 1, "G");
  b.setRange(ROWS - 1, 0, COLS - 1, "G");

  [3, 5, 7, 9, 11].forEach((c) => {
    b.set(3, c, "?");
    blockContents[`${c},3`] = "coin";
  });
  blockContents["9,3"] = "oneup";

  b.placePipe(13, ROWS - 4, 2);
  // Sends the player back to whichever level (and pipe) they entered from -
  // resolved dynamically at warp time via `pendingReturn`, since any pipe in
  // any level can now lead down here.
  warpPipes[`13,${ROWS - 4}`] = { toWorld: "RETURN", spawn: null };

  return {
    name: "underground",
    theme: "underground",
    rows: b.grid.map((row) => row.join("")),
    ROWS,
    COLS,
    blockContents,
    pipeLeftCols: b.pipeLeftCols,
    warpPipes,
    flagRow: -1,
    flagCol: -1,
    entities: null,
  };
}

const WORLD_REGISTRY = {}; // populated by initWorlds(): name -> world object
const LEVEL_ORDER = [];
for (let w = 1; w <= WORLDS_COUNT; w++) {
  for (let l = 1; l <= LEVELS_PER_WORLD; l++) {
    LEVEL_ORDER.push(`${w}-${l}`);
  }
}
let levelIndex = 0; // index into LEVEL_ORDER for the level currently being played
let world; // active world
let ROWS, COLS, LEVEL_ROWS, LEVEL_PIXEL_WIDTH, LEVEL_PIXEL_HEIGHT;

function initWorlds() {
  WORLD_REGISTRY["1-1"] = buildLevel1_1();
  for (const id of LEVEL_ORDER) {
    if (id === "1-1") continue;
    const [w, l] = id.split("-").map(Number);
    WORLD_REGISTRY[id] = buildGeneratedLevel(w, l);
  }
  WORLD_REGISTRY.underground = buildUnderground();
}

function applyWorld(w) {
  world = w;
  ROWS = w.ROWS;
  COLS = w.COLS;
  LEVEL_ROWS = w.rows;
  LEVEL_PIXEL_WIDTH = COLS * TILE;
  LEVEL_PIXEL_HEIGHT = ROWS * TILE;
}

initWorlds();
applyWorld(WORLD_REGISTRY[LEVEL_ORDER[0]]);

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

const scoreEl = document.getElementById("score");
const coinsEl = document.getElementById("coins");
const worldEl = document.getElementById("world");
const timeEl = document.getElementById("time");
const livesEl = document.getElementById("lives");

const titleScreen = document.getElementById("title-screen");
const pauseScreen = document.getElementById("pause-screen");
const gameOverScreen = document.getElementById("game-over-screen");
const soundBtn = document.getElementById("sound-btn");
const fullscreenBtn = document.getElementById("fullscreen-btn");

// ---------- Simple sound engine (Web Audio beeps, no external files) ----------
let audioCtx = null;
let soundOn = true;
function beep(freq, dur, type = "square", vol = 0.08) {
  if (!soundOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.stop(audioCtx.currentTime + dur);
  } catch (e) {
    /* audio unavailable; ignore */
  }
}
const sfx = {
  jump: () => beep(520, 0.15, "square"),
  coin: () => beep(988, 0.12, "square"),
  stomp: () => beep(180, 0.12, "square"),
  bump: () => beep(140, 0.08, "square"),
  die: () => beep(90, 0.5, "sawtooth"),
  win: () => beep(660, 0.4, "triangle"),
  powerup: () => {
    beep(523, 0.09, "square");
    setTimeout(() => beep(659, 0.09, "square"), 90);
    setTimeout(() => beep(784, 0.15, "square"), 180);
  },
  star: () => {
    beep(660, 0.07, "square");
    setTimeout(() => beep(880, 0.07, "square"), 70);
    setTimeout(() => beep(1046, 0.1, "square"), 140);
  },
  fire: () => beep(900, 0.06, "triangle", 0.07),
  shrink: () => beep(200, 0.3, "sawtooth"),
  break: () => beep(160, 0.1, "square"),
  oneup: () => {
    beep(784, 0.08, "square");
    setTimeout(() => beep(988, 0.08, "square"), 80);
    setTimeout(() => beep(1318, 0.16, "square"), 160);
  },
  warp: () => {
    beep(440, 0.08, "sine");
    setTimeout(() => beep(220, 0.15, "sine"), 80);
  },
};

// ---------- Input ----------
const keys = {};
let wantShoot = false;
window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "Enter") {
    if (state === "title") startGame();
    else if (state === "gameover") startGame();
  }
  if (e.code === "KeyP") togglePause();
  if (e.code === "KeyM") toggleSound();
  if (e.code === "KeyQ" || e.code === "KeyE" || e.code === "ControlLeft" || e.code === "ControlRight" || e.code === "KeyX") wantShoot = true;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => (keys[e.code] = false));

titleScreen.addEventListener("click", () => {
  if (state === "title") startGame();
});
gameOverScreen.addEventListener("click", () => {
  if (state === "gameover") startGame();
});
soundBtn.addEventListener("click", toggleSound);
fullscreenBtn.addEventListener("click", () => {
  const wrap = document.getElementById("canvas-container");
  if (!document.fullscreenElement) wrap.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
});

function toggleSound() {
  soundOn = !soundOn;
  soundBtn.textContent = soundOn ? "🔊 SOUND: ON" : "🔇 SOUND: OFF";
}

function togglePause() {
  if (state === "playing") {
    state = "paused";
    pauseScreen.classList.remove("hidden");
  } else if (state === "paused") {
    state = "playing";
    pauseScreen.classList.add("hidden");
    lastTime = performance.now();
  }
}

// ---------- Game state ----------
let state = "title"; // title | playing | paused | gameover | win
let score = 0;
let coins = 0;
let lives = 3;
let timeLeft = 400;
let timeAccum = 0;
let lastTime = 0;
let camX = 0;

const PLAYER_W = 24;
const PLAYER_SMALL_H = 30; // Mario always stays this size - power-ups change form, not height
const KOOPA_WALK_H = 36;
const KOOPA_SHELL_H = 24;

let player, goombas, koopas, blocks, particles, powerups, fireballs, textPops;
let warpCooldown = 0;
let pendingReturn = { toWorld: "1-1", spawn: { x: 63 * TILE, y: 5 * TILE } }; // fallback if underground is ever entered without a pipe (shouldn't happen)

// Scans a world's tile grid and builds fresh dynamic entity arrays for it
// (blocks, goombas, koopas, spawn point). Called once per world the first
// time it's entered; the resulting arrays are cached on the world object so
// that progress (broken blocks, defeated enemies) survives repeated warps.
function populateEntities(w) {
  const blocksArr = [];
  const goombasArr = [];
  const koopasArr = [];
  let spawn = { x: 2 * TILE, y: 5 * TILE };

  for (let r = 0; r < w.ROWS; r++) {
    const row = w.rows[r];
    for (let c = 0; c < w.COLS; c++) {
      const ch = row[c];
      const x = c * TILE;
      const y = r * TILE;
      if (ch === "?" || ch === "B") {
        const content = ch === "?" ? w.blockContents[`${c},${r}`] || "coin" : null;
        blocksArr.push({ x, y, type: ch, hit: false, bumpT: 0, content });
      } else if (ch === "g") {
        goombasArr.push({
          x, y: y - 8, w: 28, h: 28, vx: -40, vy: 0, alive: true, squashT: 0,
        });
      } else if (ch === "k") {
        koopasArr.push({
          x, y: y - 16, w: 26, h: 36, vx: -35, vy: 0, alive: true, squashT: 0,
          state: "walking", shellTimer: 0,
        });
      } else if (ch === "M") {
        spawn = { x, y };
      }
    }
  }

  return { blocks: blocksArr, goombas: goombasArr, koopas: koopasArr, spawn };
}

function newPlayerAt(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    w: PLAYER_W,
    h: PLAYER_SMALL_H,
    vx: 0,
    vy: 0,
    onGround: false,
    facing: 1,
    running: false,
    dead: false,
    invuln: 0,
    animT: 0,
    won: false,
    form: "small", // small | big | fire
    starT: 0,
    fireCooldown: 0,
  };
}

// Loads LEVEL_ORDER[levelIndex] fresh (undoing any broken blocks / defeated
// enemies from a previous attempt) and makes it the active world. Returns
// the level's spawn point; does not touch the player object itself, so
// callers can decide whether to reset the player or carry state forward.
function loadCurrentLevel() {
  const id = LEVEL_ORDER[levelIndex];
  const lvl = WORLD_REGISTRY[id];
  lvl.entities = null;
  applyWorld(lvl);
  const ent = populateEntities(world);
  world.entities = { blocks: ent.blocks, goombas: ent.goombas, koopas: ent.koopas };
  blocks = ent.blocks;
  goombas = ent.goombas;
  koopas = ent.koopas;
  particles = [];
  powerups = [];
  fireballs = [];
  textPops = [];
  warpCooldown = 0;
  camX = 0;
  worldEl.textContent = id;
  return ent.spawn;
}

function buildLevel() {
  // Fresh run / respawn: reload the current level and reset the player.
  const spawn = loadCurrentLevel();
  player = newPlayerAt(spawn);
}

function advanceToNextLevel() {
  levelIndex++;
  const spawn = loadCurrentLevel();
  const keptForm = player.form;
  player = newPlayerAt(spawn);
  player.form = keptForm;
  timeLeft = 400;
  timeAccum = 0;
  state = "playing";
}

function warpTo(targetWorldName, spawn) {
  // Save the current world's live entity arrays so state persists.
  world.entities = { blocks, goombas, koopas };

  const target = WORLD_REGISTRY[targetWorldName];
  if (!target.entities) {
    const ent = populateEntities(target);
    target.entities = { blocks: ent.blocks, goombas: ent.goombas, koopas: ent.koopas };
  }
  applyWorld(target);
  blocks = target.entities.blocks;
  goombas = target.entities.goombas;
  koopas = target.entities.koopas;
  if (LEVEL_ORDER.includes(target.name)) worldEl.textContent = target.name;

  powerups = [];
  fireballs = [];
  particles = [];
  textPops = [];

  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.onGround = false;
  camX = 0;
  warpCooldown = 0.6;
  sfx.warp();
}

function shrinkPlayer() {
  if (player.form === "small") {
    loseLife();
    return;
  }
  player.form = "small";
  player.invuln = 1.5;
  sfx.shrink();
}

function growPlayer(newForm, b) {
  if (player.form === "small") {
    // A fire flower picked up from Small goes straight to Fire (skipping
    // Big) so the pickup always has a visible, guaranteed payoff. Mario
    // stays the same one-block size either way - only the form (and what
    // it lets you do) changes.
    player.form = newForm;
    sfx.powerup();
    const isFire = newForm === "fire";
    spawnTextPop(b.x, b.y - TILE, isFire ? "FIRE POWER!" : "MUSHROOM!", isFire ? "#ff5a3c" : "#ffd400");
  } else if (newForm === "fire" && player.form !== "fire") {
    player.form = "fire";
    sfx.powerup();
    spawnTextPop(b.x, b.y - TILE, "FIRE POWER!", "#ff5a3c");
  } else {
    score += 1000;
    sfx.coin();
    spawnTextPop(b.x, b.y - TILE, "+1000", "#ffd400");
  }
}

function spawnTextPop(x, y, text, color) {
  textPops.push({ x, y, text, color, t: 0 });
}

function tileAt(col, row) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return ".";
  return LEVEL_ROWS[row][col];
}

function isSolidTile(ch) {
  return ch === "G" || ch === "B" || ch === "?" || ch === "P" || ch === "p";
}

// Shared ground-patrol step for goombas and walking koopas: looks at the
// leading edge of where the step WOULD land before committing to it, and
// turns around in place (without moving into a wall, or off a ledge when
// avoidLedges is true) rather than moving first and reacting after.
function patrolStep(e, dt, avoidLedges) {
  const nextX = e.x + e.vx * dt;
  const leadCol = Math.floor((e.vx > 0 ? nextX + e.w : nextX) / TILE);
  const bodyRow = Math.floor(e.y / TILE);
  let blocked = isSolidTile(tileAt(leadCol, bodyRow));
  if (!blocked && avoidLedges) {
    const footRow = Math.floor((e.y + e.h + 1) / TILE);
    blocked = !isSolidTile(tileAt(leadCol, footRow));
  }
  if (blocked) {
    e.vx *= -1;
  } else {
    e.x = nextX;
  }
}

function startGame() {
  score = 0;
  coins = 0;
  lives = 3;
  timeLeft = 400;
  levelIndex = 0;
  buildLevel();
  state = "playing";
  titleScreen.classList.add("hidden");
  gameOverScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  lastTime = performance.now();
}

function loseLife() {
  if (player.dead) return;
  player.dead = true;
  sfx.die();
  player.vy = -400;
  setTimeout(() => {
    lives--;
    if (lives <= 0) {
      state = "gameover";
      gameOverScreen.classList.remove("hidden");
    } else {
      buildLevel();
      timeLeft = 400;
      state = "playing";
    }
  }, 900);
}

// ---------- Physics constants ----------
const GRAVITY = 1600;
const MOVE_ACCEL = 900;
const MAX_RUN = 260;
const MAX_WALK = 160;
const FRICTION = 1200;
const JUMP_VELOCITY = -520;

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function update(dt) {
  if (state !== "playing") return;

  timeAccum += dt;
  if (timeAccum >= 1) {
    timeAccum -= 1;
    timeLeft = Math.max(0, timeLeft - 1);
    if (timeLeft === 0 && !player.dead) loseLife();
  }

  if (!player.dead && !player.won) {
    const left = keys["ArrowLeft"] || keys["KeyA"];
    const right = keys["ArrowRight"] || keys["KeyD"];
    const running = keys["ShiftLeft"] || keys["ShiftRight"];
    const maxSpeed = running ? MAX_RUN : MAX_WALK;

    if (left && !right) {
      player.vx -= MOVE_ACCEL * dt;
      player.facing = -1;
    } else if (right && !left) {
      player.vx += MOVE_ACCEL * dt;
      player.facing = 1;
    } else {
      const decel = FRICTION * dt;
      if (player.vx > 0) player.vx = Math.max(0, player.vx - decel);
      else if (player.vx < 0) player.vx = Math.min(0, player.vx + decel);
    }
    player.vx = Math.max(-maxSpeed, Math.min(maxSpeed, player.vx));

    const jumpPressed = keys["Space"] || keys["ArrowUp"] || keys["KeyW"];
    if (jumpPressed && player.onGround) {
      player.vy = JUMP_VELOCITY;
      player.onGround = false;
      sfx.jump();
    }

    player.animT += dt;
  }

  player.vy += GRAVITY * dt;
  if (player.vy > 900) player.vy = 900;

  // Horizontal movement + collision
  player.x += player.vx * dt;
  player.x = Math.max(0, Math.min(LEVEL_PIXEL_WIDTH - player.w, player.x));
  resolveTileCollisions(player, "x");

  // Vertical movement + collision
  const vyBeforeCollision = player.vy;
  player.y += player.vy * dt;
  player.onGround = false;
  resolveTileCollisions(player, "y");

  if (player.y > LEVEL_PIXEL_HEIGHT + 100 && !player.dead) {
    loseLife();
  }

  // Warp pipes: standing on a marked pipe top and pressing Down enters it.
  if (warpCooldown > 0) warpCooldown -= dt;
  if (!player.dead && player.onGround && warpCooldown <= 0 && (keys["ArrowDown"] || keys["KeyS"])) {
    const feetRow = Math.round((player.y + player.h) / TILE);
    const colA = Math.floor(player.x / TILE);
    const colB = colA - 1;
    const pipeCol = world.pipeLeftCols.has(colA) ? colA : world.pipeLeftCols.has(colB) ? colB : null;
    const pipe = pipeCol !== null ? world.warpPipes[`${pipeCol},${feetRow}`] : null;
    if (pipe) {
      if (pipe.toWorld === "RETURN") {
        warpTo(pendingReturn.toWorld, pendingReturn.spawn);
      } else {
        // Remember exactly where to send the player back to before leaving,
        // so the underground room's single exit pipe can return them to
        // whichever level (and pipe) they actually entered from.
        pendingReturn = { toWorld: world.name, spawn: { x: (pipeCol + 3) * TILE, y: 5 * TILE } };
        warpTo(pipe.toWorld, pipe.spawn);
      }
    }
  }

  // Blocks bump animation
  for (const b of blocks) {
    if (b.bumpT > 0) {
      b.bumpT -= dt;
      if (b.bumpT < 0) b.bumpT = 0;
    }
  }

  // Player vs blocks (hit from below). resolveTileCollisions() already
  // snaps player.y to exactly (b.y + TILE) and zeroes player.vy when the
  // player's head hits a block's underside, so we must use the
  // pre-collision velocity to detect an upward hit, not the now-zeroed one.
  // The snapped position is flush against the block (touching, not
  // overlapping), so rectsOverlap's strict inequalities would miss it —
  // check the x-range instead.
  if (!player.dead) {
    for (const b of blocks) {
      const hitsFromBelow = vyBeforeCollision < 0 && Math.abs(player.y - (b.y + TILE)) < 1;
      const overlapsX = player.x < b.x + TILE && player.x + player.w > b.x;
      if (!hitsFromBelow || !overlapsX) continue;
      player.vy = 40;
      player.y = b.y + TILE;

      if (b.type === "B") {
        if (player.form !== "small") {
          blocks.splice(blocks.indexOf(b), 1);
          score += 50;
          sfx.break();
          spawnBrickDebris(b.x, b.y);
        } else {
          b.bumpT = 0.2;
          sfx.bump();
        }
        continue;
      }

      // '?' block
      if (b.hit) {
        b.bumpT = 0.2;
        sfx.bump();
        continue;
      }
      b.hit = true;
      b.bumpT = 0.2;
      if (b.content === "coin") {
        coins++;
        score += 200;
        sfx.coin();
        spawnCoinPop(b.x, b.y);
      } else {
        spawnPowerup(b);
      }
    }
  }

  // Goombas
  for (const g of goombas) {
    if (!g.alive) {
      g.squashT -= dt;
      continue;
    }
    g.vy += GRAVITY * dt;
    patrolStep(g, dt, true);

    g.y += g.vy * dt;
    const gObj = { x: g.x, y: g.y, w: g.w, h: g.h, vy: g.vy };
    resolveTileCollisions(gObj, "y");
    g.y = gObj.y;
    g.vy = gObj.vy;

    if (!player.dead && rectsOverlap(player, g)) {
      if (player.starT > 0) {
        g.alive = false;
        g.squashT = 0.3;
        score += 100;
        sfx.stomp();
      } else if (player.invuln <= 0) {
        const stomp = player.vy > 0 && player.y + player.h - g.y < 18;
        if (stomp) {
          g.alive = false;
          g.squashT = 0.3;
          player.vy = JUMP_VELOCITY * 0.6;
          score += 100;
          sfx.stomp();
        } else {
          shrinkPlayer();
        }
      }
    }
  }
  goombas = goombas.filter((g) => g.alive || g.squashT > -0.01);

  // Koopas: walking -> (stomped) -> stationary shell -> (kicked) -> sliding
  // shell that defeats anything else it touches, until it's stomped again
  // (stops it) or it falls into a pit. A stationary shell wakes back up
  // after a while, matching classic behavior.
  for (const k of koopas) {
    if (!k.alive) {
      k.squashT -= dt;
      continue;
    }
    k.vy += GRAVITY * dt;
    if (k.state === "walking") patrolStep(k, dt, true);
    else if (k.state === "sliding") patrolStep(k, dt, false);

    k.y += k.vy * dt;
    const kObj = { x: k.x, y: k.y, w: k.w, h: k.h, vy: k.vy };
    resolveTileCollisions(kObj, "y");
    k.y = kObj.y;
    k.vy = kObj.vy;

    if (k.y > LEVEL_PIXEL_HEIGHT + 100) {
      k.alive = false;
      k.squashT = -1;
      continue;
    }

    if (k.state === "shell") {
      k.shellTimer -= dt;
      if (k.shellTimer <= 0) {
        k.state = "walking";
        k.h = KOOPA_WALK_H;
        k.y -= KOOPA_WALK_H - KOOPA_SHELL_H;
        k.vx = -35;
      }
    }

    if (k.state === "sliding") {
      for (const g of goombas) {
        if (g.alive && rectsOverlap(k, g)) {
          g.alive = false;
          g.squashT = 0.3;
          score += 100;
          sfx.stomp();
        }
      }
      for (const other of koopas) {
        if (other !== k && other.alive && other.state !== "sliding" && rectsOverlap(k, other)) {
          other.alive = false;
          other.squashT = 0.3;
          score += 100;
          sfx.stomp();
        }
      }
    }

    if (!player.dead && rectsOverlap(player, k)) {
      if (player.starT > 0) {
        k.alive = false;
        k.squashT = 0.3;
        score += 100;
        sfx.stomp();
      } else if (player.invuln <= 0) {
        const stompHit = player.vy > 0 && player.y + player.h - k.y < 18;
        if (k.state === "walking") {
          if (stompHit) {
            k.state = "shell";
            k.vx = 0;
            k.h = KOOPA_SHELL_H;
            k.y += KOOPA_WALK_H - KOOPA_SHELL_H;
            k.shellTimer = 8;
            player.vy = JUMP_VELOCITY * 0.6;
            score += 100;
            sfx.stomp();
          } else {
            shrinkPlayer();
          }
        } else if (k.state === "shell") {
          if (stompHit) {
            player.vy = JUMP_VELOCITY * 0.6;
            score += 50;
            sfx.bump();
          } else {
            k.state = "sliding";
            k.vx = (player.x < k.x ? 1 : -1) * 260;
            sfx.stomp();
          }
        } else if (k.state === "sliding") {
          if (stompHit) {
            k.state = "shell";
            k.vx = 0;
            k.shellTimer = 8;
            player.vy = JUMP_VELOCITY * 0.6;
            score += 100;
            sfx.stomp();
          } else {
            shrinkPlayer();
          }
        }
      }
    }
  }
  koopas = koopas.filter((k) => k.alive || k.squashT > -0.01);

  if (player.invuln > 0) player.invuln -= dt;
  if (player.starT > 0) player.starT -= dt;

  // ---------- Powerups ----------
  // All power-ups fall to the ground under gravity so they're easy to see
  // and grab. Unlike goombas, they deliberately do NOT turn around at
  // ledges — they're meant to walk off their single-tile spawn block and
  // drop to true floor level, only bouncing back off actual solid walls.
  for (const p of powerups) {
    p.vy += GRAVITY * dt;
    if (p.vx !== 0) {
      const nextX = p.x + p.vx * dt;
      const leadCol = Math.floor((p.vx > 0 ? nextX + p.w : nextX) / TILE);
      const midRow = Math.floor(p.y / TILE);
      if (isSolidTile(tileAt(leadCol, midRow))) {
        p.vx *= -1;
      } else {
        p.x = nextX;
      }
    }

    p.y += p.vy * dt;
    resolveTileCollisions(p, "y");

    if (p.type === "star" && p.vy === 0) p.vy = -340; // keep bouncing once grounded, but catchable
  }

  for (const p of powerups) {
    if (!rectsOverlap(player, p)) continue;
    if (p.type === "mushroom") growPlayer("big", p);
    else if (p.type === "fireflower") growPlayer("fire", p);
    else if (p.type === "star") {
      player.starT = 10;
      sfx.star();
      spawnTextPop(p.x, p.y - TILE, "STAR POWER!", "#ffe14d");
    } else if (p.type === "oneup") {
      lives++;
      sfx.oneup();
      spawnTextPop(p.x, p.y - TILE, "1-UP!", "#3fe23f");
    }
    p.collected = true;
  }
  powerups = powerups.filter((p) => !p.collected && p.y < LEVEL_PIXEL_HEIGHT + 100);

  // ---------- Fireballs ----------
  // No cap on how many are on screen and (almost) no cooldown - shoot as
  // much as you want.
  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if (wantShoot && player.form === "fire" && player.fireCooldown <= 0) {
    fireballs.push({
      x: player.x + (player.facing > 0 ? player.w : -10),
      y: player.y + player.h / 2 - 5,
      vx: 380 * player.facing,
      vy: 0,
      w: 10,
      h: 10,
      t: 0,
    });
    player.fireCooldown = 0.08;
    sfx.fire();
  }
  wantShoot = false;

  for (const f of fireballs) {
    // Straight shot: no gravity, no bounce - just travels in a flat line.
    f.x += f.vx * dt;
    f.t += dt;
    const sideCol = Math.floor((f.x + (f.vx > 0 ? f.w : 0)) / TILE);
    const midRow = Math.floor((f.y + f.h / 2) / TILE);
    if (isSolidTile(tileAt(sideCol, midRow))) f.dead = true;
    for (const g of goombas) {
      if (g.alive && rectsOverlap(f, g)) {
        g.alive = false;
        g.squashT = 0.3;
        score += 100;
        sfx.stomp();
        f.dead = true;
      }
    }
    for (const k of koopas) {
      if (k.alive && rectsOverlap(f, k)) {
        k.alive = false;
        k.squashT = 0.3;
        score += 100;
        sfx.stomp();
        f.dead = true;
      }
    }
    if (f.t > 3 || f.x < camX - 100 || f.x > camX + VIEW_W + 100) f.dead = true;
  }
  fireballs = fireballs.filter((f) => !f.dead);

  // ---------- Text pops ----------
  for (const tp of textPops) {
    tp.t += dt;
    tp.y -= 20 * dt;
  }
  textPops = textPops.filter((tp) => tp.t < 1.2);

  // Particles (coin pop / brick debris)
  for (const p of particles) {
    p.t += dt;
    p.y += p.vy * dt;
    p.vy += 700 * dt;
    if (p.vx) p.x += p.vx * dt;
  }
  particles = particles.filter((p) => p.t < (p.kind === "debris" ? 0.9 : 0.6));

  // Win condition: reach flag column. Every level but the last advances to
  // the next one; the last shows the final "course clear" overlay.
  const flagCol = world.flagCol;
  if (flagCol > -1 && player.x > flagCol * TILE && !player.won && !player.dead) {
    player.won = true;
    player.vx = 0;
    score += 1000;
    sfx.win();
    setTimeout(() => {
      if (levelIndex + 1 < LEVEL_ORDER.length) {
        advanceToNextLevel();
      } else {
        state = "win";
        showWinOverlay();
      }
    }, 600);
  }

  camX = Math.max(0, Math.min(LEVEL_PIXEL_WIDTH - VIEW_W, player.x + player.w / 2 - VIEW_W / 2));

  scoreEl.textContent = String(score).padStart(6, "0");
  coinsEl.textContent = String(coins).padStart(2, "0");
  timeEl.textContent = String(timeLeft);
  livesEl.textContent = String(lives);
}

function spawnCoinPop(x, y) {
  particles.push({ x: x + TILE / 2 - 6, y: y - 4, vy: -260, t: 0, kind: "coin" });
}

function spawnPowerup(b) {
  const type = b.content;
  const w = 26;
  const h = 26;
  powerups.push({
    type,
    x: b.x + (TILE - w) / 2,
    y: b.y - h,
    w,
    h,
    vx: 70, // all power-ups walk off their spawn block so they reach true ground level
    vy: 0,
    onGround: false,
  });
}

function spawnBrickDebris(x, y) {
  for (let i = 0; i < 4; i++) {
    particles.push({
      x: x + TILE / 2 - 4,
      y: y + TILE / 2 - 4,
      vy: -300 - Math.random() * 100,
      vx: (i < 2 ? -1 : 1) * (80 + Math.random() * 80),
      t: 0,
      kind: "debris",
    });
  }
}

function showWinOverlay() {
  gameOverScreen.classList.remove("hidden");
  gameOverScreen.querySelector(".go-text").textContent = "COURSE CLEAR!";
  gameOverScreen.querySelector(".go-hint").textContent = "Press ENTER to play again";
  state = "gameover-win";
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Enter" && state === "gameover-win") {
    gameOverScreen.querySelector(".go-text").textContent = "GAME OVER";
    gameOverScreen.querySelector(".go-hint").textContent = "Press ENTER to restart";
    startGame();
  }
});

function resolveTileCollisions(entity, axis) {
  const left = Math.floor(entity.x / TILE);
  const right = Math.floor((entity.x + entity.w - 1) / TILE);
  const top = Math.floor(entity.y / TILE);
  const bottom = Math.floor((entity.y + entity.h - 1) / TILE);

  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      const ch = tileAt(c, r);
      if (!isSolidTile(ch)) continue;
      const tileRect = { x: c * TILE, y: r * TILE, w: TILE, h: TILE };
      if (!rectsOverlap(entity, tileRect)) continue;

      if (axis === "x") {
        if (entity.vx === undefined) continue;
        if (entity.x + entity.w / 2 < tileRect.x + TILE / 2) {
          entity.x = tileRect.x - entity.w;
        } else {
          entity.x = tileRect.x + TILE;
        }
        if ("vx" in entity) entity.vx = 0;
      } else {
        if (entity.y + entity.h / 2 < tileRect.y + TILE / 2) {
          entity.y = tileRect.y - entity.h;
          entity.vy = 0;
          if ("onGround" in entity) entity.onGround = true;
        } else {
          entity.y = tileRect.y + TILE;
          entity.vy = 0;
        }
      }
    }
  }
}

// ---------- Rendering ----------
function draw() {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = world.theme === "underground" ? "#0c0c1a" : "#6b8cff";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.save();
  ctx.translate(-camX, 0);

  drawBackground();
  drawTiles();
  drawCastle();
  drawBlocks();
  drawFlag();
  drawParticles();
  for (const p of powerups) drawPowerup(p);
  for (const g of goombas) drawGoomba(g);
  for (const k of koopas) drawKoopa(k);
  for (const f of fireballs) drawFireball(f);
  if (!(state === "title")) drawPlayer();
  drawTextPops();

  ctx.restore();

  drawFireworks(); // screen-space, drawn after ctx.restore() so it isn't affected by camera scroll
}

function drawBackground() {
  // clouds
  ctx.fillStyle = "#ffffff";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (LEVEL_ROWS[r][c] === "c") drawCloud(c * TILE - 16, r * TILE);
    }
  }
  // hills
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (LEVEL_ROWS[r][c] === "H") drawHill(c * TILE, (ROWS - 2) * TILE);
      if (LEVEL_ROWS[r][c] === "b") drawBush(c * TILE, (ROWS - 2) * TILE);
    }
  }
}

function drawCloud(x, y) {
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(x + 10, y + 14, 16, 11, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 26, y + 8, 14, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 42, y + 14, 16, 11, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHill(x, baseY) {
  ctx.fillStyle = "#3fae2a";
  ctx.beginPath();
  ctx.moveTo(x - 40, baseY + TILE);
  ctx.lineTo(x + 30, baseY - 40);
  ctx.lineTo(x + 100, baseY + TILE);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#2f8f1f";
  ctx.beginPath();
  ctx.moveTo(x - 10, baseY + TILE);
  ctx.lineTo(x + 30, baseY - 15);
  ctx.lineTo(x + 70, baseY + TILE);
  ctx.closePath();
  ctx.fill();
}

function drawBush(x, baseY) {
  ctx.fillStyle = "#3fae2a";
  ctx.beginPath();
  ctx.ellipse(x + 10, baseY + TILE - 8, 14, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 26, baseY + TILE - 12, 16, 14, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 42, baseY + TILE - 8, 14, 12, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTiles() {
  const startCol = Math.max(0, Math.floor(camX / TILE) - 1);
  const endCol = Math.min(COLS - 1, Math.ceil((camX + VIEW_W) / TILE) + 1);
  for (let r = 0; r < ROWS; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const ch = LEVEL_ROWS[r][c];
      const x = c * TILE;
      const y = r * TILE;
      if (ch === "G") drawGroundTile(x, y);
      else if (ch === "p" && world.pipeLeftCols.has(c)) {
        const isTop = r === 0 || LEVEL_ROWS[r - 1][c] !== "p";
        drawPipeSegment(x, y, isTop);
      }
    }
  }
}

function drawGroundTile(x, y) {
  ctx.fillStyle = "#c04b1a";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.strokeStyle = "#7a2c0c";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
  ctx.fillStyle = "#a53e14";
  ctx.fillRect(x + 4, y + 6, 10, 6);
  ctx.fillRect(x + 18, y + 20, 10, 6);
}

function drawPipeSegment(x, y, isTop) {
  const w = TILE * 2;
  ctx.fillStyle = "#2f9e3f";
  ctx.strokeStyle = "#1c6b28";
  ctx.lineWidth = 2;
  if (isTop) {
    const capH = 12;
    ctx.fillRect(x - 4, y, w + 8, capH);
    ctx.strokeRect(x - 3, y + 1, w + 6, capH - 2);
    ctx.fillRect(x, y + capH, w, TILE - capH);
    ctx.strokeRect(x + 1, y + capH, w - 2, TILE - capH - 1);
    ctx.fillStyle = "#4fc766";
    ctx.fillRect(x - 2, y + 2, 6, capH - 4);
  } else {
    ctx.fillRect(x, y, w, TILE);
    ctx.strokeRect(x + 1, y + 1, w - 2, TILE - 2);
    ctx.fillStyle = "#4fc766";
    ctx.fillRect(x + 2, y, 6, TILE);
  }
}

function drawBlocks() {
  for (const b of blocks) {
    const bump = b.bumpT > 0 ? -6 * (b.bumpT / 0.2) : 0;
    const x = b.x;
    const y = b.y + bump;
    if (b.type === "?") {
      ctx.fillStyle = b.hit ? "#8a5a2b" : "#f2a91d";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = "#5b3a10";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
      if (!b.hit) {
        ctx.fillStyle = "#fff8e0";
        ctx.font = "bold 18px monospace";
        ctx.textAlign = "center";
        ctx.fillText("?", x + TILE / 2, y + TILE / 2 + 7);
      }
    } else if (b.type === "B") {
      ctx.fillStyle = "#b5471f";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = "#6e2a10";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
      ctx.beginPath();
      ctx.moveTo(x, y + TILE / 2);
      ctx.lineTo(x + TILE, y + TILE / 2);
      ctx.moveTo(x + TILE / 2, y);
      ctx.lineTo(x + TILE / 2, y + TILE / 2);
      ctx.moveTo(x + TILE / 4, y + TILE / 2);
      ctx.lineTo(x + TILE / 4, y + TILE);
      ctx.moveTo(x + (3 * TILE) / 4, y + TILE / 2);
      ctx.lineTo(x + (3 * TILE) / 4, y + TILE);
      ctx.stroke();
    }
  }
}

function drawFlag() {
  const flagRow = world.flagRow;
  const flagCol = world.flagCol;
  if (flagCol === -1) return;
  const x = flagCol * TILE + TILE / 2;
  const topY = flagRow * TILE;
  const groundY = (ROWS - 2) * TILE;
  ctx.strokeStyle = "#cfcfcf";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x, groundY);
  ctx.stroke();
  ctx.fillStyle = "#3fae2a";
  ctx.beginPath();
  ctx.moveTo(x, topY + 6);
  ctx.lineTo(x + 24, topY + 14);
  ctx.lineTo(x, topY + 22);
  ctx.closePath();
  ctx.fill();
}

function drawCastle() {
  const col = world.castleCol;
  if (col === undefined || col < 0) return;
  const groundY = (ROWS - 2) * TILE;
  const x = col * TILE;
  const bodyW = TILE * 4;
  const bodyH = TILE * 2.5;
  const bodyY = groundY - bodyH;
  const brick = "#9a9a9a";
  const brickDark = "#6c6c6c";
  const towerW = TILE;
  const towerH = TILE * 1;

  ctx.fillStyle = brick;
  ctx.fillRect(x, bodyY, bodyW, bodyH);
  ctx.strokeStyle = brickDark;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, bodyY + 1, bodyW - 2, bodyH - 2);

  // side towers, taller than the main body
  [x - towerW * 0.3, x + bodyW - towerW * 0.7].forEach((tx) => {
    ctx.fillStyle = brick;
    ctx.fillRect(tx, bodyY - towerH, towerW, towerH + bodyH);
    ctx.strokeRect(tx + 1, bodyY - towerH + 1, towerW - 2, towerH + bodyH - 2);
    // crenellations
    ctx.fillStyle = brickDark;
    for (let i = 0; i < 3; i++) {
      if (i % 2 === 0) ctx.fillRect(tx + i * (towerW / 3), bodyY - towerH, towerW / 3 - 2, 6);
    }
  });

  // main body crenellations
  ctx.fillStyle = brickDark;
  for (let i = 0; i < 5; i++) {
    if (i % 2 === 0) ctx.fillRect(x + i * (bodyW / 5), bodyY, bodyW / 5 - 2, 6);
  }

  // door
  ctx.fillStyle = "#2b1608";
  const doorW = TILE * 0.7;
  const doorH = TILE * 1.1;
  ctx.beginPath();
  ctx.arc(x + bodyW / 2, bodyY + bodyH - doorH, doorW / 2, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x + bodyW / 2 - doorW / 2, bodyY + bodyH - doorH, doorW, doorH);

  // flag on the center tower
  ctx.strokeStyle = brickDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + bodyW / 2, bodyY - towerH - 14);
  ctx.lineTo(x + bodyW / 2, bodyY - towerH);
  ctx.stroke();
  ctx.fillStyle = "#e2382c";
  ctx.beginPath();
  ctx.moveTo(x + bodyW / 2, bodyY - towerH - 14);
  ctx.lineTo(x + bodyW / 2 + 14, bodyY - towerH - 9);
  ctx.lineTo(x + bodyW / 2, bodyY - towerH - 4);
  ctx.closePath();
  ctx.fill();
}

function drawParticles() {
  for (const p of particles) {
    if (p.kind === "debris") {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.9);
      ctx.fillStyle = "#b5471f";
      ctx.fillRect(p.x, p.y, 8, 8);
    } else {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.6);
      ctx.fillStyle = "#ffd400";
      ctx.beginPath();
      ctx.arc(p.x + 6, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawPowerup(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.type === "mushroom" || p.type === "oneup") {
    const capColor = p.type === "oneup" ? "#3fae2a" : "#e2382c";
    ctx.fillStyle = capColor;
    ctx.beginPath();
    ctx.arc(p.w / 2, p.h / 2, p.w / 2, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#fff8e0";
    ctx.fillRect(2, p.h / 2, p.w - 4, p.h / 2 - 2);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(7, p.h / 2 - 4, 3, 0, Math.PI * 2);
    ctx.arc(p.w - 7, p.h / 2 - 4, 3, 0, Math.PI * 2);
    ctx.arc(p.w / 2, p.h / 2 - 9, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === "fireflower") {
    ctx.fillStyle = "#3fae2a";
    ctx.fillRect(p.w / 2 - 2, p.h / 2, 4, p.h / 2);
    ctx.fillStyle = "#ff5a3c";
    for (const [dx, dy] of [[0, -2], [8, 6], [-8, 6], [8, -8], [-8, -8]]) {
      ctx.beginPath();
      ctx.arc(p.w / 2 + dx, p.h / 2 - 4 + dy, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd400";
    ctx.beginPath();
    ctx.arc(p.w / 2, p.h / 2 - 4, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.type === "star") {
    ctx.fillStyle = `hsl(${(performance.now() / 4) % 360}, 90%, 60%)`;
    drawStarShape(p.w / 2, p.h / 2, p.w / 2, p.w / 4, 5);
  }
  ctx.restore();
}

function drawStarShape(cx, cy, outerR, innerR, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawFireball(f) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const dir = f.vx >= 0 ? 1 : -1;

  // motion trail
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#c7ccd6";
  ctx.beginPath();
  ctx.ellipse(cx - dir * 8, cy, 5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // spinning shuriken
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((f.t * 20) % (Math.PI * 2));
  const r = f.w / 2 + 2;
  ctx.fillStyle = "#8a8f99";
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.35, -r * 0.35);
  ctx.lineTo(r, 0);
  ctx.lineTo(r * 0.35, r * 0.35);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.35, r * 0.35);
  ctx.lineTo(-r, 0);
  ctx.lineTo(-r * 0.35, -r * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#4a4e57";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#4a4e57";
  ctx.beginPath();
  ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTextPops() {
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "center";
  for (const tp of textPops) {
    ctx.globalAlpha = Math.max(0, 1 - tp.t / 1.2);
    ctx.fillStyle = tp.color;
    ctx.fillText(tp.text, tp.x + TILE / 2, tp.y);
    ctx.globalAlpha = 1;
  }
}

function drawGoomba(g) {
  ctx.save();
  ctx.translate(g.x, g.y);
  if (!g.alive) {
    ctx.scale(1, 0.35);
    ctx.translate(0, g.h * 1.4);
  }
  ctx.fillStyle = "#8a4b1f";
  ctx.beginPath();
  ctx.ellipse(g.w / 2, g.h / 2 + 2, g.w / 2, g.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5a2f10";
  ctx.fillRect(2, g.h - 8, 8, 8);
  ctx.fillRect(g.w - 10, g.h - 8, 8, 8);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.ellipse(g.w / 2 - 6, g.h / 2 - 2, 4, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(g.w / 2 + 6, g.h / 2 - 2, 4, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(g.w / 2 - 6, g.h / 2, 2, 0, Math.PI * 2);
  ctx.arc(g.w / 2 + 6, g.h / 2, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawKoopa(k) {
  ctx.save();
  ctx.translate(k.x, k.y);
  if (!k.alive) {
    ctx.scale(1, 0.35);
    ctx.translate(0, k.h * 1.4);
  }

  if (k.state === "walking") {
    // legs
    ctx.fillStyle = "#e8c23a";
    ctx.fillRect(2, k.h - 8, 7, 8);
    ctx.fillRect(k.w - 9, k.h - 8, 7, 8);
    // shell body
    ctx.fillStyle = "#3fae2a";
    ctx.beginPath();
    ctx.ellipse(k.w / 2, k.h / 2, k.w / 2, k.h / 2 - 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#276b1a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(k.w / 2, 4);
    ctx.lineTo(k.w / 2, k.h - 10);
    ctx.moveTo(4, k.h / 2);
    ctx.lineTo(k.w - 4, k.h / 2);
    ctx.stroke();
    // head
    ctx.fillStyle = "#e8c23a";
    ctx.beginPath();
    ctx.ellipse(k.w / 2, 6, 8, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(k.w / 2 + 3, 4, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // shell (stationary or sliding)
    ctx.fillStyle = "#3fae2a";
    ctx.beginPath();
    ctx.ellipse(k.w / 2, k.h / 2, k.w / 2, k.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#276b1a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(k.w / 2, k.h / 2, k.w / 3, k.h / 3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff8e0";
    ctx.beginPath();
    ctx.ellipse(k.w / 2, k.h / 2, k.w / 5, k.h / 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawPlayer() {
  const p = player;

  // Brief post-hit invulnerability blinks the sprite; star power recolors it.
  const shrinkFlicker = p.starT <= 0 && p.invuln > 0 && Math.floor(performance.now() / 80) % 2 === 0;
  if (shrinkFlicker) return;

  ctx.save();
  if (p.starT > 0) {
    ctx.filter = `hue-rotate(${Math.floor(performance.now() / 4) % 360}deg) saturate(2)`;
  }
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
  ctx.scale(p.facing, 1);

  // Running gait: a brisk stride cycle (legs scissor fore/aft as well as
  // bobbing) that speeds up with ground speed, plus a slight forward lean
  // while sprinting so it reads as running rather than just walking. The
  // lean rotates around the character's center, so it must happen before
  // shifting the origin to the top-left corner for the rest of the drawing.
  const speed = Math.abs(p.vx);
  const running = p.onGround && speed > 5;
  const strideRate = 8 + speed / 22;
  const phase = p.animT * strideRate;
  const stride = running ? Math.sin(phase) : 0;
  const hop = running ? Math.max(0, Math.cos(phase)) * -2.5 : 0;
  if (running && speed > 140) {
    ctx.rotate(0.09);
  }

  // Draw at the small-form proportions, then scale up to match the actual
  // hitbox height. Width grows at only a fraction of the height's rate -
  // scaling both axes equally made Big/Fire Mario look overly wide/chunky.
  const growScale = p.h / PLAYER_SMALL_H;
  const widthScale = 1 + (growScale - 1) * 0.35;
  ctx.scale(widthScale, growScale);
  ctx.translate(-PLAYER_W / 2, -PLAYER_SMALL_H / 2);

  const bob = hop;
  const isFire = p.form === "fire";
  const capShirtColor = isFire ? "#f2f2f2" : "#d3241f";
  const overallsColor = isFire ? "#c0221c" : "#2b4fbf";

  const legsY = PLAYER_SMALL_H - 8;
  const bodyY = PLAYER_SMALL_H - 16;
  const shirtY = PLAYER_SMALL_H - 18;
  const headY = PLAYER_SMALL_H - 26;
  const capY = PLAYER_SMALL_H - 30;

  // legs: scissor fore/aft in addition to bobbing, like a running stride
  ctx.fillStyle = overallsColor;
  ctx.fillRect(2 + stride * 3, legsY + bob, 8, 8);
  ctx.fillRect(14 - stride * 3, legsY + bob, 8, 8);
  // overalls body
  ctx.fillStyle = overallsColor;
  ctx.fillRect(4, bodyY + bob * 0.4, 16, 10);
  // shirt/arms (swing opposite the legs)
  ctx.fillStyle = capShirtColor;
  ctx.fillRect(0, shirtY + bob * 0.4, 24, 6);
  ctx.fillRect(0, shirtY + bob * 0.4 - stride * 2, 5, 12);
  ctx.fillRect(19, shirtY + bob * 0.4 + stride * 2, 5, 12);
  // head
  ctx.fillStyle = "#f4c08a";
  ctx.fillRect(4, headY + bob * 0.4, 16, 10);
  // cap
  ctx.fillStyle = capShirtColor;
  ctx.fillRect(2, capY + bob * 0.4, 20, 6);
  ctx.fillRect(14, capY + 4 + bob * 0.4, 8, 3);
  // mustache/eye
  ctx.fillStyle = "#5a3a1a";
  ctx.fillRect(12, headY + 5 + bob * 0.4, 6, 2);
  ctx.fillStyle = "#000";
  ctx.fillRect(15, headY + 2 + bob * 0.4, 2, 2);

  // Fire Mario carries a little shuriken instead of throwing bare fireballs
  if (isFire) {
    ctx.save();
    ctx.translate(24, shirtY + 5 + bob * 0.4);
    ctx.rotate((performance.now() / 150) % (Math.PI * 2));
    ctx.fillStyle = "#8a8f99";
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(2, -2);
    ctx.lineTo(6, 0);
    ctx.lineTo(2, 2);
    ctx.lineTo(0, 6);
    ctx.lineTo(-2, 2);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-2, -2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#4a4e57";
    ctx.beginPath();
    ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

// ---------- Fireworks (final "course clear" celebration) ----------
let fireworkParticles = [];
let fireworkTimer = 0;

function spawnFirework() {
  const cx = 120 + Math.random() * (VIEW_W - 240);
  const cy = 90 + Math.random() * 160;
  const color = `hsl(${Math.floor(Math.random() * 360)}, 90%, 62%)`;
  const count = 20;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const speed = 90 + Math.random() * 70;
    fireworkParticles.push({
      x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, t: 0, color,
    });
  }
  sfx.star();
}

function updateFireworks(dt) {
  if (state === "gameover-win") {
    fireworkTimer -= dt;
    if (fireworkTimer <= 0) {
      spawnFirework();
      fireworkTimer = 0.7 + Math.random() * 0.6;
    }
  } else if (fireworkParticles.length === 0 && fireworkTimer === 0) {
    return; // nothing to do outside the win screen once particles have cleared
  }
  for (const p of fireworkParticles) {
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 220 * dt;
  }
  fireworkParticles = fireworkParticles.filter((p) => p.t < 1.3);
}

function drawFireworks() {
  for (const p of fireworkParticles) {
    ctx.globalAlpha = Math.max(0, 1 - p.t / 1.3);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------- Main loop ----------
function loop(t) {
  if (!lastTime) lastTime = t;
  const dt = Math.min(0.033, (t - lastTime) / 1000);
  lastTime = t;
  update(dt);
  updateFireworks(dt);
  draw();
  requestAnimationFrame(loop);
}

buildLevel();
requestAnimationFrame(loop);
