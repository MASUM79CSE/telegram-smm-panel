import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { connectDB } from "@/lib/db";
import { Wallet } from "@/models/Wallet";
import { Transaction } from "@/models/Transaction";
import { getDisplayMoney, getDisplayMoneyBatch } from "@/lib/services/display-money";
import { DualCurrency } from "@/components/shared/dual-currency";
import { ATTRIBUTION_TEXT, ATTRIBUTION_URL } from "@/lib/currency-format";
import { DepositForm } from "@/components/dashboard/deposit-form";

export default async function WalletPage() {
  const session = await auth();
  const locale = await getLocale();
  await connectDB();
  const t = await getTranslations("Dashboard.wallet");

  const [wallet, transactions] = await Promise.all([
    Wallet.findOne({ userId: session!.user.id }).lean(),
    Transaction.find({ userId: session!.user.id }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);

  const [balanceDisplay, transactionDisplays] = await Promise.all([
    getDisplayMoney(wallet?.balance ?? 0, locale),
    getDisplayMoneyBatch(
      transactions.map((tx) => tx.amount),
      locale
    ),
  ]);
  const showsConversion = balanceDisplay.secondary !== null;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-slate-400">
          <span>{t("currentBalance")}</span>
          <DualCurrency money={balanceDisplay} />
        </p>
        {showsConversion && (
          <p className="mt-1 text-[11px] text-slate-600">
            {t("conversionNote")}{" "}
            <a href={ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-400">
              {ATTRIBUTION_TEXT}
            </a>
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DepositForm />

        <div>
          <h3 className="mb-4 font-semibold text-white">{t("recentTransactions")}</h3>
          <div className="space-y-2">
            {transactions.length === 0 && <p className="text-slate-400">{t("noTransactions")}</p>}
            {transactions.map((tx, i) => (
              <div
                key={tx._id.toString()}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-4"
              >
                <div>
                  <p className="text-sm font-medium text-white">{tx.description || tx.type}</p>
                  <p className="text-xs text-slate-500">{new Date(tx.createdAt).toLocaleString()}</p>
                </div>
                <div
                  className={`text-right ${
                    tx.type === "DEPOSIT" || tx.type === "ORDER_REFUND" ? "text-green-400" : "text-red-400"
                  }`}
                >
                  <p className="font-semibold">
                    {tx.type === "DEPOSIT" || tx.type === "ORDER_REFUND" ? "+" : "-"}
                    {transactionDisplays[i].primary}
                  </p>
                  {transactionDisplays[i].secondary && (
                    <p className="text-xs font-normal opacity-70">≈ {transactionDisplays[i].secondary}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
