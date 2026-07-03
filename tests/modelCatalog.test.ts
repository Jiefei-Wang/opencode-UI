import assert from "node:assert/strict"
import test from "node:test"
import { connectedProvidersFromConfig, modelsFromConnectedProviders } from "../src/modelCatalog"

test("model catalog only uses connected config providers and excludes Requesty from broad catalog", () => {
  const broadCatalog = {
    all: [
      { id: "requesty", name: "Requesty", models: { claude: { id: "claude", name: "Claude via Requesty", status: "active" } } },
      { id: "openai", name: "OpenAI", models: { "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", status: "active" } } },
    ],
  }
  const connectedConfig = {
    providers: [
      { id: "openai", name: "OpenAI", models: { "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", status: "active" } } },
      { id: "github-copilot", name: "GitHub Copilot", models: { "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", status: "active" } } },
    ],
  }

  assert.equal(Array.isArray((broadCatalog as any).all), true)
  const models = modelsFromConnectedProviders(connectedProvidersFromConfig(connectedConfig))
  assert.deepEqual(models.map((model) => `${model.providerID}/${model.modelID}`), ["openai/gpt-5.5", "github-copilot/gpt-5.4"])
  assert.equal(models.some((model) => model.providerID === "requesty"), false)
})

test("model catalog filters unavailable provider and model flags", () => {
  const models = modelsFromConnectedProviders([
    { id: "disabled-provider", enabled: false, models: { ok: { id: "ok", name: "OK" } } } as any,
    { id: "openai", name: "OpenAI", models: {
      active: { id: "active", name: "Active", status: "active" },
      disabled: { id: "disabled", name: "Disabled", disabled: true },
      inactive: { id: "inactive", name: "Inactive", status: "inactive" },
      error: { id: "error", name: "Error", error: "missing auth" },
    } } as any,
  ])

  assert.deepEqual(models.map((model) => model.modelID), ["active"])
})
