import { DataSection } from "@/components/settings/DataSection";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { ErrorLine } from "@/components/ui/ErrorLine";
import { useLoad } from "@/hooks/useLoad";
import { getSettings } from "@/integrations/tauri/commands";

export function Settings() {
  const { data: settings, error } = useLoad(getSettings, []);

  if (!settings)
    return (
      error && (
        <>
          <h1>Settings</h1>
          <ErrorLine error={error} />
        </>
      )
    );
  return (
    <>
      <h1>Settings</h1>
      <SettingsForm settings={settings} />
      <DataSection />
    </>
  );
}
