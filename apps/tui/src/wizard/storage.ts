import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "@hextra/core/config.js";
import { WIZARD_STEPS, type WizardStep } from "./schema.js";

export interface WizardState {
  done: WizardStep[];
  current: WizardStep;
}

function path(): string {
  mkdirSync(configDir(), { recursive: true });
  return join(configDir(), "wizard.json");
}

export function loadWizard(): WizardState {
  try {
    if (existsSync(path())) return JSON.parse(readFileSync(path(), "utf8")) as WizardState;
  } catch { /* start fresh */ }
  return { done: [], current: WIZARD_STEPS[0] };
}

export function saveWizard(s: WizardState): void {
  writeFileSync(path(), JSON.stringify(s, null, 2));
}
