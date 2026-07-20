// Super Plumber Bros — an original, from-scratch tribute platformer.
// All art is procedurally drawn on canvas; no external assets are used.

const TILE = 32;

// Level legend:
// '.' empty  'G' ground  '?' question block  'B' brick  'p' pipe (2 tiles wide)
// 'g' goomba spawn  'M' player spawn  'F' flagpole  'H' hill (decor)
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
  return { grid, set, setRange, placePipe, pipeLeftCols, rows, cols };
}

function buildOverworld() {
  const ROWS = 10;
  const COLS = 92;
  const b = makeGridBuilder(ROWS, COLS);
  const blockContents = {};
  const warpPipes = {};

  b.setRange(ROWS - 2, 0, COLS - 1, "G");
  b.setRange(ROWS - 1, 0, COLS - 1, "G");

  // pits (gaps requiring a jump)
  [[36, 38], [76, 78]].forEach(([c1, c2]) => {
    for (let c = c1; c <= c2; c++) {
      b.set(ROWS - 2, c, ".");
      b.set(ROWS - 1, c, ".");
    }
  });

  // decor
  [8, 40, 62, 80].forEach((c) => b.set(1, c, "c"));
  [6, 30, 33, 63, 84].forEach((c) => b.set(7, c, "H"));
  [14, 66].forEach((c) => b.set(7, c, "b"));

  // pipes: two plain obstacle pipes, one warp pipe into the underground room
  b.placePipe(10, 6, 2);
  b.placePipe(41, 5, 3);
  b.placePipe(58, 6, 2);
  warpPipes["58,6"] = { toWorld: "underground", spawn: { x: 2 * TILE, y: 5 * TILE } };

  // Power-up cluster, placed early (right after the first pipe) so it's
  // easy to reach on a first attempt: mushroom, then star, then fire flower.
  b.set(4, 16, "?");
  blockContents["16,4"] = "mushroom";
  b.set(4, 18, "B");
  b.set(4, 19, "?");
  blockContents["19,4"] = "star";
  b.set(4, 20, "B");
  b.set(4, 21, "?");
  blockContents["21,4"] = "fireflower";

  // a plain bonus coin cluster further along
  b.setRange(4, 49, 53, "B");
  b.set(4, 49, "?");
  b.set(4, 51, "?");
  b.set(4, 53, "?");

  // goombas
  [26, 51, 72].forEach((c) => b.set(7, c, "g"));

  // player spawn
  b.set(5, 2, "M");

  // flagpole near the end
  b.set(4, 88, "F");

  return {
    name: "overworld",
    theme: "overworld",
    rows: b.grid.map((row) => row.join("")),
    ROWS,
    COLS,
    blockContents,
    pipeLeftCols: b.pipeLeftCols,
    warpPipes,
    flagRow: 4,
    flagCol: 88,
    entities: null,
  };
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
  warpPipes[`13,${ROWS - 4}`] = {
    toWorld: "overworld",
    spawn: { x: 61 * TILE, y: 5 * TILE },
  };

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
let world; // active world
let ROWS, COLS, LEVEL_ROWS, LEVEL_PIXEL_WIDTH, LEVEL_PIXEL_HEIGHT;

function initWorlds() {
  WORLD_REGISTRY.overworld = buildOverworld();
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
applyWorld(WORLD_REGISTRY.overworld);

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
  fire: () => beep(740, 0.08, "sawtooth", 0.06),
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
  if (e.code === "ControlLeft" || e.code === "ControlRight" || e.code === "KeyX") wantShoot = true;
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
const PLAYER_SMALL_H = 30;
const PLAYER_BIG_H = 42;

let player, goombas, blocks, particles, powerups, fireballs, textPops;
let warpCooldown = 0;

// Scans a world's tile grid and builds fresh dynamic entity arrays for it
// (blocks, goombas, spawn point). Called once per world the first time it's
// entered; the resulting arrays are cached on the world object so that
// progress (broken blocks, defeated enemies) survives repeated warps.
function populateEntities(w) {
  const blocksArr = [];
  const goombasArr = [];
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
      } else if (ch === "M") {
        spawn = { x, y };
      }
    }
  }

  return { blocks: blocksArr, goombas: goombasArr, spawn };
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

function buildLevel() {
  // Fresh run / respawn: reset the overworld's entities and start clean.
  WORLD_REGISTRY.overworld.entities = null;
  applyWorld(WORLD_REGISTRY.overworld);
  const ent = populateEntities(world);
  world.entities = { blocks: ent.blocks, goombas: ent.goombas };
  blocks = ent.blocks;
  goombas = ent.goombas;
  particles = [];
  powerups = [];
  fireballs = [];
  textPops = [];
  warpCooldown = 0;
  player = newPlayerAt(ent.spawn);
}

function warpTo(targetWorldName, spawn) {
  // Save the current world's live entity arrays so state persists.
  world.entities = { blocks, goombas };

  const target = WORLD_REGISTRY[targetWorldName];
  if (!target.entities) {
    const ent = populateEntities(target);
    target.entities = { blocks: ent.blocks, goombas: ent.goombas };
  }
  applyWorld(target);
  blocks = target.entities.blocks;
  goombas = target.entities.goombas;

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
  const diff = PLAYER_BIG_H - PLAYER_SMALL_H;
  player.h = PLAYER_SMALL_H;
  player.y += diff;
  player.invuln = 1.5;
  sfx.shrink();
}

function growPlayer(newForm, b) {
  if (player.form === "small") {
    // A fire flower picked up from Small goes straight to Fire (skipping
    // Big) so the pickup always has a visible, guaranteed payoff.
    player.form = newForm;
    const diff = PLAYER_BIG_H - PLAYER_SMALL_H;
    player.h = PLAYER_BIG_H;
    player.y -= diff;
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

function startGame() {
  score = 0;
  coins = 0;
  lives = 3;
  timeLeft = 400;
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
    if (pipe) warpTo(pipe.toWorld, pipe.spawn);
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
    g.x += g.vx * dt;
    const aheadCol = Math.floor((g.x + (g.vx > 0 ? g.w + 1 : -1)) / TILE);
    const footRow = Math.floor((g.y + g.h + 1) / TILE);
    if (!isSolidTile(tileAt(aheadCol, footRow))) g.vx *= -1;
    const midCol = Math.floor((g.x + g.w / 2) / TILE);
    if (isSolidTile(tileAt(midCol, Math.floor((g.y) / TILE)))) g.vx *= -1;

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

  if (player.invuln > 0) player.invuln -= dt;
  if (player.starT > 0) player.starT -= dt;

  // ---------- Powerups ----------
  for (const p of powerups) {
    if (p.type === "fireflower") continue; // stationary, no physics needed
    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    const aheadCol = Math.floor((p.x + (p.vx > 0 ? p.w + 1 : -1)) / TILE);
    const footRow = Math.floor((p.y + p.h + 1) / TILE);
    if (!isSolidTile(tileAt(aheadCol, footRow))) p.vx *= -1;
    const midCol = Math.floor((p.x + p.w / 2) / TILE);
    if (isSolidTile(tileAt(midCol, Math.floor(p.y / TILE)))) p.vx *= -1;

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
  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if (wantShoot && player.form === "fire" && player.fireCooldown <= 0 && fireballs.length < 2) {
    fireballs.push({
      x: player.x + (player.facing > 0 ? player.w : -10),
      y: player.y + player.h / 2 - 5,
      vx: 380 * player.facing,
      vy: -120,
      w: 10,
      h: 10,
      t: 0,
    });
    player.fireCooldown = 0.35;
    sfx.fire();
  }
  wantShoot = false;

  for (const f of fireballs) {
    f.vy += 1400 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.t += dt;
    const footRow = Math.floor((f.y + f.h) / TILE);
    const col = Math.floor((f.x + f.w / 2) / TILE);
    if (isSolidTile(tileAt(col, footRow)) && f.vy > 0) {
      f.y = footRow * TILE - f.h;
      f.vy = -420;
    }
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

  // Win condition: reach flag column
  const flagCol = world.flagCol;
  if (flagCol > -1 && player.x > flagCol * TILE && !player.won && !player.dead) {
    player.won = true;
    player.vx = 0;
    score += 1000;
    sfx.win();
    setTimeout(() => {
      state = "win";
      showWinOverlay();
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
    vx: type === "fireflower" ? 0 : 70,
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
  drawBlocks();
  drawFlag();
  drawParticles();
  for (const p of powerups) drawPowerup(p);
  for (const g of goombas) drawGoomba(g);
  for (const f of fireballs) drawFireball(f);
  if (!(state === "title")) drawPlayer();
  drawTextPops();

  ctx.restore();
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
  ctx.fillStyle = "#ff8a3c";
  ctx.beginPath();
  ctx.arc(f.x + f.w / 2, f.y + f.h / 2, f.w / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffd400";
  ctx.beginPath();
  ctx.arc(f.x + f.w / 2, f.y + f.h / 2, f.w / 4, 0, Math.PI * 2);
  ctx.fill();
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
  ctx.translate(-p.w / 2, -p.h / 2);

  const bob = p.onGround && Math.abs(p.vx) > 5 ? Math.sin(p.animT * 20) * 2 : 0;
  const isFire = p.form === "fire";
  const capShirtColor = isFire ? "#f2f2f2" : "#d3241f";
  const overallsColor = isFire ? "#c0221c" : "#2b4fbf";

  const legsY = p.h - 8;
  const bodyY = p.h - 16;
  const shirtY = p.h - 18;
  const headY = p.h - 26;
  const capY = p.h - 30;

  // legs
  ctx.fillStyle = overallsColor;
  ctx.fillRect(2, legsY + bob, 8, 8);
  ctx.fillRect(14, legsY - bob, 8, 8);
  // overalls body
  ctx.fillStyle = overallsColor;
  ctx.fillRect(4, bodyY, 16, 10);
  // shirt/arms
  ctx.fillStyle = capShirtColor;
  ctx.fillRect(0, shirtY, 24, 6);
  ctx.fillRect(0, shirtY, 5, 12);
  ctx.fillRect(19, shirtY, 5, 12);
  // head
  ctx.fillStyle = "#f4c08a";
  ctx.fillRect(4, headY, 16, 10);
  // cap
  ctx.fillStyle = capShirtColor;
  ctx.fillRect(2, capY, 20, 6);
  ctx.fillRect(14, capY + 4, 8, 3);
  // mustache/eye
  ctx.fillStyle = "#5a3a1a";
  ctx.fillRect(12, headY + 5, 6, 2);
  ctx.fillStyle = "#000";
  ctx.fillRect(15, headY + 2, 2, 2);

  ctx.restore();
}

// ---------- Main loop ----------
function loop(t) {
  if (!lastTime) lastTime = t;
  const dt = Math.min(0.033, (t - lastTime) / 1000);
  lastTime = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

worldEl.textContent = "1-1";
buildLevel();
requestAnimationFrame(loop);
