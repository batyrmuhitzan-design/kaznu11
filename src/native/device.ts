/**
 * 设备/地理信息（@capacitor/geolocation）+ 当前时区。
 * App 启动时调用一次；结果只做展示与后续“校园位置感知”的预留，
 * 失败/拒绝授权不阻塞任何功能。
 */
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export interface DeviceGeoInfo {
  available: boolean;
  coords?: { latitude: number; longitude: number; accuracy?: number };
  timezone?: string;
  campus?: boolean;
}

const CAMPUS_CENTER = { lat: 43.222, lng: 76.9255 }; // Al-Farabi KazNU 主校区（约）
const CAMPUS_RADIUS_KM = 3;

export const GEO_STORAGE_KEY = "kaznu:geo";

export async function captureDeviceContext(): Promise<DeviceGeoInfo> {
  const base: DeviceGeoInfo = {
    available: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Local",
  };

  if (!Capacitor.isNativePlatform()) {
    // Web 预览：允许浏览器定位（可选），拿不到也不报错
    try {
      const pos = await new Promise<{ latitude: number; longitude: number; accuracy: number }>((resolve, reject) => {
        if (!("geolocation" in navigator)) return reject(new Error("unsupported"));
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
          reject,
          { timeout: 4000, maximumAge: 600_000 },
        );
      });
      const info = { ...base, available: true, coords: pos, campus: inCampus(pos.latitude, pos.longitude) };
      persistGeo(info);
      return info;
    } catch {
      return base;
    }
  }

  try {
    const status = await Geolocation.checkPermissions();
    if (status.location !== "granted") {
      const req = await Geolocation.requestPermissions();
      if (req.location !== "granted") return base;
    }
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 6000 });
    const info: DeviceGeoInfo = {
      available: true,
      coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy },
      timezone: base.timezone,
      campus: inCampus(pos.coords.latitude, pos.coords.longitude),
    };
    persistGeo(info);
    return info;
  } catch {
    return base;
  }
}

function inCampus(lat: number, lng: number): boolean {
  const R = 6371;
  const dLat = ((lat - CAMPUS_CENTER.lat) * Math.PI) / 180;
  const dLng = ((lng - CAMPUS_CENTER.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((CAMPUS_CENTER.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(a));
  return dist <= CAMPUS_RADIUS_KM;
}

function persistGeo(info: DeviceGeoInfo) {
  try {
    localStorage.setItem(GEO_STORAGE_KEY, JSON.stringify(info));
  } catch {
    /* ignore */
  }
}
