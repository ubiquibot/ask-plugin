import { Context } from "../types";
import { FetchParams, SimplifiedComment } from "../types/github-types";
import { TokenLimits } from "../types/llm";
import { logger } from "./errors";
import { processPullRequestDiff } from "./pull-request-parsing";

interface PullRequestGraphQlResponse {
  repository: {
    pullRequest: {
      body: string;
      closingIssuesReferences: {
        nodes: Array<{
          number: number;
          url: string;
          body: string;
          repository: {
            owner: {
              login: string;
            };
            name: string;
          };
        }>;
      };
      reviews: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        nodes: Array<{
          comments: {
            nodes: Array<{
              id: string;
              body: string;
              author: {
                login: string;
                type: string;
              };
            }>;
          };
        }>;
      };
      comments: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        nodes: Array<{
          id: string;
          body: string;
          author: {
            login: string;
            type: string;
          };
        }>;
      };
    };
  };
}

interface PullRequestLinkedIssue {
  number: number;
  owner: string;
  repo: string;
  url: string;
  body: string;
}

/**
 * Fetch both PR review comments and regular PR comments
 */
export async function fetchPullRequestComments(params: FetchParams) {
  const { octokit } = params.context;
  const { owner, repo, issueNum } = params;

  try {
    // Fetch PR data including both types of comments
    const allComments: SimplifiedComment[] = [];
    const linkedIssues: PullRequestLinkedIssue[] = [];
    let hasMoreComments = true;
    let hasMoreReviews = true;
    let commentsEndCursor: string | null = null;
    let reviewsEndCursor: string | null = null;

    const MAX_PAGES = 100; // Safety limit to prevent infinite loops
    let pageCount = 0;

    while (hasMoreComments || hasMoreReviews) {
      if (pageCount >= MAX_PAGES) {
        logger.error(`Reached maximum page limit (${MAX_PAGES}) while fetching PR comments`, { owner, repo, issueNum });
        break;
      }
      pageCount++;

      logger.info(`Fetching PR comments page ${pageCount}`, { owner, repo, issueNum });
      const prData: PullRequestGraphQlResponse = await octokit.graphql<PullRequestGraphQlResponse>(
        `
        query($owner: String!, $repo: String!, $number: Int!, $commentsAfter: String, $reviewsAfter: String) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              body
              closingIssuesReferences(first: 100) {
                nodes {
                  number
                  url
                  body
                  repository {
                    owner {
                      login
                    }
                    name
                  }
                }
              }
              reviews(first: 100, after: $reviewsAfter) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  comments(first: 100) {
                    nodes {
                      id
                      body
                      author {
                        login
                        type: __typename
                      }
                    }
                  }
                }
              }
              comments(first: 100, after: $commentsAfter) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  id
                  body
                  author {
                    login
                    type: __typename
                  }
                }
              }
            }
          }
        }
      `,
        {
          owner,
          repo,
          number: issueNum,
          commentsAfter: commentsEndCursor,
          reviewsAfter: reviewsEndCursor,
        }
      );

      // Process PR comments for this page
      if (prData.repository.pullRequest.comments.nodes) {
        for (const comment of prData.repository.pullRequest.comments.nodes) {
          if (comment.author.type !== "Bot") {
            allComments.push({
              body: comment.body,
              user: {
                login: comment.author.login,
                type: comment.author.type,
              },
              id: comment.id,
              org: owner || "",
              repo: repo || "",
              issueUrl: `https://github.com/${owner}/${repo}/pull/${issueNum}`,
            });
          }
        }
      }

      // Process review comments for this page
      if (prData.repository.pullRequest.reviews.nodes) {
        for (const review of prData.repository.pullRequest.reviews.nodes) {
          for (const comment of review.comments.nodes) {
            if (comment.author.type !== "Bot") {
              allComments.push({
                body: comment.body,
                user: {
                  login: comment.author.login,
                  type: comment.author.type,
                },
                id: comment.id,
                org: owner || "",
                repo: repo || "",
                issueUrl: `https://github.com/${owner}/${repo}/pull/${issueNum}`,
              });
            }
          }
        }
      }

      // Process linked issues (only needed once)
      if (!commentsEndCursor && !reviewsEndCursor && prData.repository.pullRequest.closingIssuesReferences.nodes) {
        for (const issue of prData.repository.pullRequest.closingIssuesReferences.nodes) {
          linkedIssues.push({
            number: issue.number,
            owner: issue.repository.owner.login,
            repo: issue.repository.name,
            url: issue.url,
            body: issue.body,
          });
        }
      }

      // Update pagination flags and cursors
      hasMoreComments = prData.repository.pullRequest.comments.pageInfo.hasNextPage;
      hasMoreReviews = prData.repository.pullRequest.reviews.pageInfo.hasNextPage;
      commentsEndCursor = prData.repository.pullRequest.comments.pageInfo.endCursor;
      reviewsEndCursor = prData.repository.pullRequest.reviews.pageInfo.endCursor;

      // Break if we've fetched all pages
      if (!hasMoreComments && !hasMoreReviews) {
        break;
      }
    }

    return { comments: allComments, linkedIssues };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error("Error fetching PR comments", { stack: err.stack });
    return { comments: [], linkedIssues: [] };
  }
}

export async function fetchPullRequestDetails(context: Context, org: string, repo: string, pullRequestNumber: number, tokenLimits: TokenLimits) {
  try {
    // Fetch diff
    const diffResponse = await context.octokit.rest.pulls.get({
      owner: org,
      repo,
      pull_number: pullRequestNumber,
      mediaType: { format: "diff" },
    });
    const diff = diffResponse.data as unknown as string;
    return processPullRequestDiff(diff, tokenLimits);
  } catch (e) {
    logger.error(`Error fetching PR details`, { owner: org, repo, issue: pullRequestNumber, err: String(e) });
    return { diff: null };
  }
}
