import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface ConfirmRequest {
  message: string;
  resolve: (ok: boolean) => void;
}

type ConfirmFn = (message: string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Renders a styled dialog in place of the browser's native window.confirm,
 * which several embedded/mobile webview contexts silently auto-dismiss
 * (returning false immediately) -- a delete button wired to window.confirm
 * can look completely broken there with no visible error. */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const confirm = useCallback<ConfirmFn>((message) => {
    return new Promise((resolve) => {
      setRequest({ message, resolve });
    });
  }, []);

  function settle(ok: boolean) {
    request?.resolve(ok);
    setRequest(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <p className="whitespace-pre-line text-sm text-slate-700">{request.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(false)}
                className="rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  return useMemo(() => {
    if (confirm) return confirm;
    // Fallback for anything rendered outside the provider -- still
    // functional, just native, rather than throwing.
    return async (message: string) => window.confirm(message);
  }, [confirm]);
}
