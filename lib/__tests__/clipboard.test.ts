// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard, selectElementText } from "@/lib/clipboard";

/**
 * Covers the fallback behavior added after the sandboxed-preview
 * `NotAllowedError` incident: the Clipboard API can be blocked by a
 * permissions policy even in a real browser context (e.g. iframes, some
 * embedded webviews), so `copyToClipboard` must degrade gracefully to
 * `document.execCommand("copy")` instead of throwing, and `selectElementText`
 * must let the user manually copy when even that fails.
 */
describe("lib/clipboard — copyToClipboard", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    // jsdom does not implement `document.execCommand` at all, so it must be
    // stubbed onto the document before each test can spy/mock it.
    if (!("execCommand" in document)) {
      Object.defineProperty(document, "execCommand", {
        value: () => false,
        configurable: true,
        writable: true,
      });
    }
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("returns true and uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const ok = await copyToClipboard("hello world");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("falls back to execCommand when writeText rejects (e.g. NotAllowedError)", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const execCommand = vi.spyOn(document, "execCommand").mockReturnValue(true);

    const ok = await copyToClipboard("fallback text");
    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when both the clipboard API and execCommand fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    vi.spyOn(document, "execCommand").mockReturnValue(false);

    const ok = await copyToClipboard("nope");
    expect(ok).toBe(false);
  });

  it("uses execCommand directly when navigator.clipboard is entirely absent", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const execCommand = vi.spyOn(document, "execCommand").mockReturnValue(true);

    const ok = await copyToClipboard("no clipboard api");
    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("cleans up the temporary textarea it creates for the fallback path", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    vi.spyOn(document, "execCommand").mockReturnValue(true);

    await copyToClipboard("cleanup check");
    expect(document.querySelectorAll("textarea").length).toBe(0);
  });
});

describe("lib/clipboard — selectElementText", () => {
  beforeEach(() => {
    document.body.innerHTML = '<code id="target">some code text</code>';
  });

  it("does not throw when given a real element", () => {
    const el = document.getElementById("target");
    expect(() => selectElementText(el)).not.toThrow();
  });

  it("is a no-op (does not throw) when given null", () => {
    expect(() => selectElementText(null)).not.toThrow();
  });

  it("adds a selection range covering the element's contents", () => {
    const el = document.getElementById("target")!;
    selectElementText(el);
    const selection = window.getSelection();
    expect(selection?.rangeCount).toBeGreaterThan(0);
  });
});
