import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/components/auth/register-form";
import { AuthShell } from "@/components/auth/auth-shell";

export default async function RegisterPage() {
  const t = await getTranslations("Auth.register");

  return (
    <AuthShell>
      <h1 className="text-center text-2xl font-bold text-white">{t("title")}</h1>
      <p className="mt-1 text-center text-sm text-slate-400">{t("subtitle")}</p>
      <div className="mt-8">
        <RegisterForm />
      </div>
    </AuthShell>
  );
}
