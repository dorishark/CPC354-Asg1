"use strict";

/* Transform state and user-adjustable settings. */

// Current position, rotation, and scale of the logo.
const state = {
  theta: [0, 0, 0],        // rotation in degrees about X, Y, Z
  scale: 1.0,              // uniform scale factor
  translate: [0, 0, 0]     // translation in world units
};

// Values controlled by the panel and used when rebuilding the logo.
const params = {
  word: "meow",
  depth: 0.4,              // extrusion depth (z thickness) of every letter
  speed: 1.0,              // animation speed multiplier
  spacing: 0.15,           // gap between letters
  colorMode: "perLetter",  // "perLetter" | "single" | "rainbow"
  // 6 distinct defaults for letters 1 to 6
  letterColors: ["#e63946", "#f4a261", "#2a9d8f", "#457b9d", "#9b5de5", "#f15bb5"],
  singleColor: "#e63946",
  bgColor: "#111111",
  isAnimating: false,
  useLighting: true,
  animPath: "oval"
};

/* Column-major matrix helpers used by WebGL. */

function mat4Identity() {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

// out = a * b   (apply b first, then a)
function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  return out;
}

function mat4Translate(x, y, z) {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function mat4Scale(s) {
  const m = mat4Identity();
  m[0] = m[5] = m[10] = s;
  return m;
}

function mat4RotateX(deg) {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), m = mat4Identity();
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

function mat4RotateY(deg) {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), m = mat4Identity();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

function mat4RotateZ(deg) {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), m = mat4Identity();
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}

function mat4Perspective(fovyDeg, aspect, near, far) {
  const f = 1 / Math.tan(fovyDeg * Math.PI / 360), nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) * nf; m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

// "#rrggbb" -> [r, g, b] in 0..1
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/* Bitmap glyphs and 3D geometry generation. */

// Letters use bitmap rows; '#' cells become cuboids. M and W use five columns
// so their diagonals remain distinct from H.
const GLYPHS = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["###", "#.#", "#.#", "#.#", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["###", "#.#", "###", "#..", "#.."],
  Q: [".###..", "#...#.", "#...#.", "#..##.", ".##..#"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#...#", "#...#", "#.#.#", "##.##", ".#.#."],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"]
};

const CELL = 0.2;                 // edge length of one bitmap cell (world units)
const GLYPH_COLS = 3, GLYPH_ROWS = 5;
const GLYPH_H = GLYPH_ROWS * CELL; // 1.0

function getGlyphWidth(ch) {
  const bitmap = GLYPHS[ch];
  return (bitmap ? bitmap[0].length : GLYPH_COLS) * CELL;
}

// Vertex positions and colours uploaded to the GPU.
let points = [];
let colors = [];
let normals = []; // Store normal per vertex

// Add two triangles for a quad with normal vectors
function pushQuad(a, b, c, d, rgb, norm) {
  for (const v of [a, b, c, a, c, d]) {
    points.push(v[0], v[1], v[2]);
    colors.push(rgb[0], rgb[1], rgb[2], 1.0);
    normals.push(norm[0], norm[1], norm[2]);
  }
}

/**
 * Create one cuboid. (x, y, z) is the minimum corner; w/h/d are the sizes along x/y/z.
 * 8 vertices are defined, then 6 quad faces are triangulated (12 triangles = 36 vertices).
 */
function createBox(x, y, z, w, h, d, baseRgb) {
  const v = [
    [x,     y,     z + d],  // 0 front bottom-left
    [x + w, y,     z + d],  // 1 front bottom-right
    [x + w, y + h, z + d],  // 2 front top-right
    [x,     y + h, z + d],  // 3 front top-left
    [x,     y,     z],      // 4 back  bottom-left
    [x + w, y,     z],      // 5 back  bottom-right
    [x + w, y + h, z],      // 6 back  top-right
    [x,     y + h, z]       // 7 back  top-left
  ];
  // Supply baseRgb and the outward normal vector for each face
  pushQuad(v[0], v[1], v[2], v[3], baseRgb, [0, 0, 1]);   // Front
  pushQuad(v[1], v[5], v[6], v[2], baseRgb, [1, 0, 0]);   // Right
  pushQuad(v[5], v[4], v[7], v[6], baseRgb, [0, 0, -1]);  // Back
  pushQuad(v[4], v[0], v[3], v[7], baseRgb, [-1, 0, 0]);  // Left
  pushQuad(v[3], v[2], v[6], v[7], baseRgb, [0, 1, 0]);   // Top
  pushQuad(v[4], v[5], v[1], v[0], baseRgb, [0, -1, 0]);  // Bottom
}

// Build one letter by merging horizontal runs of '#' in each bitmap row into single boxes.
function buildLetter(ch, x0, y0, z0, depth, rgb) {
  const bitmap = GLYPHS[ch];
  if (!bitmap) return;                          // Unsupported characters produce no geometry.
  const columns = bitmap[0].length;
  for (let row = 0; row < GLYPH_ROWS; row++) {
    const y = y0 + (GLYPH_ROWS - 1 - row) * CELL; // row 0 is the TOP of the letter
    let col = 0;
    while (col < columns) {
      if (bitmap[row][col] !== "#") { col++; continue; }
      let run = 0;
      while (col + run < columns && bitmap[row][col + run] === "#") run++;
      createBox(x0 + col * CELL, y, z0, run * CELL, CELL, depth, rgb);
      col += run;
    }
  }
}

/**
 * Build the whole word, centred on the origin in x, y and z, so that rotations
 * about the origin pivot around the middle of the logo.
 */
function buildWord() {
  points = []; colors = []; normals = [];
  const word = params.word.toUpperCase();
  const n = word.length;
  const totalW = Array.from(word).reduce((width, ch) => width + getGlyphWidth(ch), 0)
    + (n - 1) * params.spacing;
  const xStart = -totalW / 2;
  const yStart = -GLYPH_H / 2;
  const zStart = -params.depth / 2;
  let x = xStart;
  for (let i = 0; i < n; i++) {
    buildLetter(word[i], x, yStart, zStart, params.depth, letterColor(i));
    x += getGlyphWidth(word[i]) + params.spacing;
  }
}

// Return the word width for positioning and scaling.
function getWordWidth() {
  const word = params.word.toUpperCase();
  return Array.from(word).reduce((width, ch) => width + getGlyphWidth(ch), 0)
    + (word.length - 1) * params.spacing;
}
function getWordHeight() { return GLYPH_H; }

/* WebGL setup and geometry buffers. */

let gl, program, vBuffer, cBuffer, nBuffer;
let uModelView, uProjection, uUseLighting, aPosition, aColor, aNormal;
let vertexCount = 0;

function compileShader(type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error("Shader error: " + gl.getShaderInfoLog(s));
  return s;
}

function initWebGL() {
  const canvas = document.getElementById("glcanvas");
  gl = canvas.getContext("webgl");
  if (!gl) { alert("WebGL is not supported by this browser."); return false; }

  program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, document.getElementById("vertex-shader").text));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, document.getElementById("fragment-shader").text));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error("Link error: " + gl.getProgramInfoLog(program));
  gl.useProgram(program);

  aPosition = gl.getAttribLocation(program, "aPosition");
  aColor = gl.getAttribLocation(program, "aColor");
  aNormal = gl.getAttribLocation(program, "aNormal"); // Locate normal attribute

  uModelView = gl.getUniformLocation(program, "uModelView");
  uProjection = gl.getUniformLocation(program, "uProjection");
  uUseLighting = gl.getUniformLocation(program, "uUseLighting"); // Locate lighting uniform

  vBuffer = gl.createBuffer();
  cBuffer = gl.createBuffer();
  nBuffer = gl.createBuffer(); // Create normal buffer

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);   // Skip faces pointing away from the camera.
  return true;
}

// Rebuild the mesh and upload the updated buffers
function rebuildGeometry() {
  buildWord();
  vertexCount = points.length / 3;

  gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, nBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
}

// Keep the canvas pixel dimensions in sync with its displayed size.
function resizeCanvas() {
  const c = gl.canvas;
  if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
    c.width = c.clientWidth; c.height = c.clientHeight;
  }
  gl.viewport(0, 0, c.width, c.height);
}

/* Rendering. */

const CAMERA_Z = -5;   // Place the logo in front of the camera.

// Share of the canvas width covered by the control panels.
function getPanelFraction() {
  const panels = document.getElementById("controlPanels");
  const panelWidth = panels ? panels.offsetWidth + 24 : 600;
  return Math.min(0.62, panelWidth / Math.max(gl.canvas.width, 600));
}

// Apply scale, rotation, and translation to the model in that order
function buildModelView() {
  let m = mat4Translate(state.translate[0], state.translate[1], state.translate[2] + CAMERA_Z);
  m = mat4Mul(m, mat4RotateX(state.theta[0]));
  m = mat4Mul(m, mat4RotateY(state.theta[1]));
  m = mat4Mul(m, mat4RotateZ(state.theta[2]));
  m = mat4Mul(m, mat4Scale(state.scale));
  return m;
}

// Perspective projection shifted so the camera's centre is the middle of the free
// area. The logo stays straight in front of the camera, so depth cannot pull it sideways.
function buildProjection() {
  const aspect = gl.canvas.width / gl.canvas.height;
  const shift = mat4Translate(-getPanelFraction(), 0, 0); // clip space: canvas width is 2
  return mat4Mul(shift, mat4Perspective(45, aspect, 0.1, 100));
}

function drawLogo() {
  const bg = hexToRgb(params.bgColor);
  gl.clearColor(bg[0], bg[1], bg[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.uniformMatrix4fv(uProjection, false, buildProjection());
  gl.uniformMatrix4fv(uModelView, false, buildModelView());
  gl.uniform1i(uUseLighting, params.useLighting ? 1 : 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
  gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);
  gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
  gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColor);
  gl.bindBuffer(gl.ARRAY_BUFFER, nBuffer);
  gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aNormal);

  gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
}

function render(timestamp) {
  resizeCanvas();
  updateAnimation(timestamp);
  drawLogo();
  requestAnimationFrame(render);
}
