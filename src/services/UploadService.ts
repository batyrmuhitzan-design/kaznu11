/**
 * 图片上传 —— 本地相册选图 → canvas 压缩 → 服务端存储 → 可渲染 URL。
 *
 * 为什么要先在客户端压一次
 * ------------------------
 * iPhone 相册原图动辄 3-8 MB / 4032×3024，校园网/移动网络下直接上传：
 *  1) 慢到用户以为卡死；
 *  2) 服务器 8 MB 上限很容易被超（413）；
 *  3) 帖子/私信里显示的宽度根本用不到 4000px。
 * 压到长边 1600px + JPEG 0.82 后一般 250-600 KB，肉眼几乎无差。
 *
 * HEIC 处理：iOS 相册的 HEIC 在 canvas.drawImage 时会被系统自动解码并转成 JPEG，
 * 所以不需要额外引入解码库；服务端也是**按文件头**校验类型（不信任 content-type），
 * 这里统一输出 JPEG 正好命中白名单。
 *
 * 不做"客户端直传云存储"：那需要把云存储密钥下发到客户端（泄露风险高），
 * 且没有服务端校验与统一命名。迁移到 Supabase / Azure 只需改后端 STORAGE_BACKEND。
 */
import { API_BASE_URL, blockInsecureRequest } from "../utils/config";
import { rmpEnsureToken } from "./ProfReviewsService";

const UPLOAD_URL = `${API_BASE_URL}/api/v1/uploads/image`;

/** 一次最多几张（与后端 MAX_FILES_PER_REQUEST 一致） */
export const MAX_UPLOAD_FILES = 6;
/** 压缩后长边上限 */
const MAX_EDGE = 1600;
/** JPEG 质量：0.82 是"再低开始能看出糊"的拐点 */
const JPEG_QUALITY = 0.82;

export interface UploadedImage {
  url: string;
  key: string;
  size: number;
  content_type: string;
}

export interface UploadOutcome {
  images: UploadedImage[];
  /** 失败的文件名（超限 / 类型不支持 / 网络失败），UI 用来提示 */
  failed: string[];
}

/** 只收图片（相册里可能有视频/实况照片，直接过滤掉，别让用户白等上传）。 */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name);
}

/** 把 File 解码成可绘制的位图（优先 createImageBitmap，老 WebView 回落 <img>）。 */
async function decode(file: File): Promise<{ width: number; height: number; draw: CanvasImageSource } | null> {
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height, draw: bitmap };
    }
  } catch {
    /* 回落 <img> */
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, draw: img });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * 压缩一张图。
 *
 * @returns 压缩后的 JPEG Blob（解码失败返回 null，调用方按失败处理）
 */
export async function compressImage(file: File): Promise<Blob | null> {
  const source = await decode(file);
  if (!source) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // 白底：PNG 透明区域转 JPEG 会变黑，先铺白
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source.draw, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((out) => resolve(out), "image/jpeg", JPEG_QUALITY);
  });
  return blob;
}

/**
 * 上传 1-6 张图，返回可直接渲染的绝对 URL。
 *
 * 失败策略：**部分成功也算成功** —— 一张超限不该让整条帖子发不出去，
 * 所以失败的进 ``failed`` 让 UI 提示，成功的照常放进正文。
 */
export async function uploadImages(files: File[]): Promise<UploadOutcome> {
  const picked = files.filter(isImageFile).slice(0, MAX_UPLOAD_FILES);
  const outcome: UploadOutcome = { images: [], failed: [] };
  if (picked.length === 0) return outcome;

  const token = await rmpEnsureToken();
  if (!token) {
    outcome.failed = picked.map((file) => file.name);
    return outcome;
  }
  if (blockInsecureRequest(UPLOAD_URL)) {
    outcome.failed = picked.map((file) => file.name);
    return outcome;
  }

  const form = new FormData();
  for (const file of picked) {
    const compressed = await compressImage(file);
    if (!compressed) {
      outcome.failed.push(file.name);
      continue;
    }
    // 统一命名：服务端只认魔数，文件名仅用于展示/调试
    form.append("files", compressed, `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`);
  }
  if (![...form.keys()].length) return outcome;

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30_000); // 图片大，给足 30s
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      // ⚠️ 千万不要手写 Content-Type：必须让浏览器带上 multipart boundary
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (!res.ok) {
      outcome.failed = [...outcome.failed, ...picked.map((file) => file.name)];
      return outcome;
    }
    const data = (await res.json()) as UploadedImage[];
    outcome.images = Array.isArray(data) ? data : [];
    return outcome;
  } catch {
    outcome.failed = [...outcome.failed, ...picked.map((file) => file.name)];
    return outcome;
  }
}