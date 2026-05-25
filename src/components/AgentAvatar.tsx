import { Code2, Eye, Loader2, Route, ShieldCheck } from "lucide-react";

export type AgentRole = "planner" | "coder" | "reviewer" | "verifier";
export type AgentStatus = "thinking" | "active" | "idle" | "done";

interface AgentAvatarProps {
  role: AgentRole;
  status?: AgentStatus;
  size?: number;
}

export function AgentAvatar({ role, status = "idle", size = 32 }: AgentAvatarProps) {
  const getRoleConfig = () => {
    switch (role) {
      case "planner":
        return {
          icon: Route,
          label: "Planner",
          color: "var(--warning)",
        };
      case "coder":
        return {
          icon: Code2,
          label: "Coder",
          color: "var(--accent)",
        };
      case "reviewer":
        return {
          icon: Eye,
          label: "Reviewer",
          color: "var(--danger)",
        };
      case "verifier":
        return {
          icon: ShieldCheck,
          label: "Verifier",
          color: "var(--success)",
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
        ["--agent-avatar-color" as string]: config.color,
      }}
      aria-label={config.label}
    >
      <div
        className="agent-avatar-inner"
      >
        {status === "thinking" ? (
          <Loader2 className="agent-thinking-spinner" size={size * 0.58} />
        ) : (
          <Icon size={size * 0.56} />
        )}
      </div>
      {(status === "thinking" || status === "active") && <span className="agent-status-ring" />}
    </div>
  );
}
