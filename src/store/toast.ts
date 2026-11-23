import { create } from "zustand";

export interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error" | "info";
  action?: { label: string; run: () => void };
  ms: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "ms"> & { ms?: number }) => void;
  dismiss: (id: number) => void;
}

let id = 0;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const toast: Toast = { ms: t.action ? 7000 : 3500, ...t, id: ++id };
    set({ toasts: [...get().toasts.slice(-3), toast] });
    setTimeout(() => get().dismiss(toast.id), toast.ms);
  },
  dismiss: (tid) => set({ toasts: get().toasts.filter((x) => x.id !== tid) }),
}));

export const toast = (text: string, kind: Toast["kind"] = "ok", action?: Toast["action"]) => useToasts.getState().push({ text, kind, action });
