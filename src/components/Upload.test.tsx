/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Upload } from "./Upload";

// Mock fetch globally
global.fetch = vi.fn();

describe("Upload Component", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(cleanup);

  it("shows uploading state and then success state when upload is successful", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "media_123", status: "pending" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "media_123", url: "/uploads/media_123.jpg", status: "active" }),
      });

    render(<Upload />);

    const file = new File(["dummy content"], "test.png", { type: "image/png" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    // Should show uploading state
    expect(screen.getByTestId("uploading-state")).not.toBeNull();
    expect(input.disabled).toBe(true);

    // Eventually should show success state
    await waitFor(() => {
      expect(screen.getByTestId("success-state")).not.toBeNull();
    });

    // Check preview
    expect(screen.getByTestId("preview-image").getAttribute("src")).toBe("/uploads/media_123.jpg");
    expect(screen.queryByTestId("uploading-state")).toBeNull();
    expect(input.disabled).toBe(false);
  });

  it("shows error state when upload fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 413,
      json: async () => ({ error: { message: "Payload Too Large" } }),
    });

    render(<Upload />);

    const file = new File(["dummy content"], "test.png", { type: "image/png" });
    const input = screen.getByTestId("upload-input") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    // Should show uploading state
    expect(screen.getByTestId("uploading-state")).not.toBeNull();

    // Eventually should show error state
    await waitFor(() => {
      expect(screen.getByTestId("error-state")).not.toBeNull();
    });

    expect(screen.getByTestId("error-state").textContent).toBe("Payload Too Large");
    expect(screen.queryByTestId("uploading-state")).toBeNull();
  });
});

