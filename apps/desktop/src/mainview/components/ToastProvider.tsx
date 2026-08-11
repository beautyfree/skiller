import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/mainview/lib/utils";

type ToastVariant = "default" | "destructive";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const ToastContext = createContext<{
  toast: (message: string, variant?: ToastVariant) => void;
} | null>(null);

const AUTO_DISMISS_MS = 4500;
const MAX_DISMISS_MS = 12000;

function getToastDismissMs(message: string): number {
  // Keep short messages snappy, but give long explanatory hints time to read.
  const extraByLength = message.trim().length * 35;
  return Math.min(MAX_DISMISS_MS, AUTO_DISMISS_MS + extraByLength);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, variant: ToastVariant = "default") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, variant }]);
    const dismissMs = getToastDismissMs(message);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, dismissMs);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-[min(100vw-2rem,24rem)] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto animate-toast-in rounded-2xl px-4 py-3 text-sm glass-elevated",
              t.variant === "destructive"
                ? "!bg-destructive/15 text-destructive !border-destructive/20"
                : "text-card-foreground",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
