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
