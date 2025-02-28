import { Context, CommentInfo } from "../types/context";

/**
 * Add a comment to an issue or pull request
 * @param context - The context object containing environment and configuration details
 * @param message - The message to add as a comment
 * @param options - Optional parameters for pull request review comments
 * @returns CommentInfo object containing the created or updated comment's information
 */
export async function addCommentToIssue(context: Context, message: string): Promise<CommentInfo> {
  context.logger.info("Adding a comment...");

  try {
    // Use the comment handler from context to handle the comment logic
    const commentData = await context.commentHandler.postComment(context, context.logger.info(message), {
      updateComment: true,
      raw: true,
    });

    if (!commentData) {
      throw new Error("Failed to add comment: No comment data returned");
    }

    return createCommentInfo(commentData);
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    context.logger.error("Adding a comment failed!", { err: error });
    throw error;
  }
}

interface CommentData {
  id: number;
  body?: string | null;
  user: {
    login: string;
    id: number;
    type?: string;
  } | null;
}

function createCommentInfo(data: CommentData): CommentInfo {
  return {
    id: data.id,
    body: data.body ?? "",
    user: {
      login: data.user?.login ?? "",
      id: data.user?.id ?? 0,
      type: data.user?.type ?? "User",
    },
  };
}
