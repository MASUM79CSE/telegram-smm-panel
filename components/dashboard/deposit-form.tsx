"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export function DepositForm() {
  const router = useRouter();
  const t = useTranslations("DepositForm");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BKASH");
  const [transactionRef, setTransactionRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parseFloat(amount), method, transactionRef }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t("errorFallback"));
        return;
      }

      setSuccess(t("success"));
      setAmount("");
      setTransactionRef("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-800 bg-slate-950 p-6">
      <h3 className="font-semibold text-white">{t("title")}</h3>

      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("paymentMethod")}</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white"
        >
          <option value="BKASH">{t("methodBkash")}</option>
          <option value="NAGAD">{t("methodNagad")}</option>
          <option value="SSLCOMMERZ">{t("methodSslcommerz")}</option>
          <option value="CRYPTO">{t("methodCrypto")}</option>
          <option value="MANUAL">{t("methodManual")}</option>
        </select>
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("amount")}</label>
        <input
          type="number"
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
          placeholder="500"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">{t("transactionRef")}</label>
        <input
          required
          value={transactionRef}
          onChange={(e) => setTransactionRef(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
          placeholder={t("transactionRefPlaceholder")}
        />
      </div>

      {error && <div className="rounded-lg bg-red-950 p-3 text-sm text-red-400">{error}</div>}
      {success && <div className="rounded-lg bg-green-950 p-3 text-sm text-green-400">{success}</div>}

      <button
        disabled={isPending}
        className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
