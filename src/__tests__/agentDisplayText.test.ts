import { describe, expect, it } from "vitest";
import { copy } from "../i18n/copy";
import { compactRuntimeTextForTimeline, localizedRuntimeText } from "../components/thread/agentDisplayText";

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

  it("does not leak localized patch JSON embedded in streaming prose", () => {
    const text = compactRuntimeTextForTimeline(
      copy.zh,
      [
        'Agent 正在思考...',
        '{"tool":"补丁","params":{"patches":[{"path":"orbit-mini-lab/PROJECT_STRUCTURE.md","oldContent":"","newContent":"# 项目结构梳理\\n"}]}}',
        "已折叠较长输出；完整命令输出、Diff 或文件内容请在审查台查看。",
      ].join("\n"),
    );

    expect(text).toContain("Agent 提出补丁审查：1 个文件");
    expect(text).not.toContain('"patches"');
    expect(text).not.toContain('"params"');
    expect(text).not.toContain("oldContent");
    expect(text).not.toContain("newContent");
    expect(text).not.toContain("# 项目结构梳理");
  });

  it("collapses long tool output in the central timeline", () => {
    const text = compactRuntimeTextForTimeline(
      copy.zh,
      `读取到文件内容：\n${"export const noisy = true;\n".repeat(80)}`,
      160,
    );

    expect(text.length).toBeLessThan(260);
    expect(text).toContain("已折叠较长输出");
  });

  it("removes model-fabricated tool result blocks from timeline text", () => {
    const text = compactRuntimeTextForTimeline(
      copy.zh,
      [
        "准备继续。",
        "[Tool run_command result]:",
        "workspace: /Users/li/uni/workspace",
        "package.json exists",
      ].join("\n"),
    );

    expect(text).toContain("已忽略模型伪造的工具结果");
    expect(text).not.toContain("/Users/li/uni/workspace");
  });
});
