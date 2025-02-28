import { Context as PluginContext } from "@ubiquity-os/plugin-sdk";
import { PluginSettings } from "./plugin-input";
import { Env } from "./env";
import { createAdapters } from "../adapters";
import { Command } from "./command";

export type SupportedEvents = "issue_comment.created" | "pull_request_review_comment.created";

export type CommentInfo = {
  id: number;
  body: string;
  user: {
    login: string;
    id: number;
    type: string;
  };
};

export type Context<TEvents extends SupportedEvents = SupportedEvents> = PluginContext<PluginSettings, Env, Command, TEvents> & {
  adapters: ReturnType<typeof createAdapters>;
  commentInfo?: CommentInfo;
};
