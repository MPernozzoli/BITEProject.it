// Shared 3D model of S/Y Spritz plus the ocean/sky building blocks, used by both
// the boot splash (src/lib/boot-splash-3d.ts) and the sailing easter egg
// (src/lib/spritz-sail-game.ts). Keep visual changes here so the two stay in sync.
import * as THREE from "three";

// Night-ocean wave field, shared verbatim between GLSL and JS so anything that
// floats can ride the exact same water.
export function waveHeight(x: number, z: number, t: number): number {
  return (
    0.32 * Math.sin(x * 0.35 + t * 0.9) +
    0.22 * Math.sin(x * 0.2 + z * 0.3 + t * 0.6) +
    0.12 * Math.sin(z * 0.5 - t * 0.4) +
    0.08 * Math.sin((x + z) * 0.7 + t * 1.3) +
    0.05 * Math.sin(x * 1.8 - t * 1.7) +
    0.035 * Math.sin(x * 2.6 + z * 1.4 + t * 2.3)
  );
}

export const STAR_VERTEX = /* glsl */ `
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

export const STAR_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = smoothstep(0.5, 0.08, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vec3(0.85, 0.92, 0.94), d * vAlpha * 0.55);
  }
`;

export function makeGlowTexture(inner: string, outer: string, innerStop = 0.35): THREE.CanvasTexture {
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

export function makeStreakTexture(): THREE.CanvasTexture {
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

export function makeWoodTexture(base: string, seam: string, plankHeight: number): THREE.CanvasTexture {
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

export function makeHullTexture(): THREE.CanvasTexture {
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

export function makeFlagTexture(): THREE.CanvasTexture {
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

export function makeSailTexture(): THREE.CanvasTexture {
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
export const HULL_STATIONS = [
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

export function buildHullGeometry(): THREE.BufferGeometry {
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

export function buildDeckGeometry(): THREE.BufferGeometry {
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

export function buildRailCurve(side: 1 | -1): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    HULL_STATIONS.map((st) => new THREE.Vector3(st.x, st.s + 0.016, side * st.w * 0.99))
  );
}

// Bow pulpit and stern pushpit guardrails — horseshoe arcs standing up off the
// deck at the two points of the double-ender hull.
function buildPulpitCurve(): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.74, 0.1, -0.27),
    new THREE.Vector3(0.98, 0.27, -0.2),
    new THREE.Vector3(1.11, 0.29, 0),
    new THREE.Vector3(0.98, 0.27, 0.2),
    new THREE.Vector3(0.74, 0.1, 0.27),
  ]);
}

function buildPushpitCurve(): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.86, 0.09, -0.22),
    new THREE.Vector3(-1.03, 0.24, -0.17),
    new THREE.Vector3(-1.13, 0.27, 0),
    new THREE.Vector3(-1.03, 0.24, 0.17),
    new THREE.Vector3(-0.86, 0.09, 0.22),
  ]);
}

export function buildSailGeometry(luffHeight: number, footLength: number, belly: number): THREE.BufferGeometry {
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

// Thin cylindrical strut between two points — used for spreaders, the boom
// vang, the wheel pedestal and spokes, and pulpit/pushpit stanchions.
function addStrut(
  group: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radialSegments = 6
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), material);
  strut.position.copy(from).addScaledVector(dir, 0.5);
  strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  group.add(strut);
  return strut;
}

export interface SpritzBoat {
  group: THREE.Group;
  /** Pivot at the mast: rotate on Y to swing boom + mainsail (sheeting). */
  mainPivot: THREE.Group;
  /** Pivot at the jib tack: rotate on Y to sheet the jib. */
  jibPivot: THREE.Group;
  mainSail: THREE.Mesh;
  jib: THREE.Mesh;
  flagGeometry: THREE.BufferGeometry;
  flagPositions: Float32Array;
  flagSegments: number;
  flagLength: number;
  /** Masthead anchor light: warm all-round white, lit when the boat is stopped. */
  lantern: THREE.Sprite;
  lanternLight: THREE.PointLight;
  /** Running lights: red port / green starboard / white stern, lit underway. */
  navLights: {
    port: THREE.Sprite;
    portLight: THREE.PointLight;
    starboard: THREE.Sprite;
    starboardLight: THREE.PointLight;
    stern: THREE.Sprite;
    sternLight: THREE.PointLight;
  };
  /** 0 = at anchor (masthead lantern lit), 1 = underway (running lights lit). Smoothed internally by animateSpritzBoatDetails. */
  lightsUnderway: number;
  textures: THREE.CanvasTexture[];
}

// Assembles the full Spritz model. Sails hang from pivot groups (rotation 0 =
// sheeted flat amidships, exactly the splash look); the game rotates them.
export function buildSpritzBoat(): SpritzBoat {
  const boat = new THREE.Group();
  const hullTexture = makeHullTexture();
  const deckTexture = makeWoodTexture("#8f6f4c", "rgba(58,38,22,0.5)", 22);
  const sailTexture = makeSailTexture();
  const flagTexture = makeFlagTexture();
  const lanternTexture = makeGlowTexture("rgba(255,214,150,0.9)", "rgba(255,214,150,0)", 0.2);
  const navGlowTexture = makeGlowTexture("rgba(255,255,255,0.95)", "rgba(255,255,255,0)", 0.24);

  const hullMat = new THREE.MeshStandardMaterial({ map: hullTexture, roughness: 0.45, metalness: 0.05 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: "#6e3d1e", roughness: 0.55 });
  const teakMat = new THREE.MeshStandardMaterial({ color: "#b8875a", roughness: 0.55 });
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

  // Bow pulpit and stern pushpit guardrails, each on two stanchions.
  boat.add(new THREE.Mesh(new THREE.TubeGeometry(buildPulpitCurve(), 24, 0.012, 6), steelMat));
  addStrut(boat, new THREE.Vector3(0.74, 0.02, -0.27), new THREE.Vector3(0.74, 0.1, -0.27), 0.01, steelMat);
  addStrut(boat, new THREE.Vector3(0.74, 0.02, 0.27), new THREE.Vector3(0.74, 0.1, 0.27), 0.01, steelMat);
  boat.add(new THREE.Mesh(new THREE.TubeGeometry(buildPushpitCurve(), 24, 0.012, 6), steelMat));
  addStrut(boat, new THREE.Vector3(-0.86, 0.02, -0.22), new THREE.Vector3(-0.86, 0.09, -0.22), 0.01, steelMat);
  addStrut(boat, new THREE.Vector3(-0.86, 0.02, 0.22), new THREE.Vector3(-0.86, 0.09, 0.22), 0.01, steelMat);

  // Bow roller + a small ground-tackle silhouette tucked against the stem.
  const bowRoller = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 8), steelMat);
  bowRoller.rotation.x = Math.PI / 2;
  bowRoller.position.set(1.15, 0.12, 0);
  boat.add(bowRoller);
  const anchorShank = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), steelMat);
  anchorShank.rotation.z = Math.PI / 2.6;
  anchorShank.position.set(1.06, 0.03, 0);
  boat.add(anchorShank);
  const anchorFluke = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 4), steelMat);
  anchorFluke.rotation.z = Math.PI / 2.6 - 0.3;
  anchorFluke.position.set(0.98, -0.06, 0);
  boat.add(anchorFluke);

  // Cleats at bow and stern.
  const cleatGeometry = new THREE.CapsuleGeometry(0.009, 0.05, 2, 6);
  for (const [cx, cz] of [[0.92, 0.19], [0.92, -0.19], [-1.0, 0.13], [-1.0, -0.13]] as const) {
    const cleat = new THREE.Mesh(cleatGeometry, steelMat);
    cleat.rotation.z = Math.PI / 2;
    cleat.position.set(cx, 0.12, cz);
    boat.add(cleat);
  }

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

  // Spreaders, angled slightly up and out, bending the cap shrouds below.
  const spreaderMastPt = new THREE.Vector3(0.1, 1.55, 0);
  const spreaderTipS = new THREE.Vector3(0.1, 1.6, 0.3);
  const spreaderTipP = new THREE.Vector3(0.1, 1.6, -0.3);
  addStrut(boat, spreaderMastPt, spreaderTipS, 0.011, sparMat);
  addStrut(boat, spreaderMastPt, spreaderTipP, 0.011, sparMat);

  // Main + boom swing together around the mast when sheeting.
  const mainPivot = new THREE.Group();
  mainPivot.position.set(0.1, 0, 0);
  boat.add(mainPivot);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.02, 10), sparMat);
  boom.rotation.z = Math.PI / 2;
  boom.position.set(-0.5, 0.3, 0);
  mainPivot.add(boom);
  // Boom vang: mast base to boom, swings with the boom (both points sit on the
  // pivot's rotation axis or ride along with it).
  addStrut(mainPivot, new THREE.Vector3(0, 0.14, 0), new THREE.Vector3(0.02, 0.3, 0), 0.008, steelMat);
  const mainSail = new THREE.Mesh(
    buildSailGeometry(1.95, 0.98, 0.17),
    new THREE.MeshStandardMaterial({ map: sailTexture, roughness: 0.85, side: THREE.DoubleSide })
  );
  mainSail.position.set(0.03, 0.33, 0);
  mainSail.rotation.y = Math.PI; // boom toward the stern
  mainPivot.add(mainSail);

  const jibPivot = new THREE.Group();
  jibPivot.position.set(0.16, 0, 0);
  boat.add(jibPivot);
  const jib = new THREE.Mesh(
    buildSailGeometry(1.6, 0.85, 0.13),
    new THREE.MeshStandardMaterial({ map: sailTexture, roughness: 0.85, side: THREE.DoubleSide })
  );
  jib.position.set(0, 0.3, 0);
  jibPivot.add(jib);

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

  // Destroyer wheel on a pedestal, under the stern arch — teak rim, steel spokes.
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.22, 10), steelMat);
  pedestal.position.set(-0.91, 0.14, 0);
  boat.add(pedestal);
  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(-0.91, 0.31, 0);
  wheelGroup.rotation.y = Math.PI / 2;
  wheelGroup.add(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.011, 8, 20), teakMat));
  const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 10), steelMat);
  wheelHub.rotation.x = Math.PI / 2;
  wheelGroup.add(wheelHub);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    addStrut(
      wheelGroup,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0),
      0.006,
      steelMat
    );
  }
  boat.add(wheelGroup);

  // Cockpit winches, forward of the wheel.
  const winchGeometry = new THREE.CylinderGeometry(0.026, 0.032, 0.045, 10);
  for (const wz of [0.22, -0.22] as const) {
    const winch = new THREE.Mesh(winchGeometry, steelMat);
    winch.position.set(-0.66, 0.15, wz);
    boat.add(winch);
  }

  // Rigging: forestay, backstay and cap shrouds bent over the spreaders.
  const mastTop = new THREE.Vector3(0.1, 2.28, 0);
  const bowTip = new THREE.Vector3(1.2, 0.15, 0);
  const sternPt = new THREE.Vector3(-1.16, 0.12, 0);
  const chainplateS = new THREE.Vector3(0.05, 0.02, 0.34);
  const chainplateP = new THREE.Vector3(0.05, 0.02, -0.34);
  const riggingGeometry = new THREE.BufferGeometry().setFromPoints([
    mastTop, bowTip, // forestay -> bow tip
    mastTop, sternPt, // backstay -> stern point
    mastTop, spreaderTipS, spreaderTipS, chainplateS, // starboard cap shroud, bent at the spreader
    mastTop, spreaderTipP, spreaderTipP, chainplateP, // port cap shroud
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

  // Masthead anchor light: flickering warm glow sprite + a real point light.
  // Lit only when the boat is stopped — see animateSpritzBoatDetails.
  const lantern = new THREE.Sprite(new THREE.SpriteMaterial({ map: lanternTexture, transparent: true, depthWrite: false }));
  lantern.position.set(0.1, 2.34, 0);
  lantern.scale.setScalar(0.5);
  boat.add(lantern);
  const lanternLight = new THREE.PointLight(0xffc98a, 0, 5, 2);
  lanternLight.position.copy(lantern.position);
  boat.add(lanternLight);

  // Running lights — red port, green starboard, white stern — lit while underway.
  const makeNavLight = (color: string, position: [number, number, number], scale: number, distance: number) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: navGlowTexture, color, transparent: true, opacity: 0, depthWrite: false })
    );
    sprite.position.set(...position);
    sprite.scale.setScalar(scale);
    boat.add(sprite);
    const light = new THREE.PointLight(new THREE.Color(color).getHex(), 0, distance, 2);
    light.position.set(...position);
    boat.add(light);
    return { sprite, light };
  };
  const port = makeNavLight("#ff3131", [0.78, 0.22, -0.33], 0.22, 3);
  const starboard = makeNavLight("#1fae54", [0.78, 0.22, 0.33], 0.22, 3);
  const stern = makeNavLight("#f2f5ee", [-1.12, 0.31, 0], 0.24, 3);

  return {
    group: boat,
    mainPivot,
    jibPivot,
    mainSail,
    jib,
    flagGeometry,
    flagPositions,
    flagSegments,
    flagLength,
    lantern,
    lanternLight,
    navLights: {
      port: port.sprite,
      portLight: port.light,
      starboard: starboard.sprite,
      starboardLight: starboard.light,
      stern: stern.sprite,
      sternLight: stern.light,
    },
    lightsUnderway: 0,
    textures: [hullTexture, deckTexture, sailTexture, flagTexture, lanternTexture, navGlowTexture],
  };
}

// Life-of-the-boat details shared by splash and game: sail cloth breathing,
// pennant flutter, and the anchor-light/running-lights crossfade. `flutter` > 1
// shakes the flag harder (used while luffing). `targetUnderway` is 0 (stopped —
// masthead anchor light) to 1 (underway — red/green/white running lights);
// the transition is smoothed internally via spritz.lightsUnderway.
export function animateSpritzBoatDetails(spritz: SpritzBoat, t: number, flutter = 1, targetUnderway = 1): void {
  spritz.mainSail.scale.z = 1 + 0.16 * Math.sin(t * 0.7);
  spritz.jib.scale.z = 1 + 0.14 * Math.sin(t * 0.9 + 1.7);

  const { flagPositions, flagSegments, flagLength } = spritz;
  for (let i = 0; i <= flagSegments; i++) {
    const u = i / flagSegments;
    const x = -u * flagLength; // trails behind the mast
    const wave = Math.sin(u * 9 - t * 9 * flutter) * 0.045 * u * flutter;
    const halfH = 0.05 * (1 - u * 0.65);
    const base = i * 6;
    flagPositions[base] = x;
    flagPositions[base + 1] = halfH;
    flagPositions[base + 2] = wave;
    flagPositions[base + 3] = x;
    flagPositions[base + 4] = -halfH;
    flagPositions[base + 5] = wave;
  }
  spritz.flagGeometry.attributes.position.needsUpdate = true;

  spritz.lightsUnderway += (THREE.MathUtils.clamp(targetUnderway, 0, 1) - spritz.lightsUnderway) * 0.06;
  const underway = spritz.lightsUnderway;
  const atAnchor = 1 - underway;

  const anchorFlicker = 0.75 + 0.18 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
  spritz.lanternLight.intensity = anchorFlicker * atAnchor * 0.85;
  spritz.lantern.scale.setScalar(0.34 + anchorFlicker * 0.1);
  (spritz.lantern.material as THREE.SpriteMaterial).opacity = atAnchor;

  const navFlicker = 0.94 + 0.06 * Math.sin(t * 11);
  const { port, portLight, starboard, starboardLight, stern, sternLight } = spritz.navLights;
  portLight.intensity = navFlicker * underway * 0.55;
  starboardLight.intensity = navFlicker * underway * 0.55;
  sternLight.intensity = navFlicker * underway * 0.4;
  (port.material as THREE.SpriteMaterial).opacity = underway;
  (starboard.material as THREE.SpriteMaterial).opacity = underway;
  (stern.material as THREE.SpriteMaterial).opacity = underway;
}
