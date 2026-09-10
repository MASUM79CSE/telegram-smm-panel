import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/auth/login-form";
import { AuthShell } from "@/components/auth/auth-shell";

export default async function LoginPage() {
  const t = await getTranslations("Auth.login");

  return (
    <AuthShell>
      <h1 className="text-center text-2xl font-bold text-white">{t("title")}</h1>
      <p className="mt-1 text-center text-sm text-slate-400">{t("subtitle")}</p>
      <div className="mt-8">
        <LoginForm />
      </div>
    </AuthShell>
  );
}
