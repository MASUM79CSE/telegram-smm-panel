"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AuthShell } from "@/components/auth/auth-shell";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const t = useTranslations("Auth.verifyEmail");
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? "" : t("missingToken"));

  useEffect(() => {
    if (!token) {
      return;
    }

    fetch("/api/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t("errorFallback"));
        setStatus("success");
        setMessage(data.message);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <AuthShell cardClassName="text-center">
      <h1 className="text-2xl font-bold text-white">{t("title")}</h1>

      {status === "loading" && <p className="mt-4 text-slate-400">{t("verifying")}</p>}

      {status === "success" && (
        <div className="mt-4">
          <p className="text-green-400">{message}</p>
          <Link href="/login" className="mt-6 inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-500">
            {t("goToLogin")}
          </Link>
        </div>
      )}

      {status === "error" && (
        <div className="mt-4">
          <p className="text-red-400">{message}</p>
          <Link href="/login" className="mt-6 inline-block text-blue-400 hover:text-blue-300">
            {t("backToLogin")}
          </Link>
        </div>
      )}
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
