"use strict";

/* Section 4: animation state machine, paths, and scale-to-fit (Angela). */

/* ============================================================================
 * Animation State Machine
 * ============================================================================
 *
 * Phase 0: hold at centre      Phase 4: rotate back to 0 degrees
 * Phase 1: rotate right 180    Phase 5: scale up to fit the screen
 * Phase 2: rotate back to 0    Phase 6: move in a loop (oval, bounce or flip)
 * Phase 3: rotate left 180
 *
 * Each phase changes the logo a little every frame. When it reaches its
 * target value, anim.phase moves on to the next phase.
 * ============================================================================ */

const HOLD_SECS = 0.3;      // how long Phase 0 holds the logo still
const ROTATE_SPEED = 120;   // degrees per second (180 degrees takes 1.5 s)
const SCALE_SPEED = 0.4;    // scale units per second
const OVAL_SECS = 6;        // time for one trip around the oval
const EDGE_MARGIN = 0.1;    // gap kept between the logo and the screen edge

const PHASE_NAMES = [
  "Start – holding at center",
  "Rotate Right 180°",
  "Return to Original Orientation",
  "Rotate Left 180°",
  "Return to Original Orientation",
  "Scale Up to Full-Screen",
  "Move in Oval (loop)"
];

const anim = {
  phase: 0,      // current phase (0 to 6)
  t: 0,          // seconds spent in the current phase
  running: false
};

let _lastTimestamp = null;

/* ---------------------------------------------------------------------------
 * Screen size helpers
 * ------------------------------------------------------------------------- */

// Size of the area the camera can see at the logo's distance (world units).
function getViewSize() {
  const visH = 2 * Math.abs(CAMERA_Z) * Math.tan(45 * Math.PI / 360);
  const visW = visH * gl.canvas.width / gl.canvas.height;
  const freeW = visW * (1 - getPanelFraction()); // width not covered by panels
  return { visW, visH, freeW };
}

// Thicker letters stick out towards the camera, so they look a bit bigger.
function getDepthExpansionFactor() {
  const zFront = Math.abs(CAMERA_Z) - params.depth * 0.5;
  return Math.abs(CAMERA_Z) / Math.max(zFront, 0.1);
}

// Largest scale at which the word still fits in the given share of the screen.
function scaleToFit(widthShare, heightShare) {
  const view = getViewSize();
  const k = getDepthExpansionFactor();
  const sx = (view.freeW * widthShare) / (getWordWidth() * k);
  const sy = (view.visH * heightShare) / (getWordHeight() * k);
  return Math.min(sx, sy);
}

// Starting size: the word uses at most 46% of the free width and 35% of the height.
function getBaseScale() {
  return Math.min(1.0, scaleToFit(0.46, 0.35));
}

// Full-screen size: the word uses at most 70% of the free width and 61% of the height,
// which leaves room for the oval movement.
function getMaxScaleToFit() {
  return scaleToFit(0.70, 0.61);
}

// How far the logo centre can move from the middle before its edge leaves the screen.
function getMoveLimits() {
  const view = getViewSize();
  // The front face is closest to the camera, so perspective enlarges it by k.
  const zFront = Math.abs(CAMERA_Z) - params.depth * 0.5 * state.scale;
  const k = Math.abs(CAMERA_Z) / Math.max(zFront, 0.1);
  const halfW = getWordWidth() * state.scale / 2;
  const halfH = getWordHeight() * state.scale / 2;
  // The logo sits left of the window centre because of the panels, and k pushes
  // it further left, so the left edge sets the limit.
  const panelShift = (view.visW - view.freeW) / 2;
  return {
    x: Math.max(0, view.freeW / (2 * k) - panelShift * (1 - 1 / k) - halfW - EDGE_MARGIN),
    y: Math.max(0, view.visH / (2 * k) - halfH - EDGE_MARGIN)
  };
}

// Keep the logo inside the visible area.
function clampTranslation() {
  const limit = getMoveLimits();
  state.translate[0] = Math.min(limit.x, Math.max(-limit.x, state.translate[0]));
  state.translate[1] = Math.min(limit.y, Math.max(-limit.y, state.translate[1]));
}

/* ---------------------------------------------------------------------------
 * Start, reset and path selection
 * ------------------------------------------------------------------------- */

// Put the logo back in the centre, unrotated, at its starting size.
function resetAnimationState() {
  state.theta = [0, 0, 0];
  state.translate = [0, 0, 0];
  state.scale = getBaseScale();
}

// Called by the Animation Sequence dropdown and keys 1 to 4.
function setAnimationPath(newPath) {
  params.animPath = newPath;
  const pathSelect = document.getElementById("selectAnimPath");
  if (pathSelect) pathSelect.value = newPath;

  anim.t = 0;
  _lastTimestamp = null;
  resetAnimationState();

  if (newPath === "playground") {
    // Path 4: no animation, the user moves the logo with the keyboard.
    anim.phase = 0;
    anim.running = false;
    setControlsLocked(false);
    setStatusBadge("playground", "PLAYGROUND");
    if (pathSelect) pathSelect.blur();
    const canvas = document.getElementById("glcanvas");
    if (canvas) canvas.focus();
  } else {
    // Path 1 plays the whole sequence; Paths 2 and 3 jump straight to the loop.
    anim.phase = (newPath === "oval") ? 0 : 6;
    if (anim.phase === 6) state.scale = getMaxScaleToFit();
    anim.running = true;
    setControlsLocked(true);
    setStatusBadge("running", "RUNNING");
  }
  updatePlaybackButtons();
  updatePhaseDisplay();
}

/* ---------------------------------------------------------------------------
 * Per-frame update
 * ------------------------------------------------------------------------- */

// Called once per frame by render().
function updateAnimation(timestamp) {
  if (_lastTimestamp === null) _lastTimestamp = timestamp;
  // Seconds since the last frame, capped so a hidden tab does not cause a jump.
  const dt = Math.min((timestamp - _lastTimestamp) / 1000, 0.1);
  _lastTimestamp = timestamp;

  // In Playground mode the keyboard moves the logo, so do nothing here.
  if (params.animPath === "playground") return;

  // When paused, step is 0: the logo stays still but still fits the screen.
  const step = anim.running ? dt * params.speed : 0;
  anim.t += step; 

  switch (anim.phase) {
    case 0: // Hold at centre
      state.scale = getBaseScale();
      if (anim.t >= HOLD_SECS) nextPhase();
      break;

    case 1: // Rotate right 0 -> 180
      state.scale = getBaseScale();
      state.theta[1] += ROTATE_SPEED * step;
      if (state.theta[1] >= 180) { state.theta[1] = 180; nextPhase(); }
      break;

    case 2: // Rotate back 180 -> 0
      state.scale = getBaseScale();
      state.theta[1] -= ROTATE_SPEED * step;
      if (state.theta[1] <= 0) { state.theta[1] = 0; nextPhase(); }
      break;

    case 3: // Rotate left 0 -> -180
      state.scale = getBaseScale();
      state.theta[1] -= ROTATE_SPEED * step;
      if (state.theta[1] <= -180) { state.theta[1] = -180; nextPhase(); }
      break;

    case 4: // Rotate back -180 -> 0
      state.scale = getBaseScale();
      state.theta[1] += ROTATE_SPEED * step;
      if (state.theta[1] >= 0) { state.theta[1] = 0; nextPhase(); }
      break;

    case 5: { // Scale up until the logo fills the screen
      const maxScale = getMaxScaleToFit();
      state.scale += SCALE_SPEED * step;
      if (state.scale >= maxScale) { state.scale = maxScale; nextPhase(); }
      break;
    }

    case 6: // Loop until the user pauses or resets
      if (params.animPath === "bounce") bounceLoop();
      else if (params.animPath === "flip") flipLoop();
      else { ovalLoop(); clampTranslation(); }
      break;
  }

  if (anim.running) updatePhaseDisplay();
}

function nextPhase() {
  anim.phase++;
  anim.t = 0;
}

/* ---------------------------------------------------------------------------
 * Phase 6 loops
 * ------------------------------------------------------------------------- */

// Path 1: float around an oval.
function ovalLoop() {
  state.scale = getMaxScaleToFit();
  // Grow the oval from the centre over the first 1.5 s so the logo does not jump.
  const grow = Math.min(anim.t / 1.5, 1);
  const limit = getMoveLimits();
  const radiusX = limit.x * 0.85;
  const radiusY = Math.min(limit.y * 0.85, radiusX * 0.6); // keep the oval wider than tall
  const angle = anim.t * 2 * Math.PI / OVAL_SECS;
  state.translate[0] = Math.cos(angle) * radiusX * grow;
  state.translate[1] = Math.sin(angle) * radiusY * grow;
}

// Path 2: In-place Center Bounce (Oscillates strictly in the centre)
function bounceLoop() {
  state.scale = getMaxScaleToFit() * 0.85;
  state.translate[0] = 0;
  state.translate[2] = 0;

  // Parabolic vertical bounce centered at X=0
  const effH = getWordHeight() * getDepthExpansionFactor() * state.scale;
  const bounceHeight = Math.max(0, (getViewSize().visH - effH) * 0.32);
  state.translate[1] = (Math.abs(Math.sin(anim.t * 3.5)) * 2 - 1) * bounceHeight;

  // Subtle dynamic tilt while bouncing
  state.theta[0] = Math.sin(anim.t * 3.5) * 10;
  state.theta[1] = 0;
  state.theta[2] = -Math.cos(anim.t * 1.75) * 6;
}

// Path 3: In-place Center 3D Flip & Tumble
function flipLoop() {
  state.scale = getMaxScaleToFit() * 0.78; // Headroom for 3D extrusion depth
  state.translate[0] = 0;
  state.translate[1] = 0;
  state.translate[2] = 0;

  // 3D continuous rotation centered at the origin
  state.theta[0] = (anim.t * 100) % 360; // 360° flip along X axis
  state.theta[1] = Math.sin(anim.t * 1.5) * 25; // Subtle rhythmic yaw
  state.theta[2] = 0;
}

/* ---------------------------------------------------------------------------
 * Phase display
 * ------------------------------------------------------------------------- */

// Show the current phase in the Animation Panel.
function updatePhaseDisplay() {
  const el = document.getElementById("phaseDisplay");
  if (!el) return;

  if (params.animPath === "playground") {
    el.textContent = "Playground: use keyboard controls";
  } else if (params.animPath === "bounce") {
    el.textContent = "Path 2: Center Bounce (loop)";
  } else if (params.animPath === "flip") {
    el.textContent = "Path 3: Center Flip & Wave (loop)";
  } else {
    el.textContent = "Phase " + anim.phase + ": " + PHASE_NAMES[anim.phase];
  }
}
