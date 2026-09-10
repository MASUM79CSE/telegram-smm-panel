"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Sentry's recommended App Router global error boundary
 * (docs/PRODUCTION_READINESS.md §4 — Error Tracking).
 *
 * Next.js only renders this when an error escapes the *root* layout
 * itself (app/layout.tsx) or any error not caught by a more specific
 * `error.tsx` boundary further down the tree — the rarest, most severe
 * class of client-side error this app can have, since it means the
 * shared <html>/<body> shell itself failed to render. Because it replaces
 * the root layout when active, it must define its own <html>/<body> —
 * it cannot assume anything from app/layout.tsx (SessionProvider, the CSP
 * nonce, next-intl) is available, since that's exactly what may have
 * just failed.
 *
 * `Sentry.captureException` here is a safe no-op if `SENTRY_DSN`/
 * `NEXT_PUBLIC_SENTRY_DSN` aren't set (see instrumentation-client.ts) —
 * this file doesn't require Sentry to be configured to work correctly as
 * a plain error boundary; it just also reports to Sentry when available.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>
          Something went wrong
        </h1>
        <p style={{ color: "#666", maxWidth: "32rem" }}>
          An unexpected error occurred and this page couldn&apos;t load. The
          issue has been reported automatically. Please try refreshing the
          page.
        </p>
        {/*
          A plain <a> (full navigation), not next/link or next/navigation's
          useRouter, is deliberate here: this boundary renders precisely
          when the root layout/app shell itself may be broken, so we don't
          want to depend on the Next.js client router still working. A
          full page load is the most reliable recovery path in this state.
        */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate plain <a>, see comment above: the Next.js client router may itself be the thing that's broken here. */}
        <a
          href="/"
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem 1.25rem",
            borderRadius: "0.375rem",
            border: "1px solid #ccc",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          Go to homepage
        </a>
      </body>
    </html>
  );
}
