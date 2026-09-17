import { getSettings } from "@/lib/services/settings";
import { decimalToNumber } from "@/lib/money";
import { SettingsForm } from "@/components/admin/settings-form";

export default async function AdminSettingsPage() {
  const settings = await getSettings();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-slate-400">Platform-wide configuration.</p>
      </div>

      <SettingsForm
        settings={{
          siteName: settings.siteName,
          siteDescription: settings.siteDescription,
          supportEmail: settings.supportEmail,
          minDeposit: decimalToNumber(settings.minDeposit),
          maxDeposit: decimalToNumber(settings.maxDeposit),
          registrationEnabled: settings.registrationEnabled,
          maintenanceMode: settings.maintenanceMode,
        }}
      />
    </div>
  );
}
