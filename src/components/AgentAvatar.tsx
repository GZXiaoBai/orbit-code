import { Compass, Code2, Eye, ShieldCheck, Loader2 } from "lucide-react";

export type AgentRole = "planner" | "coder" | "reviewer" | "verifier";
export type AgentStatus = "thinking" | "active" | "idle" | "done";

interface AgentAvatarProps {
  role: AgentRole;
  status?: AgentStatus;
  size?: number;
}

export function AgentAvatar({ role, status = "idle", size = 32 }: AgentAvatarProps) {
  // 根据角色返回不同的渐变配色和图标
  const getRoleConfig = () => {
    switch (role) {
      case "planner":
        return {
          icon: Compass,
          label: "Planner",
          gradient: "from-orange-500 to-purple-600",
          color: "#ea580c",
          bgColor: "rgba(234, 88, 12, 0.15)",
        };
      case "coder":
        return {
          icon: Code2,
          label: "Coder",
          gradient: "from-blue-500 to-cyan-500",
          color: "#2563eb",
          bgColor: "rgba(37, 99, 235, 0.15)",
        };
      case "reviewer":
        return {
          icon: Eye,
          label: "Reviewer",
          gradient: "from-pink-500 to-rose-500",
          color: "#db2777",
          bgColor: "rgba(219, 39, 119, 0.15)",
        };
      case "verifier":
        return {
          icon: ShieldCheck,
          label: "Verifier",
          gradient: "from-emerald-500 to-teal-500",
          color: "#059669",
          bgColor: "rgba(5, 150, 105, 0.15)",
        };
    }
  };

  const config = getRoleConfig();
  const Icon = config.icon;

  return (
    <div
      className={`agent-avatar-wrapper role-${role} status-${status}`}
      style={{
        width: size,
        height: size,
        borderColor: status === "active" || status === "thinking" ? config.color : "transparent",
      }}
    >
      <div
        className={`agent-avatar-inner bg-gradient-to-tr ${config.gradient}`}
        style={{
          backgroundColor: config.bgColor,
          color: config.color,
        }}
      >
        {status === "thinking" ? (
          <Loader2 className="agent-thinking-spinner animate-spin" size={size * 0.6} />
        ) : (
          <Icon size={size * 0.55} />
        )}
      </div>
      {(status === "thinking" || status === "active") && (
        <span
          className={`agent-status-ring`}
          style={{
            borderColor: config.color,
          }}
        />
      )}
    </div>
  );
}
