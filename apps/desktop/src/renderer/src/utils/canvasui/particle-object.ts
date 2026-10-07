// 源码取自 canvas-ui（github.com/DavidHDev/canvas-ui）的 ParticleObject，MIT + Commons Clause。
// 为过本仓 800 行单文件预算拆为多模块；除 import/导出与注释外逻辑零改动。上游：canvasui.dev。
// 运行时：three 场景装配、指针交互与渲染循环
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  createCanvasResizeObserver,
  createRectCache,
  getCanvasPixelRatio
} from "./particle-object-canvas";
import {
  CAMERA_DIR,
  DEFAULTS,
  FRAG,
  MODEL_LIFT,
  VERT,
  type AssetSource,
  type ParticleObjectElements,
  type ParticleObjectInstance,
  type ParticleObjectOptions
} from "./particle-object-types";
import {
  disposeObject,
  normalizeCloud,
  rasterizeImage,
  sampleImage,
  sampleMesh,
  sniffKind
} from "./particle-object-sampling";
import { mergeConfig } from "./particle-object-config";

/**
 * 点云是否有效：坐标必须有限，且至少有一个非零点。
 * 全 0 也算无效 —— sampleImage 在「一个可用像素都没采到」时返回的就是全 0 数组，
 * 于是画布上什么都没有，而引擎自己不会抛错，宿主的静态图回退就永远等不到 onError。
 *
 * 更正（2026-10-05）：早先这里写的是「three.js 对全 0 算出的包围球是 NaN」——**那是错的**，
 * three r186 实测全 0 点云的 radius 是 0，根本不触发那条告警。报 NaN 的另有其人：
 * position 里混入了非有限值，根因在配置的 undefined 覆盖（见 particle-object-config.ts）。
 * 这道检查拦的是「没有内容可画」，不是「拦一条报错」——判据不变，理由已更正，别再写回去。
 */
function hasFiniteSample(positions: Float32Array): boolean {
  if (positions.length === 0) return false;
  let nonZero = false;
  for (let i = 0; i < positions.length; i++) {
    const v = positions[i]!;
    if (!Number.isFinite(v)) return false;
    if (v !== 0) nonZero = true;
  }
  return nonZero;
}

/**
 * 本仓本地改动（上游无此段）：合并配置的入口从 `{ ...DEFAULTS, ...options }` 换成 mergeConfig，
 * 因为对象展开不是 undefined-safe——显式 `undefined` 会**覆盖**默认值，
 * 而 `ParticleObject.vue` 的 props 恰好带着一批这样的键（键存在、值为 undefined）。
 * 完整推导、证据与修复理由见 particle-object-config.ts 的注释（实现与测试都在那边，这里只调用）。
 */
export function createParticleObject(
  elements: ParticleObjectElements,
  options: ParticleObjectOptions = {}
): ParticleObjectInstance | null {
  const { canvas } = elements;
  const config: Required<ParticleObjectOptions> = { ...DEFAULTS };
  mergeConfig(config, options);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: "high-performance"
    });
  } catch {
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(config.fov, 1, 0.1, 200);
  camera.position.copy(CAMERA_DIR).multiplyScalar(config.cameraDistance);

  const floatGroup = new THREE.Group();
  floatGroup.position.y = MODEL_LIFT;
  const fitGroup = new THREE.Group();
  floatGroup.add(fitGroup);
  scene.add(floatGroup);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: Math.random() * 100 },
      uDrift: { value: config.drift },
      uSize: { value: config.size },
      uVariance: { value: config.sizeVariance },
      uDpr: { value: 1 },
      uRefDist: { value: config.cameraDistance },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uUseTint: { value: 0 }
    }
  });

  let points: THREE.Points | null = null;
  let homes: Float32Array | null = null;
  let velocities: Float32Array | null = null;
  let particleCount = 0;
  let assetSource: AssetSource | null = null;
  let builtCount = -1;
  let loadedSrc: string | null = null;
  let loadToken = 0;
  let disposed = false;

  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(config.dracoDecoderPath);
  loader.setDRACOLoader(draco);

  function clearPoints() {
    if (!points) return;
    fitGroup.remove(points);
    points.geometry.dispose();
    points = null;
    homes = null;
    velocities = null;
    particleCount = 0;
  }

  function clearAsset() {
    if (assetSource?.kind === "mesh") disposeObject(assetSource.scene);
    assetSource = null;
    builtCount = -1;
    clearPoints();
  }

  function buildCloud() {
    if (!assetSource) return;
    const count = Math.max(Math.round(config.count), 16);
    if (count === builtCount && points) return;
    builtCount = count;
    clearPoints();

    const sample =
      assetSource.kind === "mesh"
        ? sampleMesh(assetSource.scene, count)
        : sampleImage(assetSource.data, count);
    normalizeCloud(sample);

    // 本仓本地改动（上游无此段）：采样拿到空点云时，所有分量都是 0 —— 于是画布上什么都没有，
    // 而引擎本身不抛错，宿主那张静态品牌图的回退就永远等不到 onError，
    // 容器里留下一个 118px 的空洞（2026-10-05 实机截图）。这里主动验一遍，没有有效点位就当加载失败。
    //
    // 更正（2026-10-05，本仓上一版注释写错了）：当时写的是「three.js 随后会报
    // computeBoundingSphere NaN」。**那是错的**——three r186 实测全 0 点云算出的 radius 是 0，
    // 根本不触发那条告警；报 NaN 的另有其人（position 里混入非有限值，见 mergeConfig 的注释）。
    // 这道检查拦的是「没有内容可画」，不是「拦一条报错」——判据一样，理由不同，别再写回去。
    if (!hasFiniteSample(sample.positions)) {
      clearPoints();
      builtCount = -1;
      config.onError?.(new Error("粒子采样为空（无有效点位）"));
      return;
    }

    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = Math.random();

    const geometry = new THREE.BufferGeometry();
    const positionAttr = new THREE.BufferAttribute(sample.positions.slice(), 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", positionAttr);
    geometry.setAttribute("aColor", new THREE.BufferAttribute(sample.colors, 3));
    geometry.setAttribute("aShade", new THREE.BufferAttribute(sample.shades, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));

    homes = sample.positions;
    velocities = new Float32Array(count * 3);
    particleCount = count;
    points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    fitGroup.add(points);
  }

  async function loadAsset() {
    const src = config.src;
    if (src === loadedSrc) return;
    loadedSrc = src;
    const token = ++loadToken;
    if (!src) {
      clearAsset();
      return;
    }
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (disposed || token !== loadToken) return;
      const bytes = new Uint8Array(buffer);
      const kind = sniffKind(bytes);
      if (!kind) throw new Error("Unrecognized asset format");

      if (kind === "glb" || kind === "gltf") {
        draco.setDecoderPath(config.dracoDecoderPath);
        const resourcePath = src.slice(0, src.lastIndexOf("/") + 1);
        const data = kind === "glb" ? buffer : new TextDecoder().decode(bytes);
        const gltf = await loader.parseAsync(data, resourcePath);
        if (disposed || token !== loadToken) {
          disposeObject(gltf.scene);
          return;
        }
        clearAsset();
        assetSource = { kind: "mesh", scene: gltf.scene };
      } else {
        const blob = new Blob([buffer], {
          type: kind === "svg" ? "image/svg+xml" : ""
        });
        const data = await rasterizeImage(blob);
        if (disposed || token !== loadToken) return;
        clearAsset();
        assetSource = { kind: "image", data };
      }
      buildCloud();
      config.onLoad?.();
    } catch (error) {
      if (disposed || token !== loadToken) return;
      config.onError?.(error);
    }
  }

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;
  const onMotionChange = () => {
    reducedMotion = motionQuery.matches;
    if (reducedMotion) floatGroup.rotation.set(0, 0, 0);
    applyOptions();
  };
  motionQuery.addEventListener("change", onMotionChange);

  const tint = new THREE.Color();

  function applyOptions() {
    renderer.setClearColor(
      new THREE.Color(config.background || "#000000"),
      config.background ? 1 : 0
    );
    controls.enableRotate = config.orbit;
    controls.enableZoom = config.zoom;
    controls.autoRotate = config.autoRotate && !reducedMotion;
    controls.autoRotateSpeed = config.autoRotateSpeed;
    camera.fov = config.fov;
    camera.updateProjectionMatrix();
    floatGroup.position.x = config.xOffset;
    floatGroup.position.y = MODEL_LIFT + config.yOffset;
    fitGroup.scale.setScalar(config.scale);
    material.uniforms.uDrift!.value = reducedMotion ? 0 : Math.max(config.drift, 0);
    material.uniforms.uSize!.value = Math.max(config.size, 0.1);
    material.uniforms.uVariance!.value = Math.min(Math.max(config.sizeVariance, 0), 1);
    material.uniforms.uRefDist!.value = config.cameraDistance;
    if (config.color) {
      tint.set(config.color);
      (material.uniforms.uTint!.value as THREE.Color).copy(tint);
      material.uniforms.uUseTint!.value = 1;
    } else {
      material.uniforms.uUseTint!.value = 0;
    }
  }

  function resize() {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    const pr = getCanvasPixelRatio(canvas, renderer.getContext());
    renderer.setPixelRatio(pr);
    renderer.setSize(width, height, false);
    material.uniforms.uDpr!.value = pr;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const observer = createCanvasResizeObserver(resize);
  observer.observe(canvas);
  resize();
  applyOptions();
  loadAsset();

  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = false;
  let pointerSpeed = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let lastPointerTime = 0;
  let shoveX = 0;
  let shoveY = 0;

  const rectCache = createRectCache(canvas);

  function onPointerMove(event: PointerEvent) {
    const rect = rectCache.current;
    pointerX = event.clientX - rect.left;
    pointerY = event.clientY - rect.top;
    const now = performance.now();
    if (pointerActive && lastPointerTime) {
      const dt = Math.max((now - lastPointerTime) / 1000, 1e-3);
      const dx = pointerX - lastPointerX;
      const dy = pointerY - lastPointerY;
      const speed = Math.hypot(dx, dy) / dt;
      pointerSpeed += (speed - pointerSpeed) * 0.35;
      if (speed > 1) {
        const inv = 1 / Math.max(Math.hypot(dx, dy), 1e-3);
        shoveX += (dx * inv - shoveX) * 0.4;
        shoveY += (dy * inv - shoveY) * 0.4;
      }
    }
    lastPointerX = pointerX;
    lastPointerY = pointerY;
    lastPointerTime = now;
    pointerActive = true;
  }

  function onPointerLeave() {
    pointerActive = false;
    pointerSpeed = 0;
    lastPointerTime = 0;
  }

  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerleave", onPointerLeave, { passive: true });
  canvas.addEventListener("pointercancel", onPointerLeave, { passive: true });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const inverseMatrix = new THREE.Matrix4();
  const localOrigin = new THREE.Vector3();
  const localDir = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camBack = new THREE.Vector3();
  const localShove = new THREE.Vector3();

  function simulate(delta: number) {
    if (!points || !homes || !velocities || particleCount === 0) return;
    const positionAttr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const p = positionAttr.array as Float32Array;
    const h = homes;
    const v = velocities;

    const stiffness = 60 * Math.max(config.spring, 0.05);
    const dampingRate = 3 + 12 * Math.min(Math.max(config.damping, 0), 1);
    const decay = Math.exp(-dampingRate * delta);

    let pushing = false;
    let ox = 0,
      oy = 0,
      oz = 0,
      dx = 0,
      dy = 0,
      dz = 1;
    let localRadius = 0;
    let pushAccel = 0;
    let shove = 0;

    if (pointerActive && !reducedMotion && config.strength > 0) {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      ndc.set((pointerX / width) * 2 - 1, -(pointerY / height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);

      points.updateWorldMatrix(true, false);
      inverseMatrix.copy(points.matrixWorld).invert();
      localOrigin.copy(raycaster.ray.origin).applyMatrix4(inverseMatrix);
      localDir.copy(raycaster.ray.direction).transformDirection(inverseMatrix);

      const worldScale = Math.max(fitGroup.scale.x, 1e-4);
      const worldPerPx =
        (2 *
          camera.position.distanceTo(floatGroup.position) *
          Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
        height;
      localRadius = (Math.max(config.radius, 1) * worldPerPx) / worldScale;
      pushAccel = 26 * config.strength;
      shove = Math.min(pointerSpeed / 900, 2) * 14 * config.strength;
      camera.matrixWorld.extractBasis(camRight, camUp, camBack);
      localShove
        .set(0, 0, 0)
        .addScaledVector(camRight, shoveX)
        .addScaledVector(camUp, -shoveY)
        .transformDirection(inverseMatrix);

      ox = localOrigin.x;
      oy = localOrigin.y;
      oz = localOrigin.z;
      dx = localDir.x;
      dy = localDir.y;
      dz = localDir.z;
      pushing = true;
    }

    const swirl = Math.min(Math.max(config.swirl, 0), 2);
    const r2max = localRadius * localRadius;

    for (let i = 0; i < particleCount; i++) {
      const ix = i * 3;
      const iy = ix + 1;
      const iz = ix + 2;
      let vx = v[ix]!;
      let vy = v[iy]!;
      let vz = v[iz]!;

      if (pushing) {
        const wx = p[ix]! - ox;
        const wy = p[iy]! - oy;
        const wz = p[iz]! - oz;
        const t = Math.max(wx * dx + wy * dy + wz * dz, 0);
        let rx = wx - dx * t;
        let ry = wy - dy * t;
        let rz = wz - dz * t;
        const dist2 = rx * rx + ry * ry + rz * rz;
        if (dist2 < r2max) {
          const dist = Math.sqrt(dist2);
          const inv = 1 / Math.max(dist, 1e-5);
          rx *= inv;
          ry *= inv;
          rz *= inv;
          const fall = 1 - dist / localRadius;
          const f = fall * fall * delta;
          const tx = dy * rz - dz * ry;
          const ty = dz * rx - dx * rz;
          const tz = dx * ry - dy * rx;
          vx += (rx + tx * swirl) * pushAccel * f + localShove.x * shove * f;
          vy += (ry + ty * swirl) * pushAccel * f + localShove.y * shove * f;
          vz += (rz + tz * swirl) * pushAccel * f + localShove.z * shove * f;
        }
      }

      vx += (h[ix]! - p[ix]!) * stiffness * delta;
      vy += (h[iy]! - p[iy]!) * stiffness * delta;
      vz += (h[iz]! - p[iz]!) * stiffness * delta;
      vx *= decay;
      vy *= decay;
      vz *= decay;
      p[ix] = p[ix]! + vx * delta;
      p[iy] = p[iy]! + vy * delta;
      p[iz] = p[iz]! + vz * delta;
      v[ix] = vx;
      v[iy] = vy;
      v[iz] = vz;
    }

    positionAttr.needsUpdate = true;
  }

  let inView = true;
  let loopRunning = false;

  function tick(time: number) {
    if (!inView) {
      lastTime = 0;
      stopLoop();
      return;
    }
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 1 / 30) : 0;
    lastTime = time;
    controls.update();

    if (!reducedMotion) {
      elapsed += delta * config.floatSpeed;
      floatGroup.rotation.x = (Math.cos(elapsed / 4) / 8) * config.rotationIntensity;
      floatGroup.rotation.y = (Math.sin(elapsed / 4) / 8) * config.rotationIntensity;
      floatGroup.rotation.z = (Math.sin(elapsed / 4) / 20) * config.rotationIntensity;
      floatGroup.position.y =
        MODEL_LIFT + config.yOffset + (Math.sin(elapsed / 1.5) / 10) * config.floatIntensity;
      material.uniforms.uTime!.value += delta;
    }

    pointerSpeed *= Math.exp(-3 * delta);

    if (delta > 0) simulate(delta);
    renderer.render(scene, camera);

    // 本仓本地改动（上游无此段）：几何体是**建好之后**才被模拟跑成 NaN 的
    // （建云时那份是有限的，所以 buildCloud 里的静态检查放行了它），
    // 症状是 three.js 每帧报 computeBoundingSphere NaN、画布全空，
    // 而引擎不抛错 → 宿主那张静态品牌图的回退永远等不到 onError。
    // 这里在第一次真正跑过模拟之后验一次，坏了就停手并报给宿主。
    if (!nanReported && points && delta > 0) {
      const attr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
      if (!hasFiniteSample(attr.array as Float32Array)) {
        nanReported = true;
        stopLoop();
        config.onError?.(new Error("粒子几何体在模拟后出现 NaN，无法渲染"));
      }
    }
  }

  function startLoop() {
    if (loopRunning || !inView || disposed) return;
    loopRunning = true;
    renderer.setAnimationLoop(tick);
  }

  function stopLoop() {
    if (!loopRunning) return;
    loopRunning = false;
    renderer.setAnimationLoop(null);
  }

  const viewObserver =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          inView = entries[entries.length - 1]?.isIntersecting ?? true;
          if (inView) {
            startLoop();
          } else {
            stopLoop();
          }
        })
      : null;
  viewObserver?.observe(canvas);

  let lastTime = 0;
  let elapsed = Math.random() * 100;
  let nanReported = false;

  startLoop();

  return {
    setOptions(next: ParticleObjectOptions) {
      let changed = false;
      for (const [key, value] of Object.entries(next)) {
        if (typeof value === "function") continue;
        if (config[key as keyof ParticleObjectOptions] !== value) {
          changed = true;
          break;
        }
      }
      // 本仓本地改动：两处都用 mergeConfig 而不是 Object.assign，理由见它的注释。
      // 这里的 next 来自 ParticleObject.vue 的 watch（`{ ...props }`），带着同一批 undefined 键——
      // 只修初始合并而不修这里，等于开屏正常、任何一次 props 变更又被打回 NaN。
      if (!changed) {
        mergeConfig(config, next);
        return;
      }

      const previousDistance = config.cameraDistance;
      const previousCount = config.count;
      mergeConfig(config, next);
      if (config.cameraDistance !== previousDistance) {
        camera.position.copy(CAMERA_DIR).multiplyScalar(config.cameraDistance);
      }
      applyOptions();
      if (config.count !== previousCount) buildCloud();
      loadAsset();
      startLoop();
    },
    resize,
    destroy() {
      disposed = true;
      rectCache.destroy();
      loadToken += 1;
      stopLoop();
      observer.disconnect();
      viewObserver?.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointercancel", onPointerLeave);
      controls.dispose();
      clearAsset();
      material.dispose();
      draco.dispose();
      renderer.dispose();
    }
  };
}

// 薄壳组件从这里一次拿全类型（上游 SFC 双 script 段共享作用域，拆分后由这里汇出）。
export type {
  ParticleObjectElements,
  ParticleObjectInstance,
  ParticleObjectOptions
} from "./particle-object-types";
