import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils/tauri";

type FixtureInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => T | Promise<T>;

declare global {
  interface Window {
    __AGENT_GUI_DESKTOP_FIXTURE__?: {
      invoke: FixtureInvoke;
    };
  }
}

function getDesktopFixture() {
  if (typeof window === "undefined") return undefined;
  return window.__AGENT_GUI_DESKTOP_FIXTURE__;
}

export function isDesktopRuntime(): boolean {
  return isTauri() || Boolean(getDesktopFixture());
}

export async function invokeDesktop<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  const fixture = getDesktopFixture();
  if (fixture) return fixture.invoke<T>(command, args);
  return invoke<T>(command, args);
}
