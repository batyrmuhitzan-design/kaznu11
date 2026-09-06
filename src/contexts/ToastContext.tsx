import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ToastKind = "success" | "info" | "error";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  push: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

const TOAST_ICON: Record<ToastKind, string> = {
  success: "✓",
  info: "ℹ",
  error: "✕",
};

const TOAST_COLOR: Record<ToastKind, string> = {
  success: "#30D158",
  info: "#409CFF",
  error: "#FF453A",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback((message: string, kind: ToastKind = "success") => {
    idRef.current += 1;
    const id = idRef.current;
    setItems((list) => [...list.slice(-2), { id, message, kind }]);
    window.setTimeout(() => {
      setItems((list) => list.filter((it) => it.id !== id));
    }, 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-viewport" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className="toast-item" role="status">
            <span className="toast-icon" style={{ color: TOAST_COLOR[item.kind] }}>
              {TOAST_ICON[item.kind]}
            </span>
            <span className="toast-text">{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
