"use strict";

/* Section 4: animation state machine, paths, and scale-to-fit (Angela). */

/* ============================================================================
 * Animation State Machine 
 * ============================================================================
 *
 * The sequence holds, rotates right and back, rotates left and back, then enlarges.
 * A smooth oval translation loop follows; Start, Stop, and Reset control playback.
 *
 * ============================================================================ */

// Timed intro phases use the same duration; the opening hold is shorter.
const PHASE_BASE_SECS = 1.5;
const START_HOLD_SECS = 0.3;

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
  phase: 0,   // current step in PHASE_NAMES
  t: 0,       // elapsed progress within the step
  running: false
};

let _lastTimestamp = null;

// Cubic smooth-step eases each phase in and out.
function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

// Helper: Accounts for perspective magnification when extrusion depth pushes front vertices closer
function getDepthExpansionFactor() {
  const zFront = Math.abs(CAMERA_Z) - (params.depth * 0.5);
  return Math.abs(CAMERA_Z) / Math.max(zFront, 0.1);
}

// Calculate base scale so any word (2 to 6 letters) has generous margins at start
function getBaseScale() {
  const aspect = gl.canvas.width / gl.canvas.height;
  const visH = 2 * Math.abs(CAMERA_Z) * Math.tan(45 * Math.PI / 360);
  const visW = visH * aspect;
  const panelFraction = getPanelFraction();
  const availableWidth = visW * (1.0 - panelFraction);

  const effW = getWordWidth() * getDepthExpansionFactor();
  const effH = getWordHeight() * getDepthExpansionFactor();

  // Occupy at most 46% of available width and 35% of height at start
  const sx = (availableWidth * 0.46) / effW;
  const sy = (visH * 0.35) / effH;
  return Math.min(1.0, sx, sy);
}

// Calculate full-screen scale so the enlarged logo fits comfortably without clipping
function getMaxScaleToFit() {
  const aspect = gl.canvas.width / gl.canvas.height;
  const visH = 2 * Math.abs(CAMERA_Z) * Math.tan(45 * Math.PI / 360);
  const visW = visH * aspect;
  const panelFraction = getPanelFraction();
  const availableWidth = visW * (1.0 - panelFraction);

  const effW = getWordWidth() * getDepthExpansionFactor();
  const effH = getWordHeight() * getDepthExpansionFactor();

  // Enlarge to at most 78% of available width and 68% of height
  const sx = (availableWidth * 0.78) / effW;
  const sy = (visH * 0.68) / effH;
  return Math.min(sx, sy);
}

// Restore the logo to its centered, unrotated starting pose.
function resetAnimationState() {
  state.theta[0] = 0;
  state.theta[1] = 0;
  state.theta[2] = 0;
  state.scale = getBaseScale();
  state.translate[0] = 0;
  state.translate[1] = 0;
  state.translate[2] = 0;
}

/**
 * Handles animation path switching:
 * - "oval" (1): Resets to Phase 0 and plays all 6 intro phases before looping in oval.
 * - "bounce" (2) & "flip" (3): Jumps straight into continuous Phase 6 loop.
 * - "playground": Stops playback and enables direct keyboard transforms.
 */
function setAnimationPath(newPath) {
  params.animPath = newPath;
  const pathSelect = document.getElementById("selectAnimPath");
  if (pathSelect) pathSelect.value = newPath;

  if (newPath === "playground") {
    anim.phase = 0;
    anim.t = 0;
    anim.running = false;
    _lastTimestamp = null;
    resetAnimationState();
    setControlsLocked(false);
    setStatusBadge("playground", "PLAYGROUND");
    if (pathSelect) pathSelect.blur();
    const canvas = document.getElementById("glcanvas");
    if (canvas) canvas.focus();
  } else if (newPath === "oval") {
    // Restart full 6-phase sequence from the beginning
    anim.phase = 0;
    anim.t = 0;
    _lastTimestamp = null;
    resetAnimationState();
    anim.running = true;
    setControlsLocked(true);
    setStatusBadge("running", "RUNNING");
  } else {
    // Jump directly to the standalone loop at Phase 6
    anim.phase = 6;
    anim.t = 0;
    _lastTimestamp = null;
    state.translate[0] = 0;
    state.translate[1] = 0;
    state.translate[2] = 0;
    state.theta[0] = 0;
    state.theta[1] = 0;
    state.theta[2] = 0;
    state.scale = getMaxScaleToFit();
    anim.running = true;
    setControlsLocked(true);
    setStatusBadge("running", "RUNNING");
  }
  updatePlaybackButtons();
  updatePhaseDisplay();
}

// Advance the sequence clock, then pose the logo for this frame.
function updateAnimation(timestamp) {
  if (_lastTimestamp === null) _lastTimestamp = timestamp;
  // Delta time keeps motion consistent across frame rates; cap long pauses.
  const dt = Math.min((timestamp - _lastTimestamp) / 1000, 0.1);
  _lastTimestamp = timestamp;

  if (anim.running) {
    advancePhase(dt);
    updatePhaseDisplay();
  }

  // Playground transforms come from the keyboard, so leave them untouched.
  if (params.animPath !== "playground") applyAnimationPose();
}

// Move the phase clock forward using elapsed time, not frame count.
function advancePhase(dt) {
  if (anim.phase === 0) {
    // Phase 0 gives the viewer a moment to see the logo before it moves.
    anim.t += dt * params.speed / START_HOLD_SECS;
    if (anim.t >= 1) { anim.t = 0; anim.phase = 1; }
  } else if (anim.phase <= 5) {
    anim.t += dt * params.speed / PHASE_BASE_SECS;
    if (anim.t >= 1) { anim.t = 0; anim.phase++; }
  } else {
    anim.t += dt * params.speed;
  }
}

// The pose depends only on the phase, its progress, and the current layout, so it
// also stays correct while paused, after a resize, and after editing the word.
function applyAnimationPose() {
  if (anim.phase === 6) { applyLoopPose(); return; }

  const et = easeInOut(Math.min(anim.t, 1));
  const s0 = getBaseScale();
  let yaw = 0;
  let scale = s0;

  // Rotate right and back, left and back, then scale up.
  switch (anim.phase) {
    // Positive Y turns right; ease the angle back to zero in the next phase.
    case 1: yaw = et * 180; break;
    case 2: yaw = (1 - et) * 180; break;
    // Repeat the turn in the opposite direction, then return to zero.
    case 3: yaw = -et * 180; break;
    case 4: yaw = -(1 - et) * 180; break;
    // Smoothly enlarge from base scale (s0) to full-screen scale.
    case 5: scale = s0 + et * (getMaxScaleToFit() - s0); break;
  }

  state.theta[0] = 0;
  state.theta[1] = yaw;
  state.theta[2] = 0;
  state.scale = scale;
  state.translate[0] = 0;
  state.translate[1] = 0;
  state.translate[2] = 0;
}

// Phase 6: the continuous "move about" loop for the selected path.
function applyLoopPose() {
  const aspect = gl.canvas.width / gl.canvas.height;
  const visH = 2 * Math.abs(CAMERA_Z) * Math.tan(45 * Math.PI / 360);
  const visW = visH * aspect;
  const availableWidth = visW * (1.0 - getPanelFraction());
  const sMax = getMaxScaleToFit();

  if (params.animPath === "bounce") {
    // Path 2: In-place Center Bounce (Oscillates strictly in the centre)
    state.scale = sMax * 0.85;
    state.translate[0] = 0;
    state.translate[2] = 0;

    // Parabolic vertical bounce centered at X=0
    const effH = getWordHeight() * getDepthExpansionFactor() * state.scale;
    const bounceHeight = Math.max(0, (visH - effH) * 0.32);
    state.translate[1] = (Math.abs(Math.sin(anim.t * 3.5)) * 2 - 1) * bounceHeight;

    // Subtle dynamic tilt while bouncing
    state.theta[0] = Math.sin(anim.t * 3.5) * 10;
    state.theta[1] = 0;
    state.theta[2] = -Math.cos(anim.t * 1.75) * 6;

  } else if (params.animPath === "flip") {
    // Path 3: In-place Center 3D Flip & Tumble
    state.scale = sMax * 0.78; // Headroom for 3D extrusion depth
    state.translate[0] = 0;
    state.translate[1] = 0;
    state.translate[2] = 0;

    // 3D continuous rotation centered at the origin
    state.theta[0] = (anim.t * 100) % 360; // 360° flip along X axis
    state.theta[1] = Math.sin(anim.t * 1.5) * 25; // Subtle rhythmic yaw
    state.theta[2] = 0;

  } else {
    // Path 1 (Default): Oval translation
    state.scale = sMax;
    state.theta[0] = 0;
    state.theta[1] = 0;
    state.theta[2] = 0;
    state.translate[2] = 0;

    const effW = getWordWidth() * getDepthExpansionFactor() * state.scale;
    const effH = getWordHeight() * getDepthExpansionFactor() * state.scale;

    // The front face sits closer to the camera, so perspective enlarges it by k.
    const zFront = Math.abs(CAMERA_Z) - params.depth * 0.5 * state.scale;
    const k = Math.abs(CAMERA_Z) / Math.max(zFront, 0.1);
    const halfW = getWordWidth() * 0.5 * state.scale;
    const halfH = getWordHeight() * 0.5 * state.scale;

    // Limit the oval so the front face stays inside the open area on every side.
    const edgeMargin = 0.05;
    const stageX = getStageOffsetX();
    const rightEdge = -visW * 0.5 + availableWidth;
    const roomLeft = (visW * 0.5) / k - halfW + stageX - edgeMargin;
    const roomRight = rightEdge / k - halfW - stageX - edgeMargin;
    const roomY = (visH * 0.5) / k - halfH - edgeMargin;
    const moveX = Math.max(0, Math.min((availableWidth - effW) * 0.32, roomLeft, roomRight));
    const moveY = Math.max(0, Math.min((visH - effH) * 0.30, roomY));

    // cos(0) = 1 would snap the logo to the oval's edge, so grow the oval from
    // zero over the first 1.5 seconds of the loop.
    const ramp = easeInOut(Math.min(anim.t / 1.5, 1));

    const angle = anim.t * 2 * Math.PI / 6;
    state.translate[0] = Math.cos(angle) * moveX * ramp;
    state.translate[1] = Math.sin(angle) * moveY * ramp;
  }
}

// Show the current phase dynamically in the control panel
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
    const name = PHASE_NAMES[anim.phase] || "Unknown";
    el.textContent = "Phase " + anim.phase + ": " + name;
  }
}
