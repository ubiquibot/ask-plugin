import { LogReturn } from "@ubiquity-os/ubiquity-os-logger";
import { bubbleUpErrorComment, sanitizeMetadata } from "../helpers/errors";
import { Context } from "../types";
import { CallbackResult } from "../types/proxy";
import { addCommentToIssue } from "./add-comment";
import { askQuestion } from "./ask-llm";
import { handleDrivePermissions } from "../helpers/drive-link-handler";

export async function processCommentCallback(context: Context<"issue_comment.created" | "pull_request_review_comment.created">): Promise<CallbackResult> {
  const { logger, command, payload } = context;
  let question = "";

  if (payload.comment.user?.type === "Bot") {
    throw logger.error("Comment is from a bot. Skipping.");
  }

  // Add comment information to the context
  if (payload.comment && payload.comment.user) {
    context.commentInfo = {
      id: payload.comment.id,
      body: payload.comment.body,
      user: {
        login: payload.comment.user.login,
        id: payload.comment.user.id,
        type: payload.comment.user.type || "User",
      },
    };
  } else {
    throw logger.error("Invalid comment payload");
  }

  if (command?.name === "ask") {
    question = command.parameters.question;
  } else if (payload.comment.body.trim().startsWith("/ask")) {
    question = payload.comment.body.trim().replace("/ask", "").trim();
  } else if (!question) {
    return { status: 200, reason: logger.info("No question found in comment. Skipping.").logMessage.raw };
  }

  try {
    // Determine if this is a pull request review comment by checking the event type
    const isPullRequestReviewComment = context.eventName === "pull_request_review_comment.created";

    // Add thinking message with proper comment type
    const commentOptions = isPullRequestReviewComment
      ? {
          inReplyTo: {
            commentId: isPullRequestReviewComment ? payload.comment.id : undefined,
          },
        }
      : undefined;

    const thinkingComment = await addCommentToIssue(
      context,
      `> [!TIP]
> Thinking...`,
      commentOptions
    );
    context.thinkingComment = thinkingComment;

    logger.info("Starting Google Drive permission handling");
    let driveContents;
    if (context.config.processDriveLinks && context.config.processDriveLinks === true) {
      try {
        console.log(context.adapters.google);
        const result = await handleDrivePermissions(context, question);
        if (!result) {
          throw logger.error("Drive permission error", { message: "No result returned" });
        }

        const { hasPermission, message, driveContents: contents } = result;
        if (!hasPermission) {
          throw logger.error("Drive permission error", { message });
        }

        driveContents = contents?.length ? contents : undefined;
        logger.info("Drive contents processed", { count: contents?.length || 0 });
      } catch (error) {
        logger.error("Drive Error", { stack: error instanceof Error ? error.stack : "Unknown Error" });
        throw error;
      }
    } else {
      logger.info("Google Drive Skipping", { adapter: context.adapters.google, config: context.config.processDriveLinks });
      driveContents = undefined;
    }
    logger.info("Asking question to LLM", { questionLength: question.length });
    const response = await askQuestion(context, question, driveContents);
    const { answer, tokenUsage, groundTruths } = response;
    if (!answer) {
      throw logger.error(`No answer from OpenAI`);
    }

    const metadataString = createStructuredMetadata(
      // don't change this header, it's used for tracking
      "ubiquity-os-llm-response",
      logger.info(`Answer: ${answer}`, {
        metadata: {
          groundTruths,
          tokenUsage,
        },
      })
    );

    //Check the type of comment
    if ("pull_request" in payload) {
      // This is a pull request review comment
      await addCommentToIssue(context, answer + metadataString, {
        inReplyTo: {
          commentId: payload.comment.id,
        },
      });
    } else {
      await addCommentToIssue(context, answer + metadataString);
    }

    // Update the thinking comment with the final answer
    if (context.thinkingComment) {
      await addCommentToIssue(context, answer + metadataString, {
        inReplyTo: {
          commentId: context.thinkingComment.id,
        },
      });
    }
    return { status: 200, reason: logger.info("Comment posted successfully").logMessage.raw };
  } catch (error) {
    throw await bubbleUpErrorComment(context, error, false);
  }
}

function createStructuredMetadata(header: string | undefined, logReturn: LogReturn) {
  let logMessage, metadata;
  if (logReturn) {
    logMessage = logReturn.logMessage;
    metadata = logReturn.metadata;
  }

  const jsonPretty = sanitizeMetadata(metadata);
  const stackLine = new Error().stack?.split("\n")[2] ?? "";
  const caller = stackLine.match(/at (\S+)/)?.[1] ?? "";
  const ubiquityMetadataHeader = `\n\n<!-- Ubiquity - ${header} - ${caller} - ${metadata?.revision}`;

  let metadataSerialized: string;
  const metadataSerializedVisible = ["```json", jsonPretty, "```"].join("\n");
  const metadataSerializedHidden = [ubiquityMetadataHeader, jsonPretty, "-->"].join("\n");

  if (logMessage?.type === "fatal") {
    // if the log message is fatal, then we want to show the metadata
    metadataSerialized = [metadataSerializedVisible, metadataSerializedHidden].join("\n");
  } else {
    // otherwise we want to hide it
    metadataSerialized = metadataSerializedHidden;
  }

  return metadataSerialized;
}
