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

/**
 * A single tool invocation. A "Subagent Invocation" is a UsageEvent with
 * `toolName === 'Task'` (`isSubagent === true`) plus `subagentType`/
 * `subagentTask` populated — same shape, not a separate type (Principle
 * III: composition, not a type hierarchy). See data-model.md.
 */
export interface UsageEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly toolName: string;
  readonly isSubagent: boolean;
  readonly subagentType: string | null;
  readonly subagentTask: string | null;
  readonly outcome: Outcome;
  readonly reasoning: string | null;
  readonly inputSummary: string | null;
  readonly projectPath: string;
}

export type ValidationResult =
  | "confirmed"
  | "mismatch_corrected"
  | "not_observed"
  | "not_applicable";

/**
 * An agent-performed follow-up action confirming or contradicting a
 * UsageEvent's expected result (research.md §6, FR-014/FR-016). Zero or one
 * per UsageEvent in storage terms, but the pure core always produces one of
 * the four `result` states for every event it processes — "nothing to
 * report" is itself a state (`not_observed`/`not_applicable`), never a
 * missing row the client has to guess about.
 */
export interface ValidationCheck {
  readonly usageEventId: string;
  readonly checkedWhat: string;
  readonly result: ValidationResult;
}
