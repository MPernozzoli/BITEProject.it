// Easter egg: sail S/Y Spritz across the night ocean. Triggered by typing
// "spritz" anywhere on the site (see main.tsx). A/D steer, W/S trim the sails,
// ESC leaves. Arcade wind simulation with wandering wind and travelling gusts
// (visible as cat's paws on the water), floating lanterns to collect, a
// lighthouse with a sweeping beam, the occasional dolphin pod, bow spray and
// procedural wind/water audio. Reuses the exact Spritz model and wave field
// from src/lib/spritz-boat.ts.
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

// World-space ocean: the plane is recentered on the boat every frame and the
// shader samples the wave field at true world coordinates (uOffset), so the
// water stays put while the boat sails through it. Wake and bow spray live in
// the boat's frame (uBoatPos/uForward) and scale with speed (uWake). Gust cells
// (uGusts: xy pos, z radius, w strength) darken and roughen the surface.
const GAME_OCEAN_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform vec2 uOffset;
  uniform vec2 uBoatPos;
  uniform vec2 uForward;
  uniform float uWake;
  varying float vHeight;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  float waveH(vec2 w, float t) {
    return 0.32 * sin(w.x * 0.35 + t * 0.9)
         + 0.22 * sin(w.x * 0.2 + w.y * 0.3 + t * 0.6)
         + 0.12 * sin(w.y * 0.5 - t * 0.4)
         + 0.08 * sin((w.x + w.y) * 0.7 + t * 1.3)
         + 0.05 * sin(w.x * 1.8 - t * 1.7)
         + 0.035 * sin((w.x * 2.6 + w.y * 1.4) + t * 2.3);
  }

  void main() {
    vec3 pos = position;
    // Plane local x/y -> world x/-z, plus the plane's own offset.
    vec2 w = vec2(pos.x + uOffset.x, -pos.y + uOffset.y);
    float h = waveH(w, uTime);

    // Trough carved behind the hull, aligned to the heading, scaled by speed.
    vec2 rel = w - uBoatPos;
    float along = dot(rel, uForward);
    vec2 side = vec2(-uForward.y, uForward.x);
    float lat = dot(rel, side);
    float behind = -along;
    float wake = exp(-pow(lat * 2.4, 2.0))
               * smoothstep(0.5, 1.3, behind)
               * exp(-max(behind - 1.0, 0.0) * 0.45) * 0.09 * uWake;
    pos.z += h - wake;

    float dhdx = 0.32 * 0.35 * cos(w.x * 0.35 + uTime * 0.9)
               + 0.22 * 0.2  * cos(w.x * 0.2 + w.y * 0.3 + uTime * 0.6)
               + 0.08 * 0.7  * cos((w.x + w.y) * 0.7 + uTime * 1.3)
               + 0.05 * 1.8  * cos(w.x * 1.8 - uTime * 1.7)
               + 0.035 * 2.6 * cos((w.x * 2.6 + w.y * 1.4) + uTime * 2.3);
    float dhdz = 0.22 * 0.3  * cos(w.x * 0.2 + w.y * 0.3 + uTime * 0.6)
               + 0.12 * 0.5  * cos(w.y * 0.5 - uTime * 0.4)
               + 0.08 * 0.7  * cos((w.x + w.y) * 0.7 + uTime * 1.3)
               + 0.035 * 1.4 * cos((w.x * 2.6 + w.y * 1.4) + uTime * 2.3);

    vHeight = h;
    vNormal = normalize(vec3(-dhdx, 1.0, -dhdz));
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const GAME_OCEAN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec2 uBoatPos;
  uniform vec2 uForward;
  uniform float uWake;
  uniform vec4 uGusts[3];
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

    float sheen = pow(facing, 14.0);
    float core = pow(facing, 90.0);
    color += vec3(0.55, 0.66, 0.70) * sheen * 0.22;
    color += vec3(0.80, 0.90, 0.92) * core * 0.65;

    vec2 sparkleGrid = vWorldPos.xz * 26.0;
    float cell = hash(floor(sparkleGrid) + floor(uTime * 2.5) * 0.71);
    float sparkle = step(0.992, cell);
    float pinpoint = smoothstep(0.38, 0.08, length(fract(sparkleGrid) - 0.5));
    color += vec3(0.85, 0.94, 1.0) * sparkle * pinpoint * (sheen * 1.4 + core) * 1.8;

    float foamNoise = hash(floor(vWorldPos.xz * 6.0) + floor(uTime * 1.2));
    float foam = smoothstep(0.62, 0.95, vHeight) * smoothstep(0.6, 0.95, foamNoise);
    color = mix(color, vec3(0.78, 0.86, 0.88), foam * 0.3);

    // Cat's paws: gusts darken and roughen the water as they travel downwind.
    float gust = 0.0;
    for (int i = 0; i < 3; i++) {
      float d = length(vWorldPos.xz - uGusts[i].xy);
      gust += smoothstep(uGusts[i].z, uGusts[i].z * 0.3, d) * uGusts[i].w;
    }
    float catsPaw = hash(floor(vWorldPos.xz * 9.0) + floor(uTime * 6.0));
    color *= 1.0 - clamp(gust, 0.0, 0.6) * (0.2 + 0.12 * catsPaw);

    // Wake in the boat's frame; the churn pattern is pinned to the water so the
    // boat visibly slides past it. Everything scales with speed (uWake).
    vec2 rel = vWorldPos.xz - uBoatPos;
    float along = dot(rel, uForward);
    vec2 side = vec2(-uForward.y, uForward.x);
    float lat = abs(dot(rel, side));
    float behind = -along;
    float streamNoise = 0.5 * hash(floor(vec2(vWorldPos.x * 7.0, vWorldPos.z * 12.0)) + floor(uTime * 2.0))
                      + 0.5 * hash(floor(vec2(vWorldPos.x * 16.0, vWorldPos.z * 26.0)));
    float churn = smoothstep(0.38, 0.05, lat) * smoothstep(0.5, 1.1, behind) * exp(-behind * 0.26);
    float arms = (1.0 - smoothstep(0.0, 0.1, abs(lat - (0.14 + behind * 0.17))))
               * smoothstep(0.7, 1.2, behind) * exp(-behind * 0.24);
    float wakeFoam = clamp(churn * 1.5 + arms * 0.9, 0.0, 1.0) * (0.45 + 0.55 * streamNoise) * uWake;
    vec2 bowPos = uBoatPos + uForward * 1.12;
    float bowDist = length(vWorldPos.xz - bowPos);
    float bowFoam = smoothstep(0.36, 0.08, bowDist)
                  * (0.55 + 0.45 * sin(uTime * 5.0 + vWorldPos.z * 14.0)) * uWake;
    color = mix(color, vec3(0.8, 0.88, 0.9), clamp(wakeFoam + bowFoam, 0.0, 1.0) * 0.6);

    float dist = length(vWorldPos.xz - uCameraPos.xz);
    float alpha = 1.0 - smoothstep(24.0, 44.0, dist);
    gl_FragColor = vec4(color, alpha * 0.96);
  }
`;

const HUD_CSS = /* css */ `
  .spritz-game-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: radial-gradient(ellipse at 50% 35%, #18324a 0%, #0b1a2c 55%, #050b14 100%);
    opacity: 0;
    transition: opacity 600ms ease-out;
    font-family: "Playfair Display", ui-serif, Georgia, serif;
    color: #f6efe2;
    overflow: hidden;
  }
  .spritz-game-overlay.is-open { opacity: 1; }
  .spritz-game-overlay canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .spritz-game-title {
    position: absolute;
    top: 14%;
    left: 0;
    right: 0;
    text-align: center;
    letter-spacing: 0.42em;
    text-transform: uppercase;
    font-size: 15px;
    opacity: 0.9;
    animation: spritz-game-title-out 1200ms ease-in 4.2s forwards;
    pointer-events: none;
  }
  .spritz-game-title small {
    display: block;
    margin-top: 10px;
    font-size: 10px;
    letter-spacing: 0.3em;
    opacity: 0.65;
  }
  @keyframes spritz-game-title-out { to { opacity: 0; } }
  .spritz-game-hud {
    position: absolute;
    left: 50%;
    bottom: 22px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 22px;
    padding: 12px 24px;
    border-radius: 16px;
    background: rgba(9, 20, 34, 0.42);
    border: 1px solid rgba(246, 239, 226, 0.1);
    backdrop-filter: blur(9px);
    -webkit-backdrop-filter: blur(9px);
    letter-spacing: 0.16em;
    font-size: 12px;
    text-transform: uppercase;
    pointer-events: none;
    text-shadow: 0 1px 8px rgba(5, 11, 20, 0.8);
  }
  .spritz-game-hud .spritz-sep { width: 1px; height: 34px; background: rgba(246, 239, 226, 0.14); }
  .spritz-game-hud .spritz-wind-dial { width: 58px; height: 58px; position: relative; flex: none; }
  .spritz-game-hud .spritz-wind-dial .spritz-dial-rose { position: absolute; inset: 0; opacity: 0.6; }
  .spritz-game-hud .spritz-wind-dial .spritz-dial-arrow {
    position: absolute;
    inset: 0;
    transition: transform 220ms ease-out;
    transform-origin: 50% 50%;
  }
  .spritz-game-hud .spritz-readout { display: flex; flex-direction: column; align-items: center; min-width: 42px; }
  .spritz-game-hud .spritz-hud-value { opacity: 0.94; white-space: nowrap; }
  .spritz-game-hud .spritz-hud-value.is-gust { color: #ffd9a0; }
  .spritz-game-hud .spritz-hud-value.spritz-hud-pos { color: #9fcfd6; letter-spacing: 0.1em; }
  .spritz-game-hud .spritz-hud-label { opacity: 0.45; font-size: 8.5px; margin-top: 5px; letter-spacing: 0.2em; }
  /* Sail-trim gauge: marker chases the green target band. */
  .spritz-trim { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .spritz-trim-track {
    position: relative;
    width: 116px;
    height: 7px;
    border-radius: 4px;
    background: rgba(246, 239, 226, 0.12);
    overflow: hidden;
  }
  .spritz-trim-band {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(120, 200, 140, 0.4);
    transition: left 200ms ease-out, width 200ms ease-out;
  }
  .spritz-trim-marker {
    position: absolute;
    top: -2px;
    width: 3px;
    height: 11px;
    margin-left: -1.5px;
    border-radius: 2px;
    background: #f6efe2;
    transition: left 90ms linear, background 200ms;
  }
  .spritz-trim-marker.is-tuned { background: #7fe0a0; box-shadow: 0 0 8px rgba(127, 224, 160, 0.9); }
  .spritz-trim-hint { font-size: 8.5px; letter-spacing: 0.2em; opacity: 0.6; height: 10px; }
  .spritz-trim-hint.is-tuned { color: #7fe0a0; opacity: 0.95; }
  .spritz-trim-hint .spritz-trim-labels { display: flex; justify-content: space-between; width: 116px; opacity: 0.5; }
  .spritz-game-hint {
    position: absolute;
    right: 26px;
    top: 74px;
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    opacity: 0.5;
    pointer-events: none;
    text-align: right;
    line-height: 2;
  }
  /* Soundtrack control, top-right above the instructions. */
  .spritz-audio {
    position: absolute;
    top: 20px;
    right: 26px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px 7px 9px;
    border-radius: 13px;
    background: rgba(9, 20, 34, 0.42);
    border: 1px solid rgba(246, 239, 226, 0.1);
    backdrop-filter: blur(9px);
    -webkit-backdrop-filter: blur(9px);
    pointer-events: auto;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    text-shadow: 0 1px 8px rgba(5, 11, 20, 0.8);
  }
  .spritz-audio button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px solid rgba(246, 239, 226, 0.3);
    color: #f6efe2;
    font-size: 9px;
    line-height: 1;
    transition: background 160ms;
  }
  .spritz-audio button:hover { background: rgba(246, 239, 226, 0.14); }
  .spritz-audio .spritz-audio-label {
    opacity: 0.72;
    white-space: nowrap;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spritz-audio input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 74px;
    height: 3px;
    border-radius: 2px;
    background: rgba(246, 239, 226, 0.25);
    outline: none;
    cursor: pointer;
  }
  .spritz-audio input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #9fcfd6;
    cursor: pointer;
  }
  .spritz-audio input[type="range"]::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border: none;
    border-radius: 50%;
    background: #9fcfd6;
    cursor: pointer;
  }
  .spritz-lantern-toast {
    position: absolute;
    left: 0;
    right: 0;
    top: 24%;
    text-align: center;
    font-size: 11px;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: #ffd9a0;
    opacity: 0;
    transition: opacity 400ms ease-out;
    pointer-events: none;
  }
  .spritz-lantern-toast.is-visible { opacity: 0.9; }
`;

// Procedural night-sailing soundscape: filtered noise for wind and hull water.
// Created on mount (the "spritz" keystrokes count as the user gesture).
function createSoundscape() {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02;
    data[i] = brown * 3.5;
  }
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const makeVoice = (type: BiquadFilterType, freq: number, q: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    return { filter, gain };
  };
  const wind = makeVoice("bandpass", 650, 0.55);
  const water = makeVoice("lowpass", 420, 0.7);

  return {
    resume() {
      if (ctx.state === "suspended") void ctx.resume();
    },
    update(windKn: number, speed: number, gust: number, t: number) {
      // Fade the master in over the first seconds, keep the mix subtle.
      master.gain.value = Math.min(0.16, master.gain.value + 0.0015);
      const windTarget = Math.min(1, windKn / 14) * (0.5 + gust * 0.5);
      wind.gain.gain.value += (windTarget * 0.5 - wind.gain.gain.value) * 0.02;
      wind.filter.frequency.value = 550 + 250 * Math.sin(t * 0.4) + gust * 300;
      const waterTarget = Math.min(1, speed / 1.2) * (0.65 + 0.35 * Math.sin(t * 1.9));
      water.gain.gain.value += (waterTarget * 0.6 - water.gain.gain.value) * 0.03;
    },
    dispose() {
      void ctx.close();
    },
  };
}

let gameActive = false;

export function mountSpritzSailGame(onClose?: () => void): void {
  if (gameActive) return;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    onClose?.();
    return;
  }
  gameActive = true;

  // ---------------------------------------------------------------- Overlay + HUD
  const overlay = document.createElement("div");
  overlay.className = "spritz-game-overlay";
  const style = document.createElement("style");
  style.textContent = HUD_CSS;
  overlay.appendChild(style);
  overlay.appendChild(renderer.domElement);
  overlay.insertAdjacentHTML(
    "beforeend",
    `<div class="spritz-game-title">S/Y Spritz<small>Raccogli le lanterne · Buon vento</small></div>
     <div class="spritz-audio">
       <button class="spritz-audio-toggle" type="button" aria-label="Play/pausa musica">❚❚</button>
       <span class="spritz-audio-label">♪ Any Day Now</span>
       <input class="spritz-audio-vol" type="range" min="0" max="100" value="35" aria-label="Volume musica" />
     </div>
     <div class="spritz-game-hint">A/D — timone<br>W lasca · S cazza<br>SPAZIO — issa/ammaina<br>ESC — esci</div>
     <div class="spritz-lantern-toast">Lanterna recuperata</div>
     <div class="spritz-game-hud">
       <div class="spritz-wind-dial">
         <svg class="spritz-dial-rose" viewBox="0 0 58 58" fill="none" xmlns="http://www.w3.org/2000/svg">
           <circle cx="29" cy="29" r="27" stroke="rgba(246,239,226,0.32)" stroke-width="1"/>
           <path d="M29 29 L20.6 4.4 A26 26 0 0 1 37.4 4.4 Z" fill="rgba(255,120,120,0.16)"/>
           <path d="M29 2 L29 8" stroke="rgba(246,239,226,0.7)" stroke-width="1.4"/>
           <path d="M25.5 9 L29 3.5 L32.5 9 Z" fill="rgba(246,239,226,0.75)"/>
         </svg>
         <svg class="spritz-dial-arrow" viewBox="0 0 58 58" fill="none" xmlns="http://www.w3.org/2000/svg">
           <path d="M29 8 L34 30 L29 25.5 L24 30 Z" fill="#9fcfd6"/>
         </svg>
       </div>
       <div class="spritz-sep"></div>
       <div class="spritz-readout"><span class="spritz-hud-value spritz-hud-wind">--</span><span class="spritz-hud-label">Vento</span></div>
       <div class="spritz-readout"><span class="spritz-hud-value spritz-hud-pos spritz-hud-position">--</span><span class="spritz-hud-label">Andatura</span></div>
       <div class="spritz-readout"><span class="spritz-hud-value spritz-hud-speed">--</span><span class="spritz-hud-label">Velocità</span></div>
       <div class="spritz-sep"></div>
       <div class="spritz-trim">
         <div class="spritz-trim-track">
           <div class="spritz-trim-band"></div>
           <div class="spritz-trim-marker"></div>
         </div>
         <div class="spritz-trim-hint"><span class="spritz-trim-msg">Regola le vele</span></div>
       </div>
       <div class="spritz-sep"></div>
       <div class="spritz-readout"><span class="spritz-hud-value spritz-hud-course">--</span><span class="spritz-hud-label">Rotta</span></div>
       <div class="spritz-readout"><span class="spritz-hud-value spritz-hud-trip">0.00</span><span class="spritz-hud-label">Miglia</span></div>
       <div class="spritz-readout"><span class="spritz-hud-value spritz-hud-lanterns">0</span><span class="spritz-hud-label">Lanterne</span></div>
     </div>`
  );
  document.body.appendChild(overlay);
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  // Some environments throttle CSS transitions on freshly-inserted fixed layers;
  // guarantee the final state either way.
  window.setTimeout(() => {
    overlay.style.transition = "none";
    overlay.style.opacity = "1";
  }, 900);

  const windDialArrow = overlay.querySelector<SVGElement>(".spritz-dial-arrow")!;
  const hudWind = overlay.querySelector<HTMLElement>(".spritz-hud-wind")!;
  const hudPosition = overlay.querySelector<HTMLElement>(".spritz-hud-position")!;
  const hudSpeed = overlay.querySelector<HTMLElement>(".spritz-hud-speed")!;
  const hudCourse = overlay.querySelector<HTMLElement>(".spritz-hud-course")!;
  const hudTrip = overlay.querySelector<HTMLElement>(".spritz-hud-trip")!;
  const hudLanterns = overlay.querySelector<HTMLElement>(".spritz-hud-lanterns")!;
  const trimBand = overlay.querySelector<HTMLElement>(".spritz-trim-band")!;
  const trimMarker = overlay.querySelector<HTMLElement>(".spritz-trim-marker")!;
  const trimHint = overlay.querySelector<HTMLElement>(".spritz-trim-hint")!;
  const trimMsg = overlay.querySelector<HTMLElement>(".spritz-trim-msg")!;
  const lanternToast = overlay.querySelector<HTMLElement>(".spritz-lantern-toast")!;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const soundscape = createSoundscape();

  // ---------------------------------------------------------------- Soundtrack
  const audioToggle = overlay.querySelector<HTMLButtonElement>(".spritz-audio-toggle")!;
  const audioVol = overlay.querySelector<HTMLInputElement>(".spritz-audio-vol")!;
  const music = new Audio("/audio/any-day-now-spritz.mp3");
  music.loop = true;
  music.volume = Number(audioVol.value) / 100; // medium/low default (35%)
  let musicWanted = true; // false only if the player explicitly pauses
  const tryPlayMusic = () => {
    if (!musicWanted) return;
    music.play().catch(() => {
      /* autoplay blocked — the first keypress gesture will start it */
    });
  };
  music.addEventListener("play", () => (audioToggle.textContent = "❚❚"));
  music.addEventListener("pause", () => (audioToggle.textContent = "▶"));
  audioToggle.addEventListener("click", () => {
    if (music.paused) {
      musicWanted = true;
      tryPlayMusic();
    } else {
      musicWanted = false;
      music.pause();
    }
    audioToggle.blur(); // hand keyboard focus back to the game
  });
  audioVol.addEventListener("input", () => {
    music.volume = Number(audioVol.value) / 100;
  });
  audioVol.addEventListener("change", () => audioVol.blur());
  tryPlayMusic();

  // ---------------------------------------------------------------- Scene
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 120);

  scene.add(new THREE.HemisphereLight(0x9fcfd6, 0x1a2c40, 1.2));
  const moonDir = new THREE.Vector3(-0.35, 0.55, -0.75).normalize();
  const moonLight = new THREE.DirectionalLight(0xcfe4ea, 1.1);
  moonLight.position.copy(moonDir).multiplyScalar(20);
  scene.add(moonLight);
  const fillLight = new THREE.DirectionalLight(0xffd9b0, 0.5);
  scene.add(fillLight);

  const gustUniform = [new THREE.Vector4(999, 999, 8, 0), new THREE.Vector4(999, 999, 8, 0), new THREE.Vector4(999, 999, 8, 0)];
  const oceanUniforms = {
    uTime: { value: 0 },
    uOffset: { value: new THREE.Vector2() },
    uBoatPos: { value: new THREE.Vector2() },
    uForward: { value: new THREE.Vector2(1, 0) },
    uWake: { value: 0 },
    uGusts: { value: gustUniform },
    uDeepColor: { value: new THREE.Color("#14304a") },
    uCrestColor: { value: new THREE.Color("#3a6f86") },
    uMoonDir: { value: moonDir },
    uCameraPos: { value: camera.position },
  };
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 110, 200, 200),
    new THREE.ShaderMaterial({
      vertexShader: GAME_OCEAN_VERTEX,
      fragmentShader: GAME_OCEAN_FRAGMENT,
      uniforms: oceanUniforms,
      transparent: true,
    })
  );
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);

  const spritz = buildSpritzBoat();
  const boat = spritz.group;
  boat.rotation.order = "YXZ"; // yaw, then boat-frame roll and pitch
  scene.add(boat);

  // Sky rides along with the boat so the horizon never runs out.
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  const moonTexture = makeGlowTexture("rgba(238,247,248,0.95)", "rgba(238,247,248,0)");
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: moonTexture, transparent: true, opacity: 0.66, depthWrite: false })
  );
  moon.position.set(-9, 8.5, -26);
  moon.scale.setScalar(5.8);
  skyGroup.add(moon);

  const cloudTexture = makeGlowTexture("rgba(96,130,158,0.55)", "rgba(96,130,158,0)", 0.15);
  const clouds: { sprite: THREE.Sprite; speed: number }[] = [];
  for (const spec of [
    { x: -14, y: 5.2, z: -28, sx: 16, sy: 3.6, o: 0.4, speed: 0.12 },
    { x: 6, y: 7.5, z: -30, sx: 13, sy: 3.0, o: 0.3, speed: 0.08 },
    { x: 16, y: 4.6, z: -26, sx: 11, sy: 2.6, o: 0.35, speed: 0.15 },
    { x: -3, y: 9.8, z: -32, sx: 18, sy: 4.0, o: 0.22, speed: 0.06 },
    { x: 10, y: 6.4, z: 27, sx: 14, sy: 3.2, o: 0.3, speed: 0.1 },
    { x: -12, y: 8.2, z: 29, sx: 15, sy: 3.4, o: 0.25, speed: 0.07 },
  ]) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, opacity: spec.o, depthWrite: false })
    );
    sprite.position.set(spec.x, spec.y, spec.z);
    sprite.scale.set(spec.sx, spec.sy, 1);
    skyGroup.add(sprite);
    clouds.push({ sprite, speed: spec.speed });
  }

  // Full star dome (the camera can face any direction while sailing).
  const starCount = 420;
  const starPositions = new Float32Array(starCount * 3);
  const starPhases = new Float32Array(starCount);
  const starSizes = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const radius = 26 + Math.random() * 18;
    starPositions[i * 3] = Math.cos(theta) * radius;
    starPositions[i * 3 + 1] = 2.5 + Math.random() * 20;
    starPositions[i * 3 + 2] = Math.sin(theta) * radius;
    starPhases[i] = Math.random();
    starSizes[i] = (1.0 + Math.random() * 1.8) * Math.min(window.devicePixelRatio, 2);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  starGeometry.setAttribute("aPhase", new THREE.BufferAttribute(starPhases, 1));
  starGeometry.setAttribute("aSize", new THREE.BufferAttribute(starSizes, 1));
  const starUniforms = { uTime: { value: 0 } };
  skyGroup.add(
    new THREE.Points(
      starGeometry,
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        uniforms: starUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
  );

  const streakTexture = makeStreakTexture();
  const shootingStar = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: streakTexture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  shootingStar.scale.set(6, 0.5, 1);
  skyGroup.add(shootingStar);
  const meteor = { active: false, nextAt: 4, startAt: 0, duration: 1.1, from: new THREE.Vector3(), dir: new THREE.Vector3() };

  // ---------------------------------------------------------------- Lighthouse island
  const LIGHTHOUSE_POS = new THREE.Vector2(34, -26);
  const lighthouse = new THREE.Group();
  lighthouse.position.set(LIGHTHOUSE_POS.x, -0.25, LIGHTHOUSE_POS.y);
  const rockMat = new THREE.MeshStandardMaterial({ color: "#1c2836", roughness: 0.95, flatShading: true });
  for (const [rx, rz, rs, ry] of [[0, 0, 2.6, -0.6], [1.8, 1.2, 1.7, -0.9], [-1.6, -1.0, 1.9, -0.8], [0.6, -1.8, 1.4, -0.9]] as const) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rs, 0), rockMat);
    rock.position.set(rx, ry, rz);
    rock.scale.y = 0.55;
    lighthouse.add(rock);
  }
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.5, 2.8, 12),
    new THREE.MeshStandardMaterial({ color: "#cfc9ba", roughness: 0.7 })
  );
  tower.position.y = 2.1;
  lighthouse.add(tower);
  const lampRoom = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.24, 0.42, 10),
    new THREE.MeshStandardMaterial({ color: "#7a3b2a", roughness: 0.6 })
  );
  lampRoom.position.y = 3.7;
  lighthouse.add(lampRoom);
  const lampGlowTexture = makeGlowTexture("rgba(255,226,170,0.95)", "rgba(255,226,170,0)", 0.25);
  const lampGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: lampGlowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  lampGlow.position.y = 3.7;
  lampGlow.scale.setScalar(1.6);
  lighthouse.add(lampGlow);
  // Two opposed sweeping beams, built from the streak texture.
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 3.7;
  lighthouse.add(beamPivot);
  const beamMat = new THREE.MeshBasicMaterial({
    map: streakTexture,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  for (const flip of [0, Math.PI]) {
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(13, 1.1), beamMat);
    beam.position.x = flip === 0 ? 6.8 : -6.8;
    beam.rotation.y = flip;
    beamPivot.add(beam);
  }
  scene.add(lighthouse);

  // ---------------------------------------------------------------- Lanterns to collect
  const lanternGlowTexture = makeGlowTexture("rgba(255,196,120,0.9)", "rgba(255,196,120,0)", 0.18);
  interface FloatingLantern {
    group: THREE.Group;
    glow: THREE.Sprite;
    pos: THREE.Vector2;
    burstAt: number; // -1 = idle
  }
  const lanterns: FloatingLantern[] = [];
  const lanternBodyMat = new THREE.MeshBasicMaterial({ color: "#ffc478" });
  for (let i = 0; i < 7; i++) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), lanternBodyMat);
    body.scale.y = 1.25;
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: lanternGlowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    glow.scale.setScalar(1.1);
    group.add(body, glow);
    // Start far astern so the first frame recycles every lantern out ahead of the bow.
    const lantern: FloatingLantern = { group, glow, pos: new THREE.Vector2(-1000, -1000), burstAt: -1 };
    lanterns.push(lantern);
    scene.add(group);
  }
  let lanternsCollected = 0;
  let toastTimer = 0;
  // Scatter a lantern ahead of the boat, within a wide cone around the current
  // heading, so wherever the player chooses to sail the supply keeps coming.
  const spawnLanternAhead = (lantern: FloatingLantern, fwd: THREE.Vector2, from: THREE.Vector2) => {
    const ang = (Math.random() - 0.5) * 1.9; // ±~54° around the heading
    const dist = 17 + Math.random() * 26;
    const dirX = fwd.x * Math.cos(ang) - fwd.y * Math.sin(ang);
    const dirY = fwd.x * Math.sin(ang) + fwd.y * Math.cos(ang);
    lantern.pos.set(from.x + dirX * dist, from.y + dirY * dist);
    lantern.glow.scale.setScalar(1.1);
    (lantern.glow.material as THREE.SpriteMaterial).opacity = 1;
    lantern.group.visible = true;
  };

  // ---------------------------------------------------------------- Dolphin pod
  const dolphinMat = new THREE.MeshStandardMaterial({ color: "#3d5068", roughness: 0.4 });
  const makeDolphin = () => {
    const d = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 10), dolphinMat);
    body.rotation.z = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 8), dolphinMat);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 0.26;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 4), dolphinMat);
    tail.rotation.z = Math.PI / 2;
    tail.scale.z = 0.35;
    tail.position.x = -0.26;
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), dolphinMat);
    fin.scale.z = 0.4;
    fin.position.y = 0.09;
    d.add(body, nose, tail, fin);
    return d;
  };
  const pod = [makeDolphin(), makeDolphin()];
  pod.forEach((d) => {
    d.visible = false;
    scene.add(d);
  });
  const podState = {
    active: false,
    nextAt: 14,
    startAt: 0,
    duration: 8,
    from: new THREE.Vector2(),
    dir: new THREE.Vector2(),
  };

  // ---------------------------------------------------------------- Bow spray particles
  const sprayTexture = makeGlowTexture("rgba(214,233,238,0.9)", "rgba(214,233,238,0)", 0.2);
  interface SprayParticle {
    sprite: THREE.Sprite;
    vel: THREE.Vector3;
    life: number; // remaining seconds; <= 0 = dead
  }
  const sprayPool: SprayParticle[] = [];
  for (let i = 0; i < 26; i++) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sprayTexture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    sprite.visible = false;
    scene.add(sprite);
    sprayPool.push({ sprite, vel: new THREE.Vector3(), life: 0 });
  }

  // ---------------------------------------------------------------- Simulation state
  // Heading convention: forward = (cos h, 0, -sin h); h grows turning to port.
  const state = {
    pos: new THREE.Vector2(0, 0),
    heading: 0,
    speed: 0,
    sheetEase: 0.85, // 0 = sheeted flat amidships, 1 = boom right out; set to match the opening broad reach
    hoist: 1, // 1 = sails fully hoisted, 0 = doused (dropped onto boom / foredeck)
    hoistTarget: 1,
    heel: 0,
    trip: 0, // world units sailed
    windBase: Math.PI * 0.75, // wind initially from the aft-port quarter: a broad reach, so the boat moves right away
  };
  const keys = new Set<string>();
  const NO_GO = 0.4; // ~23° of apparent wind: a Bermudan sloop stops driving only this close
  const KN = 7.8; // world-units/sec -> knots, for both the display and the apparent-wind maths
  const MAX_BOOM = 1.45; // boom angle (rad) at full ease
  const THRUST = 0.05;
  const DRAG = 0.3; // linear hull drag
  const DRAG2 = 0.3; // quadratic drag: caps top speed, compresses the polar

  // Point-of-sail power envelope over the apparent wind angle. A marconi rig is
  // efficient close-hauled, so power climbs steeply just out of the no-go zone;
  // it peaks on a close/beam reach (~85° apparent) and eases toward a run.
  const pointOfSailPower = (awa: number) => {
    if (awa < NO_GO) return 0;
    const ramp = THREE.MathUtils.smoothstep(awa, NO_GO, NO_GO + 0.16);
    const hump = 0.66 + 0.34 * Math.sin(Math.min(awa, Math.PI) * 0.86 + 0.42);
    return ramp * THREE.MathUtils.clamp(hump, 0, 1);
  };
  // The boom angle that keeps the sail at its best angle of attack for a given
  // apparent wind angle — the target the player trims toward. Near-flat when
  // close-hauled, right out on a run.
  const idealBoomFor = (awa: number) => THREE.MathUtils.clamp((awa - 0.32) * 0.85, 0.1, 1.35);
  const pointOfSailName = (awa: number) => {
    if (awa < NO_GO) return "In stallo";
    if (awa < 1.05) return "Bolina";
    if (awa < 1.6) return "Traverso";
    if (awa < 2.5) return "Lasco";
    return "Poppa";
  };

  const windFromAngle = (t: number) => state.windBase + 0.5 * Math.sin(t * 0.023) + 0.25 * Math.sin(t * 0.011 + 2);
  const windKnots = (t: number) => 9 + 2.5 * Math.sin(t * 0.05) + Math.sin(t * 0.13);

  // Travelling gusts: pockets of stronger wind drifting downwind past the boat.
  interface Gust {
    pos: THREE.Vector2;
    radius: number;
    strength: number; // extra wind fraction at the core
  }
  const gusts: Gust[] = [];
  const respawnGust = (g: Gust, t: number, near: boolean) => {
    const windTo = windFromAngle(t) + Math.PI;
    const toDir = new THREE.Vector2(Math.cos(windTo), -Math.sin(windTo));
    const side = new THREE.Vector2(-toDir.y, toDir.x);
    // Spawn upwind of the boat so the gust sweeps across its path.
    const upwind = near ? 10 + Math.random() * 20 : 25 + Math.random() * 30;
    g.pos.copy(state.pos).addScaledVector(toDir, -upwind).addScaledVector(side, (Math.random() - 0.5) * 40);
    g.radius = 6 + Math.random() * 5;
    g.strength = 0.3 + Math.random() * 0.3;
  };
  for (let i = 0; i < 3; i++) {
    const g: Gust = { pos: new THREE.Vector2(), radius: 8, strength: 0.4 };
    respawnGust(g, 0, true);
    gusts.push(g);
  }
  const gustFactorAt = (p: THREE.Vector2) => {
    let f = 0;
    for (const g of gusts) {
      const d = p.distanceTo(g.pos);
      f += THREE.MathUtils.smoothstep(1 - Math.min(1, d / g.radius), 0.3, 1) * g.strength;
    }
    return 1 + Math.min(0.8, f);
  };

  // ---------------------------------------------------------------- Input
  const KEY_ALIAS: Record<string, string> = { arrowup: "w", arrowdown: "s", arrowleft: "a", arrowright: "d" };
  const normalizeKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    return KEY_ALIAS[k] ?? k;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      teardown();
      return;
    }
    soundscape?.resume();
    tryPlayMusic(); // start the soundtrack on the first key gesture if autoplay was blocked
    const k = normalizeKey(e);
    if (k === " " || k === "spacebar") {
      // Toggle hoist/douse: raise the sails or drop them onto the boom.
      if (!e.repeat) state.hoistTarget = state.hoistTarget > 0.5 ? 0 : 1;
      e.preventDefault();
      return;
    }
    if (["w", "a", "s", "d"].includes(k)) {
      keys.add(k);
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(normalizeKey(e));
  const onResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", onResize);

  // ---------------------------------------------------------------- Lifecycle
  let closed = false;
  const dispose = () => {
    renderer.setAnimationLoop(null);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("resize", onResize);
    soundscape?.dispose();
    music.pause();
    music.src = "";
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
    lampGlowTexture.dispose();
    lanternGlowTexture.dispose();
    sprayTexture.dispose();
    spritz.textures.forEach((texture) => texture.dispose());
    renderer.dispose();
  };
  const teardown = () => {
    if (closed) return;
    closed = true;
    overlay.style.transition = "opacity 600ms ease-out";
    overlay.style.opacity = "0";
    overlay.classList.remove("is-open");
    window.setTimeout(() => {
      dispose();
      overlay.remove();
      document.body.style.overflow = previousOverflow;
      gameActive = false;
      onClose?.();
    }, 650);
  };

  // ---------------------------------------------------------------- Loop
  const startTime = performance.now();
  let lastT = 0;
  const camPos = new THREE.Vector3(0, 3.5, 12); // dolly-in start; eases toward the chase position

  renderer.setAnimationLoop(() => {
    if (closed) return;
    const t = (performance.now() - startTime) / 1000;
    const dt = Math.min(t - lastT, 0.05);
    lastT = t;

    // ------------------------------------------------ Wind, gusts & controls
    const windFrom = windFromAngle(t);
    const windTo = windFrom + Math.PI;
    const windToDir = new THREE.Vector2(Math.cos(windTo), -Math.sin(windTo));
    const baseWindKn = windKnots(t);
    for (const g of gusts) {
      g.pos.addScaledVector(windToDir, baseWindKn * 0.09 * dt);
      if (g.pos.distanceTo(state.pos) > 75) respawnGust(g, t, false);
    }
    const gustFactor = gustFactorAt(state.pos);
    const windKn = baseWindKn * gustFactor;

    const rudder = (keys.has("a") ? 1 : 0) - (keys.has("d") ? 1 : 0);
    // W eases the sheet (boom out), S trims it in (boom toward centreline).
    state.sheetEase = THREE.MathUtils.clamp(
      state.sheetEase + ((keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0)) * dt * 0.5,
      0,
      1
    );

    const fwd = new THREE.Vector2(Math.cos(state.heading), -Math.sin(state.heading));

    // Apparent wind = true wind minus the boat's own motion. As the boat speeds
    // up on a reach the apparent wind draws forward, so the player must trim in —
    // the core wind/point-of-sail/trim relationship.
    const boatKn = state.speed * KN;
    const trueVx = -windKn * Math.cos(windFrom);
    const trueVz = windKn * Math.sin(windFrom);
    const appVx = trueVx - boatKn * fwd.x;
    const appVz = trueVz - boatKn * fwd.y;
    const appSpeed = Math.hypot(appVx, appVz) || 0.0001;
    const appFromX = -appVx / appSpeed;
    const appFromY = -appVz / appSpeed;
    const awa = Math.acos(THREE.MathUtils.clamp(appFromX * fwd.x + appFromY * fwd.y, -1, 1));
    // Which side the wind is on: sign of the 2D cross product bow × wind-from.
    const windSide = fwd.x * appFromY - fwd.y * appFromX >= 0 ? 1 : -1;

    // Trim: how close the boom is to its ideal angle for this apparent wind angle.
    state.hoist += (state.hoistTarget - state.hoist) * Math.min(1, dt * 1.6);
    const idealBoom = idealBoomFor(awa);
    const boom = state.sheetEase * MAX_BOOM;
    const trimErr = boom - idealBoom; // >0 = eased too far (luffs), <0 = over-trimmed (stalls)
    const trimEff = Math.exp(-Math.pow(trimErr / 0.5, 2));
    const power = pointOfSailPower(awa) * state.hoist; // doused sails don't drive
    const luffing = state.hoist > 0.5 && (awa < NO_GO + 0.05 || trimErr > 0.55);

    const thrust = appSpeed * THRUST * power * trimEff;
    state.speed = Math.max(0, state.speed + (thrust - DRAG * state.speed - DRAG2 * state.speed * state.speed) * dt);
    // Turning scrubs a little speed, like a real rudder.
    state.speed *= 1 - 0.2 * Math.abs(rudder) * dt;
    state.heading += rudder * (0.35 + 0.75 * Math.min(state.speed, 1.2) / 1.2) * dt;

    fwd.set(Math.cos(state.heading), -Math.sin(state.heading));
    state.pos.addScaledVector(fwd, state.speed * dt);
    state.trip += state.speed * dt;

    // Soft collision with the lighthouse island.
    const toIsland = new THREE.Vector2().subVectors(state.pos, LIGHTHOUSE_POS);
    if (toIsland.length() < 4.2) {
      toIsland.normalize();
      state.pos.copy(LIGHTHOUSE_POS).addScaledVector(toIsland, 4.2);
      state.speed *= Math.pow(0.25, dt * 4);
    }

    // ------------------------------------------------ Boat pose on the waves
    const starboard = new THREE.Vector2(Math.sin(state.heading), Math.cos(state.heading));
    const sample = (alongOff: number, sideOff: number) =>
      waveHeight(
        state.pos.x + fwd.x * alongOff + starboard.x * sideOff,
        state.pos.y + fwd.y * alongOff + starboard.y * sideOff,
        t
      );
    const hBow = sample(0.85, 0);
    const hMid = sample(0, 0);
    const hStern = sample(-0.85, 0);
    const hPort = sample(0, -0.6);
    const hStar = sample(0, 0.6);

    boat.position.set(state.pos.x, (hBow + hMid + hStern) / 3 + 0.075, state.pos.y);
    boat.rotation.y = state.heading;
    boat.rotation.z = Math.atan2(hBow - hStern, 1.7) * 0.7 + 0.02 + state.speed * 0.02; // pitch + speed trim
    // Heel to leeward. The heeling (sideways) component of the sail force is
    // largest when the sails are sheeted flat close-hauled and grows with the
    // square of the apparent wind — so she lays over on the ear upwind and in a
    // gust, and sails nearly upright dead downwind.
    const drawing = state.hoist * trimEff * THREE.MathUtils.smoothstep(awa, NO_GO, NO_GO + 0.16);
    const heelForce = drawing * Math.pow(appSpeed / 11, 2) * (0.5 + 0.5 * Math.cos(boom));
    const heelTarget = -windSide * THREE.MathUtils.clamp(heelForce, 0, 1.4) * 0.2;
    state.heel += (heelTarget - state.heel) * Math.min(1, dt * 2.2);
    boat.rotation.x = -Math.atan2(hStar - hPort, 1.2) * 0.45 + state.heel;

    // ------------------------------------------------ Sails
    // The boom is sheeted to the angle the player set, always to leeward.
    const boomTarget = -windSide * boom;
    spritz.mainPivot.rotation.y += (boomTarget - spritz.mainPivot.rotation.y) * Math.min(1, dt * 3);
    // The headsail's clew swings about the forestay axis — luff stays on the stay.
    const jibTarget = -windSide * Math.min(boom * 0.85, 0.9);
    spritz.jibPivot.rotation.y += (jibTarget - spritz.jibPivot.rotation.y) * Math.min(1, dt * 3);

    // Running lights once under way, the masthead anchor light once she's stopped
    // (in irons or sails doused) — mirrors real navigation-light rules.
    const targetUnderway = THREE.MathUtils.smoothstep(state.speed, 0.04, 0.13);
    animateSpritzBoatDetails(spritz, t, luffing ? 2.2 : Math.min(1.8, gustFactor), targetUnderway);
    if (luffing) {
      // Sail flogging: either head-to-wind or the sheet eased too far to fill.
      spritz.mainSail.scale.z = 1 + 0.08 * Math.sin(t * 26);
      spritz.jib.scale.z = 1 + 0.07 * Math.sin(t * 31 + 1);
    } else {
      // Fuller cloth the better it's trimmed; slack a touch when badly stalled.
      const fill = 0.9 + 0.25 * trimEff;
      spritz.mainSail.scale.z += (fill - spritz.mainSail.scale.z) * Math.min(1, dt * 4);
      spritz.jib.scale.z += (fill - spritz.jib.scale.z) * Math.min(1, dt * 4);
    }
    // Hoist: the sails drop straight down onto the boom / foredeck when doused
    // (scale along the luff, anchored at the foot), never sideways to the mast.
    const cloth = 0.05 + 0.95 * state.hoist;
    spritz.mainSail.scale.y = cloth;
    spritz.jib.scale.y = cloth;

    // ------------------------------------------------ World follows the boat
    oceanUniforms.uTime.value = t;
    ocean.position.set(state.pos.x, 0, state.pos.y);
    oceanUniforms.uOffset.value.set(state.pos.x, state.pos.y);
    oceanUniforms.uBoatPos.value.copy(state.pos);
    oceanUniforms.uForward.value.copy(fwd);
    oceanUniforms.uWake.value = Math.min(1, state.speed / 0.9);
    for (let i = 0; i < 3; i++) {
      gustUniform[i].set(gusts[i].pos.x, gusts[i].pos.y, gusts[i].radius, gusts[i].strength);
    }
    skyGroup.position.set(state.pos.x, 0, state.pos.y);
    starUniforms.uTime.value = t;
    fillLight.position.set(boat.position.x + 4, 3, boat.position.z + 9);
    fillLight.target = boat;

    // ------------------------------------------------ Lighthouse
    beamPivot.rotation.y = t * 0.55;
    lampGlow.material.opacity = 0.55 + 0.45 * Math.pow(Math.abs(Math.sin(t * 0.55 + 0.4)), 6);

    // ------------------------------------------------ Lanterns
    for (const lantern of lanterns) {
      const bob = waveHeight(lantern.pos.x, lantern.pos.y, t);
      lantern.group.position.set(lantern.pos.x, bob + 0.12, lantern.pos.y);
      if (lantern.burstAt >= 0) {
        const p = (t - lantern.burstAt) / 0.7;
        if (p >= 1) {
          lantern.burstAt = -1;
          spawnLanternAhead(lantern, fwd, state.pos);
        } else {
          lantern.glow.scale.setScalar(1.1 + p * 3.2);
          (lantern.glow.material as THREE.SpriteMaterial).opacity = 1 - p;
        }
      } else {
        (lantern.glow.material as THREE.SpriteMaterial).opacity = 0.75 + 0.25 * Math.sin(t * 2.4 + lantern.pos.x);
        // Recycle any lantern the player has left well astern or sailed far past,
        // dropping it back into the cone ahead — an endless supply in whatever
        // direction the boat is heading. (Off-screen, so the move is unseen.)
        const relX = lantern.pos.x - state.pos.x;
        const relY = lantern.pos.y - state.pos.y;
        const along = relX * fwd.x + relY * fwd.y;
        if (along < -12 || relX * relX + relY * relY > 52 * 52) {
          spawnLanternAhead(lantern, fwd, state.pos);
        } else if (state.pos.distanceTo(lantern.pos) < 1.35) {
          lantern.burstAt = t;
          lanternsCollected++;
          hudLanterns.textContent = String(lanternsCollected);
          lanternToast.classList.add("is-visible");
          toastTimer = t + 1.6;
        }
      }
    }
    if (toastTimer && t > toastTimer) {
      lanternToast.classList.remove("is-visible");
      toastTimer = 0;
    }

    // ------------------------------------------------ Dolphins
    if (!podState.active && t >= podState.nextAt) {
      podState.active = true;
      podState.startAt = t;
      podState.duration = 7 + Math.random() * 2;
      const side = Math.random() > 0.5 ? 1 : -1;
      podState.from.copy(state.pos).addScaledVector(fwd, 9).addScaledVector(starboard, side * 11);
      podState.dir.copy(starboard).multiplyScalar(-side).add(fwd.clone().multiplyScalar(0.25)).normalize();
      pod.forEach((d) => (d.visible = true));
    }
    if (podState.active) {
      const pt = (t - podState.startAt) / podState.duration;
      if (pt >= 1) {
        podState.active = false;
        podState.nextAt = t + 22 + Math.random() * 18;
        pod.forEach((d) => (d.visible = false));
      } else {
        pod.forEach((dolphin, i) => {
          const lag = i * 0.85;
          const dist = (pt * podState.duration) * 2.6 - lag;
          const px = podState.from.x + podState.dir.x * dist;
          const pz = podState.from.y + podState.dir.y * dist;
          const leapPhase = dist * 0.55;
          const py = Math.sin(leapPhase * Math.PI) * 0.55 - 0.18 + waveHeight(px, pz, t) * 0.4;
          dolphin.position.set(px, py, pz);
          dolphin.rotation.y = Math.atan2(-podState.dir.y, podState.dir.x);
          dolphin.rotation.z = Math.cos(leapPhase * Math.PI) * 0.7;
        });
      }
    }

    // ------------------------------------------------ Bow spray
    if (state.speed > 0.45) {
      for (const p of sprayPool) {
        if (p.life > 0) continue;
        if (Math.random() > state.speed * 0.35) break;
        p.life = 0.55 + Math.random() * 0.25;
        p.sprite.visible = true;
        p.sprite.position.set(
          boat.position.x + fwd.x * 1.12,
          boat.position.y + 0.06,
          boat.position.z + fwd.y * 1.12
        );
        p.vel.set(
          fwd.x * state.speed * 0.6 + starboard.x * (Math.random() - 0.5) * 0.9,
          0.6 + Math.random() * 0.7,
          fwd.y * state.speed * 0.6 + starboard.y * (Math.random() - 0.5) * 0.9
        );
        break; // at most one new droplet per frame
      }
    }
    for (const p of sprayPool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      p.vel.y -= 2.6 * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const lp = 1 - p.life / 0.8;
      p.sprite.scale.setScalar(0.08 + lp * 0.16);
      (p.sprite.material as THREE.SpriteMaterial).opacity = (1 - lp) * 0.55;
    }

    // ------------------------------------------------ Clouds & meteors
    for (const cloud of clouds) {
      cloud.sprite.position.x += cloud.speed * 0.016;
      if (cloud.sprite.position.x > 30) cloud.sprite.position.x = -30;
    }
    if (!meteor.active && t >= meteor.nextAt) {
      meteor.active = true;
      meteor.startAt = t;
      meteor.duration = 0.9 + Math.random() * 0.5;
      meteor.from.set(-4 + Math.random() * 18, 12 + Math.random() * 6, -30);
      meteor.dir.set(-1, -0.35 - Math.random() * 0.2, 0).normalize();
      (shootingStar.material as THREE.SpriteMaterial).rotation = Math.atan2(meteor.dir.y, meteor.dir.x) + Math.PI;
    }
    if (meteor.active) {
      const p = (t - meteor.startAt) / meteor.duration;
      if (p >= 1) {
        meteor.active = false;
        meteor.nextAt = t + 4 + Math.random() * 5;
        shootingStar.material.opacity = 0;
      } else {
        shootingStar.position.copy(meteor.from).addScaledVector(meteor.dir, p * 14);
        shootingStar.material.opacity = Math.sin(p * Math.PI) * 0.9;
      }
    }

    // ------------------------------------------------ Chase camera
    const intro = Math.min(1, t / 3);
    const ease = 1 - Math.pow(1 - intro, 3);
    const chaseBack = 12 - 5.6 * ease;
    const chaseUp = 3.5 - 1.4 * ease;
    const desired = new THREE.Vector3(
      boat.position.x - fwd.x * chaseBack,
      boat.position.y + chaseUp,
      boat.position.z - fwd.y * chaseBack
    );
    camPos.lerp(desired, 1 - Math.exp(-dt * 3));
    camera.position.copy(camPos);
    camera.lookAt(boat.position.x + fwd.x * 1.5, boat.position.y + 0.7, boat.position.z + fwd.y * 1.5);
    // Speed widens the view a touch.
    const targetFov = 52 + Math.min(state.speed, 1.4) * 5;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 2);
      camera.updateProjectionMatrix();
    }

    renderer.render(scene, camera);

    soundscape?.update(windKn, state.speed, gustFactor - 1, t);

    // ------------------------------------------------ HUD
    // Dial is bow-up; the arrow points to where the apparent wind blows FROM.
    windDialArrow.style.transform = `rotate(${windSide * awa * (180 / Math.PI)}deg)`;
    hudWind.textContent = `${appSpeed.toFixed(0)} kn`;
    hudWind.classList.toggle("is-gust", gustFactor > 1.18);
    hudPosition.textContent = pointOfSailName(awa);
    hudSpeed.textContent = `${(state.speed * KN).toFixed(1)} kn`;
    // Bearing with world -z as north.
    const bearing = ((Math.atan2(fwd.x, -fwd.y) * 180) / Math.PI + 360) % 360;
    const cardinal = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round(bearing / 45) % 8];
    hudCourse.textContent = `${bearing.toFixed(0).padStart(3, "0")}° ${cardinal}`;
    hudTrip.textContent = ((state.trip * 4) / 1852).toFixed(2);

    // Trim gauge: marker = current sheet ease, green band = the ideal for this angle.
    const idealEase = THREE.MathUtils.clamp(idealBoom / MAX_BOOM, 0, 1);
    const bandHalf = 0.09;
    trimBand.style.left = `${Math.max(0, idealEase - bandHalf) * 100}%`;
    trimBand.style.width = `${(Math.min(1, idealEase + bandHalf) - Math.max(0, idealEase - bandHalf)) * 100}%`;
    trimMarker.style.left = `${state.sheetEase * 100}%`;
    const doused = state.hoist < 0.6;
    const tuned = !doused && Math.abs(state.sheetEase - idealEase) < bandHalf && power > 0.02;
    trimMarker.classList.toggle("is-tuned", tuned);
    trimHint.classList.toggle("is-tuned", tuned);
    trimMsg.textContent = doused
      ? "Vele ammainate"
      : power < 0.02
        ? "Poggia per ripartire"
        : tuned
          ? "Vele a segno"
          : state.sheetEase > idealEase
            ? "◀ Cazza"
            : "Lasca ▶";
  });
}
