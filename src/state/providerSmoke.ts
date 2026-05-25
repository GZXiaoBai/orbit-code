import type { ProviderSmokeRecord } from "../domain/types";
import type { ProviderSettings } from "./useSession";
import { getProviderConfig } from "./modelSettings";

export function getProviderSmokeRecord(
  settings: ProviderSettings,
  providerId: string,
): ProviderSmokeRecord {
  const existing = settings.smokeStatus?.[providerId];
  if (existing) return existing;
  const config = getProviderConfig(settings, providerId);
  return {
    status: config.importedModels.length > 0 ? "imported" : "notConfigured",
  };
}

export function setProviderSmokeRecord(
  settings: ProviderSettings,
  providerId: string,
  record: ProviderSmokeRecord,
): ProviderSettings {
  return {
    ...settings,
    smokeStatus: {
      ...(settings.smokeStatus || {}),
      [providerId]: {
        ...record,
        checkedAt: record.checkedAt || new Date().toISOString(),
      },
    },
  };
}
