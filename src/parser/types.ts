// Discriminated types for Claude Code .jsonl log lines.
// Intentionally permissive — real data drifts across versions. Use
// unknown-friendly getters in consumers; don't over-constrain.

export type Uuid = string;
export type IsoTs = string;

export interface BaseLine {
  type: string;
  uuid?: Uuid;
  parentUuid?: Uuid | null;
  sessionId?: Uuid;
  timestamp?: IsoTs;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  userType?: string;
  entrypoint?: string;
  isSidechain?: boolean;
  agentId?: string;
}

export interface TextBlock { type: "text"; text: string }
export interface ThinkingBlock { type: "thinking"; thinking: string; signature?: string }
export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller?: { type: string };
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<TextBlock | ImageBlock>;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

export interface UserMessage {
  role: "user";
  content: string | ContentBlock[];
}

export interface AssistantUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  service_tier?: string;
}

export interface AssistantMessage {
  id?: string;
  role: "assistant";
  type?: "message";
  model?: string;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  content?: ContentBlock[] | null;
  usage?: AssistantUsage;
}

export interface UserLine extends BaseLine {
  type: "user";
  message: UserMessage;
  promptId?: string;
  permissionMode?: string;
  toolUseResult?: unknown;
  sourceToolAssistantUUID?: Uuid;
}

export interface AssistantLine extends BaseLine {
  type: "assistant";
  message: AssistantMessage;
  requestId?: string;
}

export interface ProgressLine extends BaseLine {
  type: "progress";
  data?: { type?: string; hookEvent?: string; hookName?: string; command?: string };
  toolUseID?: string;
  parentToolUseID?: string;
}

export type SystemSubtype =
  | "turn_duration"
  | "compact_boundary"
  | "api_error"
  | "bridge_status"
  | "local_command"
  | "scheduled_task_fire"
  | string;

export interface SystemLine extends BaseLine {
  type: "system";
  subtype?: SystemSubtype;
  level?: string;
  durationMs?: number;
  messageCount?: number;
  error?: unknown;
}

export interface AttachmentLine extends BaseLine { type: "attachment"; attachment?: unknown }
export interface PermissionModeLine extends BaseLine { type: "permission-mode"; permissionMode?: string }
export interface CustomTitleLine extends BaseLine { type: "custom-title"; customTitle?: string }
export interface AiTitleLine extends BaseLine { type: "ai-title"; aiTitle?: string }
export interface AgentNameLine extends BaseLine { type: "agent-name"; agentName?: string }
export interface LastPromptLine extends BaseLine { type: "last-prompt"; lastPrompt?: string }
export interface PrLinkLine extends BaseLine {
  type: "pr-link"; prUrl?: string; prNumber?: number; prRepository?: string;
}
export interface FileHistorySnapshotLine extends BaseLine {
  type: "file-history-snapshot"; snapshot?: unknown; messageId?: string;
}
export interface QueueOperationLine extends BaseLine {
  type: "queue-operation"; operation?: string; content?: string;
}

export type LogLine =
  | UserLine
  | AssistantLine
  | ProgressLine
  | SystemLine
  | AttachmentLine
  | PermissionModeLine
  | CustomTitleLine
  | AiTitleLine
  | AgentNameLine
  | LastPromptLine
  | PrLinkLine
  | FileHistorySnapshotLine
  | QueueOperationLine
  | (BaseLine & { type: string }); // fallback for future types

export function isUser(l: LogLine): l is UserLine { return l.type === "user"; }
export function isAssistant(l: LogLine): l is AssistantLine { return l.type === "assistant"; }
export function isSystem(l: LogLine): l is SystemLine { return l.type === "system"; }
export function isProgress(l: LogLine): l is ProgressLine { return l.type === "progress"; }

export function contentBlocks(msg: UserMessage | AssistantMessage | undefined): ContentBlock[] {
  if (!msg) return [];
  const c = (msg as any).content;
  if (c == null) return [];
  if (typeof c === "string") return [{ type: "text", text: c }];
  return c as ContentBlock[];
}
