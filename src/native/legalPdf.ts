import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const PDF_REL = "/KazNU_Helper_Legal_Notice_3Lang.pdf";
const PDF_FILE_NAME = "KazNU_Helper_Legal_Notice_3Lang.pdf";

function assetUrl(): string {
  return `${window.location.origin}${PDF_REL}`;
}

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
 * 系统级打开三语法律条款 PDF（绝不使用嵌套 iframe）：
 * 1. iOS 真机 WebView 的 origin 是 capacitor://localhost，SFSafariViewController
 *    无法访问该 scheme → 先把 PDF 落到 App Cache 的真实文件，再用系统
 *    Share/Quick Look 全屏预览完整文档（可继续用“用‘文件’打开”等系统能力）。
 * 2. http(s)（开发预览）→ Capacitor Browser（SFSafariViewController）原生打开。
 * 3. 浏览器 → 新窗口直接打开同源 PDF（WebKit 内建渲染，无 margin 偏移）。
 */
export async function openLegalPdf(): Promise<void> {
  const url = assetUrl();
  const isHttp = /^https?:$/.test(window.location.protocol);

  try {
    if (Capacitor.isNativePlatform() && !isHttp) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`PDF fetch ${response.status}`);
      const base64 = bytesToBase64(new Uint8Array(await response.arrayBuffer()));

      await Filesystem.writeFile({
        path: PDF_FILE_NAME,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      });
      const entry = await Filesystem.getUri({ path: PDF_FILE_NAME, directory: Directory.Cache });

      await Share.share({
        title: "KazNU Helper · Legal Notice · v1.2.2",
        text: "KazNU Helper — Legal Information · Privacy · Terms of Use (KK/EN/RU)",
        url: entry.uri,
      });
      return;
    }
  } catch (error) {
    console.warn("System QuickLook/Share preview unavailable, falling back to Browser", error);
  }

  try {
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url });
      return;
    }
  } catch (error) {
    console.warn("Capacitor Browser unavailable, falling back to window.open", error);
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
