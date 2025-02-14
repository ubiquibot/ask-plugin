import { google } from "googleapis";
import { Context } from "../../../types";
import { Env } from "../../../types/env";

export type DriveFileType = "document" | "spreadsheet" | "presentation" | "pdf" | "unknown";

interface ParsedDriveLink {
  fileId: string;
  fileType: DriveFileType;
  isAccessible: boolean;
  name?: string;
  content?: string;
}

export function createGoogleDriveClient(env: Pick<Env, "GOOGLE_API_KEY">) {
  const drive = google.drive({
    version: "v3",
    auth: env.GOOGLE_API_KEY,
  });

  return {
    /**
     * Parse a Google Drive link and extract file information
     */
    parseDriveLink: async (context: Context, url: string): Promise<ParsedDriveLink> => {
      // Extract file ID from various Google Drive URL formats
      const fileId = extractFileId(url);
      if (!fileId) {
        throw new Error("Invalid Google Drive URL");
      }

      try {
        // Get file metadata
        const metadataResponse = await drive.files
          .get({
            fileId,
            fields: "mimeType,name",
          })
          .catch((error) => {
            if (error.code === 403 || error.code === 404) {
              return null;
            }
            throw error;
          });

        if (!metadataResponse) {
          return {
            fileId,
            fileType: "unknown",
            isAccessible: false,
          };
        }

        const { mimeType = "", name } = metadataResponse.data;
        let fileType: DriveFileType = "unknown";

        if (mimeType === null) {
          return {
            fileId,
            fileType: "unknown",
            isAccessible: false,
          };
        }

        // Determine file type from MIME type
        if (mimeType.includes("spreadsheet")) {
          fileType = "spreadsheet";
        } else if (mimeType.includes("document")) {
          fileType = "document";
        } else if (mimeType.includes("presentation")) {
          fileType = "presentation";
        } else if (mimeType.includes("pdf")) {
          fileType = "pdf";
        }

        // Get file content if accessible
        let content: string | undefined;
        try {
          const contentResponse = await drive.files.export(
            {
              fileId,
              alt: "media",
              mimeType: "text/plain",
            },
            { responseType: "stream" }
          );

          context.logger.info("Content response status: " + contentResponse.status);

          if (contentResponse.status === 200 && contentResponse.data) {
            // Convert stream to string
            const chunks: Buffer[] = [];
            for await (const chunk of contentResponse.data) {
              chunks.push(Buffer.from(chunk));
            }
            const rawContent = Buffer.concat(chunks).toString("utf-8");
            // For different file types, handle content appropriately
            if (fileType === "document" || fileType === "pdf") {
              content = rawContent;
            } else if (fileType === "spreadsheet") {
              content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent, null, 2);
            }
          }
        } catch (error) {
          // If content fetch fails, we'll still return metadata
          context.logger.error("Failed to fetch file content:" + JSON.stringify(error));
          console.error("Failed to fetch file content:", error);
        }

        return {
          fileId,
          fileType,
          isAccessible: true,
          name: name?.toString(),
          content,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("403")) {
          return {
            fileId,
            fileType: "unknown",
            isAccessible: false,
          };
        }
        throw error;
      }
    },

    /**
     * Generate a permission request URL for a file
     */
    generatePermissionUrl: async (fileId: string): Promise<string> => {
      // Generate appropriate sharing link
      return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
    },
  };
}

/**
 * Extract file ID from various Google Drive URL formats
 */
function extractFileId(url: string): string | null {
  const patterns = [
    // Direct file links
    /\/d\/([-\w]{25,})/, // /d/ format
    /\/file\/d\/([-\w]{25,})/, // File format
    /id=([-\w]{25,})/, // id= format

    // Google Apps direct links
    /spreadsheets\/d\/([-\w]{25,})/, // Sheets
    /document\/d\/([-\w]{25,})/, // Docs
    /presentation\/d\/([-\w]{25,})/, // Slides

    // Editor URLs
    /spreadsheets\/d\/([-\w]{25,})\/edit/, // Sheets editor
    /document\/d\/([-\w]{25,})\/edit/, // Docs editor
    /presentation\/d\/([-\w]{25,})\/edit/, // Slides editor
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}
