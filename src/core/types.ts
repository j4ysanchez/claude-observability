export type Outcome = "succeeded" | "failed" | "denied" | "in_progress";

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ThinkingBlock {
  readonly type: "thinking";
  readonly thinking: string;
}

export interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolResultTextPart {
  readonly type: string;
  readonly text?: string;
}

export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly is_error?: boolean;
  readonly content: string | ReadonlyArray<ToolResultTextPart>;
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | { readonly type: string };

export interface TranscriptMessage {
  readonly role?: string;
  readonly content: ReadonlyArray<ContentBlock> | string;
}

export interface RawTranscriptLine {
  readonly type: "user" | "assistant";
  readonly sessionId: string;
  readonly timestamp: string;
  readonly cwd?: string;
  readonly gitBranch?: string | null;
  readonly uuid?: string;
  readonly parentUuid?: string | null;
  readonly message: TranscriptMessage;
}

export interface Session {
  readonly sessionId: string;
  readonly projectPath: string;
  readonly gitBranch: string | null;
  readonly startedAt: string;
  readonly lastEventAt: string;
  readonly transcriptPath: string;
}
