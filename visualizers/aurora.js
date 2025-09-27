/*
 * Aurora Orbit 3D Visualiser (simplified)
 *
 * This implementation provides a performant and visually pleasing 3D
 * visualiser without relying on external postprocessing libraries.  A
 * ring of bars arranged around a circle responds to the audio
 * spectrum, while a starfield in the background adds depth.  The
 * camera drifts slowly for dynamism.  Colors are interpolated from a
 * set of gradient stops and applied directly to each bar.  Without
 * bloom, the output remains vivid yet efficient.  Only Three.js is
 * imported, ensuring that no duplicate instances of Three are loaded.
 */

// Import Three.js from the same module URL used elsewhere in the
// project.  The `?module` suffix ensures an ES module is returned.
import * as THREE from 'https://unpkg.com/three@0.160.0?module';

// Assign THREE to the global window so that other modules (if any)
// reuse the same instance and avoid duplicate imports.  This prevents
// "Multiple instances of Three.js being imported" warnings.
if (typeof window !== 'undefined') {
  window.THREE = THREE;
}

/**
 * Quality presets determine how many bars and stars are drawn.  Fewer
 * objects improve performance on slower devices.  You can tweak
 * these numbers to balance quality and speed.
 */
const QUALITY_PRESETS = {
  high:   { bars: 64, stars: 2000 },
  medium: { bars: 48, stars: 1200 },
  low:    { bars: 32, stars: 700 }
};

/**
 * Gradient stops in HSL (hue [0..1], saturation, lightness) used
 * to colour the bars.  These values were chosen to span a vibrant
 * range across the hue wheel.  They are converted to linear RGB
 * up front for consistent blending in the scene.
 */
const GRADIENT_STOPS = [
  [0.58, 0.68, 0.64], // turquoise
  [0.76, 0.72, 0.60], // purple
  [0.90, 0.70, 0.64], // magenta
  [0.13, 0.74, 0.60]  // gold
];

/**
 * Convert an HSL colour to linear RGB.  We use an approximate gamma
 * conversion (2.2) to bring colours into linear space.  This
 * implementation is adapted from Three.js's HSL conversion.
 *
 * @param {number} h Hue in range [0, 1]
 * @param {number} s Saturation in range [0, 1]
 * @param {number} l Lightness in range [0, 1]
 * @returns {number[]} Array of linear RGB components
 */
function hslToLinear(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.pow(c, 2.2);
  };
  return [f(0), f(8), f(4)];
}

// Precompute the linear RGB colours for the gradient stops.  These
// values are stored in a flat Float32Array for fast access when
// generating bar colours.
const gradientColors = new Float32Array(GRADIENT_STOPS.length * 3);
for (let i = 0; i < GRADIENT_STOPS.length; i++) {
  const [h, s, l] = GRADIENT_STOPS[i];
  const rgb = hslToLinear(h, s, l);
  gradientColors[i * 3 + 0] = rgb[0];
  gradientColors[i * 3 + 1] = rgb[1];
  gradientColors[i * 3 + 2] = rgb[2];
}

/**
 * Create a starfield consisting of a given number of points placed
 * randomly on a sphere.  Each star has a random seed used to animate
 * twinkling.  The returned object includes both the Points mesh and
 * its uniforms so they can be updated externally.
 *
 * @param {number} count Number of stars
 * @param {number} radius Base radius of the sphere on which stars are placed
 * @returns {{ points: THREE.Points, uniforms: object }} Starfield mesh and uniforms
 */
function buildStarfield(count, radius) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Uniformly sample a point on a sphere.  We add slight jitter to
    // vary distances and avoid a perfect sphere.
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * (0.6 + 0.4 * Math.random());
    const sinPhi = Math.sin(phi);
    positions[i * 3 + 0] = r * sinPhi * Math.cos(theta);
    positions[i * 3 + 1] = r * sinPhi * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    seeds[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const uniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x0a1632) },
    uBrightness: { value: 0.25 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      precision mediump float;
      attribute float seed;
      varying float vSeed;
      void main() {
        vSeed = seed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 1.5;
      }
    `,
    fragmentShader: /* glsl */`
      precision mediump float;
      // Declare uTime so it is recognised by the shader.  Without
      // declaring it here the compiler reports "uTime" as an
      // undeclared identifier.  See console errors.
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uBrightness;
      varying float vSeed;
      void main() {
        float twinkle = smoothstep(0.45, 0.55, sin((vSeed + uTime) * 6.2832));
        vec3 color = uColor * (uBrightness + 0.5 * twinkle);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  });
  const points = new THREE.Points(geometry, material);
  return { points, uniforms };
}

/**
 * Create a logarithmic mapping from FFT bins to a smaller number of
 * frequency bands.  This replicates the mapping used by the 2D
 * visualiser to ensure similar frequency responses.
 *
 * @param {number} binCount Number of FFT bins
 * @param {number} bandCount Number of bands to compute
 * @returns {Array<[number, number]>} Array of [start, end) indices
 */
function makeLogBandMap(binCount, bandCount) {
  const sampleRate = 44100;
  const nyquist = sampleRate / 2;
  const fMin = 32;
  const fMax = Math.min(16000, nyquist);
  const bands = [];
  for (let i = 0; i < bandCount; i++) {
    const t0 = i / bandCount;
    const t1 = (i + 1) / bandCount;
    const f0 = fMin * Math.pow(fMax / fMin, t0);
    const f1 = fMin * Math.pow(fMax / fMin, t1);
    const b0 = Math.max(0, Math.floor((f0 / nyquist) * binCount));
    const b1 = Math.min(binCount - 1, Math.ceil((f1 / nyquist) * binCount));
    bands.push([b0, Math.max(b0 + 1, b1)]);
  }
  return bands;
}

/**
 * AuroraOrbitVisualizer (3D)
 *
 * Exports a class implementing the visualiser interface expected by
 * app.js.  It constructs and renders a 3D scene using Three.js.
 */
export class AuroraOrbitVisualizer {
  constructor() {
    this.container = null;
    this.analyser = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.stars = null;
    this.starUniforms = null;
    this.barsGroup = null;
    this.bars = [];
    this.bandMap = null;
    this.quality = 'high';
    this.sampleRate = 44100;
    this.lastTime = performance.now();
    this.audioState = { energy: 0 };
    this.contextLostHandler = null;
    this.resizeObserver = null;
    // Additional properties for floor disc, background and peak highlights
    this.floor = null;
    // Base colour and highlight colour used for the floor disc.  They
    // are initialised when the floor is built and updated when
    // applying palettes.  We store linear colours here for fast
    // interpolation in update().
    this.floorBaseColor = new THREE.Color();
    this.floorHighlightColor = new THREE.Color();
    // Per-bar peak array tracks highlight intensity per bar.  Values
    // decay over time and are boosted when a bar exceeds the
    // highlight threshold.  This array is created in _buildBars().
    this.barPeak = [];
    // Background group holds subtle decorative elements that rotate
    // slowly to add motion to the scene.  Built in _buildBackground().
    this.backgroundGroup = null;
  }

  /**
   * Set the quality preset.  This rebuilds bars and starfield to use
   * the counts associated with the new quality level.
   *
   * @param {string} level One of 'high', 'medium', 'low'
   */
  setQuality(level) {
    if (!QUALITY_PRESETS[level]) return;
    this.quality = level;
    if (this.barsGroup || this.stars) {
      // Rebuild bars and starfield based on the new quality.  Also
      // rebuild the floor and background elements so they match the
      // updated scene scale and palette.  Calling these methods
      // ensures that all geometry and materials are disposed of
      // properly and recreated with the correct counts.
      this._buildBars();
      this._buildStarfield();
      this._buildFloor();
      this._buildBackground();
    }
  }

  /**
   * Update the colour palette used by the bar gradient.  Accepts an
   * array of three sRGB colours (0..1).  These colours replace the
   * HSL gradient stops defined at the top of this file.  The first
   * three gradient stops are set to the palette colours and the
   * fourth stop wraps back to the first colour.  Colours are
   * converted to linear space and stored in the global
   * gradientColors array.  After updating the palette the bars are
   * rebuilt so the new colours take effect.
   *
   * @param {Array<Array<number>>} palette Array of sRGB colours
   */
  setPalette(palette) {
    if (!palette || !palette.length) return;
    // Ensure exactly three colours by repeating the last if fewer
    const cols = [];
    for (let i = 0; i < 3; i++) {
      const col = palette[i] || palette[palette.length - 1];
      cols.push([
        Math.min(1, Math.max(0, col[0])),
        Math.min(1, Math.max(0, col[1])),
        Math.min(1, Math.max(0, col[2]))
      ]);
    }
    // Build four stops: three palette colours and wrap back to first
    const stops = [cols[0], cols[1], cols[2], cols[0]];
    for (let i = 0; i < stops.length; i++) {
      const [r, g, b] = stops[i];
      // Convert sRGB to linear (approximate gamma 2.2)
      const lr = Math.pow(r, 2.2);
      const lg = Math.pow(g, 2.2);
      const lb = Math.pow(b, 2.2);
      gradientColors[i * 3 + 0] = lr;
      gradientColors[i * 3 + 1] = lg;
      gradientColors[i * 3 + 2] = lb;
    }
    // Rebuild bars with new colours
    if (this.barsGroup) {
      this._buildBars();
      // Refresh the floor and background to reflect new palette choices.
      this._buildFloor();
      this._buildBackground();
    }
  }

  /** Initialise the visualiser.  Creates the renderer, scene and
   * camera, attaches the renderer's canvas to the container, and
   * constructs the initial bars and starfield.  If WebGL fails, an
   * error is thrown and should be caught by the manager to fall back.
   *
   * @param {HTMLElement} container The DOM element to attach to
   * @param {AnalyserNode} analyser The audio analyser providing data
   */
  init(container, analyser) {
    this.container = container;
    this.analyser = analyser;
    this.sampleRate = analyser.context.sampleRate || this.sampleRate;
    try {
      // Create WebGL renderer
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      if (!renderer || !renderer.getContext()) {
        throw new Error('WebGL renderer not available');
      }
      this.renderer = renderer;
      // Colour management: enable ACES tone mapping for smoother falloff
      renderer.setClearColor(0x050a1e, 1);
      if (renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
      if (THREE.ACESFilmicToneMapping) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
      }
      // Insert the canvas into the container
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      renderer.domElement.style.zIndex = '0';
      this.container.insertBefore(renderer.domElement, this.container.firstChild);
      // Handle context loss
      renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        if (typeof this.contextLostHandler === 'function') this.contextLostHandler();
      });
      // Set up scene and camera
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      // Position the camera back a bit further and slightly lower.
      this.camera.position.set(0, 0.5, 6.0);
      this.camera.lookAt(0, 0, 0);
      // Build starfield, bars, floor and background
      this._buildStarfield();
      this._buildBars();
      this._buildFloor();
      this._buildBackground();
      // Observe container size to update aspect ratio and renderer size
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          this.resize(width, height);
        }
      });
      this.resizeObserver.observe(this.container);
    } catch (err) {
      console.error('AuroraOrbitVisualizer initialization failed:', err);
      this.dispose();
      throw err;
    }
  }

  /** Build or rebuild the starfield according to the current quality. */
  _buildStarfield() {
    if (this.stars) {
      this.scene.remove(this.stars);
      this.stars.geometry.dispose();
      this.stars.material.dispose();
      this.stars = null;
      this.starUniforms = null;
    }
    const { stars } = QUALITY_PRESETS[this.quality];
    const { points, uniforms } = buildStarfield(stars, 22);
    this.stars = points;
    this.starUniforms = uniforms;
    this.scene.add(points);
  }

  /** Build or rebuild the bars arranged in a circle. */
  _buildBars() {
    // Remove existing bars
    if (this.barsGroup) {
      this.scene.remove(this.barsGroup);
      this.bars.forEach((bar) => {
        bar.geometry.dispose();
        bar.material.dispose();
      });
      this.bars = [];
    }
    const { bars } = QUALITY_PRESETS[this.quality];
    this.barCount = bars;
    this.barsGroup = new THREE.Group();
    // Build each bar and assign its initial position and colour
    for (let i = 0; i < bars; i++) {
      const t = i / bars;
      // Interpolate colours between gradient stops
      const stopIndex = Math.floor(t * GRADIENT_STOPS.length);
      const nextIndex = (stopIndex + 1) % GRADIENT_STOPS.length;
      const localT = (t * GRADIENT_STOPS.length) - stopIndex;
      const c0r = gradientColors[stopIndex * 3 + 0];
      const c0g = gradientColors[stopIndex * 3 + 1];
      const c0b = gradientColors[stopIndex * 3 + 2];
      const c1r = gradientColors[nextIndex * 3 + 0];
      const c1g = gradientColors[nextIndex * 3 + 1];
      const c1b = gradientColors[nextIndex * 3 + 2];
      const r = c0r + (c1r - c0r) * localT;
      const g = c0g + (c1g - c0g) * localT;
      const b = c0b + (c1b - c0b) * localT;
      const color = new THREE.Color(r, g, b);
      // Box geometry for a bar.  The bar is centred at the origin and
      // extends upward; translation ensures scaling happens from the
      // bottom.
      const geometry = new THREE.BoxGeometry(0.08, 1.0, 0.08);
      geometry.translate(0, 0.5, 0);
      const material = new THREE.MeshBasicMaterial({ color: color });
      const bar = new THREE.Mesh(geometry, material);
      // Position the bar around a circle of radius 2.5.  A slightly
      // smaller radius keeps the bars fully visible within the frame.
      const angle = t * Math.PI * 2;
      const radius = 2.5;
      bar.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      // Orient the bar so it faces the centre
      bar.lookAt(0, 0, 0);
      this.barsGroup.add(bar);
      this.bars.push(bar);
    }
    this.scene.add(this.barsGroup);
    // Reset band map so it will be recomputed on next update
    this.bandMap = null;
    // Move the entire ring downward slightly so that it sits closer
    // to the bottom of the stage.  Without this offset the ring
    // appears too high in the frame, leaving awkward empty space
    // below.  Adjust this value if you change bar scaling.
    // Position the ring slightly lower so it appears centred between
    // the header and player bar.  This offset can be tuned to taste.
    // Raise the ring slightly higher so the bars occupy more of the
    // vertical space.  A value around -0.3 balances the ring between
    // the header and player bar.
    this.barsGroup.position.y = -0.3;
    // Initialise per-bar peak state array and store base colours for
    // highlight blending.  barPeak values decay over time and are
    // triggered when a bar exceeds a threshold in the update loop.
    this.barPeak = new Array(this.barCount);
    for (let i = 0; i < this.barCount; i++) {
      this.barPeak[i] = 0;
      const bar = this.bars[i];
      bar.userData.baseColor = bar.material.color.clone();
    }
  }

  /** Build or rebuild the floor disc underneath the bar ring.  The
   * floor is a flat cylinder that pulses with the overall audio
   * energy.  Its base and highlight colours are derived from the
   * current gradient colours.  Rebuilding disposes of old
   * resources and creates new geometry and materials.
   */
  _buildFloor() {
    if (!this.scene) return;
    // Remove any existing floor
    if (this.floor) {
      this.scene.remove(this.floor);
      this.floor.geometry.dispose();
      this.floor.material.dispose();
      this.floor = null;
    }
    // Choose base and highlight colours from the gradient stops.
    // Use the second stop as the base and the third stop as the highlight.
    const baseR = gradientColors[1 * 3 + 0];
    const baseG = gradientColors[1 * 3 + 1];
    const baseB = gradientColors[1 * 3 + 2];
    const highlightR = gradientColors[2 * 3 + 0];
    const highlightG = gradientColors[2 * 3 + 1];
    const highlightB = gradientColors[2 * 3 + 2];
    this.floorBaseColor.setRGB(baseR, baseG, baseB);
    this.floorHighlightColor.setRGB(highlightR, highlightG, highlightB);
    // Create a flat cylinder disc.  Use a radius slightly larger
    // than the bar ring to ensure it extends beyond the bars.  A
    // very thin height prevents z-fighting with the background.
    const radius = 3.2;
    const geometry = new THREE.CylinderGeometry(radius, radius, 0.05, 64);
    const material = new THREE.MeshBasicMaterial({
      color: this.floorBaseColor.clone(),
      transparent: true,
      opacity: 0.5
    });
    const disc = new THREE.Mesh(geometry, material);
    // Position the disc slightly below the bars.  Negative y moves it
    // downward from the origin, and a small offset prevents
    // z-fighting with the bar bases.
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.55;
    this.scene.add(disc);
    this.floor = disc;
  }

  /** Build or rebuild a subtle background group of rotating rings.
   * These elements add visual interest without reacting directly to
   * the music.  Rings are scaled progressively larger and rotate at
   * different speeds.  Colours are derived from the gradient stops
   * and tinted dark to avoid overpowering the bars.
   */
  _buildBackground() {
    if (!this.scene) return;
    // Remove existing group and dispose of its geometries/materials
    if (this.backgroundGroup) {
      this.scene.remove(this.backgroundGroup);
      this.backgroundGroup.children.forEach((mesh) => {
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      this.backgroundGroup = null;
    }
    const group = new THREE.Group();
    // Create a few torus rings at increasing radii.  These rotate
    // slowly over time; we give each one a different speed in
    // update().  Colour them using the gradient colours but at
    // reduced brightness and opacity.
    const ringCount = 3;
    for (let i = 0; i < ringCount; i++) {
      const radius = 3.8 + i * 0.6;
      const tube = 0.04 + i * 0.02;
      const geometry = new THREE.TorusGeometry(radius, tube, 16, 64);
      // Pick a colour from the gradient stops and darken it
      const index = i % (GRADIENT_STOPS.length);
      const r = gradientColors[index * 3 + 0];
      const g = gradientColors[index * 3 + 1];
      const b = gradientColors[index * 3 + 2];
      const color = new THREE.Color(r, g, b);
      color.multiplyScalar(0.3);
      const material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.15 });
      const mesh = new THREE.Mesh(geometry, material);
      // Orient rings horizontally
      mesh.rotation.x = Math.PI / 2;
      // Random starting rotation around Z axis
      mesh.rotation.z = Math.random() * Math.PI * 2;
      group.add(mesh);
    }
    this.scene.add(group);
    this.backgroundGroup = group;
  }

  /**
   * Resize the renderer and update the camera aspect ratio.  Called
   * whenever the container is resized.
   *
   * @param {number} width New width in pixels
   * @param {number} height New height in pixels
   */
  resize(width, height) {
    if (!this.renderer || !this.camera) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(dpr);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Compute audio energy and per-band amplitudes.  Returns an
   * object containing the current RMS energy (smoothed) and an array
   * of amplitudes mapped to the number of bars.
   *
   * @param {Uint8Array} freq Frequency-domain data
   * @param {Uint8Array} wave Time-domain data
   * @returns {{ energy: number, amplitudes: Float32Array }}
   */
  _computeAudioFeatures(freq, wave) {
    let sumSq = 0;
    for (let i = 0; i < wave.length; i++) {
      const v = (wave[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / wave.length);
    const smooth = 0.2;
    this.audioState.energy = this.audioState.energy * (1 - smooth) + rms * smooth;
    // Build band map if missing or changed
    if (!this.bandMap || this.bandMap.length !== this.barCount || this.bandMap[0][1] > freq.length) {
      this.bandMap = makeLogBandMap(freq.length, this.barCount);
    }
    const amplitudes = new Float32Array(this.barCount);
    for (let i = 0; i < this.bandMap.length; i++) {
      const [start, end] = this.bandMap[i];
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += freq[j];
      }
      const avg = (end > start) ? sum / (end - start) : 0;
      amplitudes[i] = avg / 255;
    }
    return { energy: this.audioState.energy, amplitudes };
  }

  /**
   * Update the scene on each animation frame.  This scales each
   * bar's height according to the current amplitude in its band and
   * rotates the entire ring.  It also updates the starfield and
   * camera drift for subtle motion.
   *
   * @param {Uint8Array} freq Frequency-domain data from analyser
   * @param {Uint8Array} wave Time-domain data from analyser
   */
  update(freq, wave) {
    if (!this.renderer || !this.scene) return;
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const { energy, amplitudes } = this._computeAudioFeatures(freq, wave);
    // Update bar heights and compute per-bar highlight effects.  Bars
    // scale with amplitude and trigger a highlight when exceeding
    // a threshold.  The highlight decays over time to create
    // afterglow on peaks.
    for (let i = 0; i < this.bars.length; i++) {
      const mesh = this.bars[i];
      const a = amplitudes[i];
      // Scale the bar's height based on the current amplitude.
      const scaleY = 0.4 + 1.5 * a;
      mesh.scale.setY(scaleY);
      // Peak detection: update highlight intensity when amplitude
      // exceeds a threshold (0.7).  Increase the peak value
      // proportionally to how far above the threshold the bar is.
      const threshold = 0.7;
      const peak = this.barPeak[i];
      if (a > threshold) {
        const excess = (a - threshold) / (1 - threshold);
        this.barPeak[i] = Math.min(1, peak + dt * 4.0 * excess);
      } else {
        // Decay the peak using an exponential falloff.  The base
        // decay rate is chosen so peaks fade over roughly a second.
        this.barPeak[i] *= Math.pow(0.8, dt * 60.0);
      }
      // Compute a blended colour between the bar's base colour and
      // white based on the highlight intensity.  This creates a
      // subtle glow on bars that recently peaked.
      const baseColor = mesh.userData.baseColor;
      const h = this.barPeak[i];
      const newR = baseColor.r + (1.0 - baseColor.r) * h;
      const newG = baseColor.g + (1.0 - baseColor.g) * h;
      const newB = baseColor.b + (1.0 - baseColor.b) * h;
      mesh.material.color.setRGB(newR, newG, newB);
    }
    // Rotate the ring slowly.  Energy modulates speed.
    this.barsGroup.rotation.y += dt * (0.2 + energy * 0.6);
    // Update starfield uniforms for twinkle
    if (this.starUniforms) {
      this.starUniforms.uTime.value = now / 1000;
      this.starUniforms.uBrightness.value = 0.2 + energy * 0.6;
    }
    // Update floor disc colour and opacity based on overall energy.
    if (this.floor) {
      const val = energy * energy;
      // Interpolate between base and highlight colours using squared
      // energy for a smoother ramp.  Also modulate opacity so the
      // disc pulses with the beat.
      const c = this.floorBaseColor.clone().lerp(this.floorHighlightColor, val);
      this.floor.material.color.copy(c);
      this.floor.material.opacity = 0.4 + energy * 0.4;
    }
    // Update background rings: rotate each at a different speed and
    // adjust opacity with energy to add subtle dynamism.
    if (this.backgroundGroup) {
      const children = this.backgroundGroup.children;
      for (let i = 0; i < children.length; i++) {
        const ring = children[i];
        ring.rotation.z += dt * (0.02 + i * 0.04);
        ring.material.opacity = 0.05 + energy * 0.15;
      }
    }
    // Camera drift: subtle sinusoidal motion to avoid static view
    const t = now / 1000;
    const drift = 0.04;
    // Drift the camera slowly around its base position.  Base values
    // adjusted to frame the entire ring comfortably within the view.
    this.camera.position.x = Math.sin(t * drift) * 0.2;
    this.camera.position.y = 0.5 + Math.sin(t * drift * 1.3) * 0.1;
    this.camera.position.z = 6.0 + Math.cos(t * drift * 0.9) * 0.2;
    this.camera.lookAt(0, 0, 0);
    // Render the scene
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Register a handler called if the WebGL context is lost.  app.js
   * uses this to fall back to the 2D visualiser.
   *
   * @param {function} handler Callback to execute on context loss
   */
  onContextLost(handler) {
    this.contextLostHandler = handler;
  }

  /**
   * Dispose of all resources.  Called when switching visualisers or
   * shutting down.  Frees GPU memory and removes event listeners.
   */
  dispose() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.stars) {
      this.scene.remove(this.stars);
      this.stars.geometry.dispose();
      this.stars.material.dispose();
      this.stars = null;
      this.starUniforms = null;
    }
    if (this.barsGroup) {
      this.scene.remove(this.barsGroup);
      this.bars.forEach((bar) => {
        bar.geometry.dispose();
        bar.material.dispose();
      });
      this.bars = [];
      this.barsGroup = null;
    }
    if (this.renderer) {
      const dom = this.renderer.domElement;
      if (dom && dom.parentNode === this.container) {
        this.container.removeChild(dom);
      }
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.analyser = null;
    this.container = null;
    this.bandMap = null;
  }
}
