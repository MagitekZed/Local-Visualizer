import * as THREE from '../modules/three.module.js';
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  FXAAEffect,
  BloomEffect
} from '../modules/postprocessing.js';
} from 'https://unpkg.com/postprocessing@6.35.3/build/postprocessing.esm.js';

// Lightweight seeded simplex noise for smooth procedural motion.
class SimplexNoise {
  constructor(seed = 0) {
    let s = seed;
    if (typeof s !== "number" || !isFinite(s)) s = Math.random() * 1e9;
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

    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

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
        i1 = 1; j1 = 0; k1 = 0;
        i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0;
        i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1;
        i2 = 1; j2 = 0; k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1;
        i2 = 0; j2 = 1; k2 = 1;
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0;
        i2 = 0; j2 = 1; k2 = 1;
      } else {
        i1 = 0; j1 = 1; k1 = 0;
        i2 = 1; j2 = 1; k2 = 0;
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

const QUALITY_PRESETS = {
  high: { particles: 19000, ribbons: 4, ribbonSegments: 170, bloom: 1.0 },
  medium: { particles: 11500, ribbons: 3, ribbonSegments: 130, bloom: 0.8 },
  low: { particles: 5500, ribbons: 2, ribbonSegments: 90, bloom: 0.6 }
};

const BASE_GRADIENT = [
  { h: 208 / 360, s: 0.78, l: 0.62 },
  { h: 190 / 360, s: 0.85, l: 0.58 },
  { h: 280 / 360, s: 0.7, l: 0.6 },
  { h: 320 / 360, s: 0.65, l: 0.57 }
];

function makeTorusAttribute(count, majorRadius, minorRadius) {
  const positions = new Float32Array(count * 3);
  const angles = new Float32Array(count * 2);
  const seeds = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 2;
    const jitter = (Math.random() - 0.5) * 0.1;
    const minor = minorRadius * (1 + jitter);
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const x = (majorRadius + minor * cosPhi) * cosTheta;
    const y = minor * sinPhi;
    const z = (majorRadius + minor * cosPhi) * sinTheta;

    const idx3 = i * 3;
    positions[idx3] = x;
    positions[idx3 + 1] = y;
    positions[idx3 + 2] = z;

    const idx2 = i * 2;
    angles[idx2] = theta;
    angles[idx2 + 1] = phi;

    seeds[idx2] = Math.random();
    seeds[idx2 + 1] = Math.random();
  }

  return { positions, angles, seeds };
}

function makeStarfield(count, radius) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * (0.6 + Math.random() * 0.4);
    const sinPhi = Math.sin(phi);
    const idx = i * 3;
    positions[idx] = r * Math.cos(theta) * sinPhi;
    positions[idx + 1] = r * Math.cos(phi);
    positions[idx + 2] = r * Math.sin(theta) * sinPhi;
    const tint = 0.7 + Math.random() * 0.3;
    colors[idx] = 0.45 * tint;
    colors[idx + 1] = 0.55 * tint;
    colors[idx + 2] = 0.7 * tint;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.08,
    vertexColors: true,
    depthWrite: false,
    transparent: true,
    opacity: 0.65
  });
  return new THREE.Points(geometry, material);
}

class AuroraRibbon {
  constructor(scene, segments, palette, noise) {
    this.segments = segments;
    this.noise = noise;
    this.seed = Math.random() * 1000;
    this.phase = Math.random() * Math.PI * 2;
    this.phiOffset = (Math.random() * 0.7 + 0.2) * (Math.random() > 0.5 ? 1 : -1);
    this.speed = 0.12 + Math.random() * 0.08;
    this.twist = 0.6 + Math.random() * 0.4;
    this.baseWidth = 0.08 + Math.random() * 0.04;
    this.palette = palette;

    const vertexCount = segments * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.along = new Float32Array(vertexCount);
    this.side = new Float32Array(vertexCount);
    this.centers = new Float32Array(segments * 3);
    this.phi = new Float32Array(segments);

    const indices = new (vertexCount > 65535 ? Uint32Array : Uint16Array)((segments - 1) * 6);
    let id = 0;
    for (let i = 0; i < segments - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices[id++] = a;
      indices[id++] = b;
      indices[id++] = c;
      indices[id++] = b;
      indices[id++] = d;
      indices[id++] = c;
    }

    for (let i = 0; i < segments; i++) {
      const alongVal = i / (segments - 1);
      const idx = i * 2;
      this.along[idx] = this.along[idx + 1] = alongVal;
      this.side[idx] = -1;
      this.side[idx + 1] = 1;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aAlong", new THREE.BufferAttribute(this.along, 1));
    this.geometry.setAttribute("aSide", new THREE.BufferAttribute(this.side, 1));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uGlow: { value: 1 },
        uColorA: { value: new THREE.Color().setHSL(palette.h1, palette.s1, palette.l1).convertSRGBToLinear() },
        uColorB: { value: new THREE.Color().setHSL(palette.h2, palette.s2, palette.l2).convertSRGBToLinear() }
      },
      vertexShader: `
        precision mediump float;
        uniform float uTime;
        attribute float aAlong;
        attribute float aSide;
        varying float vAlong;
        varying float vSide;
        void main(){
          vAlong = aAlong;
          vSide = aSide;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uEnergy;
        uniform float uGlow;
        varying float vAlong;
        varying float vSide;
        void main(){
          float core = 1.0 - smoothstep(0.0, 1.0, abs(vSide));
          float fringe = smoothstep(0.0, 0.7, core);
          vec3 color = mix(uColorA, uColorB, pow(vAlong, 1.6));
          color *= (0.6 + 0.4 * fringe);
          color += vec3(0.45, 0.35, 0.6) * uEnergy * fringe;
          float alpha = pow(core, 1.2) * uGlow;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    scene.add(this.mesh);

    this.tmpTangent = [0, 0, 0];
    this.tmpCenter = [0, 0, 0];
    this.tmpBinormal = [0, 0, 0];
  }

  update(time, audio, minorRadius, amplitude, hueShift) {
    const segments = this.segments;
    const centers = this.centers;
    const phiArray = this.phi;
    const positions = this.positions;
    const bass = audio.bass;
    const mids = audio.mids;
    const energy = audio.energy;

    const amp = amplitude * (0.6 + 1.2 * mids);

    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1);
      const theta = t * Math.PI * 2 + time * this.speed + this.phase;
      const noiseVal = this.noise.noise3D(theta * 0.6, this.seed * 0.17, time * 0.35 + this.seed);
      const wobble = this.noise.noise3D(theta * this.twist, this.seed * 0.07, time * 0.52) * 0.6;
      const phi = this.phiOffset + wobble;
      const minor = minorRadius * (1.0 + 0.2 * Math.sin(theta * 1.8 + this.phase)) + amp * noiseVal;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      const x = (2.2 + (minor + amp * 0.1) * cosPhi) * cosTheta;
      const y = (minor + amp * 0.2) * sinPhi;
      const z = (2.2 + (minor + amp * 0.1) * cosPhi) * sinTheta;
      const idx = i * 3;
      centers[idx] = x;
      centers[idx + 1] = y;
      centers[idx + 2] = z;
      phiArray[i] = phi;
    }

    const widthBase = this.baseWidth * (1.0 + 0.4 * bass);
    for (let i = 0; i < segments; i++) {
      const idx = i * 3;
      const prevIdx = i === 0 ? 0 : (i - 1) * 3;
      const nextIdx = i === segments - 1 ? idx : (i + 1) * 3;

      const tx = centers[nextIdx] - centers[prevIdx];
      const ty = centers[nextIdx + 1] - centers[prevIdx + 1];
      const tz = centers[nextIdx + 2] - centers[prevIdx + 2];
      let len = Math.hypot(tx, ty, tz) || 1;
      const tangent = this.tmpTangent;
      tangent[0] = tx / len;
      tangent[1] = ty / len;
      tangent[2] = tz / len;

      const cx = centers[idx];
      const cy = centers[idx + 1];
      const cz = centers[idx + 2];

      const toCenterX = cx;
      const toCenterY = cy * 0.4;
      const toCenterZ = cz;
      len = Math.hypot(toCenterX, toCenterY, toCenterZ) || 1;
      const normalX = toCenterX / len;
      const normalY = toCenterY / len;
      const normalZ = toCenterZ / len;

      const binormal = this.tmpBinormal;
      binormal[0] = tangent[1] * normalZ - tangent[2] * normalY;
      binormal[1] = tangent[2] * normalX - tangent[0] * normalZ;
      binormal[2] = tangent[0] * normalY - tangent[1] * normalX;
      len = Math.hypot(binormal[0], binormal[1], binormal[2]) || 1;
      binormal[0] /= len;
      binormal[1] /= len;
      binormal[2] /= len;

      const wave = Math.sin(i * 0.32 + time * 1.6 + this.seed) * 0.5 + 0.5;
      const width = widthBase * (0.8 + 0.7 * wave) * (0.7 + 0.6 * mids);

      const vIdx = i * 6;
      positions[vIdx] = cx - binormal[0] * width;
      positions[vIdx + 1] = cy - binormal[1] * width;
      positions[vIdx + 2] = cz - binormal[2] * width;
      positions[vIdx + 3] = cx + binormal[0] * width;
      positions[vIdx + 4] = cy + binormal[1] * width;
      positions[vIdx + 5] = cz + binormal[2] * width;
    }

    this.geometry.attributes.position.needsUpdate = true;

    const hueA = (this.palette.h1 + hueShift / (Math.PI * 2)) % 1;
    const hueB = (this.palette.h2 + hueShift / (Math.PI * 2)) % 1;
    this.material.uniforms.uColorA.value.setHSL((hueA + 1) % 1, this.palette.s1, this.palette.l1).convertSRGBToLinear();
    this.material.uniforms.uColorB.value.setHSL((hueB + 1) % 1, this.palette.s2, this.palette.l2).convertSRGBToLinear();
    this.material.uniforms.uEnergy.value = energy;
    this.material.uniforms.uGlow.value = 0.8 + energy * 1.4;
    this.material.uniforms.uTime.value = time;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

function makeLogBandMap(binCount, bandCount, sampleRate) {
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

class AuroraOrbitVisualizer {
  constructor() {
    this.container = null;
    this.analyser = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.fxaaEffect = null;
    this.bloomEffect = null;
    this.points = null;
    this.uniforms = null;
    this.ribbons = [];
    this.starfield = null;
    this.simplex = new SimplexNoise(4711);
    this.time = 0;
    this.hueShift = 0;
    this.quality = 'high';
    this.qualitySettings = QUALITY_PRESETS.high;
    this.bandMap = null;
    this.bandLevels = new Float32Array(48);
    this.audioState = {
      energy: 0,
      bass: 0,
      mids: 0,
      highs: 0,
      sparkle: 0
    };
    this.lastBass = 0;
    this.peakPulse = 0;
    this.gradientUniforms = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
    this.gradientWorkingColor = new THREE.Color();
    this.gradientBaseHSL = BASE_GRADIENT.map((c) => ({ ...c }));
    this.resizeObserver = null;
    this.pixelRatio = 1;
    this.width = 1;
    this.height = 1;
    this.minorRadius = 0.62;
    this.contextLostHandler = null;
  }

  setQuality(level) {
    if (!QUALITY_PRESETS[level]) return;
    this.quality = level;
    this.qualitySettings = QUALITY_PRESETS[level];
    if (this.points) {
      this._buildParticles();
    }
    if (this.ribbons.length) {
      this._buildRibbons();
    }
    if (this.bloomEffect) {
      this.bloomEffect.intensity = this.qualitySettings.bloom;
    }
  }

  init(container, analyser) {
    this.container = container;
    this.analyser = analyser;
    this.sampleRate = analyser.context.sampleRate || 44100;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!renderer.getContext()) {
      throw new Error('WebGL renderer not available');
    }
    this.renderer = renderer;
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x05060a, 1);
    renderer.domElement.className = 'aurora-orbit-webgl';
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.zIndex = '0';

    this.container.insertBefore(renderer.domElement, this.container.firstChild);

    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (typeof this.contextLostHandler === 'function') {
        this.contextLostHandler();
      }
    });

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x05060a, 12, 24);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 40);
    this.camera.position.set(0, 0.6, 4.6);

    this._buildParticles();
    this._buildRibbons();
    this._buildStarfield();
    this._setupPost();

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.resize(width, height);
      }
    });
    this.resizeObserver.observe(this.container);
  }

  onContextLost(handler) {
    this.contextLostHandler = handler;
  }

  _setupPost() {
    if (!this.renderer || !this.camera) return;
    const composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    const fxaa = new FXAAEffect();
    const bloom = new BloomEffect({
      intensity: this.qualitySettings.bloom,
      luminanceThreshold: 0.36,
      luminanceSmoothing: 0.18,
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
  }

  _buildStarfield() {
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
    }
    this.starfield = makeStarfield(700, 18);
    this.scene.add(this.starfield);
  }

  _buildParticles() {
    if (this.points) {
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.scene.remove(this.points);
    }

    const count = this.qualitySettings.particles;
    const { positions, angles, seeds } = makeTorusAttribute(count, 2.2, this.minorRadius);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('aPosition', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aAngles', new THREE.BufferAttribute(angles, 2));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));

    const uniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uBass: { value: 0 },
      uMids: { value: 0 },
      uHighs: { value: 0 },
      uHue: { value: 0 },
      uSize: { value: 16.0 },
      uBloomBoost: { value: 0 },
      uMinorRadius: { value: this.minorRadius },
      uSparkle: { value: 0 },
      uGradient: { value: this.gradientUniforms }
    };
    this.uniforms = uniforms;

    const vertexShader = `
      precision mediump float;
      attribute vec3 aPosition;
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
      uniform float uSparkle;
      varying float vSpark;
      varying float vGrad;
      varying float vDepth;
      const float PI = 3.14159265359;

      // Simple hash for sparkle
      float hash12(vec2 p){
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      void main(){
        float theta = aAngles.x;
        float phi = aAngles.y;

        float swing = sin(theta * 2.1 + uTime * 1.2 + aSeed.x * 6.283) * 0.25;
        float minor = uMinorRadius * (1.0 + 0.08 * sin(uTime * 0.8 + aSeed.y * 10.0)) + swing * (0.5 + 0.8 * uBass);
        float wobble = sin(phi * 3.0 + uTime * 1.7 + aSeed.y * 5.0) * 0.18;
        minor += wobble * (0.4 + 0.7 * uMids);

        float cosTheta = cos(theta);
        float sinTheta = sin(theta);
        float cosPhi = cos(phi);
        float sinPhi = sin(phi);

        float radius = 2.2 + (minor) * cosPhi;
        vec3 pos;
        pos.x = radius * cosTheta;
        pos.y = (minor) * sinPhi;
        pos.z = radius * sinTheta;

        vec3 radial = normalize(vec3(cosTheta * cosPhi, sinPhi, sinTheta * cosPhi));
        float shimmer = sin(uTime * 3.5 + aSeed.x * 14.0) * (0.03 + 0.05 * uHighs);
        pos += radial * shimmer;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float dist = -mvPosition.z;
        float size = uSize * (1.0 + 0.6 * uBass) * (1.0 + 0.3 * sin(theta * 4.0 + uTime + aSeed.x * 12.0)) * (1.0 + uEnergy * 0.4);
        gl_PointSize = size * (300.0 / max(dist, 40.0));
        vDepth = clamp(1.0 - dist / 18.0, 0.0, 1.0);

        float sparkleSeed = hash12(aSeed + uTime * 0.015);
        float sparkleGate = step(0.78, sparkleSeed + uSparkle * 0.85);
        vSpark = sparkleGate * (0.25 + 1.4 * uHighs);
        vGrad = clamp(0.3 + 0.6 * sin(phi + uTime * 0.35 + uHue) + 0.2 * aSeed.x, 0.0, 1.0);

        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fragmentShader = `
      precision mediump float;
      uniform vec3 uGradient[4];
      uniform float uBloomBoost;
      uniform float uEnergy;
      varying float vSpark;
      varying float vGrad;
      varying float vDepth;

      vec3 gradient(float t){
        vec3 c1 = mix(uGradient[0], uGradient[1], clamp(t, 0.0, 1.0));
        vec3 c2 = mix(uGradient[2], uGradient[3], clamp(t, 0.0, 1.0));
        float m = smoothstep(0.25, 0.85, t);
        return mix(c1, c2, m);
      }

      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = dot(uv, uv);
        if (d > 0.25) discard;
        float falloff = pow(1.0 - d * 4.0, 1.6);
        vec3 color = gradient(vGrad) * (0.55 + falloff * 0.6);
        color += vec3(0.9, 0.85, 1.2) * vSpark * falloff;
        color *= 1.0 + uBloomBoost * (0.4 + vDepth * 0.6);
        color *= 0.9 + uEnergy * 0.6;
        float alpha = falloff * (0.4 + 0.5 * vDepth + uEnergy * 0.15);
        gl_FragColor = vec4(color, alpha);
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
    for (const ribbon of this.ribbons) ribbon.dispose(this.scene);
    this.ribbons = [];

    const palettes = [
      { h1: 200 / 360, s1: 0.8, l1: 0.52, h2: 280 / 360, s2: 0.72, l2: 0.55 },
      { h1: 320 / 360, s1: 0.7, l1: 0.56, h2: 200 / 360, s2: 0.82, l2: 0.5 },
      { h1: 50 / 360, s1: 0.65, l1: 0.6, h2: 200 / 360, s2: 0.78, l2: 0.55 },
      { h1: 180 / 360, s1: 0.6, l1: 0.55, h2: 330 / 360, s2: 0.75, l2: 0.56 }
    ];

    for (let i = 0; i < this.qualitySettings.ribbons; i++) {
      const palette = palettes[i % palettes.length];
      this.ribbons.push(new AuroraRibbon(this.scene, this.qualitySettings.ribbonSegments, palette, this.simplex));
    }
  }

  resize(width, height) {
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    if (this.renderer) {
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(width, height);
    }
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    if (this.composer) {
      this.composer.setSize(width, height);
      if (this.fxaaEffect) {
        const targetWidth = width * this.pixelRatio;
        const targetHeight = height * this.pixelRatio;
        if (typeof this.fxaaEffect.setSize === 'function') {
          this.fxaaEffect.setSize(targetWidth, targetHeight);
        } else if (this.fxaaEffect.resolution) {
          const resolution = this.fxaaEffect.resolution;
          if (typeof resolution.set === 'function') {
            resolution.set(targetWidth, targetHeight);
          } else if (typeof resolution.setSize === 'function') {
            resolution.setSize(targetWidth, targetHeight);
          } else if (typeof resolution.setResolution === 'function') {
            resolution.setResolution(targetWidth, targetHeight);
          }
        }
      }
    }
  }

  _computeAudioFeatures(freq, wave) {
    if (!this.bandMap || this.bandMap.length !== 48 || this.bandMap[0][1] > freq.length) {
      this.bandMap = makeLogBandMap(freq.length, 48, this.sampleRate);
    }

    let bassSum = 0, bassCount = 0;
    let midsSum = 0, midsCount = 0;
    let highsSum = 0, highsCount = 0;

    const nyquist = this.sampleRate / 2;
    const binHz = nyquist / freq.length;
    const bassMax = 200;
    const midsMax = 2000;
    const highsMax = 16000;

    for (let i = 0; i < freq.length; i++) {
      const hz = i * binHz;
      const v = freq[i] / 255;
      if (hz <= bassMax) { bassSum += v; bassCount++; }
      else if (hz <= midsMax) { midsSum += v; midsCount++; }
      else if (hz <= highsMax) { highsSum += v; highsCount++; }
    }

    let rms = 0;
    for (let i = 0; i < wave.length; i++) {
      const v = (wave[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / wave.length);

    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = 0.2;

    const energy = Math.min(1, rms);
    this.audioState.energy = lerp(this.audioState.energy, energy, smooth);
    this.audioState.bass = lerp(this.audioState.bass, bassCount ? bassSum / bassCount : 0, smooth);
    this.audioState.mids = lerp(this.audioState.mids, midsCount ? midsSum / midsCount : 0, smooth);
    this.audioState.highs = lerp(this.audioState.highs, highsCount ? highsSum / highsCount : 0, smooth);
    this.audioState.sparkle = lerp(this.audioState.sparkle, Math.pow(this.audioState.highs, 1.2), 0.22);

    const levels = this.bandLevels;
    if (levels.length !== this.bandMap.length) {
      this.bandLevels = new Float32Array(this.bandMap.length);
    }
    const bandLevels = this.bandLevels;
    for (let i = 0; i < this.bandMap.length; i++) {
      const [b0, b1] = this.bandMap[i];
      let sum = 0;
      for (let b = b0; b < b1; b++) sum += freq[b];
      const avg = sum / Math.max(1, b1 - b0);
      const target = Math.pow(avg / 255, 0.9);
      bandLevels[i] = lerp(bandLevels[i] || 0, target, 0.2);
    }
  }

  update(freq, wave, dt) {
    if (!this.renderer || !this.uniforms) return;
    this.time += dt;

    this._computeAudioFeatures(freq, wave);

    const audio = this.audioState;

    this.hueShift += dt * (0.4 + audio.energy * 2.6);
    const hueShift = this.hueShift;

    const uniforms = this.uniforms;
    uniforms.uTime.value = this.time;
    uniforms.uEnergy.value = audio.energy;
    uniforms.uBass.value = audio.bass;
    uniforms.uMids.value = audio.mids;
    uniforms.uHighs.value = audio.highs;
    uniforms.uHue.value = hueShift;
    uniforms.uSparkle.value = audio.sparkle;

    const baseMinor = 0.62 * (1.0 + audio.bass * 0.12);
    this.minorRadius = baseMinor;
    uniforms.uMinorRadius.value = this.minorRadius;

    const bloomBoost = Math.min(1.6, audio.energy * 1.2 + audio.highs * 0.6);
    uniforms.uBloomBoost.value = bloomBoost;

    if (this.bloomEffect) {
      this.bloomEffect.intensity = this.qualitySettings.bloom * (1.0 + audio.energy * 0.5 + bloomBoost * 0.4);
      this.bloomEffect.luminanceMaterial.threshold = 0.34 - Math.min(0.15, audio.energy * 0.12);
      this.bloomEffect.luminanceMaterial.smoothing = 0.18 + audio.highs * 0.1;
    }

    const pulseTrigger = audio.bass > this.lastBass + 0.18 && audio.bass > 0.35;
    if (pulseTrigger) this.peakPulse = 1.0;
    this.peakPulse = Math.max(0, this.peakPulse - dt * 1.6);
    this.lastBass = audio.bass;

    const colors = this.gradientUniforms;
    for (let i = 0; i < colors.length; i++) {
      const base = this.gradientBaseHSL[i];
      const color = colors[i];
      const shiftedHue = (base.h + hueShift / (Math.PI * 2)) % 1;
      this.gradientWorkingColor.setHSL((shiftedHue + 1) % 1, base.s, base.l).convertSRGBToLinear();
      color.copy(this.gradientWorkingColor);
    }

    for (const ribbon of this.ribbons) {
      ribbon.update(this.time, audio, this.minorRadius * (1.0 + audio.bass * 0.25), 0.45 + audio.energy * 0.4, hueShift);
    }

    if (this.starfield) {
      this.starfield.rotation.y += dt * 0.02;
      this.starfield.rotation.z += dt * 0.005;
    }

    const driftX = this.simplex.noise3D(this.time * 0.08, 11.3, 0) * 0.45;
    const driftY = this.simplex.noise3D(0.7, this.time * 0.09, 5.1) * 0.25;
    const driftZ = this.simplex.noise3D(4.2, 0.5, this.time * 0.06) * 0.3;
    this.camera.position.x = 0.6 * Math.sin(this.time * 0.12) + driftX;
    this.camera.position.y = 0.45 + driftY + audio.energy * 0.4;
    this.camera.position.z = 4.6 + driftZ;

    const pulse = this.peakPulse * 0.6;
    const fovTarget = 55 + pulse * 1.8;
    this.camera.fov += (fovTarget - this.camera.fov) * 0.08;
    this.camera.rotation.z = pulse * 0.035 * Math.sin(this.time * 4.0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    const renderTarget = this.composer;
    if (renderTarget) {
      renderTarget.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
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
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
      this.starfield = null;
    }
    for (const ribbon of this.ribbons) {
      ribbon.dispose(this.scene);
    }
    this.ribbons = [];
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (this.renderer) {
      this.container.removeChild(this.renderer.domElement);
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
  }
}

export { AuroraOrbitVisualizer };

if (typeof window !== 'undefined') {
  window.AuroraOrbitVisualizer = AuroraOrbitVisualizer;
}
