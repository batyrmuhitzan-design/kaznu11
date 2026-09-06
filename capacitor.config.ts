import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kaznu.helper',
  appName: 'KazNU Helper',
  webDir: 'dist',
  ios: {
    // 沉浸式 edge-to-edge：WebView 内容由 CSS env(safe-area-inset-*) 自行避让，
    // 因此关闭 UIScrollView 自动安全区内边距，避免与 CSS env() 双重偏移。
    contentInset: 'never',
  },
  plugins: {
    StatusBar: {
      // 状态栏悬浮在 WebView 上方（沉浸式）。页面顶部已由 .app-root 的
      // padding-top: env(safe-area-inset-top) 让出安全区，两者不会重叠。
      overlaysWebView: true,
      // 初始跟随 App 默认深色背景 → 用 DARK（原生 lightContent = 浅色文字）。
      // 深浅主题切换时由 src/native/statusBar.ts 在运行时同步成 LIGHT/DARK。
      style: 'DARK',
      backgroundColor: '#00000000',
    },
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#000000',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
