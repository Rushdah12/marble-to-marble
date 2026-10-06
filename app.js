/* ========================================================
   MARBLE-TO-MARBLE — Sand Furrow & Physical Marble Engine
   - Inspired directly by in-sand-1.jpg & in-sand-2.jpg (Carved sand furrows)
   - Inspired directly by marble-1.jpg & marble-2.jpg (Artisanal glass marbles)
   - Features:
     * Natural glass depth with internal agate/cat-eye swirl ribbon
     * Ground bounce reflection from warm sand
     * Sand bed indentation & displaced sand lip
     * Directional slide shadow with refracted sunlight caustics
     * Trapped micro-bubbles & dual specular reflections
     * "more marbles", "less marbles", "shake it!"
   ======================================================== */

(() => {
  'use strict';

  // --- Configuration ---
  const CONFIG = {
    initialDotCount: 38,
    minDots: 8,                // Minimum marbles allowed in arena
    maxDots: 105,              // Maximum marbles allowed
    dotRadius: 7.2,            // Marble radius in px (compact dot marbles)
    minDotSpacing: 22,         // Spacing to keep dots beautifully distributed
    
    // Arena Boundaries (Carved boundary in sand)
    arenaPadX: 44,             // Padding from canvas edge
    arenaPadY: 36,
    
    // Physics
    shakeDuration: 850,        // ms
    shakeMaxVelocity: 14,      // Max initial impulse velocity
    friction: 0.962,           // Friction damping per frame
    restitution: 0.62,         // Wall & marble bounciness
    hitPadding: 14,            // Generous touch/click tolerance for easy interaction
    
    // Sunlight vector (Light from top-left ~65° onto sand)
    shadowAngle: Math.PI * 0.38,   // ~68 degrees (down and right)
    shadowDistance: 8.5,           // Slide shadow extension proportional to marble size
    shadowBlurLength: 13,          // Shadow length
    shadowBaseColor: 'rgba(40, 20, 8, 0.54)',
    shadowFadeColor: 'rgba(40, 20, 8, 0.0)',
    contactShadowColor: 'rgba(26, 12, 5, 0.76)',

    // Uniform Ocean Sea-Glass Marble Palette (Inspired by marble-2.jpg)
    marble: {
      highlight: [215, 245, 255],     // Sky cyan specular base
      mid: [12, 125, 180],            // Deep sea-glass blue
      shadow: [4, 40, 70],            // Midnight depth
      glow: [56, 189, 248],           // Translucent internal light & caustic
    },

    // Selected Marble Palette (Warm Radiant Amber/Topaz)
    marbleSelected: {
      highlight: [255, 237, 213],
      mid: [234, 88, 12],
      shadow: [124, 45, 18],
      glow: [251, 146, 60],
    },

    // Hovered Marble Palette
    marbleHover: {
      highlight: [230, 248, 255],
      mid: [2, 138, 205],
      shadow: [3, 52, 85],
      glow: [125, 211, 252],
    }
  };

  // --- State ---
  let dots = [];
  let connections = [];
  let selectedDotId = null;
  let hoveredDotId = null;
  let targetHoverDotId = null;
  let activeStroke = null;
  let dragMoved = false;
  let dragStartPos = { x: 0, y: 0 };
  let isShaking = false;
  let animFrameId = null;
  let sandBoundaryPoints = [];
  let sandBoundaryCrumbs = [];

  // --- Powder Chalk & Eraser State ---
  let activeChalkColor = null; // null = Carve Mode (Marbles), 'red' | 'blue' | 'green' | 'white'
  let isEraserActive = false;  // Eraser drag tool
  let isErasing = false;       // Active eraser drag in progress
  let eraserLastPos = null;
  let eraserHoverPos = null;
  let erasedInCurrentStroke = { chalk: [], conns: [] };
  let lastEraseSoundTime = 0;
  let chalkBrushSize = 18;     // 10 (fine), 18 (medium), 32 (wide)
  let chalkStrokes = [];       // Array of { color, size, points, specks }
  let activeChalkStroke = null;
  let actionHistory = [];      // Combined undo history

  // --- DOM Elements ---
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const chalkArena = document.getElementById('chalkArena');
  const btnShake = document.getElementById('btnShake');
  const btnMoreMarbles = document.getElementById('btnMoreMarbles');
  const btnLessMarbles = document.getElementById('btnLessMarbles');
  const btnClear = document.getElementById('btnClear');
  
  // Side Panel Elements
  const sidePanelWrapper = document.getElementById('sidePanelWrapper');
  const sidePanelTab = document.getElementById('sidePanelTab');
  const panelCloseBtn = document.getElementById('panelCloseBtn');
  const marbleCountDisplay = document.getElementById('marbleCountDisplay');
  const connectionCountDisplay = document.getElementById('connectionCountDisplay');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const panelAudioToggle = document.getElementById('panelAudioToggle');
  const downloadBtn = document.getElementById('downloadBtn');
  const panelDownloadBtn = document.getElementById('panelDownloadBtn');

  // Preloaded beach assets for high-res PNG keepsake export
  // Uses window.BEACH_ASSETS (data URIs) to completely eliminate CORS and canvas tainting on file:/// and local servers
  const assets = (typeof window !== 'undefined' && window.BEACH_ASSETS) || {};

  function createAssetImage(srcData, fallbackUrl) {
    const img = new Image();
    img.src = srcData || fallbackUrl;
    return img;
  }

  const sandBgImg = createAssetImage(assets.sandBg, 'design/beach-sand.jpg');
  const shellScallopImg = createAssetImage(assets.shellScallop, 'design/shell-scallop.png');
  const shellStarfishImg = createAssetImage(assets.shellStarfish, 'design/shell-starfish.png');
  const shellSanddollarImg = createAssetImage(assets.shellSanddollar, 'design/shell-sanddollar.png');
  const shellSpiralImg = createAssetImage(assets.shellSpiral, 'design/shell-spiral.png');
  const pebbleTanImg = createAssetImage(assets.pebbleTan, 'design/pebble-tan.png');
  const pebbleTerraImg = createAssetImage(assets.pebbleTerra, 'design/pebble-terracotta.png');
  const pebbleGraniteImg = createAssetImage(assets.pebbleGranite, 'design/pebble-granite.png');

  // --- Realistic Physical Sound Engine (Glass Marbles & Beach Sand) ---
  const SoundEngine = (() => {
    let isMuted = false;
    let audioCtx = null;
    let lastCollisionTime = 0;

    // Load persisted mute preference (default: enabled)
    try {
      if (localStorage.getItem('dot_shaker_muted') === 'true') {
        isMuted = true;
      }
    } catch (_) {}

    // HTML5 Audio Pools
    let shakeAudios = [];
    let clinkAudios = [];
    let slideAudios = [];

    function init() {
      // Find DOM audio elements
      shakeAudios = [
        document.getElementById('audioShake1'),
        document.getElementById('audioShake2')
      ].filter(Boolean);

      clinkAudios = [
        document.getElementById('audioClink1'),
        document.getElementById('audioClink2'),
        document.getElementById('audioClink3')
      ].filter(Boolean);

      slideAudios = [
        document.getElementById('audioSlide1'),
        document.getElementById('audioSlide2')
      ].filter(Boolean);

      // Fallback in case DOM wasn't ready
      if (shakeAudios.length === 0) {
        shakeAudios = [new Audio('design/marble-shake.wav'), new Audio('design/marble-shake.wav')];
      }
      if (clinkAudios.length === 0) {
        clinkAudios = [new Audio('design/marble-clink.wav'), new Audio('design/marble-clink.wav')];
      }
      if (slideAudios.length === 0) {
        slideAudios = [new Audio('design/sand-slide.wav')];
      }

      // Preload & prime all audio elements
      [...shakeAudios, ...clinkAudios, ...slideAudios].forEach(a => {
        try {
          a.preload = 'auto';
          a.load();
        } catch (_) {}
      });

      // User gesture unlock for Web Audio API & mobile audio policies
      const unlockAudio = () => {
        try {
          if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) audioCtx = new AudioContextClass();
          }
          if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
        } catch (_) {}

        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      };
      window.addEventListener('pointerdown', unlockAudio, { passive: true });
      window.addEventListener('keydown', unlockAudio, { passive: true });

      updateAudioUI();
    }

    function updateAudioUI() {
      if (soundToggleBtn) {
        soundToggleBtn.classList.toggle('is-muted', isMuted);
        soundToggleBtn.setAttribute('title', isMuted ? 'Sound: Muted (Click to turn on)' : 'Sound: Enabled (Click to mute)');
      }
      if (panelAudioToggle) {
        panelAudioToggle.classList.toggle('is-muted', isMuted);
        panelAudioToggle.textContent = isMuted ? 'Muted' : 'Enabled';
      }
    }

    function playAudioFromPool(pool, volume = 1.0, playbackRate = 1.0) {
      if (isMuted || !pool || pool.length === 0) return;
      try {
        const audio = pool[Math.floor(Math.random() * pool.length)];
        audio.pause();
        audio.currentTime = 0;
        audio.volume = Math.max(0, Math.min(1.0, volume));
        audio.playbackRate = Math.max(0.5, Math.min(2.0, playbackRate));
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(err => {
            console.warn('[SoundEngine] Audio play prevented by browser:', err);
          });
        }
      } catch (e) {
        console.warn('[SoundEngine] Play error:', e);
      }
    }

    return {
      init,
      playShake: () => {
        if (isMuted) return;
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
        // Organic pitch variation for gentle natural marble scatter
        const rate = 0.95 + Math.random() * 0.10;
        playAudioFromPool(shakeAudios, 0.42, rate);
      },
      playCollision: (velocity, normX) => {
        if (isMuted) return;
        const now = performance.now();
        if (now - lastCollisionTime < 40) return;
        lastCollisionTime = now;
        const vol = Math.min(0.28, Math.max(0.08, velocity * 0.025));
        const rate = 0.92 + Math.random() * 0.16;
        playAudioFromPool(clinkAudios, vol, rate);
      },
      playBoundaryHit: (velocity, normX) => {
        if (isMuted) return;
        const now = performance.now();
        if (now - lastCollisionTime < 50) return;
        lastCollisionTime = now;
        const vol = Math.min(0.22, Math.max(0.06, velocity * 0.02));
        playAudioFromPool(clinkAudios, vol, 0.88);
      },
      playSelect: () => {
        if (isMuted) return;
        playAudioFromPool(clinkAudios, 0.22, 1.2);
      },
      playConnect: () => {
        if (isMuted) return;
        playAudioFromPool(clinkAudios, 0.30, 1.35);
      },
      playAddMarbles: () => {
        if (isMuted) return;
        playAudioFromPool(slideAudios, 0.35, 1.02);
      },
      playRemoveMarbles: () => {
        if (isMuted) return;
        playAudioFromPool(slideAudios, 0.25, 0.92);
      },
      playCarveSand: () => {
        if (isMuted) return;
        playAudioFromPool(slideAudios, 0.16, 1.25);
      },
      toggleMute: () => {
        isMuted = !isMuted;
        try {
          localStorage.setItem('dot_shaker_muted', isMuted);
        } catch (_) {}
        updateAudioUI();
        if (!isMuted) {
          playAudioFromPool(clinkAudios, 0.25, 1.15);
        }
        return isMuted;
      },
      isMuted: () => isMuted
    };
  })();

  // --- Canvas Resizing & Sand Furrow Generation ---
  function resizeCanvas() {
    const rect = chalkArena.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    generateSandBoundary(rect.width, rect.height);
  }

  // --- Procedural Sand Furrow Boundary (Inspired by in-sand-1.jpg) ---
  function generateSandBoundary(w, h) {
    const padX = CONFIG.arenaPadX;
    const padY = CONFIG.arenaPadY;
    const left = padX;
    const right = w - padX;
    const top = padY;
    const bottom = h - padY;
    const r = 24;

    const points = [];
    const segmentsPerSide = 18;

    function wobble(mag = 2.2) {
      return (Math.random() - 0.5) * mag * 2;
    }

    // Top edge
    for (let i = 0; i <= segmentsPerSide; i++) {
      const t = i / segmentsPerSide;
      const x = left + r + t * (right - left - 2 * r);
      const sag = Math.sin(t * Math.PI) * 2.2;
      points.push({ x: x + wobble(1.2), y: top + sag + wobble(1.5) });
    }

    // Top-Right Corner
    for (let a = -Math.PI / 2; a <= 0; a += Math.PI / 8) {
      const cx = right - r;
      const cy = top + r;
      points.push({
        x: cx + Math.cos(a) * (r + wobble(1.4)),
        y: cy + Math.sin(a) * (r + wobble(1.4))
      });
    }

    // Right edge
    for (let i = 0; i <= segmentsPerSide; i++) {
      const t = i / segmentsPerSide;
      const y = top + r + t * (bottom - top - 2 * r);
      const wave = Math.sin(t * Math.PI * 2) * 1.8;
      points.push({ x: right + wave + wobble(1.5), y: y + wobble(1.2) });
    }

    // Bottom-Right Corner
    for (let a = 0; a <= Math.PI / 2; a += Math.PI / 8) {
      const cx = right - r;
      const cy = bottom - r;
      points.push({
        x: cx + Math.cos(a) * (r + wobble(1.4)),
        y: cy + Math.sin(a) * (r + wobble(1.4))
      });
    }

    // Bottom edge
    for (let i = 0; i <= segmentsPerSide; i++) {
      const t = i / segmentsPerSide;
      const x = right - r - t * (right - left - 2 * r);
      const sag = Math.sin(t * Math.PI) * 2.0;
      points.push({ x: x + wobble(1.2), y: bottom + sag + wobble(1.5) });
    }

    // Bottom-Left Corner
    for (let a = Math.PI / 2; a <= Math.PI; a += Math.PI / 8) {
      const cx = left + r;
      const cy = bottom - r;
      points.push({
        x: cx + Math.cos(a) * (r + wobble(1.4)),
        y: cy + Math.sin(a) * (r + wobble(1.4))
      });
    }

    // Left edge
    for (let i = 0; i <= segmentsPerSide; i++) {
      const t = i / segmentsPerSide;
      const y = bottom - r - t * (bottom - top - 2 * r);
      const wave = Math.sin(t * Math.PI * 2) * 1.8;
      points.push({ x: left + wave + wobble(1.5), y: y + wobble(1.2) });
    }

    // Top-Left Corner
    for (let a = Math.PI; a <= Math.PI * 1.5; a += Math.PI / 8) {
      const cx = left + r;
      const cy = top + r;
      points.push({
        x: cx + Math.cos(a) * (r + wobble(1.4)),
        y: cy + Math.sin(a) * (r + wobble(1.4))
      });
    }

    // Closure overlap
    points.push({
      x: left + r + 8 + wobble(1.8),
      y: top + wobble(1.8)
    });

    sandBoundaryPoints = points;

    // Displaced sand crumbs along the furrow edges
    sandBoundaryCrumbs = [];
    for (let i = 0; i < points.length; i++) {
      if (Math.random() > 0.4) {
        const p = points[i];
        const offsetDist = 3.5 + Math.random() * 5.0;
        const offsetAngle = Math.random() * Math.PI * 2;
        sandBoundaryCrumbs.push({
          x: p.x + Math.cos(offsetAngle) * offsetDist,
          y: p.y + Math.sin(offsetAngle) * offsetDist,
          radius: 0.9 + Math.random() * 1.8,
          isHighlight: Math.sin(offsetAngle) < 0.2
        });
      }
    }
  }

  // --- Smooth Bezier Path Helper for Natural Fluid Sand Curves ---
  function traceSmoothPath(context, pts, offsetX = 0, offsetY = 0) {
    if (!pts || pts.length < 2) return;
    context.moveTo(pts[0].x + offsetX, pts[0].y + offsetY);
    if (pts.length === 2) {
      context.lineTo(pts[1].x + offsetX, pts[1].y + offsetY);
      return;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) * 0.5 + offsetX;
      const yc = (pts[i].y + pts[i + 1].y) * 0.5 + offsetY;
      context.quadraticCurveTo(pts[i].x + offsetX, pts[i].y + offsetY, xc, yc);
    }
    const last = pts[pts.length - 1];
    context.lineTo(last.x + offsetX, last.y + offsetY);
  }

  // --- Draw a Realistic Carved Furrow in Wet Sand (in-sand-1 & 2) ---
  function drawSandFurrow(pts, width = 5.2, targetCtx = ctx) {
    if (!pts || pts.length < 2) return;

    targetCtx.save();
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';

    // 1. Cast shadow of the lower berm
    targetCtx.beginPath();
    traceSmoothPath(targetCtx, pts, 1.8, 2.8);
    targetCtx.strokeStyle = 'rgba(38, 20, 8, 0.32)';
    targetCtx.lineWidth = width + 4.2;
    targetCtx.stroke();

    // 2. Sunlit crest on the raised sand berm
    targetCtx.beginPath();
    traceSmoothPath(targetCtx, pts, -1.4, -2.0);
    targetCtx.strokeStyle = 'rgba(255, 245, 220, 0.68)';
    targetCtx.lineWidth = width + 2.6;
    targetCtx.stroke();

    // 3. Deep moist trench
    targetCtx.beginPath();
    traceSmoothPath(targetCtx, pts, 0, 0);
    targetCtx.strokeStyle = 'rgba(30, 15, 6, 0.88)';
    targetCtx.lineWidth = width;
    targetCtx.stroke();

    // 4. Center incision cleft
    targetCtx.beginPath();
    traceSmoothPath(targetCtx, pts, 0, 0);
    targetCtx.strokeStyle = 'rgba(15, 7, 2, 0.96)';
    targetCtx.lineWidth = width * 0.42;
    targetCtx.stroke();

    targetCtx.restore();
  }

  // --- Render Boundary Furrow ---
  function renderSandBoundary(targetCtx = ctx) {
    if (!sandBoundaryPoints || sandBoundaryPoints.length === 0) return;

    drawSandFurrow(sandBoundaryPoints, 5.6, targetCtx);

    targetCtx.save();
    for (const crumb of sandBoundaryCrumbs) {
      targetCtx.beginPath();
      targetCtx.arc(crumb.x + 0.8, crumb.y + 1.2, crumb.radius, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(35, 18, 7, 0.55)';
      targetCtx.fill();

      targetCtx.beginPath();
      targetCtx.arc(crumb.x, crumb.y, crumb.radius, 0, Math.PI * 2);
      targetCtx.fillStyle = crumb.isHighlight 
        ? 'rgba(255, 245, 222, 0.82)' 
        : 'rgba(50, 26, 12, 0.85)';
      targetCtx.fill();
    }
    targetCtx.restore();
  }

  // --- Displaced Sand Crumbs Along a Carved Furrow ---
  function generateLineCrumbs(pts) {
    if (!pts || pts.length < 2) return [];
    const crumbs = [];
    const count = Math.min(14, Math.max(3, Math.floor(pts.length / 8)));
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * (pts.length - 1));
      const p = pts[idx];
      const angle = Math.random() * Math.PI * 2;
      const dist = 3.5 + Math.random() * 4.5;
      crumbs.push({
        x: p.x + Math.cos(angle) * dist,
        y: p.y + Math.sin(angle) * dist,
        radius: 0.8 + Math.random() * 1.3,
        isHighlight: Math.sin(angle) < 0.25
      });
    }
    return crumbs;
  }

  // --- Generate Sand Line Points for Tap Connections ---
  function createSandLinePoints(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return [{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }];

    const steps = Math.max(6, Math.floor(len / 14));
    const pts = [];
    const perpX = -dy / len;
    const perpY = dx / len;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wobble = (i === 0 || i === steps) ? 0 : Math.sin(t * Math.PI) * 1.8;
      pts.push({
        x: p1.x + dx * t + perpX * wobble,
        y: p1.y + dy * t + perpY * wobble
      });
    }
    return pts;
  }

  // --- Render Sand Furrow Connection Line Between Two Points ---
  function renderSandLine(p1, p2, targetCtx = ctx) {
    const pts = createSandLinePoints(p1, p2);
    drawSandFurrow(pts, 3.8, targetCtx);
  }

  // --- Add or Update Connection with Custom Curved Path ---
  function addOrUpdateConnection(from, to, points) {
    if (from === to) return;
    const existingIndex = connections.findIndex(
      c => (c.from === from && c.to === to) || (c.from === to && c.to === from)
    );

    const crumbs = generateLineCrumbs(points);
    const newConn = { from, to, points: points ? [...points] : null, crumbs };

    if (existingIndex >= 0) {
      connections[existingIndex] = newConn;
    } else {
      connections.push(newConn);
      actionHistory.push({ type: 'conn' });
    }
    updateStats();
  }

  // --- Update Panel Stats ---
  function updateStats() {
    if (marbleCountDisplay) marbleCountDisplay.textContent = dots.length;
    if (connectionCountDisplay) connectionCountDisplay.textContent = connections.length;
  }

  // --- Marble Generation (With realistic internal features) ---
  function spawnMarble(w, h, existingDots) {
    const padX = CONFIG.arenaPadX + CONFIG.dotRadius + 8;
    const padY = CONFIG.arenaPadY + CONFIG.dotRadius + 8;
    let attempts = 0;
    const maxAttempts = 180;
    const minSpacingSq = CONFIG.minDotSpacing * CONFIG.minDotSpacing;

    while (attempts < maxAttempts) {
      attempts++;
      const x = padX + Math.random() * (w - 2 * padX);
      const y = padY + Math.random() * (h - 2 * padY);

      let tooClose = false;
      for (const d of existingDots) {
        const dx = d.x - x;
        const dy = d.y - y;
        if (dx * dx + dy * dy < minSpacingSq) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        return {
          id: existingDots.length,
          x,
          y,
          vx: 0,
          vy: 0,
          // Natural unique marble variations
          swirlAngle: Math.random() * Math.PI * 2,
          swirlThickness: 0.28 + Math.random() * 0.14,
          hasBubble: Math.random() > 0.35,
          bubbleX: (Math.random() - 0.5) * (CONFIG.dotRadius * 0.8),
          bubbleY: (Math.random() - 0.5) * (CONFIG.dotRadius * 0.8),
        };
      }
    }

    return {
      id: existingDots.length,
      x: padX + Math.random() * (w - 2 * padX),
      y: padY + Math.random() * (h - 2 * padY),
      vx: 0,
      vy: 0,
      swirlAngle: Math.random() * Math.PI * 2,
      swirlThickness: 0.3,
      hasBubble: false,
      bubbleX: 0,
      bubbleY: 0,
    };
  }

  function createInitialDots() {
    dots = [];
    const rect = chalkArena.getBoundingClientRect();
    const w = rect.width || 600;
    const h = rect.height || 400;

    for (let i = 0; i < CONFIG.initialDotCount; i++) {
      const marble = spawnMarble(w, h, dots);
      dots.push(marble);
    }
    updateStats();
  }

  // --- "More Marbles" Functionality ---
  function addMoreMarbles(count = 12) {
    if (dots.length >= CONFIG.maxDots) {
      btnMoreMarbles.style.transform = 'scale(0.95)';
      setTimeout(() => btnMoreMarbles.style.transform = '', 150);
      return;
    }

    const rect = chalkArena.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const toAdd = Math.min(count, CONFIG.maxDots - dots.length);

    for (let i = 0; i < toAdd; i++) {
      const marble = spawnMarble(w, h, dots);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 2.5;
      marble.vx = Math.cos(angle) * speed;
      marble.vy = Math.sin(angle) * speed;
      dots.push(marble);
    }

    updateStats();
    SoundEngine.playAddMarbles();
  }

  // --- "Less Marbles" Functionality ---
  function removeLessMarbles(count = 12) {
    if (dots.length <= CONFIG.minDots) {
      btnLessMarbles.style.transform = 'scale(0.95)';
      setTimeout(() => btnLessMarbles.style.transform = '', 150);
      return;
    }

    const toRemove = Math.min(count, dots.length - CONFIG.minDots);
    const newCount = dots.length - toRemove;

    dots.splice(newCount, toRemove);

    connections = connections.filter(
      c => c.from < newCount && c.to < newCount
    );

    if (selectedDotId !== null && selectedDotId >= newCount) {
      selectedDotId = null;
    }
    if (hoveredDotId !== null && hoveredDotId >= newCount) {
      hoveredDotId = null;
    }

    updateStats();
    SoundEngine.playRemoveMarbles();
  }

  // --- Shake Arena & Marbles Functionality ---
  function shake() {
    if (isShaking) return;
    isShaking = true;

    // Trigger realistic glass marble clatter + shifting sand audio
    SoundEngine.playShake();

    connections = [];
    chalkStrokes = [];
    actionHistory = [];
    selectedDotId = null;
    activeStroke = null;
    activeChalkStroke = null;
    targetHoverDotId = null;
    dragMoved = false;
    updateStats();

    for (const dot of dots) {
      const angle = Math.random() * Math.PI * 2;
      const speed = CONFIG.shakeMaxVelocity * (0.6 + Math.random() * 0.4);
      dot.vx = Math.cos(angle) * speed;
      dot.vy = Math.sin(angle) * speed;
      // Slight natural spin change on shake
      dot.swirlAngle += (Math.random() - 0.5) * 1.5;
    }

    chalkArena.classList.add('is-shaking');
    btnShake.disabled = true;

    chalkArena.addEventListener('animationend', () => {
      chalkArena.classList.remove('is-shaking');
    }, { once: true });

    setTimeout(() => {
      isShaking = false;
      btnShake.disabled = false;
    }, CONFIG.shakeDuration);
  }

  // --- Clear Connections ---
  function clearConnections() {
    connections = [];
    selectedDotId = null;
    activeStroke = null;
    targetHoverDotId = null;
    dragMoved = false;
    updateStats();
  }

  // --- Physics Step (Deceleration to completely static state) ---
  function physicsStep() {
    const rect = chalkArena.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const r = CONFIG.dotRadius;
    const padX = CONFIG.arenaPadX;
    const padY = CONFIG.arenaPadY;

    // 1. Move and bounce on sand boundary limits
    for (const dot of dots) {
      if (Math.abs(dot.vx) > 0.04 || Math.abs(dot.vy) > 0.04) {
        dot.vx *= CONFIG.friction;
        dot.vy *= CONFIG.friction;

        dot.x += dot.vx;
        dot.y += dot.vy;

        if (dot.x < padX + r) {
          dot.x = padX + r;
          if (Math.abs(dot.vx) > 1.6) SoundEngine.playBoundaryHit(Math.abs(dot.vx), dot.x / w);
          dot.vx = Math.abs(dot.vx) * CONFIG.restitution;
        } else if (dot.x > w - padX - r) {
          dot.x = w - padX - r;
          if (Math.abs(dot.vx) > 1.6) SoundEngine.playBoundaryHit(Math.abs(dot.vx), dot.x / w);
          dot.vx = -Math.abs(dot.vx) * CONFIG.restitution;
        }

        if (dot.y < padY + r) {
          dot.y = padY + r;
          if (Math.abs(dot.vy) > 1.6) SoundEngine.playBoundaryHit(Math.abs(dot.vy), dot.x / w);
          dot.vy = Math.abs(dot.vy) * CONFIG.restitution;
        } else if (dot.y > h - padY - r) {
          dot.y = h - padY - r;
          if (Math.abs(dot.vy) > 1.6) SoundEngine.playBoundaryHit(Math.abs(dot.vy), dot.x / w);
          dot.vy = -Math.abs(dot.vy) * CONFIG.restitution;
        }

        if (Math.abs(dot.vx) < 0.04) dot.vx = 0;
        if (Math.abs(dot.vy) < 0.04) dot.vy = 0;
      }
    }

    // 2. Marble-to-marble elastic collisions
    const minDist = r * 2 + 1;
    const minDistSq = minDist * minDist;

    for (let i = 0; i < dots.length; i++) {
      const a = dots[i];
      for (let j = i + 1; j < dots.length; j++) {
        const b = dots[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDistSq && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const overlap = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const ny = dy / dist;

          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;

          const dvx = a.vx - b.vx;
          const dvy = a.vy - b.vy;
          const dvDotN = dvx * nx + dvy * ny;

          if (dvDotN > 0) {
            a.vx -= dvDotN * nx * CONFIG.restitution;
            a.vy -= dvDotN * ny * CONFIG.restitution;
            b.vx += dvDotN * nx * CONFIG.restitution;
            b.vy += dvDotN * ny * CONFIG.restitution;

            // Trigger physical glass clink on marble impact
            if (dvDotN > 1.2) {
              SoundEngine.playCollision(dvDotN, (a.x + b.x) * 0.5 / w);
            }
          }
        }
      }
    }
  }

  // --- Rendering ---
  // --- Powder Chalk Configuration & Rendering (15 Artisanal Beach Pigments) ---
  const CHALK_COLORS = {
    red: {
      core: 'rgba(239, 68, 68, 0.82)',
      diffuse: 'rgba(239, 68, 68, 0.32)',
      speckLight: 'rgba(254, 202, 202, 0.92)',
      speckDark: 'rgba(185, 28, 28, 0.72)'
    },
    green: {
      core: 'rgba(34, 197, 94, 0.82)',
      diffuse: 'rgba(34, 197, 94, 0.32)',
      speckLight: 'rgba(187, 247, 208, 0.92)',
      speckDark: 'rgba(21, 128, 61, 0.72)'
    },
    blue: {
      core: 'rgba(59, 130, 246, 0.82)',
      diffuse: 'rgba(59, 130, 246, 0.32)',
      speckLight: 'rgba(191, 219, 254, 0.92)',
      speckDark: 'rgba(29, 78, 216, 0.72)'
    },
    black: {
      core: 'rgba(24, 24, 27, 0.92)',
      diffuse: 'rgba(39, 39, 42, 0.46)',
      speckLight: 'rgba(113, 113, 122, 0.75)',
      speckDark: 'rgba(9, 9, 11, 0.95)'
    },
    orange: {
      core: 'rgba(249, 115, 22, 0.84)',
      diffuse: 'rgba(251, 146, 60, 0.34)',
      speckLight: 'rgba(254, 215, 170, 0.92)',
      speckDark: 'rgba(194, 65, 12, 0.75)'
    },
    teal: {
      core: 'rgba(13, 148, 136, 0.82)',
      diffuse: 'rgba(20, 184, 166, 0.32)',
      speckLight: 'rgba(153, 246, 228, 0.92)',
      speckDark: 'rgba(15, 118, 110, 0.72)'
    },
    pink: {
      core: 'rgba(244, 63, 94, 0.82)',
      diffuse: 'rgba(251, 113, 133, 0.32)',
      speckLight: 'rgba(254, 205, 211, 0.92)',
      speckDark: 'rgba(190, 18, 60, 0.72)'
    },
    lime: {
      core: 'rgba(132, 204, 22, 0.84)',
      diffuse: 'rgba(163, 230, 53, 0.34)',
      speckLight: 'rgba(217, 249, 157, 0.92)',
      speckDark: 'rgba(77, 124, 15, 0.75)'
    },
    sky: {
      core: 'rgba(2, 132, 199, 0.82)',
      diffuse: 'rgba(56, 189, 248, 0.32)',
      speckLight: 'rgba(186, 230, 253, 0.92)',
      speckDark: 'rgba(3, 105, 161, 0.72)'
    },
    grey: {
      core: 'rgba(100, 116, 139, 0.84)',
      diffuse: 'rgba(148, 163, 184, 0.34)',
      speckLight: 'rgba(226, 232, 240, 0.92)',
      speckDark: 'rgba(51, 65, 85, 0.75)'
    },
    yellow: {
      core: 'rgba(234, 179, 8, 0.86)',
      diffuse: 'rgba(250, 204, 21, 0.36)',
      speckLight: 'rgba(254, 240, 138, 0.95)',
      speckDark: 'rgba(161, 98, 7, 0.75)'
    },
    mint: {
      core: 'rgba(6, 182, 212, 0.82)',
      diffuse: 'rgba(34, 211, 238, 0.32)',
      speckLight: 'rgba(165, 243, 252, 0.92)',
      speckDark: 'rgba(14, 116, 144, 0.72)'
    },
    terracotta: {
      core: 'rgba(194, 65, 12, 0.85)',
      diffuse: 'rgba(234, 88, 12, 0.35)',
      speckLight: 'rgba(255, 237, 213, 0.92)',
      speckDark: 'rgba(124, 45, 18, 0.75)'
    },
    purple: {
      core: 'rgba(139, 92, 246, 0.82)',
      diffuse: 'rgba(167, 139, 250, 0.32)',
      speckLight: 'rgba(221, 214, 254, 0.92)',
      speckDark: 'rgba(109, 40, 217, 0.72)'
    },
    white: {
      core: 'rgba(248, 250, 252, 0.88)',
      diffuse: 'rgba(241, 245, 249, 0.40)',
      speckLight: 'rgba(255, 255, 255, 0.96)',
      speckDark: 'rgba(203, 213, 225, 0.68)'
    }
  };

  // Strictly constrain powder chalk to the sand arena boundary
  function clipToSandArena(targetCtx) {
    if (sandBoundaryPoints && sandBoundaryPoints.length > 2) {
      targetCtx.beginPath();
      targetCtx.moveTo(sandBoundaryPoints[0].x, sandBoundaryPoints[0].y);
      for (let i = 1; i < sandBoundaryPoints.length; i++) {
        targetCtx.lineTo(sandBoundaryPoints[i].x, sandBoundaryPoints[i].y);
      }
      targetCtx.closePath();
      targetCtx.clip();
    } else {
      const rect = chalkArena.getBoundingClientRect();
      const padX = CONFIG.arenaPadX;
      const padY = CONFIG.arenaPadY;
      targetCtx.beginPath();
      targetCtx.rect(padX, padY, rect.width - padX * 2, rect.height - padY * 2);
      targetCtx.clip();
    }
  }

  function generateChalkSpecks(stroke, p1, p2) {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const count = Math.max(2, Math.round(dist * 0.45));
    const halfSize = (stroke.size || 18) * 0.65;

    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const cx = p1.x + (p2.x - p1.x) * t;
      const cy = p1.y + (p2.y - p1.y) * t;
      const angle = Math.random() * Math.PI * 2;
      const spread = (Math.random() ** 1.4) * halfSize;
      const sx = cx + Math.cos(angle) * spread;
      const sy = cy + Math.sin(angle) * spread;
      const r = 0.5 + Math.random() * 1.3;
      stroke.specks.push({
        x: sx,
        y: sy,
        r,
        isLight: Math.random() > 0.35
      });
    }
  }

  // --- Stroke Eraser Geometry Helpers (Cross-Stroke Removal) ---
  function distPointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    function ccw(ax, ay, bx, by, cx, cy) {
      return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
    }
    return (ccw(x1, y1, x3, y3, x4, y4) !== ccw(x2, y2, x3, y3, x4, y4)) &&
           (ccw(x1, y1, x2, y2, x3, y3) !== ccw(x1, y1, x2, y2, x4, y4));
  }

  function strokeIntersectsEraser(stroke, pPrev, pCurr, eraserRadius) {
    if (!stroke || !stroke.points || stroke.points.length === 0) return false;
    const pts = stroke.points;
    const strokeRadius = (stroke.size || 18) * 0.5;
    const threshold = eraserRadius + strokeRadius + 4;

    if (pts.length === 1) {
      return distPointToSegment(pts[0].x, pts[0].y, pPrev.x, pPrev.y, pCurr.x, pCurr.y) <= threshold;
    }

    for (let i = 0; i < pts.length - 1; i++) {
      const s1 = pts[i];
      const s2 = pts[i + 1];

      const minX = Math.min(s1.x, s2.x) - threshold;
      const maxX = Math.max(s1.x, s2.x) + threshold;
      const minY = Math.min(s1.y, s2.y) - threshold;
      const maxY = Math.max(s1.y, s2.y) + threshold;

      const eMinX = Math.min(pPrev.x, pCurr.x);
      const eMaxX = Math.max(pPrev.x, pCurr.x);
      const eMinY = Math.min(pPrev.y, pCurr.y);
      const eMaxY = Math.max(pPrev.y, pCurr.y);

      if (eMaxX < minX || eMinX > maxX || eMaxY < minY || eMinY > maxY) continue;

      if (segmentsIntersect(pPrev.x, pPrev.y, pCurr.x, pCurr.y, s1.x, s1.y, s2.x, s2.y)) {
        return true;
      }
      if (distPointToSegment(pCurr.x, pCurr.y, s1.x, s1.y, s2.x, s2.y) <= threshold) {
        return true;
      }
      if (distPointToSegment(s1.x, s1.y, pPrev.x, pPrev.y, pCurr.x, pCurr.y) <= threshold) {
        return true;
      }
    }
    return false;
  }

  function checkAndEraseAt(pPrev, pCurr) {
    const eraserRadius = Math.max(10, chalkBrushSize * 0.7);
    let removedAny = false;

    // 1. Check chalk strokes
    for (let i = chalkStrokes.length - 1; i >= 0; i--) {
      const stroke = chalkStrokes[i];
      if (strokeIntersectsEraser(stroke, pPrev, pCurr, eraserRadius)) {
        chalkStrokes.splice(i, 1);
        erasedInCurrentStroke.chalk.push(stroke);
        removedAny = true;
      }
    }

    // 2. Check connection lines
    for (let i = connections.length - 1; i >= 0; i--) {
      const conn = connections[i];
      const pts = conn.points || createSandLinePoints(dots[conn.from], dots[conn.to]);
      if (strokeIntersectsEraser({ points: pts, size: 4 }, pPrev, pCurr, eraserRadius)) {
        connections.splice(i, 1);
        erasedInCurrentStroke.conns.push(conn);
        removedAny = true;
        updateStats();
      }
    }

    if (removedAny) {
      const now = performance.now();
      if (now - lastEraseSoundTime > 140) {
        SoundEngine.playSlide();
        lastEraseSoundTime = now;
      }
    }
  }

  function drawPowderChalkStroke(stroke, targetCtx = ctx) {
    if (!stroke || !stroke.points || stroke.points.length === 0) return;
    const cfg = CHALK_COLORS[stroke.color];
    if (!cfg) return;

    const pts = stroke.points;
    const size = stroke.size || 18;

    targetCtx.save();

    // 1. Soft diffuse chalk powder halo
    targetCtx.lineWidth = size;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';
    targetCtx.strokeStyle = cfg.diffuse;

    targetCtx.beginPath();
    targetCtx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) {
      targetCtx.arc(pts[0].x, pts[0].y, size * 0.5, 0, Math.PI * 2);
      targetCtx.fillStyle = cfg.diffuse;
      targetCtx.fill();
    } else {
      for (let i = 1; i < pts.length; i++) {
        const midX = (pts[i - 1].x + pts[i].x) / 2;
        const midY = (pts[i - 1].y + pts[i].y) / 2;
        targetCtx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, midX, midY);
      }
      targetCtx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      targetCtx.stroke();
    }

    // 2. Rich core pigment streak
    targetCtx.lineWidth = size * 0.58;
    targetCtx.strokeStyle = cfg.core;
    if (pts.length === 1) {
      targetCtx.beginPath();
      targetCtx.arc(pts[0].x, pts[0].y, size * 0.29, 0, Math.PI * 2);
      targetCtx.fillStyle = cfg.core;
      targetCtx.fill();
    } else {
      targetCtx.stroke();
    }

    // 3. Dry chalk dust micro-specks
    if (stroke.specks && stroke.specks.length > 0) {
      for (const sp of stroke.specks) {
        targetCtx.beginPath();
        targetCtx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
        targetCtx.fillStyle = sp.isLight ? cfg.speckLight : cfg.speckDark;
        targetCtx.fill();
      }
    }

    targetCtx.restore();
  }

  function renderChalkLayer(targetCtx = ctx) {
    if (chalkStrokes.length === 0 && !activeChalkStroke) return;

    targetCtx.save();
    // Strictly clip to arena boundary so powder chalk can NEVER spill outside
    clipToSandArena(targetCtx);

    for (const stroke of chalkStrokes) {
      drawPowderChalkStroke(stroke, targetCtx);
    }
    if (activeChalkStroke) {
      drawPowderChalkStroke(activeChalkStroke, targetCtx);
    }

    targetCtx.restore();
  }

  // --- Render Scene (Boundary, Powder Chalk, Connections, Crumbs, Marbles) ---
  function renderScene(targetCtx = ctx, isExport = false) {
    // 1. Draw Sand Furrow Boundary
    renderSandBoundary(targetCtx);

    // 1b. Draw Powder Chalk Layer (strictly clipped inside the sand arena)
    renderChalkLayer(targetCtx);

    // 2. Draw Sand Furrow Connections
    for (const conn of connections) {
      if (conn.points && conn.points.length >= 2) {
        drawSandFurrow(conn.points, 3.8, targetCtx);
      } else {
        const from = dots[conn.from];
        const to = dots[conn.to];
        if (from && to) {
          renderSandLine(from, to, targetCtx);
        }
      }

      // Displaced sand crumbs along the furrow
      if (conn.crumbs && conn.crumbs.length > 0) {
        targetCtx.save();
        for (const crumb of conn.crumbs) {
          targetCtx.beginPath();
          targetCtx.arc(crumb.x + 0.6, crumb.y + 1.0, crumb.radius, 0, Math.PI * 2);
          targetCtx.fillStyle = 'rgba(35, 18, 7, 0.45)';
          targetCtx.fill();

          targetCtx.beginPath();
          targetCtx.arc(crumb.x, crumb.y, crumb.radius, 0, Math.PI * 2);
          targetCtx.fillStyle = crumb.isHighlight 
            ? 'rgba(255, 245, 222, 0.78)' 
            : 'rgba(50, 26, 12, 0.80)';
          targetCtx.fill();
        }
        targetCtx.restore();
      }
    }

    // 2b. Draw Live In-Progress Carving Stroke (Hold & Drag) - excluded in PNG export
    if (!isExport && activeStroke && activeStroke.points && activeStroke.points.length >= 2) {
      drawSandFurrow(activeStroke.points, 3.8, targetCtx);

      // Stylus / finger impression at current cursor tip
      const tip = activeStroke.points[activeStroke.points.length - 1];
      targetCtx.save();
      targetCtx.beginPath();
      targetCtx.arc(tip.x + 0.8, tip.y + 1.2, 3.2, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(255, 12, 4, 0.55)';
      targetCtx.fill();

      targetCtx.beginPath();
      targetCtx.arc(tip.x, tip.y, 2.5, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(40, 20, 8, 0.85)';
      targetCtx.fill();

      targetCtx.beginPath();
      targetCtx.arc(tip.x - 0.7, tip.y - 0.7, 1.2, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(255, 245, 225, 0.55)';
      targetCtx.fill();
      targetCtx.restore();
    }

    // 3. Draw Artisanal Glass Marbles on Sand
    const r = CONFIG.dotRadius;
    const shadowCos = Math.cos(CONFIG.shadowAngle);
    const shadowSin = Math.sin(CONFIG.shadowAngle);

    for (const dot of dots) {
      const isSelected = !isExport && (dot.id === selectedDotId);
      const isHovered = !isExport && (dot.id === hoveredDotId);

      const palette = isSelected 
        ? CONFIG.marbleSelected 
        : (isHovered ? CONFIG.marbleHover : CONFIG.marble);

      // A. Directional Slide Shadow with Glass Caustic on Sand
      targetCtx.save();
      const shadowCenterX = dot.x + shadowCos * CONFIG.shadowDistance;
      const shadowCenterY = dot.y + shadowSin * CONFIG.shadowDistance;
      
      targetCtx.translate(shadowCenterX, shadowCenterY);
      targetCtx.rotate(CONFIG.shadowAngle);

      // 1. Soft Penumbra Cast Shadow
      const shadowGrad = targetCtx.createRadialGradient(
        0, 0, r * 0.25,
        0, 0, CONFIG.shadowBlurLength
      );
      shadowGrad.addColorStop(0, CONFIG.shadowBaseColor);
      shadowGrad.addColorStop(0.55, 'rgba(40, 20, 8, 0.24)');
      shadowGrad.addColorStop(1, CONFIG.shadowFadeColor);

      targetCtx.beginPath();
      targetCtx.ellipse(0, 0, CONFIG.shadowBlurLength * 0.96, r * 0.88, 0, 0, Math.PI * 2);
      targetCtx.fillStyle = shadowGrad;
      targetCtx.fill();

      // 2. Refracted Sunlight Caustic
      const [cr, cg, cb] = palette.glow;
      const causticGrad = targetCtx.createRadialGradient(
        CONFIG.shadowBlurLength * 0.32, 0, 0,
        CONFIG.shadowBlurLength * 0.32, 0, r * 0.62
      );
      causticGrad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.38)`);
      causticGrad.addColorStop(0.65, `rgba(${cr}, ${cg}, ${cb}, 0.14)`);
      causticGrad.addColorStop(1, 'transparent');

      targetCtx.beginPath();
      targetCtx.ellipse(CONFIG.shadowBlurLength * 0.32, 0, r * 0.62, r * 0.40, 0, 0, Math.PI * 2);
      targetCtx.fillStyle = causticGrad;
      targetCtx.fill();

      targetCtx.restore();

      // B. Sand Bed Indentation
      targetCtx.beginPath();
      targetCtx.ellipse(dot.x, dot.y + r * 0.76, r * 0.80, r * 0.28, 0, 0, Math.PI * 2);
      targetCtx.fillStyle = CONFIG.contactShadowColor;
      targetCtx.fill();

      // Displaced sand lip highlight
      targetCtx.beginPath();
      targetCtx.ellipse(dot.x + 0.6, dot.y + r * 0.86, r * 0.82, r * 0.18, 0, 0, Math.PI * 2);
      targetCtx.strokeStyle = 'rgba(255, 245, 220, 0.32)';
      targetCtx.lineWidth = 0.9;
      targetCtx.stroke();

      // C. Selection & Target Aura (Behind marble) - omit when exporting!
      if (!isExport && isSelected) {
        targetCtx.beginPath();
        targetCtx.arc(dot.x, dot.y, r + 5, 0, Math.PI * 2);
        targetCtx.fillStyle = 'rgba(234, 88, 12, 0.28)';
        targetCtx.fill();
        targetCtx.lineWidth = 1.4;
        targetCtx.strokeStyle = 'rgba(234, 88, 12, 0.7)';
        targetCtx.stroke();
      }

      if (!isExport && dot.id === targetHoverDotId && (!activeStroke || dot.id !== activeStroke.fromDot.id)) {
        targetCtx.beginPath();
        targetCtx.arc(dot.x, dot.y, r + 6, 0, Math.PI * 2);
        targetCtx.fillStyle = 'rgba(56, 189, 248, 0.28)';
        targetCtx.fill();
        targetCtx.lineWidth = 1.5;
        targetCtx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        targetCtx.stroke();
      }

      // D. 3D Glass Marble Body
      targetCtx.save();
      targetCtx.beginPath();
      targetCtx.arc(dot.x, dot.y, r, 0, Math.PI * 2);
      targetCtx.clip();

      // 1. Deep Spherical Glass Base
      const bodyGrad = targetCtx.createRadialGradient(
        dot.x - r * 0.35, dot.y - r * 0.38, r * 0.06,
        dot.x, dot.y, r
      );
      const [hr, hg, hb] = palette.highlight;
      const [mr, mg, mb] = palette.mid;
      const [sr, sg, sb] = palette.shadow;

      bodyGrad.addColorStop(0, `rgb(${hr}, ${hg}, ${hb})`);
      bodyGrad.addColorStop(0.32, `rgb(${mr}, ${mg}, ${mb})`);
      bodyGrad.addColorStop(0.80, `rgb(${sr}, ${sg}, ${sb})`);
      bodyGrad.addColorStop(1, `rgb(${Math.max(0, sr - 18)}, ${Math.max(0, sg - 18)}, ${Math.max(0, sb - 18)})`);

      targetCtx.fillStyle = bodyGrad;
      targetCtx.fill();

      // 2. Sand Ground Bounce Light
      const bounceGrad = targetCtx.createRadialGradient(
        dot.x, dot.y + r * 0.92, r * 0.1,
        dot.x, dot.y + r * 0.65, r * 0.75
      );
      bounceGrad.addColorStop(0, 'rgba(235, 192, 135, 0.42)');
      bounceGrad.addColorStop(0.6, 'rgba(235, 192, 135, 0.12)');
      bounceGrad.addColorStop(1, 'transparent');
      targetCtx.fillStyle = bounceGrad;
      targetCtx.fill();

      // 3. Internal Agate / Cat-Eye Swirl Ribbon
      targetCtx.save();
      targetCtx.translate(dot.x, dot.y);
      targetCtx.rotate(dot.swirlAngle || 0);

      targetCtx.beginPath();
      const bandHeight = r * (dot.swirlThickness || 0.32);
      targetCtx.ellipse(0, 0, r * 0.88, bandHeight, 0, 0, Math.PI * 2);
      
      const swirlGrad = targetCtx.createLinearGradient(0, -bandHeight, 0, bandHeight);
      if (isSelected) {
        swirlGrad.addColorStop(0, 'rgba(254, 215, 170, 0.2)');
        swirlGrad.addColorStop(0.5, 'rgba(255, 237, 213, 0.82)');
        swirlGrad.addColorStop(1, 'rgba(254, 215, 170, 0.2)');
      } else {
        swirlGrad.addColorStop(0, 'rgba(165, 243, 252, 0.22)');
        swirlGrad.addColorStop(0.5, 'rgba(224, 247, 250, 0.85)');
        swirlGrad.addColorStop(1, 'rgba(165, 243, 252, 0.22)');
      }
      targetCtx.fillStyle = swirlGrad;
      targetCtx.fill();
      targetCtx.restore();

      // 4. Trapped Micro-Bubble
      if (dot.hasBubble) {
        const bx = dot.x + dot.bubbleX;
        const by = dot.y + dot.bubbleY;
        targetCtx.beginPath();
        targetCtx.arc(bx, by, 0.65, 0, Math.PI * 2);
        targetCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        targetCtx.fill();
        targetCtx.beginPath();
        targetCtx.arc(bx + 0.2, by + 0.2, 0.3, 0, Math.PI * 2);
        targetCtx.fillStyle = 'rgba(10, 30, 45, 0.45)';
        targetCtx.fill();
      }

      // 5. Internal Subsurface Glow
      const [gr, gg, gb] = palette.glow;
      const innerGlow = targetCtx.createRadialGradient(
        dot.x + r * 0.34, dot.y + r * 0.34, 0,
        dot.x + r * 0.24, dot.y + r * 0.24, r * 0.72
      );
      innerGlow.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, 0.52)`);
      innerGlow.addColorStop(0.68, `rgba(${gr}, ${gg}, ${gb}, 0.14)`);
      innerGlow.addColorStop(1, 'transparent');

      targetCtx.fillStyle = innerGlow;
      targetCtx.fill();

      targetCtx.restore(); // End sphere clip

      // E. Exterior Glass Specular Reflections
      // 1. Primary Blazing Sun Glint
      targetCtx.beginPath();
      targetCtx.arc(dot.x - r * 0.32, dot.y - r * 0.34, r * 0.22, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(255, 255, 255, 0.98)';
      targetCtx.fill();

      targetCtx.beginPath();
      targetCtx.arc(dot.x - r * 0.32, dot.y - r * 0.34, r * 0.34, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      targetCtx.fill();

      // 2. Secondary Pinpoint Sky Reflection
      targetCtx.beginPath();
      targetCtx.arc(dot.x - r * 0.14, dot.y - r * 0.20, r * 0.11, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(255, 255, 255, 0.82)';
      targetCtx.fill();

      // 3. Glass Dome Crescent Sheen
      targetCtx.beginPath();
      targetCtx.arc(dot.x, dot.y, r - 0.6, -Math.PI * 0.82, -Math.PI * 0.18);
      targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
      targetCtx.lineWidth = 1.0;
      targetCtx.stroke();

      // 4. Subtle Outer Glass Silhouette Rim
      targetCtx.beginPath();
      targetCtx.arc(dot.x, dot.y, r, 0, Math.PI * 2);
      targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      targetCtx.lineWidth = 0.6;
      targetCtx.stroke();
    }

    // 4. Live Eraser Indicator Cursor Overlay — Highly visible, crisp dual-ring target
    if (isEraserActive && !isExport && eraserHoverPos) {
      targetCtx.save();
      const erRadius = Math.max(10, chalkBrushSize * 0.7);

      // 1. Luminous semi-translucent lens fill (makes targeted area instantly recognizable)
      targetCtx.beginPath();
      targetCtx.arc(eraserHoverPos.x, eraserHoverPos.y, erRadius, 0, Math.PI * 2);
      targetCtx.fillStyle = isErasing ? 'rgba(239, 68, 68, 0.28)' : 'rgba(255, 255, 255, 0.32)';
      targetCtx.fill();

      // 2. High-contrast solid white under-ring (pops on dark furrows, sand, and marbles)
      targetCtx.beginPath();
      targetCtx.arc(eraserHoverPos.x, eraserHoverPos.y, erRadius, 0, Math.PI * 2);
      targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      targetCtx.lineWidth = 3.2;
      targetCtx.stroke();

      // 3. Vibrant crimson/coral foreground dashed ring
      targetCtx.beginPath();
      targetCtx.arc(eraserHoverPos.x, eraserHoverPos.y, erRadius, 0, Math.PI * 2);
      targetCtx.strokeStyle = isErasing ? '#b91c1c' : '#dc2626';
      targetCtx.lineWidth = 1.8;
      targetCtx.setLineDash([5, 3]);
      targetCtx.stroke();

      // 4. Center Crosshair with white outline backing for guaranteed contrast
      targetCtx.setLineDash([]);

      // White outline crosshair
      targetCtx.beginPath();
      targetCtx.moveTo(eraserHoverPos.x - 6, eraserHoverPos.y);
      targetCtx.lineTo(eraserHoverPos.x + 6, eraserHoverPos.y);
      targetCtx.moveTo(eraserHoverPos.x, eraserHoverPos.y - 6);
      targetCtx.lineTo(eraserHoverPos.x, eraserHoverPos.y + 6);
      targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      targetCtx.lineWidth = 2.8;
      targetCtx.stroke();

      // Crimson core crosshair
      targetCtx.beginPath();
      targetCtx.moveTo(eraserHoverPos.x - 5, eraserHoverPos.y);
      targetCtx.lineTo(eraserHoverPos.x + 5, eraserHoverPos.y);
      targetCtx.moveTo(eraserHoverPos.x, eraserHoverPos.y - 5);
      targetCtx.lineTo(eraserHoverPos.x, eraserHoverPos.y + 5);
      targetCtx.strokeStyle = isErasing ? '#b91c1c' : '#dc2626';
      targetCtx.lineWidth = 1.5;
      targetCtx.stroke();

      targetCtx.restore();
    }
  }

  // --- Main Animation Render ---
  function render() {
    const rect = chalkArena.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);
    renderScene(ctx, false);
  }

  // --- High-Resolution Sand Art PNG Export ---
  function exportDrawingAsPNG() {
    try {
      const rect = chalkArena.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      const arenaW = rect.width;
      const arenaH = rect.height;

      // Natural sandy frame margins around the sand art arena
      const frameMarginX = 64;
      const frameMarginTop = 64;
      const frameMarginBottom = 60;
      const totalW = arenaW + frameMarginX * 2;
      const totalH = arenaH + frameMarginTop + frameMarginBottom;

      // Minimum 2x supersampling for high resolution
      const scale = Math.max(2, window.devicePixelRatio || 2);
      const exportW = Math.round(totalW * scale);
      const exportH = Math.round(totalH * scale);

      function buildExportCanvas(withAssets) {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = exportW;
        offCanvas.height = exportH;
        const offCtx = offCanvas.getContext('2d');
        offCtx.setTransform(scale, 0, 0, scale, 0, 0);

        // 1. Packed Beach Sand Background Texture
        offCtx.fillStyle = '#c9a374';
        offCtx.fillRect(0, 0, totalW, totalH);

        if (withAssets && sandBgImg.complete && sandBgImg.naturalWidth > 0) {
          try {
            const imgAspect = sandBgImg.naturalWidth / sandBgImg.naturalHeight;
            const canvasAspect = totalW / totalH;
            let sx = 0, sy = 0, sWidth = sandBgImg.naturalWidth, sHeight = sandBgImg.naturalHeight;
            if (imgAspect > canvasAspect) {
              sWidth = sandBgImg.naturalHeight * canvasAspect;
              sx = (sandBgImg.naturalWidth - sWidth) / 2;
            } else {
              sHeight = sandBgImg.naturalWidth / canvasAspect;
              sy = (sandBgImg.naturalHeight - sHeight) / 2;
            }
            offCtx.drawImage(sandBgImg, sx, sy, sWidth, sHeight, 0, 0, totalW, totalH);
          } catch (e) {
            console.warn('Sand background image draw skipped:', e);
          }
        } else {
          // Procedural high-detail packed sand gradient if image is skipped/tainted
          const sandGrad = offCtx.createLinearGradient(0, 0, totalW, totalH);
          sandGrad.addColorStop(0, '#d8b58a');
          sandGrad.addColorStop(0.5, '#c9a374');
          sandGrad.addColorStop(1, '#b58f5e');
          offCtx.fillStyle = sandGrad;
          offCtx.fillRect(0, 0, totalW, totalH);
        }

        // 2. Sunlight Glow Overlay
        const sunGrad = offCtx.createRadialGradient(
          totalW * 0.16, totalH * 0.12, 15,
          totalW * 0.5, totalH * 0.5, totalW * 0.95
        );
        sunGrad.addColorStop(0, 'rgba(255, 253, 244, 0.28)');
        sunGrad.addColorStop(0.5, 'rgba(255, 236, 198, 0.08)');
        sunGrad.addColorStop(1, 'rgba(50, 25, 5, 0.16)');
        offCtx.fillStyle = sunGrad;
        offCtx.fillRect(0, 0, totalW, totalH);

        // 3. "MARBLE-TO-MARBLE" in the top-left corner carved into the sand
        offCtx.save();
        const titleX = 32;
        const titleY = 42;
        offCtx.font = "bold 26px 'Lacquer', cursive, system-ui";
        offCtx.textBaseline = 'alphabetic';

        // Dug sand 3D trench depth and sun crest highlight
        offCtx.fillStyle = 'rgba(50, 24, 8, 0.35)';
        offCtx.fillText('MARBLE-TO-MARBLE', titleX + 2, titleY + 4);

        offCtx.fillStyle = 'rgba(20, 8, 3, 0.95)';
        offCtx.fillText('MARBLE-TO-MARBLE', titleX, titleY + 2);

        offCtx.fillStyle = 'rgba(255, 248, 225, 0.85)';
        offCtx.fillText('MARBLE-TO-MARBLE', titleX - 1.5, titleY - 1.2);

        offCtx.fillStyle = '#261206';
        offCtx.fillText('MARBLE-TO-MARBLE', titleX, titleY);
        offCtx.restore();

        // Realistic sand shadow helper
        function drawNaturalShadow(x, y, w, h, angle = Math.PI * 0.38, dist = 7, blur = 11) {
          offCtx.save();
          offCtx.translate(x + w / 2 + Math.cos(angle) * dist, y + h / 2 + Math.sin(angle) * dist);
          offCtx.rotate(angle);
          const grad = offCtx.createRadialGradient(0, 0, w * 0.12, 0, 0, blur * 1.2);
          grad.addColorStop(0, 'rgba(32, 14, 4, 0.65)');
          grad.addColorStop(0.5, 'rgba(40, 18, 6, 0.28)');
          grad.addColorStop(1, 'rgba(40, 18, 6, 0)');
          offCtx.fillStyle = grad;
          offCtx.beginPath();
          offCtx.ellipse(0, 0, blur * 1.1, (h / 2) * 0.9, 0, 0, Math.PI * 2);
          offCtx.fill();
          offCtx.restore();
        }

        // Helper to draw an item image with shadow or procedural fallback
        function drawItem(img, x, y, w, h, rot = 0, drawFallback = null) {
          drawNaturalShadow(x, y, w, h, Math.PI * 0.38, 6, 12);
          if (withAssets && img && img.complete && img.naturalWidth > 0) {
            try {
              offCtx.save();
              offCtx.translate(x + w / 2, y + h / 2);
              if (rot) offCtx.rotate(rot);
              offCtx.drawImage(img, -w / 2, -h / 2, w, h);
              offCtx.restore();
              return;
            } catch (_) {}
          }
          if (drawFallback) {
            offCtx.save();
            offCtx.translate(x + w / 2, y + h / 2);
            if (rot) offCtx.rotate(rot);
            drawFallback(offCtx, w, h);
            offCtx.restore();
          }
        }

        // 4. Little Beach Rocks around the frame (inspired by background-1.png)
        // Tan pebble: top-right
        drawItem(pebbleTanImg, totalW - 145, 16, 30, 34, 0.1, (c, w, h) => {
          c.beginPath();
          c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
          c.fillStyle = '#caa268';
          c.fill();
        });

        // Terracotta pebble: bottom-left near scallop
        drawItem(pebbleTerraImg, 82, totalH - 48, 28, 32, -0.2, (c, w, h) => {
          c.beginPath();
          c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
          c.fillStyle = '#a84c2d';
          c.fill();
        });

        // Granite pebble: right margin
        drawItem(pebbleGraniteImg, totalW - 40, totalH * 0.5 - 15, 26, 30, 0.3, (c, w, h) => {
          c.beginPath();
          c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
          c.fillStyle = '#42454a';
          c.fill();
        });

        // 5. Beach Shells (inspired by background-1.png)
        // A. Scallop Shell (bottom-left corner)
        drawItem(shellScallopImg, 22, totalH - 68, 50, 49, -0.16, (c, w, h) => {
          c.beginPath();
          c.arc(0, 0, w / 2, 0, Math.PI * 2);
          c.fillStyle = '#ebd6bc';
          c.fill();
        });

        // B. Starfish (bottom-right corner)
        drawItem(shellStarfishImg, totalW - 74, totalH - 64, 50, 49, 0.26, (c, w, h) => {
          c.beginPath();
          for (let i = 0; i < 5; i++) {
            const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
            const rOuter = w / 2;
            const rInner = w / 4.8;
            c.lineTo(Math.cos(a) * rOuter, Math.sin(a) * rOuter);
            const aIn = a + Math.PI / 5;
            c.lineTo(Math.cos(aIn) * rInner, Math.sin(aIn) * rInner);
          }
          c.closePath();
          c.fillStyle = '#df7a32';
          c.fill();
        });

        // C. White Sand Dollar (top-right corner)
        drawItem(shellSanddollarImg, totalW - 68, 14, 46, 44, -0.1, (c, w, h) => {
          c.beginPath();
          c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
          c.fillStyle = '#f5f3ee';
          c.fill();
        });

        // D. Spiral auger shell (left margin)
        drawItem(shellSpiralImg, 14, totalH * 0.52 - 12, 46, 17, 0.48, (c, w, h) => {
          c.beginPath();
          c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
          c.fillStyle = '#e4d2be';
          c.fill();
        });

        // 6. Draw Sand Art Drawing Arena centered in the frame
        offCtx.save();
        offCtx.translate(frameMarginX, frameMarginTop);
        renderScene(offCtx, true);
        offCtx.restore();

        return offCanvas;
      }

      // 7. File Naming: marble-to-marble-YYYY-MM-DD-HHmmss.png
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const fileName = `marble-to-marble-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;

      function triggerDownload(url) {
        const link = document.createElement('a');
        link.style.display = 'none';
        link.download = fileName;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          if (link.parentNode) link.parentNode.removeChild(link);
        }, 200);

        // Audio Confirmation
        SoundEngine.playConnect();

        // Visual Feedback on Buttons
        const btns = [document.getElementById('downloadBtn'), document.getElementById('panelDownloadBtn')].filter(Boolean);
        btns.forEach(btn => {
          btn.classList.add('is-success');
          setTimeout(() => btn.classList.remove('is-success'), 1500);
        });
      }

      // Attempt 1: Render full photographic beach keepsake
      let canvasToSave = buildExportCanvas(true);
      try {
        const dataUrl = canvasToSave.toDataURL('image/png');
        triggerDownload(dataUrl);
      } catch (err) {
        console.warn('Canvas tainted by image assets, falling back to procedural beach frame:', err);
        canvasToSave = buildExportCanvas(false);
        const dataUrl = canvasToSave.toDataURL('image/png');
        triggerDownload(dataUrl);
      }
    } catch (fatalErr) {
      console.error('Failed to export drawing as PNG:', fatalErr);
    }
  }

  // --- Main Animation Loop ---
  function loop() {
    physicsStep();
    render();
    animFrameId = requestAnimationFrame(loop);
  }

  // --- Hit Detection ---
  function getDotAtPosition(px, py) {
    const hitRadius = CONFIG.dotRadius + CONFIG.hitPadding;
    const hitRadiusSq = hitRadius * hitRadius;

    for (let i = dots.length - 1; i >= 0; i--) {
      const dot = dots[i];
      const dx = dot.x - px;
      const dy = dot.y - py;
      if (dx * dx + dy * dy <= hitRadiusSq) {
        return dot;
      }
    }
    return null;
  }

  // Find nearest marble within maxDistance px (for forgiving drag release snapping)
  function getNearestDot(px, py, maxDist = 28) {
    let nearest = null;
    let nearestDistSq = maxDist * maxDist;

    for (let i = dots.length - 1; i >= 0; i--) {
      const dot = dots[i];
      const dx = dot.x - px;
      const dy = dot.y - py;
      const distSq = dx * dx + dy * dy;
      if (distSq <= nearestDistSq) {
        nearestDistSq = distSq;
        nearest = dot;
      }
    }
    return nearest;
  }

  function getCanvasPosition(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  // --- Marble Tap / Connect Logic (Fallback for simple clicks/taps) ---
  function handleDotClick(dot) {
    if (isShaking) return;

    if (selectedDotId === null) {
      selectedDotId = dot.id;
      SoundEngine.playSelect();
    } else if (selectedDotId === dot.id) {
      selectedDotId = null;
    } else {
      const from = selectedDotId;
      const to = dot.id;
      const fromDot = dots[from];
      const toDot = dots[to];

      if (fromDot && toDot) {
        const pts = createSandLinePoints(fromDot, toDot);
        addOrUpdateConnection(from, to, pts);
        SoundEngine.playConnect();
      }
      selectedDotId = null;
    }
  }

  // --- Pointer Event Listeners for Hold & Drag Curved Sand Furrows & Chalk ---
  function onPointerDown(e) {
    if (isShaking) return;
    const pos = getCanvasPosition(e);

    // 0. Eraser Mode: Drag along canvas to remove any stroke crossed (like MS Paint)
    if (isEraserActive) {
      isErasing = true;
      eraserLastPos = pos;
      eraserHoverPos = pos;
      erasedInCurrentStroke = { chalk: [], conns: [] };
      checkAndEraseAt(pos, pos);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
      return;
    }

    // 1. Chalk Painting Mode: Paint dry powder chalk onto sand
    if (activeChalkColor) {
      activeChalkStroke = {
        color: activeChalkColor,
        size: chalkBrushSize,
        points: [pos],
        specks: [],
        lastSoundTime: performance.now()
      };
      generateChalkSpecks(activeChalkStroke, pos, pos);
      SoundEngine.playCarveSand();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
      return;
    }

    // 2. Marble Mode: Select and drag curved sand furrows
    let dot = getDotAtPosition(pos.x, pos.y);
    if (!dot) dot = getNearestDot(pos.x, pos.y, 22);

    dragMoved = false;
    dragStartPos = { x: pos.x, y: pos.y };

    if (dot) {
      selectedDotId = dot.id;
      activeStroke = {
        fromDot: dot,
        points: [{ x: dot.x, y: dot.y }],
        lastSoundTime: performance.now()
      };
      SoundEngine.playSelect();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
    } else {
      selectedDotId = null;
      activeStroke = null;
    }
  }

  function onPointerMove(e) {
    const pos = getCanvasPosition(e);

    // 0. Eraser Mode: Track hover position & erase crossed strokes on drag
    if (isEraserActive) {
      eraserHoverPos = pos;
      canvas.style.cursor = 'crosshair';
      if (isErasing) {
        checkAndEraseAt(eraserLastPos || pos, pos);
        eraserLastPos = pos;
      }
      return;
    }

    // 1. Active Chalk Painting Stroke
    if (activeChalkStroke) {
      canvas.style.cursor = 'crosshair';
      const pts = activeChalkStroke.points;
      const lastPt = pts[pts.length - 1];
      const d = Math.hypot(pos.x - lastPt.x, pos.y - lastPt.y);

      if (d >= 3) {
        pts.push(pos);
        generateChalkSpecks(activeChalkStroke, lastPt, pos);

        const now = performance.now();
        if (now - activeChalkStroke.lastSoundTime > 180) {
          SoundEngine.playCarveSand();
          activeChalkStroke.lastSoundTime = now;
        }
      }
      return;
    }

    // 2. Marble Dragging / Hover
    const dot = getDotAtPosition(pos.x, pos.y);
    hoveredDotId = dot ? dot.id : null;

    if (activeStroke) {
      canvas.style.cursor = 'crosshair';
      const distFromStart = Math.hypot(pos.x - dragStartPos.x, pos.y - dragStartPos.y);
      if (distFromStart > 6) {
        dragMoved = true;
      }

      const pts = activeStroke.points;
      const lastPt = pts[pts.length - 1];
      const d = Math.hypot(pos.x - lastPt.x, pos.y - lastPt.y);

      // Append point along drag curve
      if (d >= 4) {
        pts.push({ x: pos.x, y: pos.y });

        // Subtle tactile sand friction audio when actively carving
        const now = performance.now();
        if (now - activeStroke.lastSoundTime > 220) {
          SoundEngine.playCarveSand();
          activeStroke.lastSoundTime = now;
        }
      }

      // Check if hovering over a valid target marble to connect
      if (dot && dot.id !== activeStroke.fromDot.id) {
        targetHoverDotId = dot.id;
      } else {
        const nearDot = getNearestDot(pos.x, pos.y, 24);
        if (nearDot && nearDot.id !== activeStroke.fromDot.id) {
          targetHoverDotId = nearDot.id;
        } else {
          targetHoverDotId = null;
        }
      }
    } else {
      if (activeChalkColor) {
        canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.cursor = dot ? 'pointer' : 'crosshair';
      }
      targetHoverDotId = null;
    }
  }

  function onPointerUp(e) {
    // 0. Finish Eraser Drag
    if (isErasing) {
      isErasing = false;
      eraserLastPos = null;
      if (erasedInCurrentStroke.chalk.length > 0 || erasedInCurrentStroke.conns.length > 0) {
        actionHistory.push({
          type: 'erase_batch',
          chalk: [...erasedInCurrentStroke.chalk],
          conns: [...erasedInCurrentStroke.conns]
        });
      }
      erasedInCurrentStroke = { chalk: [], conns: [] };
      try {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      return;
    }

    // 1. Finish Chalk Painting Stroke
    if (activeChalkStroke) {
      if (activeChalkStroke.points && activeChalkStroke.points.length >= 1) {
        chalkStrokes.push(activeChalkStroke);
        actionHistory.push({ type: 'chalk' });
      }
      activeChalkStroke = null;
      try {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      return;
    }

    // 2. Finish Marble Connection Stroke
    if (!activeStroke) return;
    const pos = getCanvasPosition(e);

    let targetDot = getDotAtPosition(pos.x, pos.y);
    if (!targetDot) {
      targetDot = getNearestDot(pos.x, pos.y, 28);
    }

    if (dragMoved) {
      // Completed hold & drag curved stroke
      if (targetDot && targetDot.id !== activeStroke.fromDot.id) {
        const from = activeStroke.fromDot.id;
        const to = targetDot.id;

        // Smoothly anchor the curve into the target marble center
        activeStroke.points.push({ x: targetDot.x, y: targetDot.y });

        addOrUpdateConnection(from, to, activeStroke.points);
        SoundEngine.playConnect();
        selectedDotId = null;
      } else {
        // Dragged on sand and released without reaching another marble
        selectedDotId = null;
      }
    } else {
      // Quick click/tap on the marble
      handleDotClick(activeStroke.fromDot);
    }

    activeStroke = null;
    targetHoverDotId = null;
    dragMoved = false;

    try {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
  }

  function onPointerCancel(e) {
    if (isErasing) {
      isErasing = false;
      eraserLastPos = null;
      erasedInCurrentStroke = { chalk: [], conns: [] };
      try {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      return;
    }
    if (activeChalkStroke) {
      activeChalkStroke = null;
      try {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      return;
    }
    activeStroke = null;
    targetHoverDotId = null;
    dragMoved = false;
    try {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
  }

  // --- Side Panel Toggle ---
  function setupSidePanel() {
    if (sidePanelTab) {
      sidePanelTab.addEventListener('click', () => {
        sidePanelWrapper.classList.toggle('is-open');
      });
    }

    if (panelCloseBtn) {
      panelCloseBtn.addEventListener('click', () => {
        sidePanelWrapper.classList.remove('is-open');
      });
    }
  }

  // --- Powder Chalk Palette & Eraser Controls Setup ---
  function setupChalkControls() {
    const colorBtns = document.querySelectorAll('.chalk-color-btn');
    const modeCircle = document.getElementById('chalkModeCircle');
    const sizeBtns = document.querySelectorAll('.size-btn');
    const btnClearChalk = document.getElementById('btnClearChalk');

    function updateChalkUI() {
      // 1. Color buttons
      colorBtns.forEach(btn => {
        const color = btn.getAttribute('data-color');
        if (!isEraserActive && color === activeChalkColor) {
          btn.classList.add('is-selected');
        } else {
          btn.classList.remove('is-selected');
        }
      });

      // 2. Eraser button
      if (btnClearChalk) {
        btnClearChalk.classList.toggle('is-active', isEraserActive);
        btnClearChalk.setAttribute('title', isEraserActive
          ? 'Eraser tool active — drag across strokes to erase (click to turn off)'
          : 'Eraser tool (drag across strokes to erase)');
      }

      // 3. Status Circle
      if (modeCircle) {
        modeCircle.className = 'chalk-indicator-circle';
        if (isEraserActive) {
          modeCircle.classList.add('is-eraser');
          modeCircle.setAttribute('title', 'Eraser tool active (click to return to sand carve)');
        } else if (activeChalkColor) {
          modeCircle.classList.add(`color-${activeChalkColor}`);
          const capColor = activeChalkColor.charAt(0).toUpperCase() + activeChalkColor.slice(1);
          modeCircle.setAttribute('title', `${capColor} chalk active (click to return to sand carve)`);
        } else {
          modeCircle.classList.add('is-empty');
          modeCircle.setAttribute('title', 'Carve mode (no color selected — click to activate chalk)');
        }
      }

      // 4. Canvas cursor
      if (isEraserActive || activeChalkColor) {
        canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.cursor = 'default';
      }
    }

    colorBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        isEraserActive = false;
        const color = btn.getAttribute('data-color');
        if (activeChalkColor === color) {
          activeChalkColor = null; // Toggle off to carve mode
        } else {
          activeChalkColor = color;
          SoundEngine.playSelect();
        }
        updateChalkUI();
      });
    });

    // Powder Chalk Accordion Toggle
    const chalkAccordion = document.getElementById('chalkAccordion');
    const chalkAccordionTrigger = document.getElementById('chalkAccordionTrigger');

    if (chalkAccordionTrigger && chalkAccordion) {
      chalkAccordionTrigger.addEventListener('click', (e) => {
        if (e.target.closest('#chalkModeCircle')) return;

        const isCollapsed = chalkAccordion.classList.toggle('is-collapsed');
        chalkAccordionTrigger.setAttribute('aria-expanded', !isCollapsed);
      });
    }

    if (modeCircle) {
      modeCircle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isEraserActive) {
          isEraserActive = false;
        } else if (activeChalkColor) {
          activeChalkColor = null;
        } else {
          activeChalkColor = 'red';
          SoundEngine.playSelect();
          if (chalkAccordion && chalkAccordion.classList.contains('is-collapsed')) {
            chalkAccordion.classList.remove('is-collapsed');
            if (chalkAccordionTrigger) chalkAccordionTrigger.setAttribute('aria-expanded', 'true');
          }
        }
        updateChalkUI();
      });
    }

    sizeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        sizeBtns.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        chalkBrushSize = parseInt(btn.getAttribute('data-size'), 10) || 18;
      });
    });

    if (btnClearChalk) {
      btnClearChalk.addEventListener('click', (e) => {
        e.stopPropagation();
        isEraserActive = !isEraserActive;
        if (isEraserActive) {
          activeChalkColor = null;
          SoundEngine.playSelect();
        }
        updateChalkUI();
      });
    }

    updateChalkUI();
  }

  // --- Initialization ---
  function init() {
    SoundEngine.init();
    resizeCanvas();
    createInitialDots();
    setupSidePanel();
    setupChalkControls();
    loop();

    // Buttons
    btnShake.addEventListener('click', shake);
    btnMoreMarbles.addEventListener('click', () => addMoreMarbles(12));
    btnLessMarbles.addEventListener('click', () => removeLessMarbles(12));
    btnClear.addEventListener('click', () => {
      clearConnections();
      if (chalkStrokes.length > 0) {
        chalkStrokes = [];
        actionHistory = [];
      }
    });

    // Download Buttons
    const dBtn = document.getElementById('downloadBtn');
    if (dBtn) {
      dBtn.addEventListener('click', (e) => {
        e.preventDefault();
        exportDrawingAsPNG();
      });
    }
    const pDlsBtn = document.getElementById('panelDownloadBtn');
    if (pDlsBtn) {
      pDlsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        exportDrawingAsPNG();
      });
    }

    // Audio Toggles
    if (soundToggleBtn) {
      soundToggleBtn.addEventListener('click', () => {
        SoundEngine.toggleMute();
      });
    }
    if (panelAudioToggle) {
      panelAudioToggle.addEventListener('click', () => {
        SoundEngine.toggleMute();
      });
    }

    // Canvas Pointer Events for fluid hold-and-drag drawing
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('pointerleave', () => {
      eraserHoverPos = null;
      if (isErasing) {
        isErasing = false;
        eraserLastPos = null;
      }
    });

    // Window Resize
    window.addEventListener('resize', () => {
      resizeCanvas();
      const rect = chalkArena.getBoundingClientRect();
      const r = CONFIG.dotRadius + 4;
      for (const dot of dots) {
        dot.x = Math.max(CONFIG.arenaPadX + r, Math.min(rect.width - CONFIG.arenaPadX - r, dot.x));
        dot.y = Math.max(CONFIG.arenaPadY + r, Math.min(rect.height - CONFIG.arenaPadY - r, dot.y));
      }
    });

    // Keyboard Shortcuts (Escape to deselect/cancel drag, Ctrl+Z to undo, Ctrl+S to save PNG)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        selectedDotId = null;
        activeStroke = null;
        activeChalkStroke = null;
        targetHoverDotId = null;
        if (isEraserActive) {
          isEraserActive = false;
          setupChalkControls();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (actionHistory.length > 0) {
          const last = actionHistory.pop();
          if (last.type === 'erase_batch') {
            if (last.chalk && last.chalk.length > 0) {
              chalkStrokes.push(...last.chalk);
            }
            if (last.conns && last.conns.length > 0) {
              connections.push(...last.conns);
              updateStats();
            }
          } else if (last.type === 'chalk' && chalkStrokes.length > 0) {
            chalkStrokes.pop();
          } else if (last.type === 'conn' && connections.length > 0) {
            connections.pop();
            updateStats();
          }
        } else if (chalkStrokes.length > 0) {
          chalkStrokes.pop();
        } else if (connections.length > 0) {
          connections.pop();
          updateStats();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportDrawingAsPNG();
      }
    });
  }

  // Launch when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
