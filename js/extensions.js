"use strict";

/* Section 6: colour modes, restore defaults, keyboard and resize events (Lee En). */

// Helper to convert HSV to RGB (0..1) for smooth rainbow spectrum
function hsvToRgb(h, s, v) {
  let f = (n, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  return [f(5), f(3), f(1)];
}

// Select the colour assigned to a letter.
function letterColor(i) {
  if (params.colorMode === "single") {
    return hexToRgb(params.singleColor);
  }
  if (params.colorMode === "rainbow") {
    const totalLetters = Math.max(params.word.length, 1);
    const hue = (i / totalLetters) * 360; // Spread hues evenly across letters
    return hsvToRgb(hue, 0.85, 0.95);
  }
  return hexToRgb(params.letterColors[i % params.letterColors.length]);
}

// Reset all user adjustable parameters and UI inputs to initial values
function resetDefaults() {
  // 1. Reset state & playback
  anim.phase = 0;
  anim.t = 0;
  anim.running = false;
  _lastTimestamp = null;
  resetAnimationState();
  setControlsLocked(false);

  // 2. Reset parameter values
  params.word = "meow";
  params.depth = 0.40;
  params.speed = 1.0;
  params.spacing = 0.15;
  params.colorMode = "perLetter";
  params.letterColors = ["#e63946", "#f4a261", "#2a9d8f", "#457b9d", "#9b5de5", "#f15bb5"];
  params.singleColor = "#e63946";
  params.bgColor = "#111111";
  params.useLighting = true;
  params.animPath = "oval";

  // 3. Synchronize all DOM controls and text readout badges
  const $ = id => document.getElementById(id);
  if ($("inputWord")) $("inputWord").value = "meow";
  if ($("sliderDepth")) $("sliderDepth").value = 0.40;
  if ($("valDepth")) $("valDepth").textContent = "0.40";
  if ($("sliderSpacing")) $("sliderSpacing").value = 0.15;
  if ($("valSpacing")) $("valSpacing").textContent = "0.15";
  if ($("sliderSpeed")) $("sliderSpeed").value = 1.0;
  if ($("valSpeed")) $("valSpeed").textContent = "1.0x";
  if ($("selectColorMode")) $("selectColorMode").value = "perLetter";
  if ($("pickerSingleColor")) $("pickerSingleColor").value = "#e63946";
  if ($("pickerBgColor")) $("pickerBgColor").value = "#111111";
  if ($("singleColorRow")) $("singleColorRow").style.display = "none";
  if ($("paletteColorRow")) $("paletteColorRow").style.display = "block";
  if ($("checkLighting")) $("checkLighting").checked = true;
  if (document.getElementById("selectAnimPath")) document.getElementById("selectAnimPath").value = "oval";
  updatePlaybackButtons();
  setStatusBadge("ready", "READY");
  updatePhaseDisplay();

  // 4. Re-render UI color palette pickers and rebuild WebGL geometry
  renderPalettePickers();
  rebuildGeometry();
}

// Helper to generate a random hex color
function getRandomHexColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

/**
 * Initializes all extension hooks, UI listeners, keyboard shortcuts,
 * and window resize event delegates.
 */
function initExtensions() {
  const $ = id => document.getElementById(id);

  // 1. Hook "Restore All Settings" button
  const btnResetDefaults = $("btnResetDefaults");
  if (btnResetDefaults) {
    btnResetDefaults.addEventListener("click", resetDefaults);
  }

  // 2. Hide/show palette row when Rainbow mode is chosen
  const selectMode = $("selectColorMode");
  if (selectMode) {
    selectMode.addEventListener("change", e => {
      const palRow = $("paletteColorRow");
      if (palRow) {
        palRow.style.display = (e.target.value === "perLetter") ? "block" : "none";
      }
    });
  }

  // 3. Hook lighting shader toggle checkbox
  const checkLighting = $("checkLighting");
  if (checkLighting) {
    checkLighting.addEventListener("change", e => {
      params.useLighting = e.target.checked;
    });
  }

  // 4. Hook animation path dropdown selector
  const selectAnimPath = $("selectAnimPath");
  if (selectAnimPath) {
    selectAnimPath.addEventListener("change", e => {
      setAnimationPath(e.target.value);
    });
  }

  // 5. Attach keyboard shortcuts
  window.addEventListener("keydown", e => {
    // Avoid triggering controls while typing into the text field
    if (e.target && e.target.tagName === "INPUT" && e.target.type === "text") return;

    if (params.animPath === "playground") {
      if (e.code === "Space") {
        e.preventDefault();
        return;
      }

      const step = 0.1;
      let handled = true;
      switch (e.code) {
        case "ArrowUp": state.theta[0] -= 5; break;
        case "ArrowDown": state.theta[0] += 5; break;
        case "ArrowLeft": state.theta[1] -= 5; break;
        case "ArrowRight": state.theta[1] += 5; break;
        case "Equal":
        case "NumpadAdd": state.scale = Math.min(getMaxScaleToFit() * 1.5, state.scale * 1.1); break;
        case "Minus":
        case "NumpadSubtract": state.scale = Math.max(getBaseScale() * 0.25, state.scale / 1.1); break;
        case "KeyW": state.translate[1] = Math.min(3, state.translate[1] + step); break;
        case "KeyS": state.translate[1] = Math.max(-3, state.translate[1] - step); break;
        case "KeyA": state.translate[0] = Math.max(-4, state.translate[0] - step); break;
        case "KeyD": state.translate[0] = Math.min(4, state.translate[0] + step); break;
        case "KeyR": resetAnimationState(); break;
        case "Digit4": setAnimationPath("playground"); break;
        default:
          handled = false;
      }

      if (handled) {
        e.preventDefault();
        updatePhaseDisplay();
        return;
      }
    }

    // --- Start / Pause: Space ---
    if (e.code === "Space") {
      e.preventDefault();
      anim.running = !anim.running;
      if (anim.running) _lastTimestamp = null;
      setControlsLocked(anim.running);
      setStatusBadge(anim.running ? "running" : "paused", anim.running ? "RUNNING" : "PAUSED");
      updatePhaseDisplay();
    }
    // --- Reset Animation: R ---
    else if (e.key === "r" || e.key === "R") {
      anim.phase = 0;
      anim.t = 0;
      anim.running = false;
      _lastTimestamp = null;
      params.animPath = "oval";
      if ($("selectAnimPath")) $("selectAnimPath").value = "oval";
      resetAnimationState();
      setControlsLocked(false);
      setStatusBadge("ready", "READY");
      updatePlaybackButtons();
      updatePhaseDisplay();
    }
    // --- Restore All Settings: D ---
    else if (e.key === "d" || e.key === "D") {
      resetDefaults();
    }
    // --- Toggle Lighting: L ---
    else if (e.key === "l" || e.key === "L") {
      params.useLighting = !params.useLighting;
      if ($("checkLighting")) $("checkLighting").checked = params.useLighting;
    }
    // --- Animation Path 1 (Default): Key 1 ---
    else if (e.key === "1") {
      setAnimationPath("oval");
    }
    // --- Animation Path 2 (Center Bounce Loop): Key 2 ---
    else if (e.key === "2") {
      setAnimationPath("bounce");
    }
    // --- Animation Path 3 (Center Flip & Wave Loop): Key 3 ---
    else if (e.key === "3") {
      setAnimationPath("flip");
    }
    // --- Playground: Key 4 ---
    else if (e.key === "4") {
      setAnimationPath("playground");
    }
    // --- Extrusion Depth: [ / ] ---
    else if (e.key === "[" || e.key === "]") {
      if (anim.running) return;
      const delta = (e.key === "]") ? 0.05 : -0.05;
      params.depth = Math.min(1.5, Math.max(0.1, +(params.depth + delta).toFixed(2)));
      if ($("sliderDepth")) $("sliderDepth").value = params.depth;
      if ($("valDepth")) $("valDepth").textContent = params.depth.toFixed(2);
      rebuildGeometry();
    }
    // --- Letter Spacing: - / = ---
    else if (e.key === "-" || e.key === "=") {
      if (anim.running) return;
      const delta = (e.key === "-" ? -0.01 : 0.01);
      params.spacing = Math.min(0.30, Math.max(0.0, +(params.spacing + delta).toFixed(2)));
      if ($("sliderSpacing")) $("sliderSpacing").value = params.spacing;
      if ($("valSpacing")) $("valSpacing").textContent = params.spacing.toFixed(2);
      rebuildGeometry();
    }
    // --- Playback Speed: , / . ---
    else if (e.key === "," || e.key === ".") {
      const delta = (e.key === "." || e.key === ">") ? 0.1 : -0.1;
      params.speed = Math.min(3.0, Math.max(0.2, +(params.speed + delta).toFixed(1)));
      if ($("sliderSpeed")) $("sliderSpeed").value = params.speed;
      if ($("valSpeed")) $("valSpeed").textContent = params.speed.toFixed(1) + "x";
    }
    // --- Cycle Color Mode: C ---
    else if (e.key === "c" || e.key === "C") {
      const modes = ["perLetter", "single", "rainbow"];
      const nextIdx = (modes.indexOf(params.colorMode) + 1) % modes.length;
      params.colorMode = modes[nextIdx];
      if ($("selectColorMode")) $("selectColorMode").value = params.colorMode;
      
      if ($("singleColorRow")) $("singleColorRow").style.display = (params.colorMode === "single") ? "block" : "none";
      if ($("paletteColorRow")) $("paletteColorRow").style.display = (params.colorMode === "perLetter") ? "block" : "none";
      rebuildGeometry();
    }
    // --- Randomize Logo Colors: V ---
    else if (e.key === "v" || e.key === "V") {
      if (params.colorMode === "single") {
        params.singleColor = getRandomHexColor();
        if ($("pickerSingleColor")) $("pickerSingleColor").value = params.singleColor;
      } else if (params.colorMode === "perLetter") {
        params.letterColors = params.letterColors.map(() => getRandomHexColor());
        renderPalettePickers();
      }
      rebuildGeometry();
    }
    // --- Random Stage Background: B ---
    else if (e.key === "b" || e.key === "B") {
      params.bgColor = getRandomHexColor();
      if ($("pickerBgColor")) $("pickerBgColor").value = params.bgColor;
    }
  });

  // 6. Responsive Viewport Handler: Sync WebGL dimensions on browser window resize
  window.addEventListener("resize", () => {
    if (gl) resizeCanvas();
  });
}
