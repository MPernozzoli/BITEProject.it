// Progressive 3D enhancement for the boot splash in index.html.
// The static CSS/SVG splash paints instantly; once this chunk loads we fade in a
// Three.js night-ocean scene on top and fade the 2D boat/waves out. The splash
// lifecycle (dismiss + removal) stays owned by main.tsx — when the container is
// removed from the DOM we stop the loop and dispose all GPU resources.
import * as THREE from "three";

const OCEAN_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  varying float vHeight;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  float waveHeight(vec2 p, float t) {
    return 0.32 * sin(p.x * 0.35 + t * 0.9)
         + 0.22 * sin(p.x * 0.2 + p.y * 0.3 + t * 0.6)
         + 0.12 * sin(p.y * 0.5 - t * 0.4)
         + 0.08 * sin((p.x + p.y) * 0.7 + t * 1.3)
         + 0.05 * sin(p.x * 1.8 - t * 1.7)
         + 0.035 * sin((p.x * 2.6 + p.y * 1.4) + t * 2.3);
  }

  void main() {
    vec3 pos = position;
    // PlaneGeometry is rotated flat by the mesh, so local x/y map to world x/z.
    vec2 p = pos.xy;
    // The water streams past the hull (bow points +x), selling the boat as under way.
    vec2 q = vec2(p.x + uScroll, p.y);
    float h = waveHeight(q, uTime);

    // Flattened trough carved into the water behind the transom.
    float behind = -p.x;
    float wake = exp(-pow(p.y * 2.4, 2.0))
               * smoothstep(0.5, 1.3, behind)
               * exp(-max(behind - 1.0, 0.0) * 0.45) * 0.09;
    h -= wake;
    pos.z += h;

    float dhdx = 0.32 * 0.35 * cos(q.x * 0.35 + uTime * 0.9)
               + 0.22 * 0.2  * cos(q.x * 0.2 + q.y * 0.3 + uTime * 0.6)
               + 0.08 * 0.7  * cos((q.x + q.y) * 0.7 + uTime * 1.3)
               + 0.05 * 1.8  * cos(q.x * 1.8 - uTime * 1.7)
               + 0.035 * 2.6 * cos((q.x * 2.6 + q.y * 1.4) + uTime * 2.3);
    float dhdz = 0.22 * 0.3  * cos(q.x * 0.2 + q.y * 0.3 + uTime * 0.6)
               + 0.12 * 0.5  * cos(q.y * 0.5 - uTime * 0.4)
               + 0.08 * 0.7  * cos((q.x + q.y) * 0.7 + uTime * 1.3)
               + 0.035 * 1.4 * cos((q.x * 2.6 + q.y * 1.4) + uTime * 2.3);

    vHeight = h;
    vNormal = normalize(mat3(modelMatrix) * normalize(vec3(-dhdx, -dhdz, 1.0)));
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const OCEAN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform vec3 uDeepColor;
  uniform vec3 uCrestColor;
  uniform vec3 uMoonDir;
  uniform vec3 uCameraPos;
  varying float vHeight;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float crest = smoothstep(-0.5, 0.7, vHeight);
    vec3 color = mix(uDeepColor, uCrestColor, crest);

    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 halfDir = normalize(uMoonDir + viewDir);
    float facing = max(dot(normal, halfDir), 0.0);

    // Wide moonlight sheen plus a tight hot core along the moon path.
    float sheen = pow(facing, 14.0);
    float core = pow(facing, 90.0);
    color += vec3(0.55, 0.66, 0.70) * sheen * 0.22;
    color += vec3(0.80, 0.90, 0.92) * core * 0.65;

    // Animated glitter: rare pinpoint dots that only live inside the moon streak.
    vec2 sparkleGrid = vWorldPos.xz * 26.0;
    float cell = hash(floor(sparkleGrid) + floor(uTime * 2.5) * 0.71);
    float sparkle = step(0.992, cell);
    float pinpoint = smoothstep(0.38, 0.08, length(fract(sparkleGrid) - 0.5));
    color += vec3(0.85, 0.94, 1.0) * sparkle * pinpoint * (sheen * 1.4 + core) * 1.8;

    // Sparse broken foam, confined to the very tips of the crests.
    float foamNoise = hash(floor(vWorldPos.xz * 6.0) + floor(uTime * 1.2));
    float foam = smoothstep(0.62, 0.95, vHeight) * smoothstep(0.6, 0.95, foamNoise);
    color = mix(color, vec3(0.78, 0.86, 0.88), foam * 0.3);

    // Wake: churned water astern plus thin spray arms fanning out in a V.
    // The noise streams aft with the water (uScroll) while the envelope stays on the hull.
    float behind = -vWorldPos.x;
    float lat = abs(vWorldPos.z);
    float streamNoise = 0.5 * hash(floor(vec2((vWorldPos.x + uScroll) * 7.0, vWorldPos.z * 12.0)))
                      + 0.5 * hash(floor(vec2((vWorldPos.x + uScroll) * 16.0, vWorldPos.z * 26.0)));
    float churn = smoothstep(0.38, 0.05, lat) * smoothstep(0.5, 1.1, behind) * exp(-behind * 0.26);
    float arms = (1.0 - smoothstep(0.0, 0.1, abs(lat - (0.14 + behind * 0.17))))
               * smoothstep(0.7, 1.2, behind) * exp(-behind * 0.24);
    float wakeFoam = clamp(churn * 1.5 + arms * 0.9, 0.0, 1.0) * (0.45 + 0.55 * streamNoise);
    // Bow spray where the stem cuts the water.
    float bowDist = length(vWorldPos.xz - vec2(1.12, 0.0));
    float bowFoam = smoothstep(0.36, 0.08, bowDist) * (0.55 + 0.45 * sin(uTime * 5.0 + vWorldPos.z * 14.0));
    color = mix(color, vec3(0.8, 0.88, 0.9), clamp(wakeFoam + bowFoam, 0.0, 1.0) * 0.6);

    // Fade into the CSS radial-gradient sky at the horizon (canvas is transparent).
    float dist = length(vWorldPos.xz - uCameraPos.xz);
    float alpha = 1.0 - smoothstep(18.0, 34.0, dist);
    gl_FragColor = vec4(color, alpha * 0.96);
  }
`;

const STAR_VERTEX = /* glsl */ `
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  varying float vAlpha;
  void main() {
    vAlpha = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.5 + aPhase * 1.4) + aPhase * 40.0));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = smoothstep(0.5, 0.08, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vec3(0.85, 0.92, 0.94), d * vAlpha * 0.55);
  }
`;

// Must mirror waveHeight in OCEAN_VERTEX so the boat rides the same water.
function waveHeight(x: number, z: number, t: number): number {
  return (
    0.32 * Math.sin(x * 0.35 + t * 0.9) +
    0.22 * Math.sin(x * 0.2 + z * 0.3 + t * 0.6) +
    0.12 * Math.sin(z * 0.5 - t * 0.4) +
    0.08 * Math.sin((x + z) * 0.7 + t * 1.3) +
    0.05 * Math.sin(x * 1.8 - t * 1.7) +
    0.035 * Math.sin(x * 2.6 + z * 1.4 + t * 2.3)
  );
}

function makeGlowTexture(inner: string, outer: string, innerStop = 0.35): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(innerStop, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function makeStreakTexture(): THREE.CanvasTexture {
  // Horizontal comet streak: bright head on the right, tail fading left.
  const w = 256;
  const h = 32;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, w, 0);
  gradient.addColorStop(0, "rgba(220,236,240,0)");
  gradient.addColorStop(0.75, "rgba(220,236,240,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0.95)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  // Soften vertically.
  const mask = ctx.createLinearGradient(0, 0, 0, h);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.5, "rgba(0,0,0,0)");
  mask.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(canvas);
}

function makeWoodTexture(base: string, seam: string, plankHeight: number): THREE.CanvasTexture {
  // Horizontal strakes with subtle grain streaks; u runs along the hull length.
  const w = 256;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += plankHeight) {
    ctx.fillStyle = seam;
    ctx.fillRect(0, y, w, 2);
    // Slight per-plank tonal shift so strakes read individually.
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? "255,235,210" : "60,30,10"},${0.03 + Math.random() * 0.05})`;
    ctx.fillRect(0, y + 2, w, plankHeight - 2);
  }
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "#3c1f0a" : "#ffe9cf";
    const y = Math.random() * h;
    ctx.fillRect(Math.random() * w, y, 14 + Math.random() * 60, 1);
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeHullTexture(): THREE.CanvasTexture {
  // Spritz's paint scheme mapped around the hull section (v: rail -> keel -> rail):
  // white topsides band with a gold cove stripe, navy blue below the sheer.
  // The waterline sits at only ~8% of the rail-to-keel arc, so the paint bands
  // must be much thinner than they look on the real hull photos.
  const w = 256;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#3a4d7a";
  ctx.fillRect(0, 0, w, h);
  // Slightly darker antifouling around the keel.
  ctx.fillStyle = "#2a3757";
  ctx.fillRect(0, Math.round(h * 0.3), w, Math.round(h * 0.4));
  // Hairline white sheer band + gold cove stripe at both rails; navy owns the freeboard.
  ctx.fillStyle = "#edeee9";
  ctx.fillRect(0, 0, w, 5);
  ctx.fillRect(0, h - 5, w, 5);
  ctx.fillStyle = "#c9a35e";
  ctx.fillRect(0, 5, w, 3);
  ctx.fillRect(0, h - 8, w, 3);
  // Faint hull sheen noise.
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "#141d33" : "#5a6c96";
    ctx.fillRect(Math.random() * w, Math.round(h * 0.06) + Math.random() * h * 0.86, 20 + Math.random() * 70, 1.5);
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeFlagTexture(): THREE.CanvasTexture {
  // German ensign, slightly muted for the night palette.
  const w = 60;
  const h = 42;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#26262b";
  ctx.fillRect(0, 0, w, h / 3);
  ctx.fillStyle = "#a83a30";
  ctx.fillRect(0, h / 3, w, h / 3);
  ctx.fillStyle = "#d9a13b";
  ctx.fillRect(0, (2 * h) / 3, w, h / 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSailTexture(): THREE.CanvasTexture {
  // Woven canvas with faint horizontal panel seams.
  const w = 256;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f8f2e4";
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "#b8ac90" : "#ffffff";
    ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 8, 1.5);
  }
  ctx.globalAlpha = 1;
  for (let y = 64; y < h; y += 64) {
    ctx.fillStyle = "rgba(150,138,112,0.28)";
    ctx.fillRect(0, y, w, 1.5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Lofted hull modelled on S/Y Spritz: a double-ender — the stern tapers to a
// canoe point that mirrors the fine, upswept bow.
const HULL_STATIONS = [
  { x: -1.18, w: 0.02, d: 0.06, s: 0.105 },
  { x: -1.06, w: 0.105, d: 0.15, s: 0.06 },
  { x: -0.9, w: 0.195, d: 0.235, s: 0.032 },
  { x: -0.7, w: 0.27, d: 0.295, s: 0.015 },
  { x: -0.48, w: 0.322, d: 0.33, s: 0.006 },
  { x: -0.25, w: 0.348, d: 0.35, s: 0.002 },
  { x: -0.05, w: 0.35, d: 0.35, s: 0.0 },
  { x: 0.15, w: 0.344, d: 0.345, s: 0.002 },
  { x: 0.35, w: 0.33, d: 0.33, s: 0.01 },
  { x: 0.55, w: 0.305, d: 0.305, s: 0.024 },
  { x: 0.75, w: 0.265, d: 0.27, s: 0.045 },
  { x: 0.95, w: 0.205, d: 0.22, s: 0.072 },
  { x: 1.1, w: 0.125, d: 0.16, s: 0.1 },
  { x: 1.22, w: 0.018, d: 0.07, s: 0.132 },
];
const HULL_RING = 9;

function buildHullGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const S = HULL_STATIONS.length;

  for (let i = 0; i < S; i++) {
    const st = HULL_STATIONS[i];
    for (let k = 0; k < HULL_RING; k++) {
      const t = k / (HULL_RING - 1);
      // Half-round section: port rail -> keel -> starboard rail.
      positions.push(st.x, st.s - Math.sin(t * Math.PI) * st.d, Math.cos(t * Math.PI) * st.w);
      uvs.push((i / (S - 1)) * 3, t);
    }
  }
  for (let i = 0; i < S - 1; i++) {
    for (let k = 0; k < HULL_RING - 1; k++) {
      const a = i * HULL_RING + k;
      const b = (i + 1) * HULL_RING + k;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // Transom: fan closing the stern.
  const sternCenter = positions.length / 3;
  const st0 = HULL_STATIONS[0];
  positions.push(st0.x, st0.s - st0.d * 0.45, 0);
  uvs.push(0, 0.5);
  for (let k = 0; k < HULL_RING - 1; k++) {
    indices.push(sternCenter, k, k + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildDeckGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const S = HULL_STATIONS.length;
  for (let i = 0; i < S; i++) {
    const st = HULL_STATIONS[i];
    positions.push(st.x, st.s + 0.004, st.w * 0.97); // port edge
    positions.push(st.x, st.s + 0.004, -st.w * 0.97); // starboard edge
    uvs.push((i / (S - 1)) * 3, 0, (i / (S - 1)) * 3, 1);
  }
  for (let i = 0; i < S - 1; i++) {
    const p = i * 2;
    indices.push(p, p + 3, p + 1, p, p + 2, p + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildRailCurve(side: 1 | -1): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    HULL_STATIONS.map((st) => new THREE.Vector3(st.x, st.s + 0.016, side * st.w * 0.99))
  );
}

function buildSailGeometry(luffHeight: number, footLength: number, belly: number): THREE.BufferGeometry {
  // Full cloth grid: belly curves both across the chord and up the luff,
  // with a gentle roach (outward curve) on the leech.
  const rows = 12;
  const cols = 7;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const foot = footLength * (1 - v) * (1 + 0.07 * Math.sin(v * Math.PI));
    for (let c = 0; c <= cols; c++) {
      const f = c / cols;
      const draft = Math.sin(Math.PI * Math.pow(f, 0.85)) * Math.sin(Math.PI * Math.min(1, v * 1.06 + 0.02));
      positions.push(f * foot, v * luffHeight, draft * belly);
      uvs.push(f, v);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = (r + 1) * (cols + 1) + c;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function mountBootSplash3D(): void {
  const splash = document.getElementById("bite-boot-splash");
  if (!splash || splash.classList.contains("is-hiding")) return;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return; // No WebGL — the CSS splash stays as-is.
  }

  const canvas = renderer.domElement;
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 700ms ease-out;pointer-events:none;";
  splash.prepend(canvas);

  // Keep the label readable above the scene; fade the 2D boat/waves out once 3D is up.
  const stage = splash.querySelector<HTMLElement>(".bite-boot-stage");
  const waves = splash.querySelector<HTMLElement>(".bite-boot-waves");
  const label = splash.querySelector<HTMLElement>(".bite-boot-label");
  if (label) label.style.zIndex = "1";

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(splash.clientWidth, splash.clientHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, splash.clientWidth / splash.clientHeight, 0.1, 100);
  camera.position.set(0, 1.35, 10.8);

  scene.add(new THREE.HemisphereLight(0x9fcfd6, 0x1a2c40, 1.2));
  const moonDir = new THREE.Vector3(-0.35, 0.55, -0.75).normalize();
  const moonLight = new THREE.DirectionalLight(0xcfe4ea, 1.1);
  moonLight.position.copy(moonDir).multiplyScalar(20);
  scene.add(moonLight);
  // Warm fill from the camera side so the hull and sails read against the night sky.
  const fillLight = new THREE.DirectionalLight(0xffd9b0, 0.55);
  fillLight.position.set(4, 3, 9);
  scene.add(fillLight);

  // ---------------------------------------------------------------- Ocean
  const oceanUniforms = {
    uTime: { value: 0 },
    uScroll: { value: 0 },
    uDeepColor: { value: new THREE.Color("#14304a") },
    uCrestColor: { value: new THREE.Color("#3a6f86") },
    uMoonDir: { value: moonDir },
    uCameraPos: { value: camera.position },
  };
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 44, 220, 120),
    new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERTEX,
      fragmentShader: OCEAN_FRAGMENT,
      uniforms: oceanUniforms,
      transparent: true,
    })
  );
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);

  // ---------------------------------------------------------------- Boat
  const boat = new THREE.Group();
  const hullTexture = makeHullTexture();
  const deckTexture = makeWoodTexture("#8f6f4c", "rgba(58,38,22,0.5)", 22);
  const sailTexture = makeSailTexture();
  const flagTexture = makeFlagTexture();

  const hullMat = new THREE.MeshStandardMaterial({ map: hullTexture, roughness: 0.45, metalness: 0.05 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: "#6e3d1e", roughness: 0.55 });
  // Spritz's mast and boom are painted blue.
  const sparMat = new THREE.MeshStandardMaterial({ color: "#41598a", roughness: 0.55 });
  const steelMat = new THREE.MeshStandardMaterial({ color: "#9aa4ad", roughness: 0.35, metalness: 0.7 });

  const hull = new THREE.Mesh(buildHullGeometry(), hullMat);
  const deck = new THREE.Mesh(
    buildDeckGeometry(),
    new THREE.MeshStandardMaterial({ map: deckTexture, roughness: 0.75 })
  );
  boat.add(hull, deck);

  // Rounded rub rail along the sheer line, closing at the bow.
  const railGeometryPort = new THREE.TubeGeometry(buildRailCurve(1), 32, 0.02, 6);
  const railGeometryStar = new THREE.TubeGeometry(buildRailCurve(-1), 32, 0.02, 6);
  boat.add(new THREE.Mesh(railGeometryPort, darkWoodMat), new THREE.Mesh(railGeometryStar, darkWoodMat));

  // Cabin: cream sides, wood roof, brass-ringed porthole glowing warm.
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.2, 0.38),
    new THREE.MeshStandardMaterial({ color: "#efe5d0", roughness: 0.8 })
  );
  cabin.position.set(-0.42, 0.11, 0);
  boat.add(cabin);
  const cabinRoof = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.035, 0.44), darkWoodMat);
  cabinRoof.position.set(-0.42, 0.225, 0);
  boat.add(cabinRoof);
  const cabinWindow = new THREE.Mesh(new THREE.CircleGeometry(0.038, 20), new THREE.MeshBasicMaterial({ color: "#ffd9a0" }));
  cabinWindow.position.set(-0.42, 0.12, 0.191);
  boat.add(cabinWindow);
  const portholeRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.042, 0.007, 8, 24),
    new THREE.MeshStandardMaterial({ color: "#c9a35e", roughness: 0.35, metalness: 0.7 })
  );
  portholeRing.position.set(-0.42, 0.12, 0.192);
  boat.add(portholeRing);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 2.3, 12), sparMat);
  mast.position.set(0.1, 1.15, 0);
  boat.add(mast);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.02, 10), sparMat);
  boom.rotation.z = Math.PI / 2;
  boom.position.set(-0.4, 0.3, 0);
  boat.add(boom);

  const mainSail = new THREE.Mesh(
    buildSailGeometry(1.95, 0.98, 0.17),
    new THREE.MeshStandardMaterial({ map: sailTexture, roughness: 0.85, side: THREE.DoubleSide })
  );
  mainSail.position.set(0.13, 0.33, 0);
  mainSail.rotation.y = Math.PI; // boom toward the stern
  boat.add(mainSail);

  const jib = new THREE.Mesh(
    buildSailGeometry(1.6, 0.85, 0.13),
    new THREE.MeshStandardMaterial({ map: sailTexture, roughness: 0.85, side: THREE.DoubleSide })
  );
  jib.position.set(0.16, 0.3, 0);
  boat.add(jib);

  // Stern arch carrying the solar panel, and the cream sprayhood over the companionway.
  const archPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.018, 0.46),
    new THREE.MeshStandardMaterial({ color: "#141a28", roughness: 0.35, metalness: 0.5 })
  );
  archPanel.position.set(-0.92, 0.56, 0);
  boat.add(archPanel);
  const postGeometry = new THREE.CylinderGeometry(0.011, 0.011, 0.52, 6);
  for (const [px, pz] of [[-0.79, 0.15], [-0.79, -0.15], [-1.04, 0.12], [-1.04, -0.12]] as const) {
    const post = new THREE.Mesh(postGeometry, steelMat);
    post.position.set(px, 0.3, pz);
    boat.add(post);
  }
  const sprayhood = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.34, 14, 1, true, Math.PI / 2, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: "#e6d9bc", roughness: 0.9, side: THREE.DoubleSide })
  );
  sprayhood.rotation.x = Math.PI / 2;
  sprayhood.position.set(-0.76, 0.13, 0);
  boat.add(sprayhood);

  // Rigging: forestay, backstay and two shrouds as thin lines.
  const mastTop = new THREE.Vector3(0.1, 2.28, 0);
  const riggingGeometry = new THREE.BufferGeometry().setFromPoints([
    mastTop, new THREE.Vector3(1.2, 0.15, 0),     // forestay -> bow tip
    mastTop, new THREE.Vector3(-1.16, 0.12, 0),   // backstay -> stern point
    mastTop, new THREE.Vector3(0.05, 0.02, 0.33), // shroud starboard
    mastTop, new THREE.Vector3(0.05, 0.02, -0.33) // shroud port
  ]);
  const riggingMat = new THREE.LineBasicMaterial({ color: 0xd8d2c4, transparent: true, opacity: 0.5 });
  boat.add(new THREE.LineSegments(riggingGeometry, riggingMat));

  // Fluttering pennant at the masthead (vertices animated each frame).
  const flagSegments = 7;
  const flagLength = 0.34;
  const flagPositions = new Float32Array((flagSegments + 1) * 2 * 3);
  const flagGeometry = new THREE.BufferGeometry();
  const flagIndices: number[] = [];
  for (let i = 0; i < flagSegments; i++) {
    const a = i * 2;
    flagIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  flagGeometry.setIndex(flagIndices);
  flagGeometry.setAttribute("position", new THREE.BufferAttribute(flagPositions, 3));
  const flagUvs = new Float32Array((flagSegments + 1) * 2 * 2);
  for (let i = 0; i <= flagSegments; i++) {
    const u = i / flagSegments;
    flagUvs.set([u, 1, u, 0], i * 4);
  }
  flagGeometry.setAttribute("uv", new THREE.BufferAttribute(flagUvs, 2));
  const flag = new THREE.Mesh(
    flagGeometry,
    new THREE.MeshBasicMaterial({ map: flagTexture, side: THREE.DoubleSide })
  );
  // Fly the ensign below the masthead light so its glow doesn't wash out the black stripe.
  flag.position.set(mastTop.x, mastTop.y - 0.18, mastTop.z);
  boat.add(flag);

  // Warm masthead lantern: flickering glow sprite + a real point light.
  const lanternTexture = makeGlowTexture("rgba(255,214,150,0.9)", "rgba(255,214,150,0)", 0.2);
  const lantern = new THREE.Sprite(new THREE.SpriteMaterial({ map: lanternTexture, transparent: true, depthWrite: false }));
  lantern.position.set(0.1, 2.34, 0);
  lantern.scale.setScalar(0.5);
  boat.add(lantern);
  const lanternLight = new THREE.PointLight(0xffc98a, 0.8, 5, 2);
  lanternLight.position.copy(lantern.position);
  boat.add(lanternLight);

  scene.add(boat);

  // ---------------------------------------------------------------- Sky
  const moonTexture = makeGlowTexture("rgba(238,247,248,0.95)", "rgba(238,247,248,0)");
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: moonTexture, transparent: true, opacity: 0.66, depthWrite: false })
  );
  moon.position.set(-9, 8.5, -26);
  moon.scale.setScalar(5.8);
  scene.add(moon);

  // Soft clouds drifting near the horizon.
  const cloudTexture = makeGlowTexture("rgba(96,130,158,0.55)", "rgba(96,130,158,0)", 0.15);
  const clouds: { sprite: THREE.Sprite; speed: number }[] = [];
  const cloudSpecs = [
    { x: -14, y: 5.2, z: -28, sx: 16, sy: 3.6, o: 0.4, speed: 0.12 },
    { x: 6, y: 7.5, z: -30, sx: 13, sy: 3.0, o: 0.3, speed: 0.08 },
    { x: 16, y: 4.6, z: -26, sx: 11, sy: 2.6, o: 0.35, speed: 0.15 },
    { x: -3, y: 9.8, z: -32, sx: 18, sy: 4.0, o: 0.22, speed: 0.06 },
  ];
  for (const spec of cloudSpecs) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, opacity: spec.o, depthWrite: false })
    );
    sprite.position.set(spec.x, spec.y, spec.z);
    sprite.scale.set(spec.sx, spec.sy, 1);
    scene.add(sprite);
    clouds.push({ sprite, speed: spec.speed });
  }

  // Twinkling stars with per-star phase and size.
  const starCount = 260;
  const starPositions = new Float32Array(starCount * 3);
  const starPhases = new Float32Array(starCount);
  const starSizes = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const radius = 24 + Math.random() * 16;
    starPositions[i * 3] = Math.cos(theta) * radius;
    starPositions[i * 3 + 1] = 2.5 + Math.random() * 18;
    starPositions[i * 3 + 2] = -8 - Math.random() * 30;
    starPhases[i] = Math.random();
    starSizes[i] = (1.0 + Math.random() * 1.8) * Math.min(window.devicePixelRatio, 2);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  starGeometry.setAttribute("aPhase", new THREE.BufferAttribute(starPhases, 1));
  starGeometry.setAttribute("aSize", new THREE.BufferAttribute(starSizes, 1));
  const starUniforms = { uTime: { value: 0 } };
  const starMaterial = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    uniforms: starUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(starGeometry, starMaterial));

  // Occasional shooting star: an elongated streak sprite sweeping across the sky.
  const streakTexture = makeStreakTexture();
  const shootingStar = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: streakTexture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  shootingStar.scale.set(6, 0.5, 1);
  scene.add(shootingStar);
  const meteor = {
    active: false,
    nextAt: 2.5,
    startAt: 0,
    duration: 1.1,
    from: new THREE.Vector3(),
    dir: new THREE.Vector3(),
  };

  const onResize = () => {
    if (!canvas.isConnected) return;
    const { clientWidth, clientHeight } = splash;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);

  const startTime = performance.now();
  let revealed = false;
  let revealTime = 0;

  const dispose = () => {
    window.removeEventListener("resize", onResize);
    renderer.setAnimationLoop(null);
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose?.();
    });
    moonTexture.dispose();
    lanternTexture.dispose();
    cloudTexture.dispose();
    streakTexture.dispose();
    hullTexture.dispose();
    deckTexture.dispose();
    sailTexture.dispose();
    flagTexture.dispose();
    renderer.dispose();
  };

  renderer.setAnimationLoop(() => {
    // main.tsx removes the splash node when the app is ready — shut down with it.
    if (!canvas.isConnected) {
      dispose();
      return;
    }
    const t = (performance.now() - startTime) / 1000;
    oceanUniforms.uTime.value = t;
    starUniforms.uTime.value = t;

    // Under way: the wave field streams past the hull at a steady few knots.
    const scroll = t * 0.55;
    oceanUniforms.uScroll.value = scroll;

    // Ride the same (scrolled) wave field as the shader, sampled along the full
    // hull length so the boat settles into the swell instead of hovering on a point.
    const hBow = waveHeight(0.85 + scroll, 0, t);
    const hMid = waveHeight(scroll, 0, t);
    const hStern = waveHeight(-0.85 + scroll, 0, t);
    boat.position.y = (hBow + hMid + hStern) / 3 + 0.075;
    const dz = (waveHeight(scroll, 0.6, t) - waveHeight(scroll, -0.6, t)) / 1.2;
    boat.rotation.z = Math.atan2(hBow - hStern, 1.7) * 0.7 + 0.02; // pitch with the swell, slight bow-up trim
    boat.rotation.x = -dz * 0.45 - 0.03; // wave roll plus a slight heel, near freeboard lifted into view
    boat.rotation.y = Math.sin(t * 0.22) * 0.06;

    // Sails breathe as if catching gusts.
    mainSail.scale.z = 1 + 0.16 * Math.sin(t * 0.7);
    jib.scale.z = 1 + 0.14 * Math.sin(t * 0.9 + 1.7);

    // Pennant flutter: rebuild the thin triangle strip with a travelling wave.
    for (let i = 0; i <= flagSegments; i++) {
      const u = i / flagSegments;
      const x = -u * flagLength; // trails behind the mast
      const wave = Math.sin(u * 9 - t * 9) * 0.045 * u;
      const halfH = 0.05 * (1 - u * 0.65);
      const base = i * 6;
      flagPositions[base] = x;
      flagPositions[base + 1] = halfH;
      flagPositions[base + 2] = wave;
      flagPositions[base + 3] = x;
      flagPositions[base + 4] = -halfH;
      flagPositions[base + 5] = wave;
    }
    flagGeometry.attributes.position.needsUpdate = true;

    // Lantern flicker.
    const flicker = 0.75 + 0.18 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
    lanternLight.intensity = flicker;
    lantern.scale.setScalar(0.34 + flicker * 0.1);

    // Clouds drift and wrap.
    for (const cloud of clouds) {
      cloud.sprite.position.x += cloud.speed * 0.016;
      if (cloud.sprite.position.x > 24) cloud.sprite.position.x = -24;
    }

    // Shooting star lifecycle.
    if (!meteor.active && t >= meteor.nextAt) {
      meteor.active = true;
      meteor.startAt = t;
      meteor.duration = 0.9 + Math.random() * 0.5;
      meteor.from.set(-4 + Math.random() * 18, 12 + Math.random() * 6, -30);
      meteor.dir.set(-1, -0.35 - Math.random() * 0.2, 0).normalize();
      const angle = Math.atan2(meteor.dir.y, meteor.dir.x) + Math.PI; // streak head leads the motion
      (shootingStar.material as THREE.SpriteMaterial).rotation = angle;
    }
    if (meteor.active) {
      const p = (t - meteor.startAt) / meteor.duration;
      if (p >= 1) {
        meteor.active = false;
        meteor.nextAt = t + 3.5 + Math.random() * 4;
        shootingStar.material.opacity = 0;
      } else {
        shootingStar.position.copy(meteor.from).addScaledVector(meteor.dir, p * 14);
        shootingStar.material.opacity = Math.sin(p * Math.PI) * 0.9;
      }
    }

    // Gentle dolly-in after reveal, then a slow drift.
    const intro = revealed ? Math.min(1, (t - revealTime) / 2.6) : 0;
    const ease = 1 - Math.pow(1 - intro, 3);
    camera.position.z = 10.8 - 3.2 * ease;
    camera.position.x = Math.sin(t * 0.12) * 0.45;
    camera.position.y = 1.35 + Math.sin(t * 0.3) * 0.06;
    camera.lookAt(0, 0.5, 0);

    renderer.render(scene, camera);

    if (!revealed) {
      revealed = true;
      revealTime = t;
      requestAnimationFrame(() => {
        canvas.style.opacity = "1";
        // The 2D fallback fades in via a delayed CSS animation (see index.html).
        // Freeze it at its current opacity, then fade to zero — if it never
        // appeared it stays hidden; if it was mid-fade it dissolves smoothly.
        for (const el of [stage, waves]) {
          if (!el) continue;
          el.style.opacity = getComputedStyle(el).opacity;
          el.style.animation = "none";
          requestAnimationFrame(() => {
            el.style.transition = "opacity 600ms ease-out";
            el.style.opacity = "0";
          });
        }
      });
    }
  });
}
