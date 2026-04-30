import { describe, it, expect, vi, afterEach } from "vitest";
import { getYouTubeTitleFromUrl, isYouTubeUrl } from "../src/services/youtube.js";

describe("isYouTubeUrl", () => {
  it("recognizes www.youtube.com URLs", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
  });

  it("recognizes bare youtube.com URLs", () => {
    expect(isYouTubeUrl("https://youtube.com/watch?v=abc123")).toBe(true);
  });

  it("recognizes youtu.be short URLs", () => {
    expect(isYouTubeUrl("https://youtu.be/abc123")).toBe(true);
  });

  it("rejects non-YouTube URLs", () => {
    expect(isYouTubeUrl("https://vimeo.com/123456")).toBe(false);
    expect(isYouTubeUrl("https://example.com")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isYouTubeUrl("not-a-url")).toBe(false);
  });
});

describe("getYouTubeTitleFromUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the title on a successful oEmbed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ title: "My YouTube Video", author_name: "Test Channel" }),
      }),
    );

    const title = await getYouTubeTitleFromUrl("https://www.youtube.com/watch?v=abc123");
    expect(title).toBe("My YouTube Video");
  });

  it("returns null when the oEmbed response is not ok (e.g. 404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    const title = await getYouTubeTitleFromUrl("https://www.youtube.com/watch?v=private");
    expect(title).toBeNull();
  });

  it("returns null when fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const title = await getYouTubeTitleFromUrl("https://www.youtube.com/watch?v=abc123");
    expect(title).toBeNull();
  });

  it("returns null when the response has no title field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ author_name: "Test Channel" }),
      }),
    );

    const title = await getYouTubeTitleFromUrl("https://www.youtube.com/watch?v=abc123");
    expect(title).toBeNull();
  });

  it("calls the oEmbed endpoint with the encoded URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "Test Video" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await getYouTubeTitleFromUrl("https://www.youtube.com/watch?v=abc123");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123&format=json",
    );
  });
});
