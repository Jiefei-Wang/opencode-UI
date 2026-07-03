import type { ModelPick, ProviderInfo } from "./opencodeTypes"

export function modelsFromConnectedProviders(providers: ProviderInfo[]): ModelPick[] {
  return providers.filter(isAvailableProvider).flatMap((provider) => Object.entries(provider.models ?? {}).filter(([, value]) => isAvailableModel(value)).map(([key, value]) => {
    const model = value as { id?: string; name?: string }
    const modelID = model.id ?? key
    const name = model.name ?? modelID
    return {
      providerID: provider.id,
      providerName: provider.name ?? provider.id,
      modelID,
      name,
      label: name,
    }
  }))
}

export function connectedProvidersFromConfig(configData: any): ProviderInfo[] {
  const providers = configData?.providers
  return Array.isArray(providers) ? providers : []
}

function isAvailableProvider(provider: any) {
  if (!provider?.id || !provider.models) return false
  if (provider.disabled === true || provider.enabled === false || provider.available === false) return false
  return true
}

function isAvailableModel(model: unknown) {
  const item = model as any
  if (!item || typeof item !== "object") return false
  if (item.disabled === true || item.enabled === false || item.available === false) return false
  if (item.error || item.unavailable === true) return false
  if (item.status && item.status !== "active") return false
  return true
}
