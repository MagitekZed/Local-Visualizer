const GLOBAL = typeof window !== 'undefined' ? window : undefined;

async function loadModule(options) {
  for (const src of options) {
    if (!src) continue;
    try {
      return await import(src);
    } catch (err) {
      console.warn(`Failed loading module ${src}:`, err);
    }
  }
  throw new Error('Unable to load requested module');
}

const moduleBase = new URL('.', import.meta.url);
const vendorConfig = (GLOBAL && GLOBAL.AURORA_VENDOR_MODULES) || {};
const documentBase =
  (GLOBAL && GLOBAL.document && GLOBAL.document.baseURI) ||
  (GLOBAL && GLOBAL.location && GLOBAL.location.href) ||
  moduleBase;

const resolveVendorModule = (specifier) => {
  if (!specifier) return null;
  try {
    return new URL(specifier, documentBase).href;
  } catch (err) {
    console.warn(`Failed to resolve vendor module ${specifier}:`, err);
  }
  try {
    return new URL(specifier, moduleBase).href;
  } catch (err) {
    console.warn(`Failed to resolve module-relative specifier ${specifier}:`, err);
  }
  return null;
};

const threeModule = await loadModule([
  resolveVendorModule(vendorConfig.three),
  new URL('../modules/three.module.js', moduleBase).href,
  'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js'
]);
const THREE = threeModule;

const postModule = await loadModule([
  resolveVendorModule(vendorConfig.postprocessing),
  new URL('../modules/postprocessing.js', moduleBase).href,
  'https://cdn.jsdelivr.net/npm/postprocessing@6.35.3/build/postprocessing.esm.js'
]);
const {
  EffectComposer,
  RenderPass,
  EffectPass,
  FXAAEffect,
  BloomEffect
} = postModule;

if (THREE.ColorManagement && THREE.ColorManagement.enabled !== undefined) {
  THREE.ColorManagement.enabled = true;
}

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
  high: { particles: 20000, ribbons: 4, ribbonSegments: 170, bloom: 1.0 },
  medium: { particles: 12000, ribbons: 3, ribbonSegments: 140, bloom: 0.85 },
  low: { particles: 6000, ribbons: 2, ribbonSegments: 110, bloom: 0.7 }
};

const BASE_GRADIENT = [
  { h: 178 / 360, s: 0.9, l: 0.58 },
  { h: 204 / 360, s: 0.92, l: 0.6 },
  { h: 286 / 360, s: 0.94, l: 0.56 },
  { h: 324 / 360, s: 0.98, l: 0.6 },
  { h: 48 / 360, s: 0.92, l: 0.62 }
];

function radicalInverse(base, n) {
  let inv = 0;
  let denom = 1 / base;
  while (n > 0) {
    inv += (n % base) * denom;
    n = Math.floor(n / base);
    denom /= base;
  }
  return inv;
}

function makeTorusAttribute(count, majorRadius, minorRadius) {
  const positions = new Float32Array(count * 3);
  const angles = new Float32Array(count * 2);
  const seeds = new Float32Array(count * 2);
  const TWO_PI = Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const idx = i + 1;
    const theta = radicalInverse(2, idx) * TWO_PI;
    const phi = radicalInverse(3, idx) * TWO_PI;
    const minorJitter = 0.04 * Math.sin(idx * 2.37);
    const twistJitter = 0.06 * Math.cos(idx * 1.71);
    const minor = minorRadius * (1 + minorJitter);
    const cosPhi = Math.cos(phi + twistJitter);
    const sinPhi = Math.sin(phi + twistJitter);
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const radius = majorRadius + minor * cosPhi;

    const baseIndex = i * 3;
    positions[baseIndex] = radius * cosTheta;
    positions[baseIndex + 1] = minor * sinPhi;
    positions[baseIndex + 2] = radius * sinTheta;

    const angleIndex = i * 2;
    angles[angleIndex] = theta;
    angles[angleIndex + 1] = phi;

    const seedA = Math.sin(idx * 12.9898) * 43758.5453;
    const seedB = Math.sin(idx * 78.233) * 19642.3496;
    seeds[angleIndex] = seedA - Math.floor(seedA);
    seeds[angleIndex + 1] = seedB - Math.floor(seedB);
  }

  return { positions, angles, seeds };
}

function makeStarfield(count, radius) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const twinkle = new Float32Array(count);
  const TWO_PI = Math.PI * 2;
  const tempColor = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const idx = i + 1;
    const u = radicalInverse(2, idx);
    const v = radicalInverse(3, idx);
    const theta = u * TWO_PI;
    const phi = Math.acos(2 * v - 1);
    const r = radius * (0.45 + 0.55 * ((idx * 0.61803398875) % 1));
    const sinPhi = Math.sin(phi);
    const posIdx = i * 3;
    positions[posIdx] = r * Math.cos(theta) * sinPhi;
    positions[posIdx + 1] = r * Math.cos(phi);
    positions[posIdx + 2] = r * Math.sin(theta) * sinPhi;

    const baseTint = 0.35 + 0.65 * ((idx * 0.31830988618) % 1);
    const hue = 220 / 360 + 0.08 * baseTint;
    const sat = 0.55 + 0.35 * baseTint;
    const light = 0.35 + 0.45 * baseTint;
    tempColor.setHSL(hue, sat, light).convertSRGBToLinear();
    colors[posIdx] = tempColor.r;
    colors[posIdx + 1] = tempColor.g;
    colors[posIdx + 2] = tempColor.b;

    const tw = Math.sin(idx * 4.129) * 0.5 + 0.5;
    twinkle[i] = tw;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1));

  const uniforms = {
    uTime: { value: 0 }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      precision mediump float;
      uniform float uTime;
      attribute float aTwinkle;
      varying float vTwinkle;
      varying vec3 vColor;
      void main(){
        vColor = color;
        float flicker = sin(uTime * 0.6 + aTwinkle * 6.2831) * 0.5 + 0.5;
        vTwinkle = mix(0.35, 1.0, flicker);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float dist = max(1.0, -mvPosition.z);
        gl_PointSize = (1.2 + aTwinkle * 0.6 + flicker * 0.8) * (180.0 / dist);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      precision mediump float;
      varying float vTwinkle;
      varying vec3 vColor;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = dot(uv, uv);
        if (d > 0.25) discard;
        float falloff = pow(1.0 - d * 4.0, 1.8);
        vec3 col = vColor * (0.4 + vTwinkle * 0.9) * falloff;
        gl_FragColor = vec4(col, falloff * vTwinkle);
      }
    `
  });

  const points = new THREE.Points(geometry, material);
  return { points, uniforms };
}

class AuroraRibbon {
  constructor(scene, segments, palette, noise) {
    this.segments = segments;
    this.noise = noise;
    this.seed = Math.random() * 1000;
    this.phase = Math.random() * Math.PI * 2;
    this.phiOffset = (Math.random() * 0.75 + 0.2) * (Math.random() > 0.5 ? 1 : -1);
    this.speed = 0.1 + Math.random() * 0.07;
    this.twistBase = 0.5 + Math.random() * 0.45;
    this.baseWidth = 0.085 + Math.random() * 0.045;
    this.amplitudeBase = 0.5 + Math.random() * 0.6;
    this.flowOffset = Math.random() * 10;
    this.majorRadius = 2.2;
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
        varying float vStripe;
        void main(){
          vAlong = aAlong;
          vSide = aSide;
          vStripe = sin(aAlong * 6.2831 + uTime * 0.6);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uEnergy;
        uniform float uGlow;
        uniform float uTime;
        varying float vAlong;
        varying float vSide;
        varying float vStripe;
        void main(){
          float core = clamp(1.0 - abs(vSide), 0.0, 1.0);
          float mainBand = pow(core, 1.4);
          float edge = pow(core, 3.2);
          float mixVal = smoothstep(0.0, 1.0, vAlong + 0.2 * sin(vAlong * 4.0 + uTime * 0.5));
          vec3 color = mix(uColorA, uColorB, mixVal);
          color *= 0.5 + mainBand * (1.2 + uEnergy * 0.8);
          vec3 accent = mix(uColorA, uColorB, 0.5 + 0.5 * vStripe);
          color += accent * edge * (0.25 + uEnergy * 0.75);
          float alpha = mainBand * (0.45 + uGlow * 0.7);
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
    const twist = this.twistBase + mids * 1.4;
    const amp = amplitude * this.amplitudeBase * (0.5 + mids * 1.1);

    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1);
      const theta = t * Math.PI * 2 + time * this.speed + this.phase;
      const flow = this.noise.noise3D(theta * 0.35, this.seed * 0.27, time * 0.2 + this.flowOffset);
      const phiNoise = this.noise.noise3D(theta * 0.2 + this.seed, time * 0.32, this.flowOffset * 0.5);
      const phi = this.phiOffset + phiNoise * twist + Math.sin(theta * 0.6 + time * 0.8 + this.seed) * 0.15;
      const radialNoise = this.noise.noise3D(theta * 0.58, time * 0.18, this.seed * 1.7);
      const minor = minorRadius * (1.0 + 0.22 * radialNoise);
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      const radius = this.majorRadius + minor * cosPhi;
      const baseX = radius * cosTheta;
      const baseY = minor * sinPhi;
      const baseZ = radius * sinTheta;
      const radialX = cosTheta * cosPhi;
      const radialY = sinPhi;
      const radialZ = sinTheta * cosPhi;
      const offset = amp * flow;
      const idx = i * 3;
      centers[idx] = baseX + radialX * offset;
      centers[idx + 1] = baseY + radialY * offset;
      centers[idx + 2] = baseZ + radialZ * offset;
      phiArray[i] = phi;
    }

    const widthBase = this.baseWidth * (0.9 + bass * 0.5);
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

      const phi = phiArray[i];
      const theta = (i / (segments - 1)) * Math.PI * 2 + time * this.speed + this.phase;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      let normalX = cosTheta * cosPhi;
      let normalY = sinPhi;
      let normalZ = sinTheta * cosPhi;
      len = Math.hypot(normalX, normalY, normalZ) || 1;
      normalX /= len;
      normalY /= len;
      normalZ /= len;

      const binormal = this.tmpBinormal;
      binormal[0] = tangent[1] * normalZ - tangent[2] * normalY;
      binormal[1] = tangent[2] * normalX - tangent[0] * normalZ;
      binormal[2] = tangent[0] * normalY - tangent[1] * normalX;
      len = Math.hypot(binormal[0], binormal[1], binormal[2]) || 1;
      binormal[0] /= len;
      binormal[1] /= len;
      binormal[2] /= len;

      const wave = Math.sin(i * 0.3 + time * 1.35 + this.seed) * 0.5 + 0.5;
      const width = widthBase * (0.8 + 0.7 * wave) * (0.8 + mids * 0.8) * (0.85 + energy * 0.7);
      const swirl = amp * 0.35 * this.noise.noise3D(theta * 0.48, this.seed, time * 0.45);

      const nx = normalX * swirl;
      const ny = normalY * swirl;
      const nz = normalZ * swirl;

      const vIdx = i * 6;
      positions[vIdx] = cx - binormal[0] * width + nx;
      positions[vIdx + 1] = cy - binormal[1] * width + ny;
      positions[vIdx + 2] = cz - binormal[2] * width + nz;
      positions[vIdx + 3] = cx + binormal[0] * width + nx;
      positions[vIdx + 4] = cy + binormal[1] * width + ny;
      positions[vIdx + 5] = cz + binormal[2] * width + nz;
    }

    this.geometry.attributes.position.needsUpdate = true;

    const hueA = (this.palette.h1 + hueShift / (Math.PI * 2)) % 1;
    const hueB = (this.palette.h2 + hueShift / (Math.PI * 2)) % 1;
    this.material.uniforms.uColorA.value.setHSL((hueA + 1) % 1, this.palette.s1, this.palette.l1).convertSRGBToLinear();
    this.material.uniforms.uColorB.value.setHSL((hueB + 1) % 1, this.palette.s2, this.palette.l2).convertSRGBToLinear();
    this.material.uniforms.uEnergy.value = energy;
    this.material.uniforms.uGlow.value = 0.7 + energy * 1.6 + mids * 0.4;
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
    this.starfieldUniforms = null;
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
      highs: 0
    };
    this.lastBass = 0;
    this.peakPulse = 0;
    this.gradientUniforms = [
      new THREE.Color(),
      new THREE.Color(),
      new THREE.Color(),
      new THREE.Color(),
      new THREE.Color()
    ];
    this.gradientWorkingColor = new THREE.Color();
    this.gradientBaseHSL = BASE_GRADIENT.map((c) => ({ ...c }));
    this.resizeObserver = null;
    this.pixelRatio = 1;
    this.width = 1;
    this.height = 1;
    this.baseMinor = 0.66;
    this.minorRadius = this.baseMinor;
    this.baseFov = 53;
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
    if (this.starfield) {
      this._buildStarfield();
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
  }

  _buildStarfield() {
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
    }
    const density = this.quality === 'high' ? 3200 : this.quality === 'medium' ? 2200 : 1600;
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
        minor += uMinorRadius * 0.05 * sin(theta * 3.5 + uTime * 1.4);

        float cosTheta = cos(theta);
        float sinTheta = sin(theta);
        float cosPhi = cos(phi);
        float sinPhi = sin(phi);

        float major = 2.2;
        float radius = major + minor * cosPhi;
        vec3 pos = vec3(radius * cosTheta, minor * sinPhi, radius * sinTheta);
        vec3 radial = normalize(vec3(cosTheta * cosPhi, sinPhi, sinTheta * cosPhi));
        float flutter = sin(uTime * 1.1 + aSeed.x * 20.0 + theta * 2.4) * 0.04;
        pos += radial * flutter * (0.6 + 0.8 * uHighs);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float dist = max(1.0, -mvPosition.z);

        float sparkleRand = hash21(aSeed + uTime * 0.13);
        float sparkleGate = step(1.0 - clamp(uHighs * 1.25 + 0.12, 0.08, 0.96), sparkleRand);
        vSparkle = sparkleGate;
        vGrad = fract((phi / (2.0 * PI)) + uHue * 0.08 + aSeed.x * 0.25);
        vDepth = clamp(1.0 - dist / 28.0, 0.0, 1.0);
        vFlux = 0.55 + 0.45 * sin(theta * 1.6 + uTime * 0.6 + aSeed.y * 3.0);

        float size = uSize * (0.9 + uBass * 0.6 + uEnergy * 0.4);
        size *= 1.0 + 0.25 * sin(theta * 5.0 + uTime * 1.7 + aSeed.x * 12.0);
        gl_PointSize = size * (220.0 / dist);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fragmentShader = `
      precision mediump float;
      uniform vec3 uGradient[5];
      uniform float uBloomBoost;
      uniform float uEnergy;
      uniform float uHighs;
      varying float vSparkle;
      varying float vGrad;
      varying float vDepth;
      varying float vFlux;

      vec3 gradient(float t){
        vec3 c0 = uGradient[0];
        vec3 c1 = uGradient[1];
        vec3 c2 = uGradient[2];
        vec3 c3 = uGradient[3];
        vec3 c4 = uGradient[4];
        float m1 = smoothstep(0.0, 0.32, t);
        float m2 = smoothstep(0.25, 0.55, t);
        float m3 = smoothstep(0.5, 0.78, t);
        float m4 = smoothstep(0.72, 1.0, t);
        vec3 low = mix(c0, c1, m1);
        vec3 mid = mix(c1, c2, m2);
        vec3 high = mix(c2, c3, m3);
        vec3 apex = mix(c3, c4, m4);
        vec3 blend1 = mix(low, mid, smoothstep(0.12, 0.5, t));
        vec3 blend2 = mix(high, apex, smoothstep(0.55, 1.0, t));
        return mix(blend1, blend2, smoothstep(0.45, 0.92, t));
      }

      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = dot(uv, uv);
        if (d > 0.25) discard;
        float falloff = pow(1.0 - d * 4.0, 1.9);
        float energyGlow = 0.75 + uEnergy * 0.8;
        vec3 color = gradient(vGrad);
        color *= 0.45 + energyGlow * falloff * (1.3 + vFlux * 0.5);
        float sparkle = vSparkle * (1.0 + uHighs * 1.8) * falloff;
        color += vec3(1.15, 0.95, 1.25) * sparkle;
        color *= 1.0 + uBloomBoost * (0.45 + vDepth * 0.65);
        float alpha = falloff * (0.3 + 0.55 * vDepth) * energyGlow;
        if (alpha < 0.01) discard;
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
      { h1: 190 / 360, s1: 0.95, l1: 0.56, h2: 302 / 360, s2: 0.96, l2: 0.58 },
      { h1: 165 / 360, s1: 0.9, l1: 0.54, h2: 46 / 360, s2: 0.96, l2: 0.6 },
      { h1: 212 / 360, s1: 0.94, l1: 0.55, h2: 330 / 360, s2: 0.98, l2: 0.6 },
      { h1: 285 / 360, s1: 0.88, l1: 0.55, h2: 60 / 360, s2: 0.95, l2: 0.62 }
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
    const bassAvg = bassCount ? bassSum / Math.max(1, bassCount) : 0;
    const midsAvg = midsCount ? midsSum / Math.max(1, midsCount) : 0;
    const highsAvg = highsCount ? highsSum / Math.max(1, highsCount) : 0;

    const energy = Math.min(1, rms * 1.2);
    this.audioState.energy = lerp(this.audioState.energy, energy, 0.14);
    this.audioState.bass = lerp(this.audioState.bass, bassAvg, 0.18);
    this.audioState.mids = lerp(this.audioState.mids, midsAvg, 0.18);
    this.audioState.highs = lerp(this.audioState.highs, highsAvg, 0.2);

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
      bandLevels[i] = lerp(bandLevels[i] || 0, target, 0.18);
    }
  }

  update(freq, wave, dt) {
    if (!this.renderer || !this.uniforms) return;
    this.time += dt;

    this._computeAudioFeatures(freq, wave);

    const audio = this.audioState;

    this.hueShift += dt * (0.18 + audio.energy * 3.2);
    const hueShift = this.hueShift;

    const uniforms = this.uniforms;
    uniforms.uTime.value = this.time;
    uniforms.uEnergy.value = audio.energy;
    uniforms.uBass.value = audio.bass;
    uniforms.uMids.value = audio.mids;
    uniforms.uHighs.value = audio.highs;
    uniforms.uHue.value = hueShift;
    const bassPulse = Math.max(-1, Math.min(1, audio.bass * 2.0 - 1.0));
    this.minorRadius = Math.max(0.45, this.baseMinor * (1.0 + bassPulse * 0.12));
    uniforms.uMinorRadius.value = this.minorRadius;

    const bloomBoost = Math.min(1.8, audio.energy * 1.3 + audio.highs * 0.7);
    uniforms.uBloomBoost.value = bloomBoost;

    if (this.bloomEffect) {
      const baseBloom = this.qualitySettings.bloom;
      this.bloomEffect.intensity = baseBloom * (1.0 + audio.energy * 1.1 + audio.highs * 0.3);
      if (this.bloomEffect.luminanceMaterial) {
        this.bloomEffect.luminanceMaterial.threshold = 0.35 - Math.min(0.1, audio.energy * 0.08);
        this.bloomEffect.luminanceMaterial.smoothing = 0.16 + audio.highs * 0.12;
      }
    }

    const pulseTrigger = audio.bass > this.lastBass + 0.22 && audio.bass > 0.4;
    if (pulseTrigger) this.peakPulse = 1.0;
    this.peakPulse = Math.max(0, this.peakPulse - dt * 1.5);
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
      ribbon.update(this.time, audio, this.minorRadius, 0.5 + audio.energy * 0.45, hueShift);
    }

    if (this.starfield) {
      this.starfield.rotation.y += dt * 0.015;
      this.starfield.rotation.z += dt * 0.004;
    }
    if (this.starfieldUniforms) {
      this.starfieldUniforms.uTime.value = this.time;
    }

    const driftX = this.simplex.noise3D(this.time * 0.06, 11.3, 0) * 0.45;
    const driftY = this.simplex.noise3D(0.7, this.time * 0.08, 5.1) * 0.28;
    const driftZ = this.simplex.noise3D(4.2, 0.5, this.time * 0.07) * 0.32;
    this.camera.position.x = 0.45 * Math.sin(this.time * 0.18) + driftX;
    this.camera.position.y = 0.4 + driftY + audio.energy * 0.35;
    this.camera.position.z = 4.6 + driftZ - audio.bass * 0.2;

    const pulse = this.peakPulse;
    const fovTarget = this.baseFov + pulse * 2.0;
    this.camera.fov += (fovTarget - this.camera.fov) * 0.1;
    this.camera.rotation.z = pulse * 0.04 * Math.sin(this.time * 3.5);
    const lookTargetX = Math.sin(this.time * 0.12) * 0.25;
    const lookTargetY = audio.energy * 0.25 + this.simplex.noise3D(2.4, this.time * 0.05, 1.1) * 0.1;
    const lookTargetZ = Math.cos(this.time * 0.1) * 0.25;
    this.camera.lookAt(lookTargetX, lookTargetY, lookTargetZ);
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
      this.starfieldUniforms = null;
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
