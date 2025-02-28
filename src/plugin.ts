import { Context } from "./types";
import { createAdapters } from "./adapters";
import { createClient } from "@supabase/supabase-js";
import { VoyageAIClient } from "voyageai";
import OpenAI from "openai";
import { callCallbacks } from "./helpers/callback-proxy";
import { processCommentCallback } from "./handlers/comment-created-callback";
import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";

export async function plugin(context: Context) {
  const { env, config } = context;
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
  const voyageClient = new VoyageAIClient({
    apiKey: env.VOYAGEAI_API_KEY,
  });
  const openAiObject = {
    apiKey: (config.openAiBaseUrl && env.OPENROUTER_API_KEY) || env.OPENAI_API_KEY,
    ...(config.openAiBaseUrl && { baseURL: config.openAiBaseUrl }),
  };
  const openaiClient = new OpenAI(openAiObject);
  if (config.processDriveLinks && config.processDriveLinks === true) {
    const auth = new GoogleAuth({
      credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/cloud-platform"],
    });
    const drive = google.drive({ version: "v3", auth });
    context.logger.info("Google Drive API client initialized");
    context.adapters = createAdapters(supabase, voyageClient, openaiClient, context, drive);
  } else {
    context.adapters = createAdapters(supabase, voyageClient, openaiClient, context);
  }

  context.adapters = createAdapters(supabase, voyageClient, openaiClient, context);

  if (context.command) {
    return await processCommentCallback(context);
  }
  return await callCallbacks(context, context.eventName);
}
