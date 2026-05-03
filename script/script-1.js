(function () {
  "use strict";

  const ROWS = 8;
  const COLS = 8;
  const FRUIT_TYPES = 6;
  const BASE_TIME = 120;
  const LEVEL_SCORE_THRESHOLD = 250;

  const FRUITS = ["🍎", "🍋", "🍈", "🍊", "🍐", "🍒"];
  const COLORS = ["#ff6174", "#FFF000", "#078a42", "#E9692C", "#6db105", "#F12F3A"];

  const canvas = document.getElementById("gameCanvas");
  let ctx = canvas ? canvas.getContext("2d") : null;
  const timeSpan = document.getElementById("time");
  const scoreSpan = document.getElementById("score");
  const levelSpan = document.getElementById("level");
  const comboDisplay = document.getElementById("comboDisplay");
  const gameoverMsg = document.getElementById("gameoverMsg");
  const restartButton = document.getElementById("restartButton");
  const hintButton = document.getElementById("hintButton");
  const muteButton = document.getElementById("muteButton");

  function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem("limeSound", soundEnabled);
    muteButton.classList.toggle("muted", !soundEnabled);
    if (bgmAudio) {
      if (soundEnabled) bgmAudio.play().catch(() => {});
      else bgmAudio.pause();
    }
  }

  // muteButton listener attached after soundEnabled is declared (moved to initGame)

  let board = [];
  let selected = null;
  let score = 0;
  let level = 1;
  let timeLeft = BASE_TIME;
  let combo = 0;
  let gameActive = true;
  let paused = false;
  let busy = false;
  let particles = [];
  let shakeIntensity = 0;
  let tapCombo = 1;
  let lastSwapTime = 0;
  const COMBO_TIMEOUT = 1200;
  let blastAudio = null;
  let sparkleAudio = null;
  let soundEnabled = localStorage.getItem("limeSound") !== "false";
  let clickAudio = null;
  let winAudio = null;
  let bgmAudio = null;
  let tileSize = 60;
  let coins = parseInt(localStorage.getItem("limeCoins") || "0");
  let lastDaily = localStorage.getItem("limeLastDaily") || 0;
  let leaderboard = JSON.parse(localStorage.getItem("limeLeaderboard") || "[]");
  let timerInterval = null;
  let rewardedAdsUsed = 0;           // limit rewarded ads per session
  const MAX_REWARDED_ADS = 3;
  // Glass fill state
  const GLASS_MAX = 100;       // fruits needed to fill glass
  let glassLevel = 0;          // 0–100
  let glassAnimLevel = 0;      // smooth display value

  let audioCtx = null;

  function initAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {
      audioCtx = null;
    }

    // Full sound system
    const loadSound = (name, vol = 0.5) => {
      try {
        const audio = new Audio(`sound/${name}.mp3`);
        audio.preload = "auto";
        audio.volume = vol;
        return audio;
      } catch (e) {
        console.warn(`${name} preload failed`);
        return null;
      }
    };

    blastAudio = loadSound("balst-sound", 0.6);
    sparkleAudio = loadSound("sparkle-sound", 0.4);
    clickAudio = null; // No file, use synth
    winAudio = null; // No file, use synth
    bgmAudio = null; // No file, use synth

    // Load mute state
    const savedMute = localStorage.getItem("limeSound");
    soundEnabled = savedMute === null ? true : savedMute !== "false";
  }

  function playSFX(audio, fallbackFreq = 0) {
    if (!soundEnabled) return;
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
    if (fallbackFreq) playSound(fallbackFreq, 0.08, "triangle");
  }

  function playSound(freq, duration, type) {
    if (!audioCtx || audioCtx.state !== "running") return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audioCtx.currentTime + duration,
      );
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      // Ignore audio failures; gameplay should continue.
    }
  }

  function randomFruit() {
    return Math.floor(Math.random() * FRUIT_TYPES);
  }

  function createTile(r, c, val) {
    return {
      r: r,
      c: c,
      val: val,
      x: c * tileSize,
      y: r * tileSize,
      targetX: c * tileSize,
      targetY: r * tileSize,
    };
  }

  function syncTargets() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tile = board[r][c];
        tile.r = r;
        tile.c = c;
        tile.targetX = c * tileSize;
        tile.targetY = r * tileSize;
      }
    }
  }

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function hasLocalMatch(boardRef, r, c) {
    const val = boardRef[r][c].val;
    if (val < 0) return false;

    let count = 1;
    for (let cc = c - 1; cc >= 0 && boardRef[r][cc].val === val; cc--) count++;
    for (let cc = c + 1; cc < COLS && boardRef[r][cc].val === val; cc++)
      count++;
    if (count >= 3) return true;

    count = 1;
    for (let rr = r - 1; rr >= 0 && boardRef[rr][c].val === val; rr--) count++;
    for (let rr = r + 1; rr < ROWS && boardRef[rr][c].val === val; rr++)
      count++;
    return count >= 3;
  }

  function findMatches(boardRef) {
    const keySet = new Set();

    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const start = c;
        const val = boardRef[r][c].val;
        while (c + 1 < COLS && boardRef[r][c + 1].val === val) c++;
        const len = c - start + 1;
        if (val >= 0 && len >= 3) {
          for (let k = start; k <= c; k++) keySet.add(r + "," + k);
        }
        c++;
      }
    }

    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        const start = r;
        const val = boardRef[r][c].val;
        while (r + 1 < ROWS && boardRef[r + 1][c].val === val) r++;
        const len = r - start + 1;
        if (val >= 0 && len >= 3) {
          for (let k = start; k <= r; k++) keySet.add(k + "," + c);
        }
        r++;
      }
    }

    const list = [];
    keySet.forEach((key) => {
      const parts = key.split(",");
      list.push({ r: parseInt(parts[0], 10), c: parseInt(parts[1], 10) });
    });
    return list;
  }

  function swapTiles(boardRef, r1, c1, r2, c2) {
    const temp = boardRef[r1][c1].val;
    boardRef[r1][c1].val = boardRef[r2][c2].val;
    boardRef[r2][c2].val = temp;
  }

  function hasPossibleMoves(boardRef) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const dirs = [
          [0, 1],
          [1, 0],
        ];
        for (let i = 0; i < dirs.length; i++) {
          const nr = r + dirs[i][0];
          const nc = c + dirs[i][1];
          if (!inBounds(nr, nc)) continue;
          swapTiles(boardRef, r, c, nr, nc);
          const ok =
            hasLocalMatch(boardRef, r, c) || hasLocalMatch(boardRef, nr, nc);
          swapTiles(boardRef, r, c, nr, nc);
          if (ok) return true;
        }
      }
    }
    return false;
  }

  function buildBoardNoStartingMatches() {
    const b = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => createTile(r, c, 0)),
    );

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const candidates = [];
        for (let v = 0; v < FRUIT_TYPES; v++) {
          const leftBad =
            c >= 2 && b[r][c - 1].val === v && b[r][c - 2].val === v;
          const upBad =
            r >= 2 && b[r - 1][c].val === v && b[r - 2][c].val === v;
          if (!leftBad && !upBad) candidates.push(v);
        }
        const pool = candidates.length > 0 ? candidates : [randomFruit()];
        b[r][c].val = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    return b;
  }

  function reshuffleUntilPlayable() {
    let attempts = 0;
    do {
      board = buildBoardNoStartingMatches();
      attempts++;
    } while (!hasPossibleMoves(board) && attempts < 50);
  }

  function collapseAndRefill() {
    for (let c = 0; c < COLS; c++) {
      const values = [];
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][c].val >= 0) values.push(board[r][c].val);
      }
      while (values.length < ROWS) values.push(randomFruit());
      for (let r = ROWS - 1, idx = 0; r >= 0; r--, idx++) {
        board[r][c].val = values[idx];
      }
    }
  }

  function resolveCascades(tapComboParam = 1) {
    const tapCombo = tapComboParam;
    let any = false;
    let chain = 0;
    const MAX_CHAIN = 30;

    while (chain < MAX_CHAIN) {
      const matches = findMatches(board);
      if (matches.length === 0) break;
      any = true;
      chain++;
      combo = chain;
      comboDisplay.innerText = String(combo);

      score += Math.floor(matches.length * 10 * (1 + chain * 0.25));

      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const tileX = board[m.r][m.c].x + tileSize / 2;
        const tileY = board[m.r][m.c].y + tileSize / 2;
        spawnExplosion(particles, tileX, tileY, chain * tapCombo);
        spawnSparkle(particles, tileX, tileY, chain * tapCombo);
        board[m.r][m.c].val = -1;
      }

      updateGlass(matches.length);
      collapseAndRefill();
      syncTargets();
      playSFX(blastAudio);
      shakeIntensity += matches.length * 0.5 * chain * tapCombo;
    }

    if (!any) {
      combo = 0;
      comboDisplay.innerText = "0";
    }

    const newLevel = 1 + Math.floor(score / LEVEL_SCORE_THRESHOLD);
    if (newLevel > level) {
      level = newLevel;
      timeLeft = Math.min(99, timeLeft + 10);
      playSound(760, 0.12, "square");
    }

    if (!hasPossibleMoves(board)) {
      reshuffleUntilPlayable();
      syncTargets();
      gameoverMsg.innerText = "No moves. Reshuffled!";
    }

    updateUI();
    return any;
  }

  function updateGlass(fruitsMatched) {
    glassLevel = Math.min(GLASS_MAX, glassLevel + fruitsMatched);
    const pct = Math.round((glassLevel / GLASS_MAX) * 100);
    const liquid = document.getElementById("glassLiquid");
    const pctLabel = document.getElementById("glassPct");
    const outer = document.querySelector(".glass-outer");
    const wrap = document.querySelector(".glass-wrap");
    const stream = document.getElementById("glassStream");
    if (!liquid) return;

    // Trigger pouring animation with dynamic height
    if (fruitsMatched > 0 && wrap && stream) {
      // Stream height = 100% - current liquid %
      stream.style.height = (100 - pct) + "%";
      
      wrap.classList.add("pouring");
      clearTimeout(wrap._pourTimer);
      wrap._pourTimer = setTimeout(() => {
        wrap.classList.remove("pouring");
      }, 800);
    }

    const isMobile = window.innerWidth <= 480;
    if (isMobile) {
      liquid.style.width  = pct + "%";
      liquid.style.height = "100%";
    } else {
      liquid.style.height = pct + "%";
      liquid.style.width  = "100%";
    }

    if (pctLabel) pctLabel.innerText = pct + "%";

    if (pct >= 100) {
      liquid.classList.add("full");
      outer && outer.classList.add("full");
      if (pctLabel) pctLabel.style.color = "#facc15";
    } else if (pct > 60) {
      liquid.style.background = "linear-gradient(180deg, #86efac 0%, #22c55e 60%, #16a34a 100%)";
    }

    spawnGlassBubble();

    if (glassLevel >= GLASS_MAX && gameActive) {
      showResult(true);
    }
  }

  function spawnGlassBubble() {
    const container = document.getElementById("glassBubbles");
    if (!container) return;
    const b = document.createElement("div");
    b.className = "bubble";
    const size = 4 + Math.random() * 6;
    b.style.width = size + "px";
    b.style.height = size + "px";
    b.style.left = (10 + Math.random() * 70) + "%";
    b.style.bottom = (Math.random() * 30) + "%";
    b.style.animationDuration = (1.2 + Math.random() * 1.5) + "s";
    b.style.animationDelay = (Math.random() * 0.5) + "s";
    container.appendChild(b);
    setTimeout(() => b.remove(), 3000);
  }

  function showResult(win) {
    gameActive = false;
    if (timerInterval) clearInterval(timerInterval);

    const overlay = document.getElementById("resultOverlay");
    const icon    = document.getElementById("resultIcon");
    const title   = document.getElementById("resultTitle");
    const sub     = document.getElementById("resultSub");
    if (!overlay) return;

    if (win) {
      icon.innerText  = "🏆";
      title.innerText = "YOU WIN!";
      title.className = "result-title win";
      sub.innerText   = `Glass filled! Score: ${score}`;
      playSound(880, 0.15, "sine");
      setTimeout(() => playSound(1100, 0.12, "sine"), 180);
    } else {
      icon.innerText  = "💧";
      title.innerText = "TIME'S UP!";
      title.className = "result-title lose";
      const pct = Math.round((glassLevel / GLASS_MAX) * 100);
      sub.innerText   = `Glass was ${pct}% full. Score: ${score}`;
      playSound(200, 0.22, "sawtooth");
    }

    overlay.classList.add("show");

    // Show/hide the "Watch Ad for Extra Life" button (only on loss, not win)
    const resultAdBtn = document.getElementById("resultAdBtn");
    if (resultAdBtn) {
      if (!win && rewardedAdsUsed < MAX_REWARDED_ADS) {
        resultAdBtn.style.display = "block";
      } else {
        resultAdBtn.style.display = "none";
      }
    }

    // Save leaderboard
    leaderboard.push({ name: "You", score, date: Date.now() });
    leaderboard.sort((a, b) => b.score - a.score);
    leaderboard = leaderboard.slice(0, 10);
    localStorage.setItem("limeLeaderboard", JSON.stringify(leaderboard));
  }

  function updateUI() {
    scoreSpan.innerText = String(score);
    levelSpan.innerText = String(level);
    timeSpan.innerText = String(timeLeft);
    const coinsSpan = document.getElementById("coins");
    if (coinsSpan) coinsSpan.innerText = coins;
  }

  function gameOver() {
    showResult(false);
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(function () {
      if (!gameActive || paused) return;
      timeLeft--;
      if (timeLeft <= 0) {
        timeLeft = 0;
        updateUI();
        gameOver();
        return;
      }
      updateUI();
    }, 1000);
  }

  function togglePause() {
    if (!gameActive) return;
    paused = !paused;
    const pauseBtn = document.getElementById("pauseButton");
    if (pauseBtn) pauseBtn.innerText = paused ? "▶ RESUME" : "⏸ PAUSE";
  }

  function restartGame() {
    score = 0;
    level = 1;
    timeLeft = BASE_TIME;
    combo = 0;
    tapCombo = 1;
    lastSwapTime = 0;
    particles = [];
    shakeIntensity = 0;
    selected = null;
    gameActive = true;
    paused = false;
    busy = false;
    rewardedAdsUsed = 0;  // reset ad count on full restart
    gameoverMsg.innerText = "";
    comboDisplay.innerText = "0";
    const pauseBtn = document.getElementById("pauseButton");
    if (pauseBtn) pauseBtn.innerText = "⏸ PAUSE";

    // Reset glass
    glassLevel = 0;
    const liquid = document.getElementById("glassLiquid");
    const pctLabel = document.getElementById("glassPct");
    const outer = document.querySelector(".glass-outer");
    if (liquid) { liquid.style.height = "0%"; liquid.style.width = "0%"; liquid.classList.remove("full"); liquid.style.background = ""; }
    if (outer) outer.classList.remove("full");
    if (pctLabel) { pctLabel.innerText = "0%"; pctLabel.style.color = ""; }

    // Hide result overlay
    const overlay = document.getElementById("resultOverlay");
    if (overlay) overlay.classList.remove("show");

    reshuffleUntilPlayable();
    syncTargets();
    updateUI();
    startTimer();
    playSound(520, 0.08, "sine");
  }

  function findHintMove() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const dirs = [
          [0, 1],
          [1, 0],
        ];
        for (let i = 0; i < dirs.length; i++) {
          const nr = r + dirs[i][0];
          const nc = c + dirs[i][1];
          if (!inBounds(nr, nc)) continue;
          swapTiles(board, r, c, nr, nc);
          const ok = hasLocalMatch(board, r, c) || hasLocalMatch(board, nr, nc);
          swapTiles(board, r, c, nr, nc);
          if (ok) return { r: r, c: c };
        }
      }
    }
    return null;
  }

  function drawRoundedRectPath(ctxRef, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    if (typeof ctxRef.roundRect === "function") {
      ctxRef.roundRect(x, y, w, h, r);
      return;
    }
    ctxRef.moveTo(x + r, y);
    ctxRef.lineTo(x + w - r, y);
    ctxRef.quadraticCurveTo(x + w, y, x + w, y + r);
    ctxRef.lineTo(x + w, y + h - r);
    ctxRef.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctxRef.lineTo(x + r, y + h);
    ctxRef.quadraticCurveTo(x, y + h, x, y + h - r);
    ctxRef.lineTo(x, y + r);
    ctxRef.quadraticCurveTo(x, y, x + r, y);
  }

  function drawBoard() {
    try {
      if (!ctx || canvas.width <= 0 || canvas.height <= 0) return;

      if (shakeIntensity > 0) {
        ctx.save();
        ctx.translate(
          (Math.random() - 0.5) * shakeIntensity,
          (Math.random() - 0.5) * shakeIntensity,
        );
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Subtle grid lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= COLS; i++) {
        ctx.beginPath();
        ctx.moveTo(i * tileSize, 0);
        ctx.lineTo(i * tileSize, canvas.height);
        ctx.stroke();
      }
      for (let i = 0; i <= ROWS; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * tileSize);
        ctx.lineTo(canvas.width, i * tileSize);
        ctx.stroke();
      }

      if (!board || board.length === 0) {
         ctx.fillStyle = "rgba(255,255,255,0.3)";
         ctx.font = "bold 18px 'Inter', sans-serif";
         ctx.textAlign = "center";
         ctx.textBaseline = "middle";
         ctx.fillText("Loading...", canvas.width / 2, canvas.height / 2);
         return;
      }

      for (let r = 0; r < ROWS; r++) {
        if (!board[r]) continue;
        for (let c = 0; c < COLS; c++) {
          const tile = board[r][c];
          if (!tile) continue;

          if (typeof tile.x === 'undefined' || Number.isNaN(tile.x)) {
             tile.x = c * tileSize;
             tile.targetX = tile.x;
          }
          if (typeof tile.y === 'undefined' || Number.isNaN(tile.y)) {
             tile.y = r * tileSize;
             tile.targetY = tile.y;
          }

          tile.x += (tile.targetX - tile.x) * 0.28;
          tile.y += (tile.targetY - tile.y) * 0.28;

          const x = tile.x;
          const y = tile.y;
          const val = tile.val >= 0 ? tile.val : 0;

          // Clean white tile background
          const themeColor = COLORS[val] || "#cbd5e1";
          ctx.fillStyle = "#ffffff";
          ctx.shadowColor = "rgba(0,0,0,0.06)";
          ctx.shadowBlur = 8;
          ctx.shadowOffsetY = 3;
          ctx.beginPath();
          drawRoundedRectPath(ctx, x + 3, y + 3, tileSize - 6, tileSize - 6, 12);
          ctx.fill();
          ctx.shadowColor = "transparent";

          // Colored border to keep the theme intact
          ctx.strokeStyle = themeColor;
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Selection highlight glow
          if (selected && selected.r === r && selected.c === c) {
            ctx.shadowColor = themeColor;
            ctx.shadowBlur = 15;
            ctx.strokeStyle = themeColor;
            ctx.lineWidth = 4;
            ctx.beginPath();
            drawRoundedRectPath(ctx, x + 3, y + 3, tileSize - 6, tileSize - 6, 12);
            ctx.stroke();
            ctx.shadowBlur = 0;
          }

          // Draw fruit emoji on top of colored background
          const emojiSize = Math.floor(tileSize * 0.68);
          ctx.font = emojiSize + "px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          const fruitIcon = FRUITS[val] || "?";
          // Subtle drop shadow behind emoji
          ctx.shadowColor = "rgba(0,0,0,0.35)";
          ctx.shadowBlur = 6;
          ctx.shadowOffsetX = 1;
          ctx.shadowOffsetY = 2;
          ctx.fillText(fruitIcon, x + tileSize / 2, y + tileSize / 2);
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
        }
      }
      if (shakeIntensity > 0) ctx.restore();
      drawParticles();

      // Paused overlay
      if (paused) {
        ctx.fillStyle = "rgba(10, 20, 40, 0.7)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#fff";
        ctx.font = "bold " + Math.floor(tileSize * 0.8) + "px 'Poppins', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⏸ PAUSED", canvas.width / 2, canvas.height / 2);
      }
    } catch (e) {
      if (document.getElementById("gameoverMsg")) {
        document.getElementById("gameoverMsg").innerText = "Draw Error: " + e.message;
      }
    }
  }

  function checkTapComboTimeout() {
    const now = Date.now();
    if (now - lastSwapTime > COMBO_TIMEOUT) {
      tapCombo = 1;
    }
  }

  function decayShake() {
    shakeIntensity *= 0.92;
    if (shakeIntensity < 0.01) shakeIntensity = 0;
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08; // gravity
      p.life--;
      p.rot += p.rotSpeed || 0;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      // friction
      p.vx *= 0.98;
      p.vy *= 0.98;
    }
  }

  function drawParticles() {
    for (let p of particles) {
      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha * alpha;
      ctx.translate(p.x, p.y);
      ctx.scale(p.scale * alpha, p.scale * alpha);

      if (p.type === "explosion") {
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
        grad.addColorStop(0, `rgba(255, 150, 0, 0.9)`);
        grad.addColorStop(0.6, `rgba(255, 200, 100, 0.6)`);
        grad.addColorStop(1, `rgba(255, 255, 100, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === "sparkle") {
        ctx.rotate(p.rot);
        ctx.font = "bold 16px 'Segoe UI Emoji'";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = `hsl(60, 100%, 80%)`;
        ctx.shadowColor = "#ffff88";
        ctx.shadowBlur = 8;
        ctx.fillText("✨", 0, 0);
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }
  }

  function animationLoop() {
    if (particles.length > 200) particles.length = 150; // perf limit
    checkTapComboTimeout();
    decayShake();
    updateParticles();
    drawBoard();
    requestAnimationFrame(animationLoop);
  }

  window.addEventListener("resize", () => {
    // Force a redraw if needed, though requestAnimationFrame handles it.
    // We could adjust internal tileSize if we wanted dynamic resolution,
    // but CSS handles the scaling fine for now.
    updateUI(); 
  });

  function toCellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const c = Math.floor(x / tileSize);
    const r = Math.floor(y / tileSize);
    if (!inBounds(r, c)) return null;
    return { r: r, c: c };
  }

  function tryMove(r1, c1, r2, c2) {
    if (busy || !gameActive) return;
    busy = true;

    swapTiles(board, r1, c1, r2, c2);
    const isValid =
      hasLocalMatch(board, r1, c1) || hasLocalMatch(board, r2, c2);
    if (!isValid) {
      swapTiles(board, r1, c1, r2, c2);
      busy = false;
      playSound(280, 0.08, "sawtooth");
      return;
    }

    combo = 0;
    comboDisplay.innerText = "0";
    playSound(560, 0.06, "triangle");

    // Update tap combo
    const now = Date.now();
    if (now - lastSwapTime < COMBO_TIMEOUT) {
      tapCombo++;
    } else {
      tapCombo = 1;
    }
    lastSwapTime = now;

    resolveCascades(tapCombo);
    busy = false;
  }

  function handlePointerDown(e) {
    if (!gameActive || paused) return;
    e.preventDefault();
    initAudio();
    playSFX(clickAudio, 800); // tile click sound

    const cell = toCellFromEvent(e);
    if (!cell) return;

    if (!selected) {
      selected = cell;
      return;
    }

    const dr = Math.abs(selected.r - cell.r);
    const dc = Math.abs(selected.c - cell.c);
    if (dr + dc !== 1) {
      selected = cell;
      return;
    }

    tryMove(selected.r, selected.c, cell.r, cell.c);
    selected = null;
  }

  function resizeCanvas() {
    const isMobile = window.innerWidth <= 480;
    const container = canvas.closest(".game-container") || document.body;
    const padX = isMobile ? 20 : 48;
    // Compute gap from the actual rendered play-area element.
    // The CSS variable uses clamp() so parseInt on it returns NaN;
    // reading the computed gap property gives the resolved pixel value.
    const playArea = document.querySelector(".play-area");
    let computedGap = 12;
    if (playArea) {
      const g = parseFloat(getComputedStyle(playArea).gap);
      if (isFinite(g)) computedGap = g;
    }
    const glassW = isMobile ? 0 : (document.querySelector(".glass-wrap")?.offsetWidth || 70) + computedGap;
    const containerW = container.clientWidth || container.offsetWidth || window.innerWidth;
    const available = containerW - padX - glassW;
    let size = Math.floor(Math.max(220, Math.min(560, available)));
    // Guard against NaN / zero — fall back to 480 (HTML attribute default)
    if (!isFinite(size) || size <= 0) size = 480;
    canvas.style.width  = size + "px";
    canvas.style.height = size + "px";
    canvas.width  = size;
    canvas.height = size;
    tileSize = size / COLS;
    // Re-obtain context after canvas buffer resize
    ctx = canvas.getContext("2d");
    if (board.length === ROWS) syncTargets();
  }

  function showFatal(message) {
    console.error("FATAL:", message);
    if (gameoverMsg) {
      gameoverMsg.innerText = "ERROR: " + message;
      gameoverMsg.style.color = "#ff9e9e";
    }
  }

  function watchAd(callback) {
    const overlay = document.getElementById("adOverlay");
    const progress = document.getElementById("adProgress");
    const status = document.getElementById("adStatus");
    const skipBtn = document.getElementById("adSkipBtn");

    // Reset state
    progress.style.width = "0%";
    status.textContent = "Loading ad...";
    if (skipBtn) skipBtn.style.display = "none";

    overlay.classList.remove("hidden");
    overlay.classList.add("show");

    let prog = 0;
    let failed = false;
    const interval = setInterval(() => {
      if (failed) return;
      prog += Math.random() * 8;
      if (prog > 100) prog = 100;
      progress.style.width = prog + "%";

      if (prog >= 100) {
        clearInterval(interval);
        status.textContent = "Ad complete! Reward earned ✓";
        if (skipBtn) skipBtn.style.display = "inline-block";

        setTimeout(() => {
          overlay.classList.remove("show");
          overlay.classList.add("hidden");
          if (skipBtn) skipBtn.style.display = "none";
          if (callback) callback(true); // reward
        }, 1500);
      }
    }, 80);

    // Fake fail chance (10%)
    if (Math.random() < 0.1) {
      failed = true;
      setTimeout(() => {
        clearInterval(interval);
        status.textContent = "Ad unavailable. Try again later.";
        if (skipBtn) {
          skipBtn.style.display = "inline-block";
          skipBtn.onclick = () => {
            overlay.classList.remove("show");
            overlay.classList.add("hidden");
            skipBtn.style.display = "none";
            if (callback) callback(false);
          };
        } else {
          setTimeout(() => {
            overlay.classList.remove("show");
            overlay.classList.add("hidden");
            if (callback) callback(false);
          }, 1500);
        }
      }, 2000);
    }
  }

  /** Grant an extra life: restore time and resume the game */
  function grantExtraLife() {
    rewardedAdsUsed++;
    timeLeft = Math.min(999, timeLeft + 30);
    gameActive = true;
    paused = false;
    busy = false;

    // Hide result overlay
    const overlay = document.getElementById("resultOverlay");
    if (overlay) overlay.classList.remove("show");

    coins += 100;
    localStorage.setItem("limeCoins", coins);
    gameoverMsg.innerText = "🎁 Extra Life! +30s +100💰";
    setTimeout(() => (gameoverMsg.innerText = ""), 3000);

    startTimer();
    updateUI();
    playSound(660, 0.1, "sine");
    setTimeout(() => playSound(880, 0.08, "sine"), 120);
  }

  function initGame() {
    console.log("initGame started");
    if (!canvas) {
      console.error("Canvas #gameCanvas missing");
      return showFatal("Canvas missing");
    }
    if (!(ctx = canvas.getContext("2d"))) {
      console.error("Canvas context failed");
      return showFatal("Canvas 2D context failed");
    }
    if (!timeSpan) console.error("#time missing");
    if (!scoreSpan) console.error("#score missing");
    if (!levelSpan) console.error("#level missing");
    if (!comboDisplay) console.error("#comboDisplay missing");
    if (!gameoverMsg) console.error("#gameoverMsg missing");
    console.log("initGame checks passed");

    // Daily reward check
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    if (now - parseInt(lastDaily) > oneDay) {
      coins += 50;
      lastDaily = now;
      localStorage.setItem("limeLastDaily", lastDaily);
      localStorage.setItem("limeCoins", coins);
      gameoverMsg.innerText = "📅 Daily +50💰!";
    }

    // Leaderboard bonus (local fake top 10) — saved on game over, not on init
    coins += 25;
    localStorage.setItem("limeCoins", coins);
    gameoverMsg.innerText += " 🏆 +25💰!";

    setTimeout(() => (gameoverMsg.innerText = ""), 4000);

    window.addEventListener("error", function (event) {
      showFatal(event.message || "Unknown error");
    });

    resizeCanvas();
    restartGame();
    console.log("Starting render loop");
    animationLoop();

    canvas.addEventListener("pointerdown", handlePointerDown, {
      passive: false,
    });
    console.log("Event listeners attached");
    window.addEventListener("resize", resizeCanvas);

    const resultBtn = document.getElementById("resultBtn");
    if (resultBtn) resultBtn.addEventListener("click", () => restartGame());

    // Rewarded ad on game-over: "Watch Ad for Extra Life"
    const resultAdBtn = document.getElementById("resultAdBtn");
    if (resultAdBtn) {
      resultAdBtn.addEventListener("click", () => {
        watchAd((reward) => {
          if (reward) {
            grantExtraLife();
          }
        });
      });
    }

    if (muteButton) {
      muteButton.classList.toggle("muted", !soundEnabled);
      muteButton.addEventListener("click", toggleSound);
    }

    if (restartButton) {
      restartButton.addEventListener("click", function () {
        restartGame();
      });
    }

    if (hintButton) {
      hintButton.addEventListener("click", function () {
        if (!gameActive || paused) return;
        const hint = findHintMove();
        if (hint) {
          selected = hint;
          playSound(720, 0.06, "sine");
        } else {
          reshuffleUntilPlayable();
          syncTargets();
          gameoverMsg.innerText = "No moves. Reshuffled!";
        }
      });
    }

    const pauseButton = document.getElementById("pauseButton");
    if (pauseButton) {
      pauseButton.addEventListener("click", togglePause);
    }

    // Coin buttons
    const dailyButton = document.getElementById("dailyButton");
    if (dailyButton) {
      dailyButton.addEventListener("click", () => {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        if (now - parseInt(lastDaily) > oneDay) {
          coins += 50;
          lastDaily = now;
          localStorage.setItem("limeLastDaily", lastDaily);
          localStorage.setItem("limeCoins", coins);
          gameoverMsg.innerText = "📅 +50💰";
        } else {
          gameoverMsg.innerText = "📅 Tomorrow";
        }
        setTimeout(() => (gameoverMsg.innerText = ""), 2000);
        updateUI();
      });
    }

    const leaderButton = document.getElementById("leaderButton");
    if (leaderButton) {
      leaderButton.addEventListener("click", () => {
        let msg = "🏆 TOP\n";
        leaderboard
          .slice(0, 10)
          .forEach((e, i) => (msg += `${i + 1}. ${e.name}: ${e.score}\n`));
        gameoverMsg.innerText = msg;
        setTimeout(() => (gameoverMsg.innerText = ""), 5000);
      });
    }

    const adButton = document.getElementById("adButton");
    if (adButton) {
      adButton.addEventListener("click", () => {
        watchAd((reward) => {
          if (reward) {
            timeLeft = Math.min(99, timeLeft + 30);
            coins += 100;
            localStorage.setItem("limeCoins", coins);
            gameoverMsg.innerText = "🎁 +30s +100💰";
            setTimeout(() => (gameoverMsg.innerText = ""), 2000);
            updateUI();
          }
        });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initGame();
    });
  } else {
    initGame();
  }
})();
