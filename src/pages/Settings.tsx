import { DataSection } from "@/components/settings/DataSection";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { useLoad } from "@/hooks/useLoad";
import { getSettings } from "@/integrations/tauri/commands";

export function Settings() {
  const settings = useLoad(getSettings, []).data;

  if (!settings) return null;
  return (
    <>
      <h1>Settings</h1>
      <SettingsForm settings={settings} />
      <DataSection />
    </>
  );
}
