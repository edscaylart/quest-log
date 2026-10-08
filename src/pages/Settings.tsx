import { useEffect, useState } from "react";
import { DataSection } from "@/components/settings/DataSection";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { getSettings } from "@/integrations/tauri/commands";
import type { Settings as SettingsRecord } from "@/lib/settings/types";

export function Settings() {
  const [settings, setSettings] = useState<SettingsRecord | null>(null);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  if (!settings) return null;
  return (
    <>
      <h1>Settings</h1>
      <SettingsForm settings={settings} />
      <DataSection />
    </>
  );
}
