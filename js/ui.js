"use strict";

/* Section 5: control panel behaviour (Xin Qi). */

/* User interface event handlers. */
function renderPalettePickers() {
  const container = document.getElementById("paletteGrid");
  if (!container) return;
  container.innerHTML = "";

  const word = params.word || "MEOW";

  for (let i = 0; i < word.length; i++) {
    const input = document.createElement("input");
    input.type = "color";
    input.value = params.letterColors[i];
    input.title = `Color for "${word[i]}" (Letter ${i + 1})`;
    
    input.addEventListener("input", e => {
      params.letterColors[i] = e.target.value;
      if (params.colorMode === "perLetter") rebuildGeometry();
    });
    
    container.appendChild(input);
  }
}

function initUI() {
  const $ = id => document.getElementById(id);

  // 1. Text input listener (filters valid letters only)
  $("inputWord").addEventListener("input", e => {
    const sanitized = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    e.target.value = sanitized; // Update the input field with validated text

    if (sanitized.length > 0) {
      params.word = sanitized; // Update the stored logo text
      renderPalettePickers(); // Refresh colour pickers based on the number of the letters
      rebuildGeometry(); // Rebuild the 3D logo using the updated text
    }
  });

  // Restore previous valid text when the input field loses focus
  $("inputWord").addEventListener("blur", e => {
    if (e.target.value.trim().length === 0) {
      e.target.value = params.word.toUpperCase(); // Restore the previous valid word
      renderPalettePickers(); // Refresh the colour pickers
      rebuildGeometry(); // Rebuild the 3D logo
    }
  });

  // Populate dynamic pickers on initial setup
  renderPalettePickers();

  // 2. Extrusion Depth slider listener
  $("sliderDepth").addEventListener("input", e => {
    params.depth = parseFloat(e.target.value);
    $("valDepth").textContent = params.depth.toFixed(2);
    rebuildGeometry();
  });

  // 3. Spacing slider listener
  $("sliderSpacing").addEventListener("input", e => {
    params.spacing = parseFloat(e.target.value);
    $("valSpacing").textContent = params.spacing.toFixed(2);
    rebuildGeometry();
  });

  // 4. Animation Speed slider listener
  $("sliderSpeed").addEventListener("input", e => {
    params.speed = parseFloat(e.target.value);
    $("valSpeed").textContent = params.speed.toFixed(1) + "x";
  });

  // 5. Color Mode Dropdown listener
  $("selectColorMode").addEventListener("change", e => {
    params.colorMode = e.target.value;
    if (params.colorMode === "single") {
      $("singleColorRow").style.display = "block";
      $("paletteColorRow").style.display = "none";
    } else {
      $("singleColorRow").style.display = "none";
      $("paletteColorRow").style.display = "block";
    }
    rebuildGeometry();
  });

  // 6. Unified Single Color Picker
  $("pickerSingleColor").addEventListener("input", e => {
    params.singleColor = e.target.value;
    if (params.colorMode === "single") rebuildGeometry();
  });

  // 7. Stage Background Color Picker
  const bgPicker = $("pickerBgColor");
  if (bgPicker) {
    bgPicker.addEventListener("input", e => {
      params.bgColor = e.target.value;
    });
  }

  // 8. Playback Buttons with Status Badges and Parameter Locking
  $("btnStart").addEventListener("click", () => {
    if (params.animPath === "playground") return;
    anim.running = true;
    _lastTimestamp = null;
    setControlsLocked(true);
    setStatusBadge("running", "RUNNING");
    updatePhaseDisplay();
  });

  $("btnStop").addEventListener("click", () => {
    if (params.animPath === "playground") return;
    anim.running = false;
    setControlsLocked(false);
    setStatusBadge("paused", "PAUSED");
    updatePhaseDisplay();
  });

  $("btnReset").addEventListener("click", () => {
    anim.phase = 0;
    anim.t = 0;
    anim.running = false;
    _lastTimestamp = null;
    resetAnimationState();
    setControlsLocked(false);
    if (params.animPath === "playground") {
      setStatusBadge("playground", "PLAYGROUND");
    } else {
      params.animPath = "oval";
      if ($("selectAnimPath")) $("selectAnimPath").value = "oval";
      setStatusBadge("ready", "READY");
    }
    updatePlaybackButtons();
    updatePhaseDisplay();
  });
  updatePlaybackButtons();
}

// Visual status badge helper
function setStatusBadge(className, label) {
  const badge = document.getElementById("badgeStatus");
  if (badge) {
    badge.className = "status-badge " + className;
    badge.textContent = label;
  }
}

function updatePlaybackButtons() {
  const isPlayground = params.animPath === "playground";
  const startButton = document.getElementById("btnStart");
  const stopButton = document.getElementById("btnStop");
  const resetButton = document.getElementById("btnReset");
  const playgroundControls = document.getElementById("playgroundControls");

  if (startButton) startButton.disabled = isPlayground;
  if (stopButton) stopButton.disabled = isPlayground;
  if (resetButton) resetButton.textContent = isPlayground ? "Reset View" : "Reset";
  if (playgroundControls) playgroundControls.style.display = isPlayground ? "block" : "none";
}

// Lock/unlock geometry controls while animating to prevent visual glitches
function setControlsLocked(locked) {
  ["inputWord", "sliderDepth", "sliderSpacing", "selectColorMode"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
  const groups = document.querySelectorAll(".control-group");
  if (groups.length > 0) {
    groups[0].classList.toggle("disabled-while-running", locked);
    groups[1].classList.toggle("disabled-while-running", locked);
  }
}
