// 源码取自 canvas-ui（github.com/DavidHDev/canvas-ui）的 ParticleObject，MIT + Commons Clause。
// 为过本仓 800 行单文件预算拆为多模块；除 import/导出与注释外逻辑零改动。上游：canvasui.dev。
// 选项/实例类型、默认值、着色器与采样常量
import * as THREE from "three";

export interface ParticleObjectOptions {
  /** URL of the asset to display: GLB/glTF, SVG, PNG, JPEG, WebP, or GIF. Object URLs from a file input work too. The format is sniffed from the bytes, not the extension. */
  src?: string;
  /** Number of particles the asset is rebuilt from. */
  count?: number;
  /** Particle size in CSS pixels at the model's distance. */
  size?: number;
  /** Random per-particle size variation (0 to 1). */
  sizeVariance?: number;
  /** Override color as any CSS color. Empty string keeps the asset's own colors. */
  color?: string;
  /** Radius of the cursor's push field in CSS pixels. */
  radius?: number;
  /** How hard the cursor pushes particles away. */
  strength?: number;
  /** Tangential curl of the push (0 to 2). Particles spiral around the cursor instead of only fleeing it. */
  swirl?: number;
  /** How quickly displaced particles spring back home. */
  spring?: number;
  /** Velocity damping (0 to 1). Lower values keep particles wobbling longer. */
  damping?: number;
  /** Idle shimmer of the resting particles (0 disables). */
  drift?: number;
  /** Background color behind the particles. Empty string keeps the canvas transparent. */
  background?: string;
  /** Size of the longest side of the asset in scene units. The camera sits about 4 units away. */
  scale?: number;
  /** Horizontal offset of the asset in scene units. */
  xOffset?: number;
  /** Vertical offset of the asset in scene units. */
  yOffset?: number;
  /** Strength of the floating bob animation (0 disables). */
  floatIntensity?: number;
  /** Strength of the idle rocking rotation (0 disables). */
  rotationIntensity?: number;
  /** Speed of the float and rocking animation. */
  floatSpeed?: number;
  /** Let the user orbit the camera by dragging. */
  orbit?: boolean;
  /** Let the user zoom with the scroll wheel or pinch. */
  zoom?: boolean;
  /** Spin the camera around the asset turntable-style. */
  autoRotate?: boolean;
  /** Turntable speed when autoRotate is on. */
  autoRotateSpeed?: number;
  /** Camera field of view in degrees. */
  fov?: number;
  /** Camera distance from the center of the asset. */
  cameraDistance?: number;
  /** Base URL of the Draco decoder, fetched only when a model needs it. */
  dracoDecoderPath?: string;
  /** Called after an asset finishes loading. */
  onLoad?: (() => void) | null;
  /** Called when an asset fails to load. */
  onError?: ((error: unknown) => void) | null;
}

export interface ParticleObjectElements {
  /** Canvas the scene renders to. */
  canvas: HTMLCanvasElement;
}

export interface ParticleObjectInstance {
  /** Update options live. Changing src loads the new asset. */
  setOptions: (options: ParticleObjectOptions) => void;
  /** Re-read canvas size. Call when the element is resized. */
  resize: () => void;
  /** Stop the loop and release all GPU resources. */
  destroy: () => void;
}

export const DEFAULTS: Required<ParticleObjectOptions> = {
  src: "",
  count: 14000,
  size: 2.4,
  sizeVariance: 0.6,
  color: "",
  radius: 110,
  strength: 1,
  swirl: 0.6,
  spring: 1,
  damping: 0.35,
  drift: 0.6,
  background: "",
  scale: 3,
  xOffset: 0,
  yOffset: 0,
  floatIntensity: 2,
  rotationIntensity: 1,
  floatSpeed: 2,
  orbit: true,
  zoom: false,
  autoRotate: false,
  autoRotateSpeed: 2,
  fov: 65,
  cameraDistance: 4.2,
  dracoDecoderPath: "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
  onLoad: null,
  onError: null
};

export const CAMERA_DIR = new THREE.Vector3(0, -1, 4).normalize();
export const MODEL_LIFT = 0.3;
export const RASTER_SIZE = 420;
export const ALBEDO_SIZE = 128;

export const VERT = `
in vec3 aColor;
in float aShade;
in float aSeed;
out vec3 vColor;
uniform float uTime;
uniform float uDrift;
uniform float uSize;
uniform float uVariance;
uniform float uDpr;
uniform float uRefDist;
uniform vec3 uTint;
uniform float uUseTint;

void main() {
  vec3 p = position;

  float t = uTime + aSeed * 39.0;
  p += uDrift * 0.005 * vec3(
    sin(t * 1.7 + aSeed * 61.0),
    cos(t * 1.3 + aSeed * 23.0),
    sin(t * 2.3 + aSeed * 47.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float jitter = 1.0 + uVariance * (fract(aSeed * 7.13) - 0.5) * 1.4;
  gl_PointSize = clamp(
    uSize * uDpr * jitter * (uRefDist / max(-mv.z, 0.1)), 0.0, 64.0);
  vColor = mix(aColor, uTint * aShade, uUseTint);
  gl_Position = projectionMatrix * mv;
}`;

export const FRAG = `
precision highp float;
in vec3 vColor;
out vec4 outColor;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  float alpha = 1.0 - smoothstep(0.16, 0.25, r2);
  if (alpha < 0.08) discard;
  outColor = vec4(vColor, alpha);
}`;

export interface CloudSample {
  positions: Float32Array;
  colors: Float32Array;
  shades: Float32Array;
}

export interface MeshSource {
  kind: "mesh";
  scene: THREE.Group;
}

export interface ImageSource {
  kind: "image";
  data: ImageData;
}

export type AssetSource = MeshSource | ImageSource;

export interface TriangleBucket {
  positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  normals: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null;
  uvs: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null;
  vertexColors: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null;
  index: THREE.BufferAttribute | null;
  matrix: THREE.Matrix4;
  normalMatrix: THREE.Matrix3;
  baseColor: THREE.Color;
  albedo: ImageData | null;
  albedoFlipY: boolean;
  triangleCount: number;
}
