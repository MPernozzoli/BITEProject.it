// Progressive 3D enhancement for the boot splash in index.html.
// The static CSS/SVG splash paints instantly; once this chunk loads we fade in a
// Three.js night-ocean scene on top and fade the 2D boat/waves out. The splash
// lifecycle (dismiss + removal) stays owned by main.tsx — when the container is
// removed from the DOM we stop the loop and dispose all GPU resources.
import * as THREE from "three";

const OCEAN_VERTEX = /* glsl */ `
  uniform float uTime;
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
    float h = waveHeight(p, uTime);
    pos.z += h;

    float dhdx = 0.32 * 0.35 * cos(p.x * 0.35 + uTime * 0.9)
               + 0.22 * 0.2  * cos(p.x * 0.2 + p.y * 0.3 + uTime * 0.6)
               + 0.08 * 0.7  * cos((p.x + p.y) * 0.7 + uTime * 1.3)
               + 0.05 * 1.8  * cos(p.x * 1.8 - uTime * 1.7)
               + 0.035 * 2.6 * cos((p.x * 2.6 + p.y * 1.4) + uTime * 2.3);
    float dhdz = 0.22 * 0.3  * cos(p.x * 0.2 + p.y * 0.3 + uTime * 0.6)
               + 0.12 * 0.5  * cos(p.y * 0.5 - uTime * 0.4)
               + 0.08 * 0.7  * cos((p.x + p.y) * 0.7 + uTime * 1.3)
               + 0.035 * 1.4 * cos((p.x * 2.6 + p.y * 1.4) + uTime * 2.3);

    vHeight = h;
    vNormal = normalize(mat3(modelMatrix) * normalize(vec3(-dhdx, -dhdz, 1.0)));
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const OCEAN_FRAGMENT = /* glsl */ `
  uniform float uTime;
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
    gl_FragColor = vec4(vec3(0.85, 0.92, 0.94), d * vAlpha);
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

function buildHullGeometry(): THREE.BufferGeometry {
  // Tapered trapezoid prism echoing the SVG hull silhouette.
  const halfLen = 1.15;
  const halfTop = 0.34;
  const halfBottom = 0.2;
  const depth = 0.42;
  const bowTaper = 0.55;
  const topY = 0;
  const bottomY = -depth;

  const vertices = new Float32Array([
    -halfLen, topY, -halfTop,
    halfLen, topY, -halfTop * bowTaper,
    halfLen, topY, halfTop * bowTaper,
    -halfLen, topY, halfTop,
    -halfLen * 0.72, bottomY, -halfBottom,
    halfLen * 0.82, bottomY, -halfBottom * bowTaper,
    halfLen * 0.82, bottomY, halfBottom * bowTaper,
    -halfLen * 0.72, bottomY, halfBottom,
  ]);
  const indices = [
    0, 2, 1, 0, 3, 2, // deck
    4, 5, 6, 4, 6, 7, // keel
    0, 1, 5, 0, 5, 4, // port side
    3, 7, 6, 3, 6, 2, // starboard side
    1, 2, 6, 1, 6, 5, // bow
    0, 4, 7, 0, 7, 3, // stern
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildSailGeometry(luffHeight: number, footLength: number, belly: number): THREE.BufferGeometry {
  // Triangular sail with a slight horizontal belly so it catches the light.
  const segments = 6;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const v = i / segments;
    const y = v * luffHeight;
    const foot = footLength * (1 - v);
    positions.push(0, y, 0);
    positions.push(foot, y, Math.sin(v * Math.PI) * belly);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
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
  camera.position.set(0, 2.1, 10.8);

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
    uDeepColor: { value: new THREE.Color("#14304a") },
    uCrestColor: { value: new THREE.Color("#3a6f86") },
    uMoonDir: { value: moonDir },
    uCameraPos: { value: camera.position },
  };
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 44, 160, 90),
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
  const hullMat = new THREE.MeshLambertMaterial({ color: "#d68a52" });
  const trimMat = new THREE.MeshLambertMaterial({ color: "#7a4220" });
  const creamMat = new THREE.MeshLambertMaterial({ color: "#f6efe2" });
  const hull = new THREE.Mesh(buildHullGeometry(), hullMat);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.07, 0.66), trimMat);
  trim.position.y = 0.035;
  boat.add(hull, trim);

  // Cabin with a warm lit porthole facing the camera.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.4), new THREE.MeshLambertMaterial({ color: "#b06a38" }));
  cabin.position.set(-0.42, 0.17, 0);
  boat.add(cabin);
  const windowMat = new THREE.MeshBasicMaterial({ color: "#ffd9a0" });
  const cabinWindow = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), windowMat);
  cabinWindow.position.set(-0.42, 0.18, 0.201);
  boat.add(cabinWindow);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.032, 2.3, 8), creamMat);
  mast.position.set(0.1, 1.15, 0);
  boat.add(mast);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.1, 8), creamMat);
  boom.rotation.z = Math.PI / 2;
  boom.position.set(-0.44, 0.3, 0);
  boat.add(boom);

  const mainSail = new THREE.Mesh(
    buildSailGeometry(1.95, 1.05, 0.16),
    new THREE.MeshLambertMaterial({ color: "#f6efe2", side: THREE.DoubleSide })
  );
  mainSail.position.set(0.13, 0.33, 0);
  mainSail.rotation.y = Math.PI; // boom toward the stern
  boat.add(mainSail);

  const jib = new THREE.Mesh(
    buildSailGeometry(1.6, 0.85, 0.12),
    new THREE.MeshLambertMaterial({ color: "#8db6c0", side: THREE.DoubleSide })
  );
  jib.position.set(0.16, 0.3, 0);
  boat.add(jib);

  // Rigging: forestay, backstay and two shrouds as thin lines.
  const mastTop = new THREE.Vector3(0.1, 2.28, 0);
  const riggingGeometry = new THREE.BufferGeometry().setFromPoints([
    mastTop, new THREE.Vector3(1.12, 0.05, 0),   // forestay -> bow
    mastTop, new THREE.Vector3(-1.12, 0.05, 0),  // backstay -> stern
    mastTop, new THREE.Vector3(0.05, 0.05, 0.3), // shroud starboard
    mastTop, new THREE.Vector3(0.05, 0.05, -0.3) // shroud port
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
  const flag = new THREE.Mesh(
    flagGeometry,
    new THREE.MeshBasicMaterial({ color: "#d68a52", side: THREE.DoubleSide })
  );
  flag.position.copy(mastTop);
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
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture, transparent: true, depthWrite: false }));
  moon.position.set(-9, 8.5, -26);
  moon.scale.setScalar(7);
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
    starSizes[i] = (1.2 + Math.random() * 2.2) * Math.min(window.devicePixelRatio, 2);
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

    // Ride the same wave field as the shader.
    const bx = boat.position.x;
    const bz = boat.position.z;
    boat.position.y = waveHeight(bx, bz, t) + 0.16;
    const dx = (waveHeight(bx + 0.6, bz, t) - waveHeight(bx - 0.6, bz, t)) / 1.2;
    const dz = (waveHeight(bx, bz + 0.6, t) - waveHeight(bx, bz - 0.6, t)) / 1.2;
    boat.rotation.z = dx * 0.55;
    boat.rotation.x = -dz * 0.55;
    boat.rotation.y = Math.sin(t * 0.22) * 0.08;

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
    lantern.scale.setScalar(0.42 + flicker * 0.12);

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
    camera.position.y = 2.1 + Math.sin(t * 0.3) * 0.06;
    camera.lookAt(0, 0.55, 0);

    renderer.render(scene, camera);

    if (!revealed) {
      revealed = true;
      revealTime = t;
      requestAnimationFrame(() => {
        canvas.style.opacity = "1";
        const fade = "opacity 600ms ease-out";
        if (stage) {
          stage.style.transition = fade;
          stage.style.opacity = "0";
        }
        if (waves) {
          waves.style.transition = fade;
          waves.style.opacity = "0";
        }
      });
    }
  });
}
