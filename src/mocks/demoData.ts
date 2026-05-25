import type { AppCopy } from "../i18n/copy";

export function getDemoProjects(t: AppCopy) {
  return [
    {
      name: "Homework2",
      items: [["", t.language === "中" ? "暂无对话" : "No chats yet"]],
    },
    {
      name: "Orbit Code",
      items: [
        [t.title, t.language === "中" ? "3 分" : "3m"],
        [
          t.language === "中" ? "Checkout refactor" : "Checkout refactor",
          t.language === "中" ? "导入" : "imported",
        ],
        [
          t.language === "中" ? "主题与布局调整" : "Theme and layout pass",
          t.language === "中" ? "刚刚" : "now",
        ],
      ],
    },
    {
      name: "skill",
      items: [
        [
          t.language === "中" ? "安装并去重 Skills" : "Install and dedupe Skills",
          t.language === "中" ? "15 小时" : "15h",
        ],
      ],
    },
    {
      name: t.language === "中" ? "接口与通信技术" : "Interfaces and comms",
      items: [
        [
          t.language === "中"
            ? "期末课程答辩和论文主题：介绍..."
            : "Final presentation and paper topic...",
          t.language === "中" ? "2 天" : "2d",
        ],
      ],
    },
    {
      name: "Homework8",
      items: [
        [
          t.language === "中"
            ? "下面是课后习题 7.2、7.4、7.5、..."
            : "Problems 7.2, 7.4, 7.5, ...",
          t.language === "中" ? "3 天" : "3d",
        ],
      ],
    },
  ];
}

export function getDemoOutputFiles(t: AppCopy) {
  return [
    "orbit-code-workbench.png",
    "orbit-code-i18n-zh-final.png",
    t.language === "中" ? "主题截图：浅色" : "Theme screenshot: light",
    t.language === "中" ? "主题截图：深色" : "Theme screenshot: dark",
  ];
}
