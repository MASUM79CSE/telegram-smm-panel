"use client";

/**
 * Client-only clipboard helper. Wraps `navigator.clipboard.writeText` with a
 * `document.execCommand("copy")` fallback and swallows/report errors instead
 * of throwing, because `writeText` can reject with `NotAllowedError` in
 * contexts where the Clipboard API is disabled by a permissions policy
 * (e.g. sandboxed iframes such as this app's in-preview environment) even
 * though the same code works fine in a normal top-level browser tab.
 *
 * Returns `true` if the copy is believed to have succeeded, `false`
 * otherwise. Callers should use the return value to decide whether to show
 * a "copied" vs. a "couldn't copy, please copy manually" state.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy fallback below (e.g. NotAllowedError
      // from a permissions-policy-restricted context).
    }
  }

  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let succeeded = false;
  try {
    succeeded = document.execCommand("copy");
  } catch {
    succeeded = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return succeeded;
}

/**
 * Selects the full text content of an element in the document, so that if
 * an automatic copy fails (see `copyToClipboard` above) the user can still
 * copy manually with Ctrl/Cmd+C without having to select the text by hand.
 * No-op outside the browser or if `el` is null.
 */
export function selectElementText(el: HTMLElement | null): void {
  if (!el || typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    // Selection API is best-effort here; ignore failures silently.
  }
}

