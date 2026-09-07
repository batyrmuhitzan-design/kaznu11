// 在 npm install / npm ci 后运行：把 Capacitor LocalNotifications 的 sound 处理
// 打一个补丁 —— 当 TS 传 `sound: "system-default"` 时原生直接使用
// `UNNotificationSound.default`（苹果经典 Tri-tone 通知声），而不是查找同名音频文件。
const fs = require("fs");
const path = require("path");

const pluginFile = path.join(
  __dirname,
  "..",
  "node_modules",
  "@capacitor",
  "local-notifications",
  "ios",
  "Sources",
  "LocalNotificationsPlugin",
  "LocalNotificationsPlugin.swift",
);

if (!fs.existsSync(pluginFile)) {
  console.warn("LocalNotifications iOS 源文件不存在，跳过补丁（可能仅 Web 环境）。");
  process.exit(0);
}

let source = fs.readFileSync(pluginFile, "utf8");
const sentinel = '"system-default"';

if (source.includes(sentinel)) {
  console.log("Capacitor system-default sound patch: already applied");
  process.exit(0);
}

const needle = "content.sound = resolveSound(sound)";
if (!source.includes(needle)) {
  console.error("未找到预期代码行，请检查 @capacitor/local-notifications 版本。");
  process.exit(1);
}

source = source.replace(
  needle,
  'content.sound = (sound == "system-default") ? .default : resolveSound(sound)',
);
fs.writeFileSync(pluginFile, source);
console.log("Capacitor system-default sound patch: applied (UNNotificationSound.default)");
