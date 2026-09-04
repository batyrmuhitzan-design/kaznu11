import { useEffect, useRef, useState, type CSSProperties } from "react";

export interface CountUpOptions {
  duration?: number;
  delay?: number;
}

/**
 * 线性(缓出)数字动画：组件挂载时从 0 平滑涨到目标值。
 * 之后如果 target 变化会直接跳到新目标（避免每次秒级更新都重播）。
 */
export function useCountUp(target: number, options: CountUpOptions = {}) {
  const { duration = 1500, delay = 0 } = options;
  const [value, setValue] = useState(0);
  const animatedRef = useRef(false);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (animatedRef.current) {
      setValue(targetRef.current);
      return;
    }
    animatedRef.current = true;
    let raf = 0;
    const start = performance.now() + Math.max(0, delay);
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / duration));
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(targetRef.current * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [delay, duration]);

  return value;
}

/** 带缓出动画的数字，默认等宽数字避免动画/更新时左右抖动。 */
export function AnimatedNumber({
  value,
  decimals = 0,
  duration = 1500,
  delay = 0,
  className,
  style,
  suffix = "",
}: {
  value: number;
  decimals?: number;
  duration?: number;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  suffix?: string;
}) {
  const animated = useCountUp(value, { duration, delay });
  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {animated.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** 线性加载条：宽度从 0 缓动到 value%（value 取 0–100）。 */
export function AnimatedBar({
  value,
  duration = 1500,
  delay = 0,
  className,
  style,
}: {
  value: number;
  duration?: number;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const w = useCountUp(value, { duration, delay });
  return (
    <div className={className} style={{ width: `${Math.min(100, Math.max(0, w))}%`, ...style }} />
  );
}
