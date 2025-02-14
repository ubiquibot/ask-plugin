import { Context } from "../types";
import { bubbleUpErrorComment } from "./errors";

const POLL_INTERVAL = 25000; // 25 seconds
const MAX_POLL_TIME = 900000; // 15 minutes

interface DriveLink {
  url: string;
  requiresPermission: boolean;
  permissionUrl?: string;
}

/**
 * Check for Drive links and their accessibility
 */
export async function checkDriveLinks(context: Context, question: string): Promise<DriveLink[]> {
  try {
    const { google } = context.adapters;
    const driveUrlPattern = /https:\/\/(docs|drive|sheets|slides)\.google\.com\/[^\s"<>)}\]]+(?=[\s"<>)}\]]|$)/g;
    const matches = question.match(driveUrlPattern);

    if (!matches) {
      return [];
    }

    const processedUrls = new Set<string>();
    const driveLinks: DriveLink[] = [];

    for (const url of matches) {
      if (processedUrls.has(url)) {
        continue;
      }
      processedUrls.add(url);

      try {
        const result = await google.drive.parseDriveLink(url);

        if (!result.isAccessible) {
          const permissionUrl = await google.drive.generatePermissionUrl(result.fileId);
          driveLinks.push({
            url,
            requiresPermission: true,
            permissionUrl,
          });
        } else {
          driveLinks.push({
            url,
            requiresPermission: false,
          });
        }
      } catch {
        // Skip invalid links
        continue;
      }
    }

    return driveLinks;
  } catch (error) {
    throw bubbleUpErrorComment(context, error, false);
  }
}

/**
 * Poll for access to Drive files
 */
export async function checkAccessStatus(context: Context, links: DriveLink[]): Promise<boolean> {
  const startTime = Date.now();
  const linksNeedingPermission = links.filter((link) => link.requiresPermission);

  if (linksNeedingPermission.length === 0) {
    return true;
  }

  while (Date.now() - startTime < MAX_POLL_TIME) {
    let hasFullAccess = true;

    for (const link of linksNeedingPermission) {
      try {
        const result = await context.adapters.google.drive.parseDriveLink(link.url);
        if (!result.isAccessible) {
          hasFullAccess = false;
          break;
        }
      } catch {
        hasFullAccess = false;
        break;
      }
    }

    if (hasFullAccess) {
      return true;
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  return false;
}

/**
 * Format access request message
 */
export function formatAccessRequestMessage(links: DriveLink[]): string {
  const linksNeedingPermission = links.filter((link) => link.requiresPermission);

  if (linksNeedingPermission.length === 0) {
    return "";
  }

  const urlList = linksNeedingPermission.map((link) => `- ${link.permissionUrl}`).join("\n");

  return `I need access to continue. Please click these links and grant permission:\n\n${urlList}\n\nI'll wait up to 15 minutes for access to be granted.`;
}

/**
 * Get content from Drive files once access is granted
 */
export async function getDriveContents(context: Context, links: DriveLink[]): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};

  for (const link of links) {
    try {
      const result = await context.adapters.google.drive.parseDriveLink(link.url);
      if (result.isAccessible && result.content) {
        context.logger.info(`Fetched content for "${result.name} and "${result.content}" characters`);
        contents[link.url] = `Content of "${result.name}":\n${result.content}`;
      }
    } catch (error) {
      console.log(JSON.stringify(error, null, 2));
      context.logger.error(`Failed to fetch content for ${link.url}: ${error}`);
      continue;
    }
  }

  return contents;
}

import { addCommentToIssue } from "../handlers/add-comment";

/**
 * Handle Drive permission flow
 */
export async function handleDrivePermissions(context: Context, question: string): Promise<{ hasPermission: boolean; message?: string; content?: string }> {
  context.logger.info("Checking for Drive links in the question");
  // Check for Drive links
  const driveLinks = await checkDriveLinks(context, question);
  context.logger.info(`Found ${driveLinks.length} Drive links`);

  if (driveLinks.length === 0) {
    context.logger.info("No Drive links found, returning hasPermission: true");
    return { hasPermission: true };
  }

  // If any links need permission, start polling flow
  const accessMessage = formatAccessRequestMessage(driveLinks);
  context.logger.info(`Access message: ${accessMessage}`);

  if (accessMessage) {
    context.logger.info("Some links require permission, starting polling flow");
    // Update thinking comment with access request message
    if (context.thinkingComment) {
      await addCommentToIssue(
        context,
        `${accessMessage}\n\nPlease grant access to the Google Drive files. I'll check again in ${POLL_INTERVAL / 1000} seconds.`,
        {
          inReplyTo: { commentId: context.thinkingComment.id },
        }
      );
    }

    const startTime = Date.now();
    let hasAccess = false;

    while (Date.now() - startTime < MAX_POLL_TIME) {
      hasAccess = await checkAccessStatus(context, driveLinks);
      if (hasAccess) break;

      // Update thinking comment with waiting message
      if (context.thinkingComment) {
        await addCommentToIssue(context, `Still waiting for access. I'll check again in ${POLL_INTERVAL / 1000} seconds.`, {
          inReplyTo: { commentId: context.thinkingComment.id },
        });
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }

    if (!hasAccess) {
      context.logger.info("Access not granted within time limit");
      if (context.thinkingComment) {
        await addCommentToIssue(context, `Access was not granted within the ${MAX_POLL_TIME / 60000} minute time limit. Please try again.`, {
          inReplyTo: { commentId: context.thinkingComment.id },
        });
      }
      return { hasPermission: false, message: "Access not granted within time limit." };
    }

    context.logger.info("Access granted to all Google Drive files");
    // Update thinking comment indicating access was granted
    if (context.thinkingComment) {
      await addCommentToIssue(context, "Access granted to all Google Drive files. Proceeding with the request.", {
        inReplyTo: { commentId: context.thinkingComment.id },
      });
    }
  }

  context.logger.info("Fetching contents of accessible Drive files");
  // All files are now accessible, get their contents
  const contents = await getDriveContents(context, driveLinks);
  const contentString = Object.values(contents).join("\n\n");

  context.logger.info(`Returning hasPermission: true, content length: ${contentString.length}`);
  return {
    hasPermission: true,
    content: contentString || undefined,
  };
}
