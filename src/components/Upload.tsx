"use client";
import { useEffect, useState } from "react";

export function Upload({ csrfToken }: { csrfToken: string }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);
  async function upload(selected: File) {
    setUploading(true); setError(null); setResult(null);
    const body = new FormData(); body.append("file", selected);
    try {
      const res = await fetch("/api/media/upload", { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": csrfToken }, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || `Upload failed with status ${res.status}`);
      setResult(data);
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setUploading(false); }
  }
  return <div className="p-4 border rounded shadow-sm" aria-busy={uploading}>
    <h2 className="text-lg font-bold mb-4">Upload Media</h2>
    <label htmlFor="media-file">Static JPEG, PNG or WebP, up to 5 MiB, 4096 pixels per side and 8 million pixels</label>
    <input id="media-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} data-testid="upload-input" onChange={(e) => { const selected = e.target.files?.[0]; e.target.value = ""; if (selected) { setFile(selected); setPreview(URL.createObjectURL(selected)); void upload(selected); } }} />
    {uploading && <p role="status" data-testid="uploading-state">Uploading...</p>}
    {error && <><p role="alert" data-testid="error-state">{error}</p><button type="button" disabled={uploading} onClick={() => { if (file) void upload(file); }}>Retry upload</button></>}
    {result && (
      <div role="status" data-testid="success-state">
        <p>Upload successful. Media remains private and pending.</p>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Uploaded media local preview" className="max-w-xs" data-testid="preview-image" />
        )}
        <p>ID: {result.id}</p>
      </div>
    )}
  </div>;
}
