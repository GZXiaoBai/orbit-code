import { describe, expect, it } from "vitest";
import { copy } from "../i18n/copy";
import { localizedRuntimeText } from "../components/thread/agentDisplayText";

describe("agent display text", () => {
  it("summarizes raw run_command tool JSON for the thread", () => {
    const text = localizedRuntimeText(
      copy.zh,
      '{"tool":"run_command","params":{"command":"npm","args":["test","--","--run"],"reason":"验证改动"}}',
    );

    expect(text).toBe("Agent 请求运行命令：npm test -- --run。原因：验证改动");
    expect(text).not.toContain('"tool"');
  });

  it("summarizes raw apply_patch tool JSON for the thread", () => {
    const text = localizedRuntimeText(
      copy.zh,
      '{"tool":"apply_patch","params":{"patches":[{"path":"src/App.tsx","oldContent":"","newContent":"export {}"},{"path":"src/App.css","oldContent":"","newContent":".app{}"}]}}',
    );

    expect(text).toBe("Agent 提出补丁审查：2 个文件（src/App.tsx、src/App.css）");
    expect(text).not.toContain("apply_patch");
  });
});
