import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const PDF_FILE_NAME = "KazNU_Helper_Legal_Notice_3Lang.pdf";

/**
 * PDF 的资源地址 —— **必须相对当前文档基址解析**，不能写 `origin + "/文件名"`。
 *
 * 为什么不写死绝对路径（踩过两个坑）：
 *  - iOS（Capacitor）：文档基址是 `capacitor://localhost/` → 解析成
 *    `capacitor://localhost/KazNU_...pdf`（正确）；
 *  - 网站预览：站点挂在 **子路径** `https://1losion.me/app/` 下，硬拼 origin 会得到
 *    `https://1losion.me/KazNU_...pdf` → **404**（实测：`/app/` 下 200、根部 404），
 *    这就是"登录页 PDF 点不开"的根因之一。
 * 相对 baseURI 解析对两种部署都成立，且以后换域名/子路径都不用改代码。
 */
function assetUrl(): string {
  try {
    return new URL(PDF_FILE_NAME, document.baseURI).href;
  } catch {
    return `${window.location.origin}/${PDF_FILE_NAME}`;
  }
}

/** 线上绝对地址：仅在"本地文件打开失败"时作为兜底（能联网就有 PDF 看）。 */
const PUBLIC_PDF_URL = `https://1losion.me/app/${PDF_FILE_NAME}`;

/** Uint8Array → base64（按块拼接，避免大文件超栈） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 系统级打开三语法律条款 PDF（绝不使用嵌套 iframe）。
 *
 * @returns 是否已成功唤起（调用方据此决定"是否算看过条款"）
 *
 * 三条路径：
 *  1. **iOS 真机**：WebView 的 origin 是 `capacitor://localhost`，SFSafariViewController
 *     打不开这个 scheme → 先把 PDF 落到 App Cache 的真实文件，再用系统 Share Sheet
 *     预览（可继续"存储到文件 / 打印 / 发送"）。
 *  2. **原生但 Share 不可用**（模拟器 / 受管设备）→ SFSafariViewController 打开**线上**
 *     绝对地址（`PUBLIC_PDF_URL`），保证一定看得到。
 *  3. **浏览器**：新窗口打开；弹窗被拦截则直接同窗口导航（用户仍能看到 PDF）。
 *
 * ⚠️ Capacitor Share 的两个字段语义完全不同（这里是"点了没反应"的根因）：
 *   - `files: [fileUri]` → iOS 用 `UIActivityViewController` **分享这个文件**（正确）；
 *   - `url: fileUri`     → 被当成"分享一个链接"，本地 `file://` 会被静默忽略。
 */
export async function openLegalPdf(): Promise<boolean> {
  const url = assetUrl();
  const isHttp = /^https?:$/.test(window.location.protocol);

  if (Capacitor.isNativePlatform() && !isHttp) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`PDF fetch ${response.status}`);
      const base64 = bytesToBase64(new Uint8Array(await response.arrayBuffer()));

      const saved = await Filesystem.writeFile({
        path: PDF_FILE_NAME,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      });

      try {
        await Share.share({
          files: [saved.uri],
          dialogTitle: "KazNU Helper",
          title: "KazNU Helper · Legal Notice · v1.2.2",
          text: "KazNU Helper — Legal Information · Privacy · Terms of Use (KK/EN/RU)",
        });
        return true;
      } catch (shareError) {
        // Share Sheet 起不来 → 退到 SFSafariViewController 打开线上地址
        console.warn("[legalPdf] Share sheet unavailable, opening public URL", shareError);
        await Browser.open({ url: PUBLIC_PDF_URL });
        return true;
      }
    } catch (error) {
      console.warn("[legalPdf] 本地文件路径失败，改用线上地址", error);
      try {
        await Browser.open({ url: PUBLIC_PDF_URL });
        return true;
      } catch (browserError) {
        console.warn("[legalPdf] Capacitor Browser 不可用", browserError);
      }
    }
  }

  // 浏览器 / 网站预览
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    // 弹窗被拦截（iOS 上很常见）：同窗口导航同样能看到 PDF
    window.location.assign(url);
  }
  return true;
}

/** 供自检/调试：当前解析出的 PDF 地址 */
export function legalPdfUrl(): string {
  return typeof document === "undefined" ? PUBLIC_PDF_URL : assetUrl();
}

