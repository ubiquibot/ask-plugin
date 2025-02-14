import { createClient } from "@supabase/supabase-js";
import { initAdapters } from "./evals/handlers/setup-context";
import { createAdapters } from "./src/adapters";
import { formatChatHistory } from "./src/helpers/format-chat-history";
import { Context } from "./src/types";
import issueTemplate from "./tests/__mocks__/issue-template";
import { customOctokit as Octokit } from "@ubiquity-os/plugin-sdk/octokit";
import { VoyageAIClient } from "voyageai";
import OpenAI from "openai";
import { LOG_LEVEL, Logs } from "@ubiquity-os/ubiquity-os-logger";
import { SimilarComment, SimilarIssue } from "./src/types/github-types";

//Load .env
require("dotenv").config();

const input = {
  issueResponses: [
    {
      scenario: "/annotate",
      issue: {
        body: "There are situations where we write about certain issues that were likely to have been posted in the past, but are difficult to find. Imagine if using vector embeddings, we can instantly link to whatever issues are being referenced: > We had some problems with KV, so I don't know if it's wise to enable plugin communication without fixing the problem (I can't find the issue about this). Alternatively we could make this as part of a module inside `text-conversation-rewards` From https://github.com/kingsley-einstein/contributions-scan/pull/4#issuecomment-2577468623 Using this command, we should replicate the behavior of issue deduplication on the existing comment and edit/add the footnotes with links to the source issues. A limitation that I see is how wide of a search we should conduct. Within the same repository is somewhat useless, and globally might incur too much noise. Organization wide might be the best default, but sometimes it would be very useful, especially for us using three organizations, to do a global annotation/search. Perhaps we can have optional arguments to scope the search. ``` /annotate https://github.com/kingsley-einstein/contributions-scan/pull/4#issuecomment-2577468623 global ``` But default can be just ``` /annotate ``` \nAnd it will automatically annotate the previous comment with an organization wide search. ",
        number: 247,
        html_url: "https://github.com/ShivTestOrg/test-public/issues/247",
        question: "/ask could you please provide a summary of the issue ?",
      },
      expectedResponse:
        "The manifest.name should match the name of the repo it lives in. This is because the worker URL contains the repo name, and we use that to match against manifest.name.",
      sender: {
        login: "sshivaditya2019",
        type: "User",
      },
      repository: {
        name: "test-public",
        owner: {
          login: "ShivTestOrg",
          type: "Organization",
        },
      },
    },
  ],
};

const inputs = {
  config: {
    model: "openai/o1-mini",
    similarityThreshold: 0.8
  },
  settings: {
    openAiBaseUrl: "https://openrouter.ai/api/v1",
  },
};

// Required environment variables with type assertion
const requiredEnvVars = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY as string,
  UBIQUITY_OS_APP_NAME: process.env.UBIQUITY_OS_APP_NAME as string,
  VOYAGEAI_API_KEY: process.env.VOYAGEAI_API_KEY as string,
  SUPABASE_URL: process.env.SUPABASE_URL as string,
  SUPABASE_KEY: process.env.SUPABASE_KEY as string,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY as string,
};

// Validate all required env vars are present
Object.entries(requiredEnvVars).forEach(([key, value]) => {
  if (!value) {
    throw new Error(`${key} is required`);
  }
});

const clients = {
  supabase: createClient(requiredEnvVars.SUPABASE_URL, requiredEnvVars.SUPABASE_KEY),
  voyage: new VoyageAIClient({ apiKey: requiredEnvVars.VOYAGEAI_API_KEY }),
  openai: new OpenAI({
    apiKey: (inputs.settings.openAiBaseUrl && requiredEnvVars.OPENROUTER_API_KEY) || requiredEnvVars.OPENAI_API_KEY,
    baseURL: inputs.settings.openAiBaseUrl || undefined,
  }),
};

const baseContext: Partial<Context> = {
  config: inputs.config,
  env: requiredEnvVars,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore: Logger type conflict workaround (Two different types with this name exist, but they are unrelated)
  logger: new Logs(LOG_LEVEL.DEBUG),
  octokit: new Octokit({ auth: process.env.GITHUB_TOKEN }),
};

const test_func_pull = async () => {
  const { issueResponses } = input;
  const scenario = issueResponses[0];
  let context: Context = {
    ...baseContext,
    adapters: {} as ReturnType<typeof createAdapters>,
    payload: {
      issue: {
        ...issueTemplate,
        body: scenario.issue.body,
        html_url: scenario.issue.html_url,
        number: scenario.issue.number,
      } as unknown as Context<"issue_comment.created">["payload"]["issue"],
      sender: scenario.sender,
      repository: {
        name: scenario.repository.name,
        owner: {
          login: scenario.repository.owner.login,
        },
      },
      comment: {
        body: scenario.issue.question,
        user: scenario.sender,
      } as unknown as Context["payload"]["comment"],
      action: "created" as string,
      installation: { id: 1 } as unknown as Context["payload"]["installation"],
      organization: { login: "ubiquity" } as unknown as Context["payload"]["organization"],
    },
    eventName: "issue_comment.created",
  } as Context;

  context = initAdapters(context, clients);

  const maxDepth = 45;

  // const { specAndBodies, streamlinedComments } = await recursivelyFetchLinkedIssues({
  //     context,
  //     maxDepth,
  //     owner: context.payload.repository.owner.login,
  //     repo: context.payload.repository.name,
  //     issueNum: context.payload.issue.number,
  // });

  // console.log("Streamlined comments " + JSON.stringify(streamlinedComments));
  // console.log("Spec and bodies " + JSON.stringify(specAndBodies));
  // console.log("Streamlined comments " + JSON.stringify(streamlinedComments));
  // console.log("Spec and bodies " + JSON.stringify(specAndBodies));
  // build a nicely structure system message containing a streamlined chat history
  // includes the current issue, any linked issues, and any linked PRs
  //const formattedChat = await formatChatHistory(context, maxDepth, [] as unknown as SimilarIssue[], [] as unknown as SimilarComment[]);

  // Rerank the chat history
  //const reRankedChat = await context.adapters.voyage.reranker.reRankTreeNodes(formattedChat, context.payload.comment.body);
  //console.log("Formatted chat history " + formattedChat.join("\n"));
};

test_func_pull();
