/**
 * 上课提醒铃声（Web 模拟；原生 iOS 会换成系统闹钟音 + UINotificationFeedbackGenerator）。
 */
export function playAlarmSound() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [880, 0, 880, 0, 880, 0, 1174, 880];
    notes.forEach((freq, i) => {
      if (!freq) return;
      const t0 = ctx.currentTime + i * 0.17;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.16);
    });
  } catch {
    /* 忽略 */
  }
}

/**
 * 通知提示音（**兜底**）。
 *
 * 什么时候会用到它：系统横幅没能排程成功时 —— 用户拒绝了通知权限、纯 Web 预览、
 * 或处于专注模式被系统丢掉。那种情况下如果不补一个声音，
 * 用户只会看到一条**静默**的横幅（"为什么没提示音"）。
 *
 * 音色刻意做得接近 iOS 的 Tri-tone（两个短促的下行音），但**不打包苹果的音频文件**
 * （有版权问题）：原生端真正响的是 `UNNotificationSound.default`（即 Tri-tone），
 * 这里只是 Web/降级场景的替代。
 */
export function playAlertTone(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // Tri-tone 风格：G5 → E5，各 150ms，中间 90ms 间隔
    const notes: Array<[number, number]> = [
      [784, 0],
      [659, 0.24],
    ];
    for (const [freq, offset] of notes) {
      const t0 = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    }
  } catch {
    /* 忽略（无音频权限 / 静音开关等） */
  }
}
