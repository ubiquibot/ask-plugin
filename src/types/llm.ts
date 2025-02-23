import { Context } from "@ubiquity-os/plugin-sdk";
import { GROUND_TRUTHS_SYSTEM_MESSAGES } from "../handlers/ground-truths/prompts";

export type ModelApplications = "code-review" | "chat-bot";

type ChatBotAppParams = {
  languages: [string, number][];
  dependencies: Record<string, string> | null;
  devDependencies: Record<string, string> | null;
};

type CodeReviewAppParams = {
  taskSpecification: string;
};

export type AppParamsHelper<TApp extends ModelApplications> = TApp extends "code-review"
  ? CodeReviewAppParams
  : TApp extends "chat-bot"
    ? ChatBotAppParams
    : never;

export type CompletionsModelHelper<TApp extends ModelApplications> = TApp extends "code-review" ? "gpt-4o" : TApp extends "chat-bot" ? "o1-mini" : never;

export type GroundTruthsSystemMessage<TApp extends ModelApplications = ModelApplications> = TApp extends "code-review"
  ? (typeof GROUND_TRUTHS_SYSTEM_MESSAGES)["code-review"]
  : TApp extends "chat-bot"
    ? (typeof GROUND_TRUTHS_SYSTEM_MESSAGES)["chat-bot"]
    : never;

export type GroundTruthsSystemMessageTemplate = {
  truthRules: string[];
  example: string[];
  conditions?: string[];
};

export type StreamlinedComment = {
  id: string;
  user?: string;
  body?: string;
  org: string;
  repo: string;
  issueUrl: string;
  specOrBody?: {
    html: string;
    text: string;
  };
  commentType?: "issue_comment" | "pull_request_review_comment";
  referencedCode?: {
    content: string;
    startLine: number;
    endLine: number;
    path: string;
  };
};

export type TokenLimits = {
  modelMaxTokenLimit: number;
  context: Context;
  maxCompletionTokens: number;
  runningTokenCount: number;
  tokensRemaining: number;
};

export type DriveContents = { name: string; content: string };
