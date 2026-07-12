// Progressive 3D enhancement for the boot splash in index.html.
// The static CSS/SVG splash paints instantly; once this chunk loads we fade in a
// Three.js night-ocean scene on top and fade the 2D boat/waves out. The splash
// lifecycle (dismiss + removal) stays owned by main.tsx — when the container is
// removed from the DOM we stop the loop and dispose all GPU resources.
// The Spritz model itself lives in src/lib/spritz-boat.ts, shared with the
// sailing easter egg (src/lib/spritz-sail-game.ts).
import * as THREE from "three";
import {
  buildSpritzBoat,
  animateSpritzBoatDetails,
  waveHeight,
  makeGlowTexture,
  makeStreakTexture,
  STAR_VERTEX,
  STAR_FRAGMENT,
} from "./spritz-boat";

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
  const spritz = buildSpritzBoat();
  const boat = spritz.group;
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
    cloudTexture.dispose();
    streakTexture.dispose();
    spritz.textures.forEach((texture) => texture.dispose());
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

    // Sail breathing, pennant flutter, lantern flicker.
    animateSpritzBoatDetails(spritz, t);

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
