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
  return {
    /**
     * Parse a Google Drive link and extract file information
     */
    parseDriveLink: async (url: string): Promise<ParsedDriveLink> => {
      // Extract file ID from various Google Drive URL formats
      const fileId = extractFileId(url);
      if (!fileId) {
        throw new Error("Invalid Google Drive URL");
      }

      try {
        // Make a metadata request to check file accessibility
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?key=${env.GOOGLE_API_KEY}&fields=mimeType,name`, { method: "GET" });

        if (!response.ok) {
          if (response.status === 403 || response.status === 404) {
            return {
              fileId,
              fileType: "unknown",
              isAccessible: false,
            };
          }
          throw new Error(`Failed to fetch file info: ${response.statusText}`);
        }

        const data = await response.json();
        let fileType: DriveFileType = "unknown";

        // Determine file type from MIME type
        const mimeType = data.mimeType?.toLowerCase() || "";
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
          const contentResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?key=${env.GOOGLE_API_KEY}&alt=media`, { method: "GET" });

          if (contentResponse.ok) {
            // For different file types, handle content appropriately
            if (fileType === "document" || fileType === "pdf") {
              content = await contentResponse.text();
            } else if (fileType === "spreadsheet") {
              const jsonData = await contentResponse.json();
              content = JSON.stringify(jsonData, null, 2);
            }
          }
        } catch (error) {
          // If content fetch fails, we'll still return metadata
          console.error("Failed to fetch file content:", error);
        }

        return {
          fileId,
          fileType,
          isAccessible: true,
          name: data.name,
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
