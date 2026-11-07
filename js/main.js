"use strict";

/* Start the WebGL scene and its controls. */
window.onload = function () {
  if (!initWebGL()) return;
  initUI();
  initExtensions();
  resizeCanvas();
  rebuildGeometry();
  requestAnimationFrame(render);   // pass timestamp correctly on first frame
};
