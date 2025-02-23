import { SupabaseClient } from "@supabase/supabase-js";
import { Context } from "../types";
import { Comment } from "./supabase/helpers/comment";
import { SuperSupabase } from "./supabase/helpers/supabase";
import { Embedding as VoyageEmbedding } from "./voyage/helpers/embedding";
import { SuperVoyage } from "./voyage/helpers/voyage";
import { VoyageAIClient } from "voyageai";
import { Issue } from "./supabase/helpers/issues";
import { SuperOpenAi } from "./openai/helpers/openai";
import OpenAI from "openai";
import { Completions } from "./openai/helpers/completions";
import { Rerankers } from "./voyage/helpers/rerankers";
import { createGoogleAdapters } from "./google";

export function createAdapters(supabaseClient: SupabaseClient, voyage: VoyageAIClient, openai: OpenAI, context: Context) {
  const { env } = context;
  return {
    google: createGoogleAdapters(env),
    supabase: {
      comment: new Comment(supabaseClient, context),
      issue: new Issue(supabaseClient, context),
      super: new SuperSupabase(supabaseClient, context),
    },
    voyage: {
      reranker: new Rerankers(voyage, context),
      embedding: new VoyageEmbedding(voyage, context),
      super: new SuperVoyage(voyage, context),
    },
    openai: {
      completions: new Completions(openai, context),
      super: new SuperOpenAi(openai, context),
    },
  };
}
