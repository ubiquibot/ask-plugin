import { Context, CommentInfo } from "../types/context";

interface CommentOptions {
  inReplyTo?: {
    commentId?: number; // Required for replying to existing comments
  };
}

/**
 * Add a comment to an issue or pull request
 * @param context - The context object containing environment and configuration details
 * @param message - The message to add as a comment
 * @param options - Optional parameters for pull request review comments
 * @returns CommentInfo object containing the created or updated comment's information
 */
export async function addCommentToIssue(context: Context, message: string, options?: CommentOptions): Promise<CommentInfo> {
  const { payload } = context;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;

  try {
    let commentInfo: CommentInfo;

    // If this is a pull request review comment
    if (options?.inReplyTo) {
      let pullNumber: number | undefined;

      if ("pull_request" in payload) {
        pullNumber = payload.pull_request.number;
      } else if ("issue" in payload && payload.issue.pull_request) {
        pullNumber = payload.issue.number;
      } else {
        pullNumber = undefined;
      }

      if (!pullNumber) {
        throw new Error("Cannot add review comment: not a pull request");
      }

      if (options.inReplyTo.commentId) {
        // Reply to an existing review comment
        if (addCommentToIssue.lastCommentId) {
          const { data } = await context.octokit.rest.pulls.updateReviewComment({
            owner,
            repo,
            body: message,
            comment_id: addCommentToIssue.lastCommentId,
          });
          commentInfo = createCommentInfo(data);
        } else {
          const { data } = await context.octokit.rest.pulls.createReplyForReviewComment({
            owner,
            repo,
            pull_number: pullNumber,
            body: message,
            comment_id: options.inReplyTo.commentId,
          });
          addCommentToIssue.lastCommentId = data.id;
          commentInfo = createCommentInfo(data);
        }
      } else {
        throw new Error("Comment ID is required for replying to a review comment");
      }
    } else {
      // Regular issue comment
      let issueNumber: number | undefined;
      if ("issue" in payload) {
        issueNumber = payload.issue.number;
      } else if ("pull_request" in payload) {
        issueNumber = payload.pull_request.number;
      } else {
        issueNumber = undefined;
      }

      if (!issueNumber) {
        throw new Error("Cannot determine issue/PR number");
      }

      if (addCommentToIssue.lastCommentId) {
        const { data } = await context.octokit.rest.issues.updateComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: message,
          comment_id: addCommentToIssue.lastCommentId,
        });
        commentInfo = createCommentInfo(data);
      } else {
        const { data } = await context.octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: message,
        });
        addCommentToIssue.lastCommentId = data.id;
        commentInfo = createCommentInfo(data);
      }
    }

    return commentInfo;
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    let commentType = "issue_comment";
    if (options?.inReplyTo?.commentId) {
      commentType = "review_reply";
    } else if (options?.inReplyTo) {
      commentType = "review_comment";
    }
    context.logger.error("Adding a comment failed!", {
      err: error,
      type: commentType,
    });
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

addCommentToIssue.lastCommentId = null as number | null;
