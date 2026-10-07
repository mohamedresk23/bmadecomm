"use client";

import { useState } from "react";

export function Upload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; url?: string } | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/media/upload", {
        method: "POST",
        // In a real app, you would pass real auth headers here
        headers: {
          "x-mock-user": JSON.stringify({ id: "user1", roles: [], permissions: ["media:upload"] }),
        },
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || `Upload failed with status ${res.status}`);
      }

      const data = await res.json();
      setResult(data);

      // Now publish it so we can preview it
      const publishRes = await fetch("/api/media/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mock-user": JSON.stringify({ id: "user1", roles: [], permissions: ["media:upload"] }),
        },
        body: JSON.stringify({ id: data.id }),
      });

      if (publishRes.ok) {
        const publishData = await publishRes.json();
        setResult(publishData);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 border rounded shadow-sm">
      <h2 className="text-lg font-bold mb-4">Upload Media</h2>
      <input
        type="file"
        accept="image/png, image/jpeg, image/webp"
        onChange={handleUpload}
        disabled={uploading}
        className="mb-4"
        data-testid="upload-input"
      />
      {uploading && <p className="text-gray-500" data-testid="uploading-state">Uploading...</p>}
      {error && <p className="text-red-500" data-testid="error-state">{error}</p>}
      {result && (
        <div className="mt-4" data-testid="success-state">
          <p className="text-green-600 mb-2">Upload successful!</p>
          {result.url && <img src={result.url} alt="Uploaded media" className="max-w-xs border rounded" data-testid="preview-image" />}
          <p className="text-xs text-gray-400 mt-2">ID: {result.id}</p>
        </div>
      )}
    </div>
  );
}
