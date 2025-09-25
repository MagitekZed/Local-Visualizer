// Import Three.js and the postprocessing library from a CDN.  We use
// absolute URLs so that this file can run without bundling or
// installing local modules.  If you wish to host the modules
// yourself, update these URLs accordingly.
// Import Three.js from the same URL that postprocessing uses.  The
// `?module` suffix instructs unpkg to serve the ES module build and
// avoids loading a second copy of the library.  This prevents the
// "Multiple instances of Three.js being imported" warning in the
// console.
import * as THREE from 'https://unpkg.com/three@0.160.0?module';
// Import the entire postprocessing module and then destructure the needed
// classes.  The `?module` suffix ensures we load the ES module build of
// postprocessing, which provides named exports.  Importing the
// namespace rather than individual named exports ensures compatibility if
// the bundler changes the export structure in future versions.
import * as POSTPROCESSING from 'https://unpkg.com/postprocessing@6.35.3?module';
const {
  EffectComposer,
  RenderPass,
  EffectPass,
  FXAAEffect,
  BloomEffect
} = POSTPROCESSING;

// Expose Three.js on the global object if it is not already set.  The
// postprocessing module will detect this and reuse the existing
// instance instead of importing its own copy.  Without this, two
// separate versions of THREE may coexist, leading to warnings and
// inconsistent behaviour.
if (typeof window !== 'undefined' && !window.THREE) {
  window.THREE = THREE;
}

/*!
 * Aurora Orbit Visualiser
 *
 * This module implements a polished Three.js visualiser that displays
 * a colourful torus of particles, several audio‑reactive ribbons and
 * a starfield backdrop.  Audio features (bass, mids, highs and
 * overall energy) drive subtle pulsation of the torus, ribbon
 * thickness, hue rotation and bloom intensity.  A fallback 2D
 * implementation lives in aurora2d.js for browsers without WebGL.
 *
 * The module relies on two vendor libraries: Three.js and
 * postprocessing.  When this file is loaded as an ES module the
 * browser resolves those imports using paths defined in
 * `window.AURORA_VENDOR_MODULES`.  See index.html for details.
 */

const GLOBAL = typeof window !== 'undefined' ? window : undefined;
const DEBUG = !!(
  GLOBAL &&
  ((GLOBAL.localStorage && GLOBAL.localStorage.getItem('aurora-debug') === '1') ||
    (GLOBAL.location && /auroraDebug=1/i.test(GLOBAL.location.search || '')))
);

const debugLog = (...args) => {
  if (DEBUG && typeof console !== 'undefined' && console.log) {
    console.log('[AuroraOrbit]', ...args);
  }
};

// Verify vendor modules are loaded.  If they are missing the visualiser
// will throw and the fallback 2D implementation should activate.
if (!THREE || !THREE.WebGLRenderer) {
  console.error('AuroraOrbitVisualizer: failed to load three.module.js');
  throw new Error('Three.js module missing');
}
if (!EffectComposer || !RenderPass || !EffectPass) {
  console.error('AuroraOrbitVisualizer: failed to load postprocessing module');
  throw new Error('postprocessing module missing');
}

// Enable Three.js colour management so linear colours are converted
// correctly to sRGB.  This improves the appearance of gradients and
// glow when combined with ACES filmic tone mapping.
if (THREE.ColorManagement && THREE.ColorManagement.enabled !== undefined) {
  THREE.ColorManagement.enabled = true;
}

// Lightweight seeded simplex noise for smooth procedural motion.  This
// implementation avoids large dependencies and runs entirely on the CPU.
class SimplexNoise {
  constructor(seed = 0) {
    let s = seed;
    if (typeof s !== 'number' || !isFinite(s)) s = Math.random() * 1e9;
    this.p = new Uint8Array(512);
    for (let i = 0; i < 256; i++) {
      s = (s * 16807) % 2147483647;
      this.p[i] = this.p[i + 256] = s & 255;
    }
  }
  noise3D(x, y, z) {
    const F3 = 1 / 3;
    const G3 = 1 / 6;
    const perm = this.p;
    let n0 = 0,
      n1 = 0,
      n2 = 0,
      n3 = 0;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    const z0 = z - Z0;
    let i1, j1, k1;
    let i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else if (x0 < z0) {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      }
    }
    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    const grad = (hash, x, y, z) => {
      const h = hash & 15;
      const u = h < 8 ? x : y;
      const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
      return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    };
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      t0 *= t0;
      n0 = t0 * t0 * grad(perm[ii + perm[jj + perm[kk]]], x0, y0, z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      t1 *= t1;
      n1 = t1 * t1 * grad(perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]], x1, y1, z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      t2 *= t2;
      n2 = t2 * t2 * grad(perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]], x2, y2, z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      t3 *= t3;
      n3 = t3 * t3 * grad(perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]], x3, y3, z3);
    }
    return 32 * (n0 + n1 + n2 + n3);
  }
}

// Quality presets define how many particles and ribbons are used.  Lower
// settings produce fewer objects and lighter bloom to reduce CPU/GPU
// load on slower machines.  Adjust these values if you experience
// performance issues.
const QUALITY_PRESETS = {
  high: { particles: 10000, ribbons: 3, ribbonSegments: 170, bloom: 0.9 },
  medium: { particles: 6000, ribbons: 2, ribbonSegments: 140, bloom: 0.8 },
  low: { particles: 2500, ribbons: 1, ribbonSegments: 110, bloom: 0.65 }
};

// A simple HSL gradient used to colour the torus and ribbons.  Each
// element corresponds to a colour stop: hue (0–1), saturation,
// lightness.  These values were hand‑tuned for a vibrant but
// harmonious palette.
const GRADIENT_STOPS = [
  [0.58, 0.68, 0.64], // turquoise
  [0.76, 0.72, 0.60], // purple
  [0.90, 0.70, 0.64], // magenta
  [0.13, 0.74, 0.60]  // gold
];

// Convert HSL to linear RGB.  We do this here so the palette is
// computed once up front.  The shader receives colours in linear
// space for accurate blending and bloom.
function hslToLinear(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return c;
  };
  const r = f(0);
  const g = f(8);
  const b = f(4);
  // Convert to linear space
  return [
    Math.pow(r, 2.2),
    Math.pow(g, 2.2),
    Math.pow(b, 2.2)
  ];
}

// Precompute gradient uniforms used by the particle shader.  The
// gradient array is flattened into a 1D uniform.  Each entry is
// a vec3 representing a linear sRGB colour.
const gradientUniforms = new Float32Array(GRADIENT_STOPS.length * 3);
for (let i = 0; i < GRADIENT_STOPS.length; i++) {
  const [h, s, l] = GRADIENT_STOPS[i];
  const rgb = hslToLinear(h, s, l);
  gradientUniforms[i * 3 + 0] = rgb[0];
  gradientUniforms[i * 3 + 1] = rgb[1];
  gradientUniforms[i * 3 + 2] = rgb[2];
}

/**
 * Build torus vertex attributes.  We generate an array of positions,
 * angles and seeds.  The positions are not used directly; instead the
 * shader reconstructs the torus from the angles and a uniform minor
 * radius.  The seeds provide per‑particle variation for noise,
 * sparkle and motion.
 */
function makeTorusAttribute(count, major, minor) {
  const positions = new Float32Array(count * 3);
  const angles = new Float32Array(count * 2);
  const seeds = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 2;
    const x = (major + minor * Math.cos(theta)) * Math.cos(phi);
    const y = (major + minor * Math.cos(theta)) * Math.sin(phi);
    const z = minor * Math.sin(theta);
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    angles[i * 2 + 0] = theta;
    angles[i * 2 + 1] = phi;
    seeds[i * 2 + 0] = Math.random();
    seeds[i * 2 + 1] = Math.random();
  }
  return { positions, angles, seeds };
}

/**
 * Build a starfield.  This helper returns a Points object and its
 * associated uniforms.  Stars are placed in a spherical shell
 * surrounding the scene.  Their colours are tinted dark blue to
 * avoid overpowering the torus.  Each star has a random seed used
 * to drive subtle twinkling in the fragment shader.
 */
function makeStarfield(count, radius) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = radius * (0.6 + 0.4 * Math.random());
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;
    const x = r * Math.sin(theta) * Math.cos(phi);
    const y = r * Math.sin(theta) * Math.sin(phi);
    const z = r * Math.cos(theta);
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    seeds[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const uniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x0a1632) },
    uBrightness: { value: 0.25 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      precision mediump float;
      attribute float aSeed;
      uniform float uTime;
      varying float vSeed;
      void main() {
        vSeed = fract(aSeed + uTime * 0.05);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 1.5;
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying float vSeed;
      uniform vec3 uColor;
      uniform float uBrightness;
      void main() {
        float twinkle = smoothstep(0.45, 0.55, sin((vSeed + 0.1) * 6.2832));
        gl_FragColor = vec4(uColor * (uBrightness + twinkle * 0.5), 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });
  const points = new THREE.Points(geometry, material);
  return { points, uniforms };
}

/**
 * Build a set of ribbon geometries.  Ribbons are fat lines (Line2
 * objects) with vertex colours derived from the gradient.  Each
 * ribbon is parameterised by a set of sample points around the
 * torus.  Their thickness and amplitude are driven by audio mids.
 */
function buildRibbonGeometry(samples, segments) {
  // Each ribbon segment consists of three vertices: two at the start of the
  // segment (t0,0) and (t0,1), and one at the next sample (t1,0).  This
  // arrangement mirrors the structure of Line2 geometry, where vertices
  // are duplicated to properly convey width and orientation.  Accordingly,
  // we allocate 6 floats for positions (3 vertices × 2 components) and
  // 9 floats for colours (3 vertices × 3 components) per segment.
  const positions = new Float32Array(segments * 6);
  const colors = new Float32Array(segments * 9);
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    // Populate position attributes: (t0,0), (t0,1), (t1,0)
    positions.set([t0, 0, t0, 1, t1, 0], i * 6);
    // Determine colour indices in the gradient palette
    const c0 = i % GRADIENT_STOPS.length;
    const c1 = (i + 1) % GRADIENT_STOPS.length;
    const color0 = gradientUniforms.slice(c0 * 3, c0 * 3 + 3);
    const color1 = gradientUniforms.slice(c1 * 3, c1 * 3 + 3);
    // Assign colours for the three vertices: the two start vertices share
    // color0, and the end vertex uses color1.  This produces a smooth
    // colour gradient along the ribbon.
    colors.set([...color0, ...color0, ...color1], i * 9);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * The main class representing the WebGL visualiser.  It adheres to
 * the Visualizer interface defined in app.js: init, resize, update,
 * setQuality and dispose.  Outside code never accesses Three.js
 * internals directly.
 */
export class AuroraOrbitVisualizer {
  constructor() {
    this.container = null;
    this.analyser = null;
    this.sampleRate = 44100;
    this.renderer = null;
    this.composer = null;
    this.fxaaEffect = null;
    this.bloomEffect = null;
    this.effectPass = null;
    this.scene = null;
    this.camera = null;
    this.points = null;
    this.starfield = null;
    this.starfieldUniforms = null;
    this.ribbonObjects = [];
    this.ribbonCurves = [];
    this.ribbonMesh = [];
    this.uniforms = null;
    this.resizeObserver = null;
    this.baseMinor = 0.62;
    this.baseFov = 50;
    this.quality = 'high';
    this.qualitySettings = QUALITY_PRESETS.high;
    this.gradientUniforms = gradientUniforms;
    this.noise = new SimplexNoise();
    this.audioState = {
      energy: 0,
      bass: 0,
      mids: 0,
      highs: 0
    };
    this.cameraDrift = { x: 0, y: 0, z: 0, roll: 0, fovOffset: 0 };
    this.contextLostHandler = null;
  }
  setQuality(level) {
    if (!QUALITY_PRESETS[level]) return;
    this.quality = level;
    this.qualitySettings = QUALITY_PRESETS[level];
    // Rebuild starfield and particles on quality change
    this._buildParticles();
    this._buildRibbons();
    this._buildStarfield();
    if (this.bloomEffect) {
      this.bloomEffect.intensity = this.qualitySettings.bloom;
    }
  }
  init(container, analyser) {
    this.container = container;
    this.analyser = analyser;
    this.sampleRate = analyser.context.sampleRate || 44100;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!renderer || !renderer.getContext()) {
        throw new Error('WebGL renderer not available');
      }
      this.renderer = renderer;
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x05060a, 1);
      if (renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if (renderer.outputEncoding !== undefined && THREE.sRGBEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
      if (THREE.ACESFilmicToneMapping !== undefined) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
      }
      renderer.domElement.className = 'aurora-orbit-webgl';
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.zIndex = '0';
      this.container.insertBefore(renderer.domElement, this.container.firstChild);
      debugLog('Renderer created');
      renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        if (typeof this.contextLostHandler === 'function') {
          this.contextLostHandler();
        }
      });
      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.Fog(0x05060a, 12, 24);
      this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.1, 45);
      this.camera.position.set(0, 0.5, 4.6);
      this._buildParticles();
      this._buildRibbons();
      this._buildStarfield();
      debugLog('Starfield ready');
      this._setupPost();
      debugLog('Composer ready');
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
  onContextLost(handler) {
    this.contextLostHandler = handler;
  }
  _setupPost() {
    if (!this.renderer || !this.camera) return;
    try {
      const composer = new EffectComposer(this.renderer);
      if ('multisampling' in composer) {
        composer.multisampling = 0;
      }
      const renderPass = new RenderPass(this.scene, this.camera);
      const fxaa = new FXAAEffect();
      const bloom = new BloomEffect({
        intensity: this.qualitySettings.bloom,
        luminanceThreshold: 0.35,
        luminanceSmoothing: 0.16,
        radius: 0.85
      });
      bloom.blendMode.opacity.value = 1.0;
      const effectPass = new EffectPass(this.camera, fxaa, bloom);
      effectPass.renderToScreen = true;
      composer.addPass(renderPass);
      composer.addPass(effectPass);
      this.composer = composer;
      this.fxaaEffect = fxaa;
      this.bloomEffect = bloom;
      this.effectPass = effectPass;
    } catch (err) {
      console.error('AuroraOrbitVisualizer post-processing failed:', err);
      throw err;
    }
  }
  _buildStarfield() {
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
    }
    const density = this.quality === 'high' ? 3000 : this.quality === 'medium' ? 2000 : 1400;
    const { points, uniforms } = makeStarfield(density, 22);
    this.starfield = points;
    this.starfieldUniforms = uniforms;
    this.scene.add(this.starfield);
  }
  _buildParticles() {
    if (this.points) {
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.scene.remove(this.points);
    }
    const count = this.qualitySettings.particles;
    const { positions, angles, seeds } = makeTorusAttribute(count, 2.2, this.baseMinor);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aAngles', new THREE.BufferAttribute(angles, 2));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));
    const uniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uBass: { value: 0 },
      uMids: { value: 0 },
      uHighs: { value: 0 },
      uHue: { value: 0 },
      uSize: { value: 22.0 },
      uBloomBoost: { value: 0 },
      uMinorRadius: { value: this.baseMinor },
      uGradient: { value: this.gradientUniforms }
    };
    this.uniforms = uniforms;
    const vertexShader = `
      precision mediump float;
      attribute vec2 aAngles;
      attribute vec2 aSeed;
      uniform float uTime;
      uniform float uEnergy;
      uniform float uBass;
      uniform float uMids;
      uniform float uHighs;
      uniform float uHue;
      uniform float uSize;
      uniform float uMinorRadius;
      varying float vSparkle;
      varying float vGrad;
      varying float vDepth;
      varying float vFlux;
      const float PI = 3.141592653589793;
      float hash21(vec2 p){
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main(){
        float theta = aAngles.x;
        float phi = aAngles.y;
        float minor = uMinorRadius;
        minor += uMinorRadius * 0.12 * sin(uTime * 0.6 + theta * 1.9 + aSeed.x * 9.0);
        minor += uMinorRadius * 0.10 * sin(phi * 2.2 + uTime * 0.8 + aSeed.y * 7.0) * (0.6 + 0.9 * uMids);
        float x = (2.2 + minor * cos(theta)) * cos(phi);
        float y = (2.2 + minor * cos(theta)) * sin(phi);
        float z = minor * sin(theta);
        vec3 pos = vec3(x, y, z);
        // Depth fade: points further from the camera are dimmer
        vDepth = 1.0 - smoothstep(6.0, 18.0, length(pos));
        // Random sparkle based on highs energy and aSeed
        vSparkle = step(1.0 - uHighs * 1.1, hash21(aSeed + uTime));
        // Gradient index based on phi angle
        vGrad = (phi / (2.0 * PI));
        // Flux used for minor color modulation
        vFlux = sin(theta * 2.5 + uTime * 0.7) * cos(phi * 1.7 + uTime * 0.9);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = uSize;
      }
    `;
    const fragmentShader = `
      precision highp float;
      uniform sampler2D uGradient;
      uniform float uHue;
      uniform float uEnergy;
      varying float vSparkle;
      varying float vGrad;
      varying float vDepth;
      varying float vFlux;
      vec3 palette(float t) {
        // Sample the gradient from the uniform.  Use vGrad mod 1.0 and
        // add a hue rotation based on uHue.  Wrap hue within [0,1].
        float wrapped = mod(t + uHue, 1.0);
        int idx = int(floor(wrapped * 4.0));
        int nextIdx = (idx + 1) % 4;
        float f = fract(wrapped * 4.0);
        vec3 c0 = texelFetch(uGradient, ivec2(0, idx), 0).rgb;
        vec3 c1 = texelFetch(uGradient, ivec2(0, nextIdx), 0).rgb;
        return mix(c0, c1, f);
      }
      void main(){
        vec3 color = palette(vGrad + vFlux * 0.03);
        // Apply depth fade: far points are darker
        color *= vDepth;
        // Sparkle overlay
        if (vSparkle > 0.0) {
          color += vec3(1.0, 1.0, 1.0) * 0.4;
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);
  }
  _buildRibbons() {
    // Dispose previous ribbons
    this.ribbonObjects.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    this.ribbonObjects = [];
    this.ribbonCurves = [];
    const ribbonCount = this.qualitySettings.ribbons;
    const segments = this.qualitySettings.ribbonSegments;
    for (let i = 0; i < ribbonCount; i++) {
      const curve = [];
      for (let j = 0; j <= segments; j++) {
        curve.push(new THREE.Vector3());
      }
      this.ribbonCurves.push(curve);
      const geometry = buildRibbonGeometry(ribbonCount, segments);
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      this.scene.add(mesh);
      this.ribbonObjects.push(mesh);
    }
  }
  resize(width, height) {
    if (!this.renderer || !this.camera) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(width, height);
  }
  _computeAudioFeatures(freq, wave) {
    // Map the FFT bins onto logarithmic bands.  Lazily recompute
    // whenever the number of bands changes or when the FFT length
    // changes.
    if (!this.bandMap || this.bandMap.length !== 48 || this.bandMap[0][1] > freq.length) {
      this.bandMap = this._makeLogBandMap(freq.length, 48);
    }
    const lerp = (a, b, t) => a + (b - a) * t;
    const nyquist = this.sampleRate / 2;
    const binHz = nyquist / freq.length;
    let bassSum = 0,
      bassCount = 0;
    let midsSum = 0,
      midsCount = 0;
    let highsSum = 0,
      highsCount = 0;
    for (let i = 0; i < freq.length; i++) {
      const v = freq[i] / 255;
      const hz = i * binHz;
      if (hz <= 200) {
        bassSum += v;
        bassCount++;
      } else if (hz <= 2000) {
        midsSum += v;
        midsCount++;
      } else if (hz <= 16000) {
        highsSum += v;
        highsCount++;
      }
    }
    let rms = 0;
    for (let i = 0; i < wave.length; i++) {
      const v = (wave[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / wave.length);
    const smooth = 0.2;
    const energy = Math.min(1, rms);
    this.audioState.energy = lerp(this.audioState.energy, energy, smooth);
    this.audioState.bass = lerp(this.audioState.bass, bassCount ? bassSum / bassCount : 0, smooth);
    this.audioState.mids = lerp(this.audioState.mids, midsCount ? midsSum / midsCount : 0, smooth);
    this.audioState.highs = lerp(this.audioState.highs, highsCount ? highsSum / highsCount : 0, smooth);
  }
  _makeLogBandMap(binCount, bandCount) {
    const nyquist = this.sampleRate / 2;
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
  update(freq, wave, dt) {
    if (!this.composer || !this.uniforms) return;
    this._computeAudioFeatures(freq, wave);
    const { energy, bass, mids, highs } = this.audioState;
    // Drive torus and camera with audio
    const t = performance.now() / 1000;
    // Hue rotates slowly with energy
    this.uniforms.uHue.value = (this.uniforms.uHue.value + energy * 0.05 * dt) % 1.0;
    // Bloom boost from loud moments
    this.uniforms.uBloomBoost.value = Math.pow(energy, 2) * 0.8;
    // Torus minor radius pulsates ±12% with bass
    this.uniforms.uMinorRadius.value = this.baseMinor * (1 + 0.12 * bass);
    // Point size scales up to +60% with bass
    this.uniforms.uSize.value = 22.0 * (1 + 0.6 * bass);
    this.uniforms.uBass.value = bass;
    this.uniforms.uMids.value = mids;
    this.uniforms.uHighs.value = highs;
    this.uniforms.uEnergy.value = energy;
    this.uniforms.uTime.value = t;
    // Camera drift using simplex noise
    const driftSpeed = 0.12;
    this.cameraDrift.x += driftSpeed * dt;
    this.cameraDrift.y += driftSpeed * dt * 0.8;
    this.cameraDrift.z += driftSpeed * dt * 1.1;
    const nx = this.noise.noise3D(this.cameraDrift.x, 0, 0);
    const ny = this.noise.noise3D(0, this.cameraDrift.y, 0);
    const nz = this.noise.noise3D(0, 0, this.cameraDrift.z);
    this.camera.position.x = nx * 0.08;
    this.camera.position.y = ny * 0.08 + 0.5;
    this.camera.position.z = 4.6 + nz * 0.07;
    // Small FOV pulse and roll on bass peaks
    const bassPulse = bass * 0.015;
    this.camera.fov = this.baseFov + bassPulse * 100;
    this.camera.rotation.z = bass * 0.05;
    this.camera.updateProjectionMatrix();
    // Animate ribbons: update curves based on mids and noise
    for (let i = 0; i < this.ribbonCurves.length; i++) {
      const curve = this.ribbonCurves[i];
      const phase = (i / this.ribbonCurves.length) * Math.PI * 2;
      for (let j = 0; j < curve.length; j++) {
        const t = j / (curve.length - 1);
        const angle = t * Math.PI * 2;
        const amp = 0.36 + 0.5 * mids;
        const x = (2.2 + this.baseMinor * Math.cos(angle)) * Math.cos(angle) + Math.sin(t * Math.PI * 4 + phase + t * 6.0 + this.uniforms.uTime.value * 0.5) * amp * 0.5;
        const y = (2.2 + this.baseMinor * Math.cos(angle)) * Math.sin(angle) + Math.cos(t * Math.PI * 3 + phase + t * 5.0 + this.uniforms.uTime.value * 0.6) * amp * 0.5;
        const z = this.baseMinor * Math.sin(angle) + Math.sin(t * Math.PI * 5 + phase + t * 7.0 + this.uniforms.uTime.value * 0.4) * amp * 0.4;
        curve[j].set(x, y, z);
      }
      const mesh = this.ribbonObjects[i];
      const positions = mesh.geometry.getAttribute('position');
      const colors = mesh.geometry.getAttribute('color');
      // Each ribbon consists of `segments` segments, where `curve.length`
      // equals `segments + 1`.  Our geometry stores 3 vertices per segment
      // (two at the start and one at the end), so there are `segments * 3`
      // vertices in total.  Update each segment by assigning the start
      // vertices to c0 and the end vertex to c1.  This avoids reading
      // beyond the end of the `curve` array (which caused the previous
      // TypeError) and matches the attribute layout built in
      // `buildRibbonGeometry`.
      const segCount = curve.length - 1;
      for (let j = 0; j < segCount; j++) {
        const c0 = curve[j];
        const c1 = curve[j + 1];
        const idx = j * 3;
        // v0 and v1 (t0,0) and (t0,1)
        positions.setXY(idx + 0, c0.x, c0.y);
        positions.setXY(idx + 1, c0.x, c0.y);
        // v2 (t1,0)
        positions.setXY(idx + 2, c1.x, c1.y);
      }
      positions.needsUpdate = true;
      colors.needsUpdate = true;
    }
    // Update starfield twinkle
    if (this.starfieldUniforms) {
      this.starfieldUniforms.uTime.value = t;
      this.starfieldUniforms.uBrightness.value = 0.2 + Math.pow(energy, 2) * 0.6;
    }
    // Render scene via composer
    this.composer.render();
  }
  dispose() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
    this.ribbonObjects.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    this.ribbonObjects = [];
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
      this.starfield = null;
    }
    if (this.composer) {
      this.composer.passes.forEach((pass) => {
        if (pass.dispose) pass.dispose();
      });
      this.composer = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }
    if (this.scene) {
      this.scene.clear();
      this.scene = null;
    }
    this.camera = null;
    this.uniforms = null;
  }
}
