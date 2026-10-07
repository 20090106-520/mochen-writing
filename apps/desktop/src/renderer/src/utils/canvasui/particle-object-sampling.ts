// 源码取自 canvas-ui（github.com/DavidHDev/canvas-ui）的 ParticleObject，MIT + Commons Clause。
// 为过本仓 800 行单文件预算拆为多模块；除 import/导出与注释外逻辑零改动。上游：canvasui.dev。
// 网格/图像采样：把模型与图片重建成粒子云样本
import * as THREE from "three";
import type { CloudSample, TriangleBucket } from "./particle-object-types";
import { ALBEDO_SIZE, RASTER_SIZE } from "./particle-object-types";

export function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function readAlbedo(map: THREE.Texture | null): ImageData | null {
  const image = map?.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined;
  if (!image || !image.width || !image.height) return null;
  try {
    const ratio = Math.min(1, ALBEDO_SIZE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * ratio));
    const height = Math.max(1, Math.round(image.height * ratio));
    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  }
}

function sampleAlbedo(data: ImageData, u: number, v: number, flipY: boolean, out: THREE.Color) {
  const x = Math.min(data.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * data.width)));
  const vWrapped = v - Math.floor(v);
  const y = Math.min(
    data.height - 1,
    Math.max(0, Math.floor((flipY ? 1 - vWrapped : vWrapped) * data.height))
  );
  const i = (y * data.width + x) * 4;
  out.setRGB(
    data.data[i]! / 255,
    data.data[i + 1]! / 255,
    data.data[i + 2]! / 255,
    THREE.SRGBColorSpace
  );
}

export function sampleMesh(scene: THREE.Group, count: number): CloudSample {
  scene.updateMatrixWorld(true);
  const buckets: TriangleBucket[] = [];

  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const index = geometry.getIndex();
    const triangleCount = Math.floor((index ? index.count : positions.count) / 3);
    if (triangleCount === 0) return;
    const material = (
      Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    ) as THREE.MeshStandardMaterial;
    buckets.push({
      positions,
      normals: geometry.getAttribute("normal") ?? null,
      uvs: geometry.getAttribute("uv") ?? null,
      vertexColors: geometry.getAttribute("color") ?? null,
      index,
      matrix: mesh.matrixWorld.clone(),
      normalMatrix: new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),
      baseColor: material?.color?.clone() ?? new THREE.Color(1, 1, 1),
      albedo: readAlbedo(material?.map ?? null),
      albedoFlipY: material?.map?.flipY ?? false,
      triangleCount
    });
  });

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const shades = new Float32Array(count);
  if (buckets.length === 0) return { positions, colors, shades };

  const areas: number[] = [];
  const owners: { bucket: TriangleBucket; tri: number }[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let totalArea = 0;

  const vertexIndex = (bucket: TriangleBucket, tri: number, corner: number) =>
    bucket.index ? bucket.index.getX(tri * 3 + corner) : tri * 3 + corner;

  for (const bucket of buckets) {
    for (let tri = 0; tri < bucket.triangleCount; tri++) {
      const i0 = vertexIndex(bucket, tri, 0);
      const i1 = vertexIndex(bucket, tri, 1);
      const i2 = vertexIndex(bucket, tri, 2);
      a.fromBufferAttribute(bucket.positions, i0).applyMatrix4(bucket.matrix);
      b.fromBufferAttribute(bucket.positions, i1).applyMatrix4(bucket.matrix);
      c.fromBufferAttribute(bucket.positions, i2).applyMatrix4(bucket.matrix);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      totalArea += ab.cross(ac).length() * 0.5;
      areas.push(totalArea);
      owners.push({ bucket, tri });
    }
  }
  if (totalArea <= 0) return { positions, colors, shades };

  const normal = new THREE.Vector3();
  const albedo = new THREE.Color();
  const texel = new THREE.Color();
  const final = new THREE.Color();
  const light = new THREE.Vector3(0.5, 0.8, 0.6).normalize();

  for (let i = 0; i < count; i++) {
    const pick = Math.random() * totalArea;
    let lo = 0;
    let hi = areas.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (areas[mid]! < pick) lo = mid + 1;
      else hi = mid;
    }
    const { bucket, tri } = owners[lo]!;
    const i0 = vertexIndex(bucket, tri, 0);
    const i1 = vertexIndex(bucket, tri, 1);
    const i2 = vertexIndex(bucket, tri, 2);

    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;

    a.fromBufferAttribute(bucket.positions, i0);
    b.fromBufferAttribute(bucket.positions, i1);
    c.fromBufferAttribute(bucket.positions, i2);
    a.multiplyScalar(w).addScaledVector(b, u).addScaledVector(c, v);
    a.applyMatrix4(bucket.matrix);
    positions[i * 3] = a.x;
    positions[i * 3 + 1] = a.y;
    positions[i * 3 + 2] = a.z;

    albedo.copy(bucket.baseColor);
    if (bucket.albedo && bucket.uvs) {
      const tu = bucket.uvs.getX(i0) * w + bucket.uvs.getX(i1) * u + bucket.uvs.getX(i2) * v;
      const tv = bucket.uvs.getY(i0) * w + bucket.uvs.getY(i1) * u + bucket.uvs.getY(i2) * v;
      sampleAlbedo(bucket.albedo, tu, tv, bucket.albedoFlipY, texel);
      albedo.multiply(texel);
    }
    if (bucket.vertexColors) {
      albedo.multiplyScalar(
        (bucket.vertexColors.getX(i0) * w +
          bucket.vertexColors.getX(i1) * u +
          bucket.vertexColors.getX(i2) * v +
          bucket.vertexColors.getY(i0) * w +
          bucket.vertexColors.getY(i1) * u +
          bucket.vertexColors.getY(i2) * v +
          bucket.vertexColors.getZ(i0) * w +
          bucket.vertexColors.getZ(i1) * u +
          bucket.vertexColors.getZ(i2) * v) /
          3
      );
    }

    let shade = 0.85;
    if (bucket.normals) {
      normal.set(
        bucket.normals.getX(i0) * w + bucket.normals.getX(i1) * u + bucket.normals.getX(i2) * v,
        bucket.normals.getY(i0) * w + bucket.normals.getY(i1) * u + bucket.normals.getY(i2) * v,
        bucket.normals.getZ(i0) * w + bucket.normals.getZ(i1) * u + bucket.normals.getZ(i2) * v
      );
      normal.applyMatrix3(bucket.normalMatrix).normalize();
      shade = 0.45 + 0.65 * Math.max(normal.dot(light) * 0.5 + 0.5, 0);
    }

    final.copy(albedo).multiplyScalar(shade);
    final.convertLinearToSRGB();
    colors[i * 3] = Math.min(final.r, 1);
    colors[i * 3 + 1] = Math.min(final.g, 1);
    colors[i * 3 + 2] = Math.min(final.b, 1);
    shades[i] = Math.min(Math.pow(shade, 1 / 2.2), 1);
  }

  return { positions, colors, shades };
}

export function sampleImage(data: ImageData, count: number): CloudSample {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const shades = new Float32Array(count);

  const pixels: number[] = [];
  const weights: number[] = [];
  let totalWeight = 0;
  for (let i = 0; i < data.width * data.height; i++) {
    const alpha = data.data[i * 4 + 3]!;
    if (alpha < 10) continue;
    totalWeight += alpha;
    pixels.push(i);
    weights.push(totalWeight);
  }
  if (pixels.length === 0) return { positions, colors, shades };

  const longest = Math.max(data.width, data.height);
  for (let i = 0; i < count; i++) {
    const pick = Math.random() * totalWeight;
    let lo = 0;
    let hi = weights.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (weights[mid]! < pick) lo = mid + 1;
      else hi = mid;
    }
    const p = pixels[lo]!;
    const px = p % data.width;
    const py = Math.floor(p / data.width);
    positions[i * 3] = (px + Math.random() - data.width / 2) / longest;
    positions[i * 3 + 1] = -(py + Math.random() - data.height / 2) / longest;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    colors[i * 3] = data.data[p * 4]! / 255;
    colors[i * 3 + 1] = data.data[p * 4 + 1]! / 255;
    colors[i * 3 + 2] = data.data[p * 4 + 2]! / 255;
    shades[i] = 1;
  }

  return { positions, colors, shades };
}

export function normalizeCloud(sample: CloudSample) {
  const p = sample.positions;
  if (p.length === 0) return;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]!);
    maxX = Math.max(maxX, p[i]!);
    minY = Math.min(minY, p[i + 1]!);
    maxY = Math.max(maxY, p[i + 1]!);
    minZ = Math.min(minZ, p[i + 2]!);
    maxZ = Math.max(maxZ, p[i + 2]!);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const inv = 1 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-4);
  for (let i = 0; i < p.length; i += 3) {
    p[i] = (p[i]! - cx) * inv;
    p[i + 1] = (p[i + 1]! - cy) * inv;
    p[i + 2] = (p[i + 2]! - cz) * inv;
  }
}

export function sniffKind(bytes: Uint8Array): "glb" | "gltf" | "svg" | "bitmap" | null {
  if (bytes.length < 4) return null;
  const ascii = (start: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      if (bytes[start + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  };
  if (ascii(0, "glTF")) return "glb";
  if (bytes[0] === 0x89 && ascii(1, "PNG")) return "bitmap";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "bitmap";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "bitmap";
  if (ascii(0, "GIF8")) return "bitmap";
  let head: string;
  try {
    head = new TextDecoder()
      .decode(bytes.subarray(0, 2048))
      .replace(/^\uFEFF/, "")
      .trimStart();
  } catch {
    return null;
  }
  if (head.startsWith("{")) return "gltf";
  if (head.startsWith("<")) {
    return head.includes("<svg") ? "svg" : null;
  }
  return null;
}

export function rasterizeImage(blob: Blob): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const width = image.naturalWidth || 1024;
      const height = image.naturalHeight || 1024;
      const ratio = Math.min(1, RASTER_SIZE / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("2d context unavailable"));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode the image"));
    };
    image.src = url;
  });
}
