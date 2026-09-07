import { useRef, type ReactNode } from "react";
import { hapticTap } from "../utils/haptics";

/**
 * iOS 风格「从屏幕左缘右滑返回」手势容器。
 *  - 只在屏幕左侧 ~32px 内起始才识别；
 *  - 向右拖动超过 72px 触发 onBack（仅触发一次）；
 *  - 纵向滚动 / 上下滑动不会误触。
 */
export default function SwipeBack({
  onBack,
  disabled = false,
  children,
}: {
  onBack: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    tracking: boolean;
    triggered: boolean;
    pointerId?: number;
  } | null>(null);

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ touchAction: "pan-y" }}
      onPointerDown={(e) => {
        if (disabled) return;
        if (e.clientX > 34) return;
        gestureRef.current = { startX: e.clientX, startY: e.clientY, tracking: false, triggered: false, pointerId: e.pointerId };
      }}
      onPointerMove={(e) => {
        const gesture = gestureRef.current;
        if (!gesture || disabled || gesture.triggered) return;
        if (gesture.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;

        const dx = e.clientX - gesture.startX;
        const dy = e.clientY - gesture.startY;

        if (!gesture.tracking) {
          // 横向意图明显时才接管，避免干扰竖向滚动
          if (dx > 10 && Math.abs(dy) < dx * 1.6) {
            gesture.tracking = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* 兼容 */
            }
          } else if (Math.abs(dy) > 14) {
            gestureRef.current = null;
            return;
          }
        }
        if (!gesture.tracking) return;

        if (dx > 6) e.preventDefault();
        if (dx >= 72) {
          gesture.triggered = true;
          void hapticTap();
          onBack();
        }
      }}
      onPointerUp={() => {
        gestureRef.current = null;
      }}
      onPointerCancel={() => {
        gestureRef.current = null;
      }}
      onPointerLeave={() => {
        // 仅当尚未横向接管时清除；横向拖动中离开仍继续
        const gesture = gestureRef.current;
        if (gesture && !gesture.tracking) gestureRef.current = null;
      }}
    >
      {children}
    </div>
  );
}
