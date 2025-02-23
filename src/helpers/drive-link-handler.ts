import { Context } from "../types";
import { bubbleUpErrorComment } from "./errors";

const POLL_INTERVAL = 25000; // 25 seconds
const MAX_POLL_TIME = 900000; // 15 minutes

interface DriveLink {
  url: string;
  requiresPermission: boolean;
}

/**
 * Check for Drive links and their accessibility
 */
export async function checkDriveLinks(context: Context, question: string): Promise<DriveLink[]> {
  try {
    const { google } = context.adapters;
    const driveUrlPattern = /https:\/\/(docs|drive|sheets|slides)\.google\.com\/[^\s"<>)}\]]+(?=[\s"<>)}\]]|$)/g;
    const matches = [...question.matchAll(driveUrlPattern)];

    if (matches.length === 0) {
      context.logger.info("No Drive links found in regex search");
      return [];
    }

    context.logger.info(`Found ${matches.length} potential Drive links: ${matches.map((m) => m[0]).join(", ")}`);

    const processedUrls = new Set<string>();
    const driveLinks: DriveLink[] = [];

    for (const match of matches) {
      const url = match[0];
      if (processedUrls.has(url)) {
        continue;
      }
      processedUrls.add(url);

      try {
        const result = await google.drive.parseDriveLink(context, url);

        if (!result.isAccessible) {
          driveLinks.push({
            url,
            requiresPermission: true,
          });
        } else {
          driveLinks.push({
            url,
            requiresPermission: false,
          });
        }
      } catch (error) {
        context.logger.error(`Error processing Drive link ${url}: ${error}`);
        // Skip invalid links
        continue;
      }
    }

    context.logger.info(`Processed ${driveLinks.length} valid Drive links`);
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
        const result = await context.adapters.google.drive.parseDriveLink(context, link.url);
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
export function formatAccessRequestMessage(context: Context, links: DriveLink[]): string {
  const linksNeedingPermission = links.filter((link) => link.requiresPermission);

  if (linksNeedingPermission.length === 0) {
    return "";
  }

  const fileList = linksNeedingPermission.map((link) => `- ${link.url}`).join("\n");
  const serviceAccountEmail = JSON.parse(context.env.GOOGLE_SERVICE_ACCOUNT_KEY).client_email;

  return `I need access to continue. Please share these files with ${serviceAccountEmail}:\n\n${fileList}\n\nI'll wait up to 15 minutes for access to be granted.`;
}

/**
 * Get content from Drive files once access is granted
 */
export async function getDriveContents(
  context: Context,
  links: DriveLink[]
): Promise<{ contents: Record<string, string>; driveContents: Array<{ name: string; content: string }> }> {
  const contents: Record<string, string> = {};
  context.logger.info(`Fetching content for ${links.length} Drive files`);
  for (const link of links) {
    context.logger.info(`Fetching content for ${link.url}`);
    try {
      const result = await context.adapters.google.drive.parseDriveLink(context, link.url);
      context.logger.info(`Parsed Drive link: ${JSON.stringify(result)}`);
      if (result.isAccessible && result.content) {
        context.logger.info(`Fetched content for "${result.metadata.name}" with type ${result.fileType}`);

        if (result.isStructured && typeof result.content === "object") {
          // Handle structured content (Google Docs, Sheets, Slides)
          let formattedContent = "";
          if (result.content.pages) {
            // Google Docs
            formattedContent = result.content.pages
              .map((page) => {
                let pageContent = `Page ${page.pageNumber}:\n${page.content || ""}`;
                if (page.tables?.length) {
                  pageContent += "\n\nTables:\n" + page.tables.map((table) => table.data.map((row) => row.join("\t")).join("\n")).join("\n\n");
                }
                return pageContent;
              })
              .join("\n\n");
          } else if (result.content.sheets) {
            // Google Sheets
            formattedContent = result.content.sheets
              .map((sheet) => `Sheet "${sheet.name}":\n${sheet.data.map((row) => row.join("\t")).join("\n")}`)
              .join("\n\n");
          } else if (result.content.slides) {
            // Google Slides
            formattedContent = result.content.slides
              .map((slide) => {
                const titleText = slide.title ? ` - ${slide.title}` : "";
                return `Slide ${slide.slideNumber}${titleText}:\n${slide.textContent || ""}`;
              })
              .join("\n\n");
          }
          contents[link.url] = `Content of "${result.metadata.name}":\n\n${formattedContent}`;
        } else if (result.isBase64) {
          // For binary content, just indicate the type and size
          const contentStr = result.content as string;
          const FILE_SIZE_KB = Math.round((contentStr.length * 3) / 4 / 1024); // Approximate size of base64 data
          contents[link.url] = `File "${result.metadata.name}" (${result.fileType}, ${FILE_SIZE_KB}KB)`;
        } else if (typeof result.content === "string") {
          // Plain text content
          contents[link.url] = `Content of "${result.metadata.name}":\n${result.content}`;
        }
      }
    } catch (error) {
      console.log(JSON.stringify(error, null, 2));
      context.logger.error(`Failed to fetch content for ${link.url}: ${error}`);
      continue;
    }
  }

  const driveContents = Object.entries(contents).map(([url, content]) => {
    const match = url.match(/\/d\/([^/]+)/);
    return {
      name: match ? `document-${match[1]}` : url,
      content: content,
    };
  });
  return { contents, driveContents };
}

import { addCommentToIssue } from "../handlers/add-comment";

/**
 * Handle Drive permission flow
 */
export async function handleDrivePermissions(
  context: Context,
  question: string
): Promise<{ hasPermission: boolean; message?: string; driveContents?: Array<{ name: string; content: string }> }> {
  context.logger.info("Checking for Drive links in the question");
  // Check for Drive links
  const driveLinks = await checkDriveLinks(context, question);
  context.logger.info(`Found ${driveLinks.length} Drive links`);

  if (driveLinks.length === 0) {
    context.logger.info("No Drive links found, returning hasPermission: true");
    return { hasPermission: true };
  }

  // If any links need permission, start polling flow
  const accessMessage = formatAccessRequestMessage(context, driveLinks); // Pass context here
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
      context.logger.warn("Access not granted within time limit");
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
  const { driveContents } = await getDriveContents(context, driveLinks);

  context.logger.info(`Returning hasPermission: true, driveContents count: ${driveContents.length}`);
  return {
    hasPermission: true,
    driveContents: driveContents.length > 0 ? driveContents : undefined,
  };
}
