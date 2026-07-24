// Geometry Dash Lite — an original, from-scratch tribute to the auto-runner
// rhythm-platformer. All art is procedurally drawn on canvas; no external
// assets are used. Level layouts are original / procedurally generated —
// they carry the real game's level names for flavor but are not copies of
// the real geometry.

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

const hudPercent = document.getElementById("hud-percent");
const hudAttempts = document.getElementById("hud-attempts");
const hudLevelName = document.getElementById("hud-level-name");
const titleScreen = document.getElementById("title-screen");
const selectScreen = document.getElementById("select-screen");
const deathScreen = document.getElementById("death-screen");
const winScreen = document.getElementById("win-screen");
const levelGrid = document.getElementById("level-grid");
const exitBtn = document.getElementById("exit-btn");
exitBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  showSelect();
});

// ---------------------------------------------------------------- Audio ---
let muted = false;
const actx = new (window.AudioContext || window.webkitAudioContext)();
function beep(freq, dur, type, vol) {
  if (muted) return;
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = vol;
  gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  osc.connect(gain).connect(actx.destination);
  osc.start();
  osc.stop(actx.currentTime + dur);
}
const sfx = {
  jump: () => beep(520, 0.08, "square", 0.06),
  death: () => beep(110, 0.35, "sawtooth", 0.12),
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => beep(f, 0.18, "triangle", 0.08), i * 90)
    );
  },
};

// -------------------------------------------------------------- Physics ---
const GRAVITY = 2200;
const JUMP_VELOCITY = -760;
const GROUND_Y = VIEW_H - 110;
const PLAYER_SIZE = 36;
const PLAYER_SCREEN_X = 200;
const JUMP_AIR_TIME = (2 * Math.abs(JUMP_VELOCITY)) / GRAVITY; // seconds
const APEX_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
const MAX_BLOCK_HEIGHT = Math.min(96, APEX_HEIGHT * 0.7);

// ------------------------------------------------------------ Level defs --
const LEVEL_DEFS = [
  { name: "Stereo Madness", diff: "Easy Demon", c1: "#2ee6a8", c2: "#0e6b52" },
  { name: "Back On Track", diff: "Easy Demon", c1: "#3fa9ff", c2: "#0b3f6b" },
  { name: "Polargeist", diff: "Easy Demon", c1: "#b06bff", c2: "#3b1466" },
  { name: "Dry Out", diff: "Easy Demon", c1: "#ff9a3f", c2: "#6b3a0b" },
  { name: "Base After Base", diff: "Medium Demon", c1: "#ff5252", c2: "#5c0d0d" },
  { name: "Can't Let Go", diff: "Medium Demon", c1: "#ff5cb8", c2: "#661038" },
  { name: "Jumper", diff: "Medium Demon", c1: "#ffe94e", c2: "#665c0b" },
  { name: "Time Machine", diff: "Medium Demon", c1: "#4ee1ff", c2: "#0b5766" },
  { name: "Cycles", diff: "Medium Demon", c1: "#a06bff", c2: "#331a66" },
  { name: "xStep", diff: "Hard Demon", c1: "#6b7dff", c2: "#171a66" },
  { name: "Clutterfunk", diff: "Hard Demon", c1: "#ff4ee1", c2: "#660b52" },
  { name: "Theory of Everything", diff: "Hard Demon", c1: "#4e6dff", c2: "#0b1466" },
  { name: "Electroman Adventures", diff: "Hard Demon", c1: "#4ecbff", c2: "#0b3966" },
  { name: "Clubstep", diff: "Hard Demon", c1: "#8a4eff", c2: "#150029" },
  { name: "Electrodynamix", diff: "Extreme Demon", c1: "#4eff8a", c2: "#0a3319" },
  { name: "Hexagon Force", diff: "Extreme Demon", c1: "#ff6b4e", c2: "#661f0b" },
  { name: "Blast Processing", diff: "Extreme Demon", c1: "#4e8aff", c2: "#0b1e66" },
  { name: "Theory of Everything 2", diff: "Extreme Demon", c1: "#4effe1", c2: "#0b3f39" },
  { name: "Geometrical Dominator", diff: "Impossible Demon", c1: "#ffcf4e", c2: "#664d0b" },
  { name: "Deadlocked", diff: "Impossible Demon", c1: "#ff4e4e", c2: "#1a0303" },
  { name: "Fingerdash", diff: "Impossible Demon", c1: "#ff4ecb", c2: "#3b0b30" },
].map((d, i) => ({ ...d, id: i + 1 }));

// Builds an original, seeded, procedurally-generated obstacle course for a
// given level index (1..21). Difficulty (speed, hazard density, level
// length) scales with the level's position in the list, mirroring the real
// game's escalating challenge without reusing its actual layouts.
function generateLevel(idx) {
  const rand = mulberry32(idx * 7919 + 13);
  const speed = 380 * (1 + (idx - 1) * 0.018);
  const density = Math.min(0.5, 0.16 + (idx - 1) * 0.016);
  const numSegments = 34 + idx * 2;
  const jumpDist = speed * JUMP_AIR_TIME;
  const unit = Math.max(170, jumpDist * 0.75);

  const obstacles = []; // { x, type: 'spike'|'block', w, h }
  const floors = []; // { x1, x2, topY } — raised ground or pit gaps

  let cursor = unit * 3; // safe run-up before first hazard
  floors.push({ x1: 0, x2: cursor, topY: GROUND_Y });

  // Every segment reserves a guaranteed-clear runway at its start so a
  // hazard can never land right on the heels of the previous one (that
  // "impossible" back-to-back case, e.g. a spike immediately followed by
  // a block wall with no reaction time).
  const buffer = unit * 0.4;
  let lastWasHazard = false;

  for (let seg = 0; seg < numSegments; seg++) {
    const r = rand();
    const segX = cursor;
    const hazardStart = segX + buffer;
    const hazardSpan = unit - buffer;

    // Never two hazard segments back to back, regardless of density — every
    // hazard is guaranteed a full clear segment to recover in afterward.
    if (lastWasHazard) {
      floors.push({ x1: segX, x2: segX + unit, topY: GROUND_Y });
      lastWasHazard = false;
      cursor = segX + unit;
      continue;
    }

    if (r < density * 0.32) {
      // single spike
      obstacles.push({ x: hazardStart + hazardSpan * 0.4, type: "spike", w: 30, h: 30 });
      floors.push({ x1: segX, x2: segX + unit, topY: GROUND_Y });
      lastWasHazard = true;
    } else if (r < density * 0.5) {
      // double spike cluster
      obstacles.push({ x: hazardStart, type: "spike", w: 30, h: 30 });
      obstacles.push({ x: hazardStart + 32, type: "spike", w: 30, h: 30 });
      floors.push({ x1: segX, x2: segX + unit, topY: GROUND_Y });
      lastWasHazard = true;
    } else if (r < density * 0.72) {
      // raised block to hop onto
      const h = 40 + Math.floor(rand() * 2) * 40;
      const bh = Math.min(h, MAX_BLOCK_HEIGHT);
      const w = hazardSpan * 0.65;
      floors.push({ x1: segX, x2: hazardStart, topY: GROUND_Y });
      floors.push({ x1: hazardStart, x2: hazardStart + w, topY: GROUND_Y - bh, block: true });
      floors.push({ x1: hazardStart + w, x2: segX + unit, topY: GROUND_Y });
      lastWasHazard = true;
    } else if (r < density * 0.9) {
      // pit gap — always narrower than a safe jump distance
      const gapW = Math.min(jumpDist * 0.55, hazardSpan * 0.6);
      floors.push({ x1: segX, x2: hazardStart, topY: GROUND_Y });
      floors.push({ x1: hazardStart, x2: hazardStart + gapW, topY: null });
      floors.push({ x1: hazardStart + gapW, x2: segX + unit, topY: GROUND_Y });
      lastWasHazard = true;
    } else {
      // clear stretch, just floor
      floors.push({ x1: segX, x2: segX + unit, topY: GROUND_Y });
      lastWasHazard = false;
    }

    cursor = segX + unit;
  }

  const levelLength = cursor + 300;
  floors.push({ x1: cursor, x2: levelLength + 400, topY: GROUND_Y });

  // Purely decorative floating background shapes — no collision, just
  // ambience. Two depth layers give a parallax feel as the camera scrolls.
  const bgShapes = [];
  for (let i = 0; i < Math.ceil(levelLength / 260); i++) {
    const layer = rand() < 0.5 ? 0 : 1;
    bgShapes.push({
      x: i * 260 + rand() * 200,
      y: 40 + rand() * (GROUND_Y - 140),
      size: 14 + rand() * (layer === 0 ? 34 : 18),
      shape: Math.floor(rand() * 3), // 0 circle, 1 square, 2 triangle
      layer,
      rot: rand() * Math.PI,
    });
  }

  return { obstacles, floors, length: levelLength, speed, def: LEVEL_DEFS[idx - 1], bgShapes };
}

function floorAt(floors, x) {
  for (let i = floors.length - 1; i >= 0; i--) {
    const f = floors[i];
    if (x >= f.x1 && x < f.x2) return f;
  }
  return null;
}

// ------------------------------------------------------------- Game state -
let state = "title"; // title | select | play | dead | win
let currentLevelIdx = 1;
let level = null;
let camX = 0;
let attempts = 1;
let bestPercent = {};
try {
  bestPercent = JSON.parse(localStorage.getItem("gdlite-best") || "{}");
} catch (e) {
  bestPercent = {};
}

const player = { x: 0, y: GROUND_Y - PLAYER_SIZE, vy: 0, onGround: true, rot: 0, dustTimer: 0 };
let particles = [];
let trail = [];
let dust = [];
let wantJump = false;
let paused = false;

function resetPlayer() {
  player.x = 0;
  player.y = GROUND_Y - PLAYER_SIZE;
  player.vy = 0;
  player.onGround = true;
  player.rot = 0;
  camX = 0;
  particles = [];
  trail = [];
  dust = [];
  player.dustTimer = 0;
}

function startLevel(idx) {
  currentLevelIdx = idx;
  level = generateLevel(idx);
  attempts = 1;
  resetPlayer();
  state = "play";
  hideAllOverlays();
  hudLevelName.textContent = level.def.name;
  exitBtn.classList.remove("hidden");
}

function retryLevel() {
  attempts++;
  resetPlayer();
  state = "play";
  hideAllOverlays();
  exitBtn.classList.remove("hidden");
}

function hideAllOverlays() {
  titleScreen.classList.add("hidden");
  selectScreen.classList.add("hidden");
  deathScreen.classList.add("hidden");
  winScreen.classList.add("hidden");
}

function showSelect() {
  state = "select";
  hideAllOverlays();
  selectScreen.classList.remove("hidden");
  exitBtn.classList.add("hidden");
}

function buildLevelGrid() {
  levelGrid.innerHTML = "";
  LEVEL_DEFS.forEach((d) => {
    const card = document.createElement("div");
    card.className = "level-card";
    card.style.setProperty("--c1", d.c1);
    card.style.setProperty("--c2", d.c2);
    const best = bestPercent[d.id] || 0;
    card.innerHTML = `
      <div class="lc-num">#${d.id}</div>
      <div class="lc-name">${d.name}</div>
      <div class="lc-diff">${d.diff}</div>
      <div class="lc-best">${best}%</div>
    `;
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      startLevel(d.id);
    });
    levelGrid.appendChild(card);
  });
}
buildLevelGrid();

function die() {
  if (state !== "play") return;
  state = "dead";
  sfx.death();
  for (let i = 0; i < 24; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 120 + Math.random() * 260;
    particles.push({
      x: player.x + PLAYER_SIZE / 2,
      y: player.y + PLAYER_SIZE / 2,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      t: 0.6,
      color: level.def.c1,
    });
  }
  const pct = Math.min(100, Math.floor((camX / (level.length - VIEW_W + PLAYER_SCREEN_X)) * 100));
  if (pct > (bestPercent[currentLevelIdx] || 0)) {
    bestPercent[currentLevelIdx] = pct;
    try {
      localStorage.setItem("gdlite-best", JSON.stringify(bestPercent));
    } catch (e) {}
  }
  deathScreen.classList.remove("hidden");
  setTimeout(() => {
    if (state === "dead") retryLevel();
  }, 700);
}

function win() {
  state = "win";
  sfx.win();
  bestPercent[currentLevelIdx] = 100;
  try {
    localStorage.setItem("gdlite-best", JSON.stringify(bestPercent));
  } catch (e) {}
  winScreen.classList.remove("hidden");
}

// ------------------------------------------------------------------ Input -
function doJump() {
  if (state === "play" && player.onGround) {
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
    sfx.jump();
  }
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault();
    if (state === "title") return startLevelSelectFromTitle();
    doJump();
  } else if (e.code === "Enter") {
    if (state === "title") startLevelSelectFromTitle();
    else if (state === "win") showSelect();
  } else if (e.code === "Escape") {
    if (state === "play" || state === "dead") showSelect();
  } else if (e.code === "KeyP") {
    if (state === "play" || state === "dead") paused = !paused;
  } else if (e.code === "KeyM") {
    muted = !muted;
  } else if (e.code === "KeyH") {
    showHitboxes = !showHitboxes;
  }
});

function startLevelSelectFromTitle() {
  showSelect();
}

canvas.addEventListener("mousedown", () => {
  if (state === "title") startLevelSelectFromTitle();
  else if (state === "play") doJump();
});
canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  if (state === "title") startLevelSelectFromTitle();
  else if (state === "play") doJump();
});

titleScreen.addEventListener("click", startLevelSelectFromTitle);
winScreen.addEventListener("click", showSelect);

// -------------------------------------------------------------- Rendering -
function drawShape(shape, x, y, size, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (shape === 0) {
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape === 1) {
    ctx.strokeRect(-size / 2, -size / 2, size, size);
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(size / 2, size / 2);
    ctx.lineTo(-size / 2, size / 2);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  const c1 = level ? level.def.c1 : "#2ee6a8";
  const c2 = level ? level.def.c2 : "#0e6b52";
  grad.addColorStop(0, c2);
  grad.addColorStop(1, "#0a0a12");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // slow pulsing glow orb, drifting gently side to side
  const orbX = VIEW_W * 0.78 + Math.sin(elapsed * 0.15) * 60;
  const orbY = VIEW_H * 0.22 + Math.cos(elapsed * 0.1) * 20;
  const orbPulse = 0.55 + Math.sin(elapsed * 0.8) * 0.15;
  const orbR = 150;
  const orbAlphaHex = Math.round(orbPulse * 70).toString(16).padStart(2, "0");
  const orbGrad = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, orbR);
  orbGrad.addColorStop(0, c1 + orbAlphaHex);
  orbGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = orbGrad;
  ctx.fillRect(orbX - orbR, orbY - orbR, orbR * 2, orbR * 2);

  // parallax stripes with a gentle opacity pulse
  ctx.globalAlpha = 0.1 + Math.sin(elapsed * 0.6) * 0.03;
  ctx.fillStyle = c1;
  const stripeW = 60;
  const offset = (camX * 0.3) % (stripeW * 2);
  for (let x = -stripeW * 2; x < VIEW_W + stripeW * 2; x += stripeW * 2) {
    ctx.fillRect(x - offset, 0, stripeW, VIEW_H);
  }
  ctx.globalAlpha = 1;

  // floating decorative geometry (two parallax depths, no collision)
  if (level && level.bgShapes) {
    ctx.lineWidth = 2;
    const startX = camX - PLAYER_SCREEN_X - 300;
    const endX = startX + VIEW_W + 600;
    for (const s of level.bgShapes) {
      if (s.x < startX || s.x > endX) continue;
      const depth = s.layer === 0 ? 0.35 : 0.6;
      const sx = s.x - camX * depth + PLAYER_SCREEN_X;
      ctx.globalAlpha = s.layer === 0 ? 0.1 : 0.18;
      ctx.strokeStyle = c1;
      drawShape(s.shape, sx, s.y, s.size, s.rot + camX * 0.0006);
    }
    ctx.globalAlpha = 1;
  }

  // subtle vignette for depth
  const vg = ctx.createRadialGradient(
    VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35,
    VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.9
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawGroundAndBlocks() {
  const startX = camX - PLAYER_SCREEN_X;
  const endX = startX + VIEW_W + 60;
  for (const f of level.floors) {
    if (f.x2 < startX || f.x1 > endX) continue;
    const sx = f.x1 - camX + PLAYER_SCREEN_X;
    const w = f.x2 - f.x1;
    if (f.topY === null) continue; // pit — nothing drawn, it's a gap
    const topScreenY = f.topY;
    if (f.block) {
      const blockH = VIEW_H - topScreenY;
      ctx.fillStyle = level.def.c1;
      ctx.fillRect(sx, topScreenY, w, blockH);

      // diagonal stripe texture
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, topScreenY, w, blockH);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 6;
      for (let d = -blockH; d < w + blockH; d += 18) {
        ctx.beginPath();
        ctx.moveTo(sx + d, topScreenY + blockH);
        ctx.lineTo(sx + d + blockH, topScreenY);
        ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, topScreenY, w, blockH);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(sx, topScreenY, w, 4);
    } else {
      ctx.fillStyle = "#20202f";
      ctx.fillRect(sx, topScreenY, w, VIEW_H - topScreenY);

      // ground tick-mark texture
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 2;
      const tickStart = Math.floor((f.x1 - camX + PLAYER_SCREEN_X) / 24) * 24;
      for (let tx = tickStart; tx < sx + w; tx += 24) {
        if (tx < sx) continue;
        ctx.beginPath();
        ctx.moveTo(tx, topScreenY + 10);
        ctx.lineTo(tx, VIEW_H);
        ctx.stroke();
      }

      ctx.fillStyle = level.def.c1;
      ctx.fillRect(sx, topScreenY, w, 6);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(sx, topScreenY + 6, w, 2);

      // small zigzag "teeth" strip just under the surface, purely cosmetic
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      const toothW = 16;
      const toothStart = Math.floor((f.x1 - camX + PLAYER_SCREEN_X) / toothW) * toothW;
      for (let tx = toothStart; tx < sx + w; tx += toothW) {
        if (tx < sx) continue;
        ctx.beginPath();
        ctx.moveTo(tx, topScreenY + 8);
        ctx.lineTo(tx + toothW / 2, topScreenY + 16);
        ctx.lineTo(tx + toothW, topScreenY + 8);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

function drawObstacles() {
  const startX = camX - PLAYER_SCREEN_X;
  const endX = startX + VIEW_W + 60;
  for (const o of level.obstacles) {
    if (o.x + o.w < startX || o.x - o.w > endX) continue;
    const sx = o.x - camX + PLAYER_SCREEN_X;
    if (o.type === "spike") {
      ctx.save();
      ctx.shadowColor = level.def.c1;
      ctx.shadowBlur = 14;
      const grad = ctx.createLinearGradient(sx, GROUND_Y - o.h, sx, GROUND_Y);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, level.def.c1);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sx, GROUND_Y);
      ctx.lineTo(sx + o.w / 2, GROUND_Y - o.h);
      ctx.lineTo(sx + o.w, GROUND_Y);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawTrail() {
  for (const t of trail) {
    ctx.globalAlpha = Math.max(0, t.t / 0.35) * 0.35;
    ctx.save();
    ctx.translate(PLAYER_SCREEN_X - t.age * 90, t.y + PLAYER_SIZE / 2);
    ctx.rotate(t.rot);
    ctx.fillStyle = level ? level.def.c1 : "#2ee6a8";
    ctx.fillRect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE * 0.7, PLAYER_SIZE * 0.7);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const sx = PLAYER_SCREEN_X;
  ctx.save();
  ctx.translate(sx + PLAYER_SIZE / 2, player.y + PLAYER_SIZE / 2);
  ctx.rotate(player.rot);
  ctx.fillStyle = level ? level.def.c1 : "#2ee6a8";
  ctx.fillRect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
  ctx.fillStyle = "#0a0a12";
  ctx.beginPath();
  ctx.arc(-PLAYER_SIZE * 0.15, -PLAYER_SIZE * 0.1, 3.5, 0, Math.PI * 2);
  ctx.arc(PLAYER_SIZE * 0.18, -PLAYER_SIZE * 0.1, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.t / 0.6);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - camX + PLAYER_SCREEN_X - 3, p.y - 3, 6, 6);
  }
  ctx.globalAlpha = 1;
}

function drawDust() {
  for (const d of dust) {
    ctx.globalAlpha = Math.max(0, d.t / 0.4) * 0.35;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(d.x - camX + PLAYER_SCREEN_X - 2, d.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
}

// Debug overlay (toggle with H): draws the actual collision boxes used by
// die(), which are smaller/tighter than the drawn sprites, so it's clear
// exactly what counts as a hit.
let showHitboxes = false;
function drawHitboxes() {
  if (!level) return;
  ctx.strokeStyle = "#39ff6a";
  ctx.lineWidth = 2;
  ctx.strokeRect(PLAYER_SCREEN_X + 6, player.y + 6, PLAYER_SIZE - 12, PLAYER_SIZE - 12);

  ctx.strokeStyle = "#ff3b3b";
  const startX = camX - PLAYER_SCREEN_X;
  const endX = startX + VIEW_W + 60;
  for (const o of level.obstacles) {
    if (o.type !== "spike") continue;
    if (o.x + o.w < startX || o.x - o.w > endX) continue;
    const sx = o.x - camX + PLAYER_SCREEN_X;
    ctx.strokeRect(sx + o.w * 0.25, GROUND_Y - o.h + 6, o.w * 0.5, o.h - 6);
  }

  ctx.strokeStyle = "#ffcf3b";
  for (const f of level.floors) {
    if (!f.block) continue;
    if (f.x2 < startX || f.x1 > endX) continue;
    const sx = f.x1 - camX + PLAYER_SCREEN_X;
    ctx.strokeRect(sx, f.topY, 10, VIEW_H - f.topY);
  }
}

// --------------------------------------------------------------- Update ---
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

let lastTime = performance.now();
let elapsed = 0;
function frame(now) {
  let dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  elapsed += dt;
  requestAnimationFrame(frame);

  if (state === "play" && !paused) update(dt);

  drawBackground();
  if (level) {
    drawGroundAndBlocks();
    drawObstacles();
  }
  if (state === "play" || state === "dead") {
    drawDust();
    drawTrail();
    drawPlayer();
  }
  drawParticles();
  if (showHitboxes && (state === "play" || state === "dead")) drawHitboxes();

  if (state === "play") {
    const pct = Math.min(100, Math.max(0, Math.floor((camX / (level.length - VIEW_W + PLAYER_SCREEN_X)) * 100)));
    hudPercent.textContent = pct + "%";
    hudAttempts.textContent = "Attempt " + attempts;
  }
}

function update(dt) {
  // particles still tick during death freeze-frame via separate loop below
  camX += level.speed * dt;
  player.x = camX;

  player.vy += GRAVITY * dt;
  player.y += player.vy * dt;

  if (!player.onGround) {
    trail.push({ y: player.y, rot: player.rot, t: 0.35, age: 0 });
  }
  for (const t of trail) {
    t.t -= dt;
    t.age += dt;
  }
  trail = trail.filter((t) => t.t > 0);

  const feetX1 = player.x + 4;
  const feetX2 = player.x + PLAYER_SIZE - 4;
  const f1 = floorAt(level.floors, feetX1);
  const f2 = floorAt(level.floors, feetX2);
  const topY = Math.min(
    f1 ? f1.topY ?? Infinity : Infinity,
    f2 ? f2.topY ?? Infinity : Infinity
  );

  // Falling into a pit (no floor under the player at all)
  if (topY === Infinity) {
    if (player.y + PLAYER_SIZE > GROUND_Y + 30) {
      die();
      return;
    }
    player.onGround = false;
  } else {
    const bottom = player.y + PLAYER_SIZE;
    if (bottom >= topY) {
      if (player.vy >= 0) {
        player.y = topY - PLAYER_SIZE;
        player.vy = 0;
        player.onGround = true;
      } else {
        // Moving upward into the underside of a block: not modeled as a
        // hazard here since blocks only ever sit on the ground.
      }
    } else {
      player.onGround = false;
    }
  }

  // Hitting the face of a raised block while below its top = death.
  for (const f of level.floors) {
    if (!f.block) continue;
    if (feetX2 < f.x1 || feetX1 > f.x2) continue;
    if (player.y + PLAYER_SIZE > f.topY + 2 && player.x + PLAYER_SIZE - 6 > f.x1 && player.x + 6 < f.x1 + 10) {
      die();
      return;
    }
  }

  if (!player.onGround) {
    player.rot += dt * 9;
  } else {
    player.rot = Math.round(player.rot / (Math.PI / 2)) * (Math.PI / 2);
  }

  const playerBox = { x: player.x + 6, y: player.y + 6, w: PLAYER_SIZE - 12, h: PLAYER_SIZE - 12 };
  for (const o of level.obstacles) {
    if (o.type === "spike") {
      const spikeBox = { x: o.x + o.w * 0.25, y: GROUND_Y - o.h + 6, w: o.w * 0.5, h: o.h - 6 };
      if (rectsOverlap(playerBox, spikeBox)) {
        die();
        return;
      }
    }
  }

  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += GRAVITY * 0.5 * dt;
    p.t -= dt;
  }
  particles = particles.filter((p) => p.t > 0);

  // Small dust kicked up behind the cube while it's grounded and moving.
  if (player.onGround) {
    player.dustTimer -= dt;
    if (player.dustTimer <= 0) {
      dust.push({ x: player.x + 4, y: GROUND_Y - 2, t: 0.4 });
      player.dustTimer = 0.05;
    }
  }
  for (const d of dust) d.t -= dt;
  dust = dust.filter((d) => d.t > 0);

  if (camX >= level.length - VIEW_W + PLAYER_SCREEN_X - 20) {
    win();
  }
}

requestAnimationFrame(frame);
