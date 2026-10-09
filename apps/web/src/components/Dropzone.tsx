import { useRef, useState } from "react";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DropzoneProps {
  accept: string[];
  file: File | null;
  onFileSelected: (file: File) => void;
  onRemove: () => void;
  error: string | null;
  hint: string;
}

export default function Dropzone({ accept, file, onFileSelected, onRemove, error, hint }: DropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Extension/size validation lives in the parent (it already shows the
  // specific error via `error`); this just hands the picked file up.
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFileSelected(dropped);
  }

  if (file) {
    return (
      <div>
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <path
                  d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">{file.name}</p>
              <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove file"
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
          >
            ×
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
          dragOver
            ? "border-indigo-400 bg-indigo-50"
            : "border-slate-300 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/50"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-indigo-400">
          <path
            d="M12 16V4m0 0 4 4m-4-4-4 4M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="text-sm text-slate-600">
          <span className="font-medium text-indigo-600">Click to browse</span> or drag a file here
        </p>
        <p className="text-xs text-slate-400">{hint}</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept.map((ext) => `.${ext}`).join(",")}
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) onFileSelected(picked);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
