// Super Plumber Bros — an original, from-scratch tribute platformer.
// All art is procedurally drawn on canvas; no external assets are used.

const TILE = 32;

// Level legend:
// '.' empty  'G' ground  '?' question block  'B' brick  'P' pipe top  'p' pipe body
// 'C' floating coin  'g' goomba spawn  'M' player spawn  'F' flagpole  'H' hill (decor)
// 'b' bush (decor)  'c' cloud (decor)
const ROWS = 10;
const COLS = 92;

function buildLevelRows() {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill("."));
  const set = (r, c, ch) => {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) grid[r][c] = ch;
  };
  const setRange = (r, c1, c2, ch) => {
    for (let c = c1; c <= c2; c++) set(r, c, ch);
  };

  // ground (bottom two rows)
  setRange(ROWS - 2, 0, COLS - 1, "G");
  setRange(ROWS - 1, 0, COLS - 1, "G");

  // decor: clouds
  [8, 40, 62, 80].forEach((c) => set(1, c, "c"));

  // decor: hills
  [6, 30, 33, 63, 84].forEach((c) => set(7, c, "H"));

  // decor: bushes
  [14, 40, 66].forEach((c) => set(7, c, "b"));

  // question blocks and bricks
  set(4, 20, "?");
  setRange(4, 49, 53, "B");
  set(4, 51, "?");
  set(4, 49, "?");
  set(4, 53, "?");

  // goombas
  [21, 51, 72].forEach((c) => set(7, c, "g"));

  // player spawn
  set(5, 2, "M");

  // flagpole near the end
  set(4, 88, "F");

  return grid.map((row) => row.join(""));
}

const LEVEL_ROWS = buildLevelRows();
const LEVEL_PIXEL_WIDTH = COLS * TILE;
const LEVEL_PIXEL_HEIGHT = ROWS * TILE;

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
};

// ---------- Input ----------
const keys = {};
window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "Enter") {
    if (state === "title") startGame();
    else if (state === "gameover") startGame();
  }
  if (e.code === "KeyP") togglePause();
  if (e.code === "KeyM") toggleSound();
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

let player, goombas, blocks, particles;

function buildLevel() {
  goombas = [];
  blocks = []; // dynamic block state: {x,y,type,hit,bumpT}
  particles = [];
  let spawn = { x: 2 * TILE, y: 5 * TILE };

  for (let r = 0; r < ROWS; r++) {
    const row = LEVEL_ROWS[r];
    for (let c = 0; c < COLS; c++) {
      const ch = row[c];
      const x = c * TILE;
      const y = r * TILE;
      if (ch === "?" || ch === "B") {
        blocks.push({ x, y, type: ch, hit: false, bumpT: 0, coinPopped: false });
      } else if (ch === "g") {
        goombas.push({
          x, y: y - 8, w: 28, h: 28, vx: -40, vy: 0, alive: true, squashT: 0,
        });
      } else if (ch === "M") {
        spawn = { x, y };
      } else if (ch === "F") {
        // flagpole handled via static scan, not needed dynamically
      }
    }
  }

  player = {
    x: spawn.x,
    y: spawn.y,
    w: 24,
    h: 30,
    vx: 0,
    vy: 0,
    onGround: false,
    facing: 1,
    running: false,
    dead: false,
    invuln: 0,
    animT: 0,
    won: false,
  };
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
      if (hitsFromBelow && overlapsX) {
        player.vy = 40;
        player.y = b.y + TILE;
        if (b.type === "?" && !b.hit) {
          b.hit = true;
          b.bumpT = 0.2;
          coins++;
          score += 200;
          sfx.coin();
          spawnCoinPop(b.x, b.y);
        } else {
          b.bumpT = 0.2;
          sfx.bump();
        }
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

    if (!player.dead && player.invuln <= 0 && rectsOverlap(player, g)) {
      const stomp = player.vy > 0 && player.y + player.h - g.y < 18;
      if (stomp) {
        g.alive = false;
        g.squashT = 0.3;
        player.vy = JUMP_VELOCITY * 0.6;
        score += 100;
        sfx.stomp();
      } else {
        loseLife();
      }
    }
  }
  goombas = goombas.filter((g) => g.alive || g.squashT > -0.01);

  if (player.invuln > 0) player.invuln -= dt;

  // Particles (coin pop)
  for (const p of particles) {
    p.t += dt;
    p.y += p.vy * dt;
    p.vy += 700 * dt;
  }
  particles = particles.filter((p) => p.t < 0.6);

  // Win condition: reach flag column
  const flagCol = LEVEL_ROWS[4].indexOf("F");
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
  ctx.fillStyle = "#6b8cff";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.save();
  ctx.translate(-camX, 0);

  drawBackground();
  drawTiles();
  drawBlocks();
  drawFlag();
  drawParticles();
  for (const g of goombas) drawGoomba(g);
  if (!(state === "title")) drawPlayer();

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
  const flagRow = 4;
  const flagCol = LEVEL_ROWS[flagRow].indexOf("F");
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
    ctx.globalAlpha = Math.max(0, 1 - p.t / 0.6);
    ctx.fillStyle = "#ffd400";
    ctx.beginPath();
    ctx.arc(p.x + 6, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
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
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
  if (p.dead) ctx.rotate(Math.min(1, p.animT) * 0);
  ctx.scale(p.facing, 1);
  ctx.translate(-p.w / 2, -p.h / 2);

  const bob = p.onGround && Math.abs(p.vx) > 5 ? Math.sin(p.animT * 20) * 2 : 0;

  // legs
  ctx.fillStyle = "#2b4fbf";
  ctx.fillRect(2, 22 + bob, 8, 8);
  ctx.fillRect(14, 22 - bob, 8, 8);
  // overalls body
  ctx.fillStyle = "#2b4fbf";
  ctx.fillRect(4, 14, 16, 10);
  // shirt/arms
  ctx.fillStyle = "#d3241f";
  ctx.fillRect(0, 12, 24, 6);
  ctx.fillRect(0, 12, 5, 12);
  ctx.fillRect(19, 12, 5, 12);
  // head
  ctx.fillStyle = "#f4c08a";
  ctx.fillRect(4, 4, 16, 10);
  // cap
  ctx.fillStyle = "#d3241f";
  ctx.fillRect(2, 0, 20, 6);
  ctx.fillRect(14, 4, 8, 3);
  // mustache/eye
  ctx.fillStyle = "#5a3a1a";
  ctx.fillRect(12, 9, 6, 2);
  ctx.fillStyle = "#000";
  ctx.fillRect(15, 6, 2, 2);

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
