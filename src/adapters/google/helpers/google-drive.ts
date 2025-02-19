import { google } from "googleapis";
import { Context } from "../../../types";
import { Env } from "../../../types/env";
import { parseOfficeAsync } from "officeparser";
import { GoogleAuth } from "google-auth-library";

export type DriveFileType =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "pdf"
  | "image"
  | "msword"
  | "excel"
  | "powerpoint"
  | "odt"
  | "odp"
  | "ods"
  | "unknown";

interface DriveFileMetadata {
  id: string;
  name?: string;
  mimeType?: string;
  createdTime?: string;
  modifiedTime?: string;
  owners?: Array<{
    displayName?: string;
    emailAddress?: string;
  }>;
  lastModifyingUser?: {
    displayName?: string;
    emailAddress?: string;
  };
  webViewLink?: string;
  thumbnailLink?: string;
  accessMessage?: string; // Added for permission request messages
}

interface ParsedOfficeContent {
  sheets?: Array<{
    name?: string;
    data: string[][];
  }>;
  slides?: Array<{
    title?: string;
    content?: string;
  }>;
  content?: string;
}

interface DocumentContent {
  pages?: Array<{
    pageNumber: number;
    content?: string;
    tables?: Array<{
      rowCount: number;
      columnCount: number;
      data: string[][];
    }>;
    images?: Array<{
      id: string;
      name?: string;
      mimeType: string;
      content: string;
    }>;
  }>;
  sheets?: Array<{
    name: string;
    data: string[][];
  }>;
  slides?: Array<{
    slideNumber: number;
    title?: string;
    textContent?: string;
    binaryContent?: string;
    images?: Array<{
      id: string;
      name?: string;
      mimeType: string;
      content: string;
    }>;
  }>;
  rawContent?: string;
}

interface ParsedDriveLink {
  fileId: string;
  fileType: DriveFileType;
  isAccessible: boolean;
  metadata: DriveFileMetadata;
  content?: string | DocumentContent;
  contentType?: string;
  isBase64?: boolean;
  isStructured?: boolean;
  rawSize?: number;
}

const GOOGLE_APPS = "google-apps";
const VND_PREFIX = "application/vnd.";
const GOOGLE_APPS_PREFIX = `${VND_PREFIX}${GOOGLE_APPS}.`;
const OPENXML_PREFIX = `${VND_PREFIX}openxmlformats-officedocument`;
const MS_OFFICE_PREFIX = `${VND_PREFIX}ms-`;
const OFFICE_MIME_TYPES: Record<"DOCUMENT" | "SPREADSHEET" | "PRESENTATION", readonly string[]> = {
  SPREADSHEET: [`${GOOGLE_APPS_PREFIX}spreadsheet`, `${OPENXML_PREFIX}.spreadsheetml.sheet`, `${MS_OFFICE_PREFIX}excel`],
  DOCUMENT: [`${GOOGLE_APPS_PREFIX}document`, `${OPENXML_PREFIX}.wordprocessingml.document`, `${MS_OFFICE_PREFIX}word`],
  PRESENTATION: [`${GOOGLE_APPS_PREFIX}presentation`, `${OPENXML_PREFIX}.presentationml.presentation`, `${MS_OFFICE_PREFIX}powerpoint`],
};

const DEFAULT_MIME_TYPE = "text/plain";

const EXPORT_MIME_TYPES = {
  GOOGLE: {
    SPREADSHEET: "text/csv",
    DOCUMENT: DEFAULT_MIME_TYPE,
    PRESENTATION: DEFAULT_MIME_TYPE,
  },
  OFFICE: {
    SPREADSHEET: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    DOCUMENT: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    PRESENTATION: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  PDF: "application/pdf",
  PLAIN: DEFAULT_MIME_TYPE,
  HTML: "text/html",
} as const;

export function createGoogleDriveClient(env: Pick<Env, "GOOGLE_SERVICE_ACCOUNT_KEY">): {
  parseDriveLink: (context: Context, url: string) => Promise<ParsedDriveLink>;
  generatePermissionUrl: (fileId: string) => Promise<string>;
} {
  const key = env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const auth = new GoogleAuth({
    credentials: JSON.parse(key),
    scopes: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/cloud-platform"],
  });

  const drive = google.drive({ version: "v3", auth });

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
            fields: "id,name,mimeType,createdTime,modifiedTime,owners,lastModifyingUser,webViewLink,thumbnailLink,size",
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
            metadata: {
              id: fileId,
            },
          };
        }

        const { mimeType = "", name } = metadataResponse.data;
        let fileType: DriveFileType = "unknown";

        if (mimeType === null) {
          return {
            fileId,
            fileType: "unknown",
            isAccessible: false,
            metadata: {
              id: fileId,
            },
          };
        }

        // Determine file type from MIME type
        const isGoogleApps = mimeType.includes(GOOGLE_APPS);
        if (OFFICE_MIME_TYPES.SPREADSHEET.some((type) => mimeType.includes(type))) {
          fileType = isGoogleApps ? "spreadsheet" : "excel";
        } else if (OFFICE_MIME_TYPES.DOCUMENT.some((type) => mimeType.includes(type))) {
          fileType = isGoogleApps ? "document" : "msword";
        } else if (OFFICE_MIME_TYPES.PRESENTATION.some((type) => mimeType.includes(type))) {
          fileType = isGoogleApps ? "presentation" : "powerpoint";
        } else if (mimeType.includes("pdf")) {
          fileType = "pdf";
        } else if (mimeType.includes("image/") || /\.(jpe?g|png|gif|bmp|webp)$/i.test(name || "")) {
          fileType = "image";
        }

        // Get file content if accessible
        let content: string | undefined;
        let documentContent: DocumentContent | undefined;

        try {
          if (mimeType.includes(GOOGLE_APPS)) {
            // Handle Google Workspace files
            let exportMimeType: string;
            switch (fileType) {
              case "spreadsheet":
                exportMimeType = EXPORT_MIME_TYPES.GOOGLE.SPREADSHEET;
                break;
              case "document":
                exportMimeType = EXPORT_MIME_TYPES.GOOGLE.DOCUMENT;
                break;
              case "presentation":
                exportMimeType = EXPORT_MIME_TYPES.GOOGLE.PRESENTATION;
                break;
              default:
                exportMimeType = DEFAULT_MIME_TYPE;
            }

            const exportResponse = await drive.files.export({
              fileId,
              mimeType: exportMimeType,
            });

            if (exportResponse?.data) {
              const textContent = exportResponse.data.toString();

              if (fileType === "spreadsheet") {
                try {
                  const rows = textContent.split("\n").map((row) => row.split(",").map((cell) => cell.trim()));
                  documentContent = {
                    sheets: [
                      {
                        name: "Sheet1",
                        data: rows,
                      },
                    ],
                  };
                } catch (error) {
                  context.logger.error(`Error parsing spreadsheet content: ${error}`);
                  documentContent = {
                    sheets: [
                      {
                        name: "Sheet1",
                        data: [["Error parsing spreadsheet content"]],
                      },
                    ],
                  };
                }
              } else if (fileType === "document") {
                documentContent = {
                  pages: [
                    {
                      pageNumber: 1,
                      content: textContent,
                      tables: [],
                      images: [],
                    },
                  ],
                };
              } else if (fileType === "presentation") {
                const slides = textContent.split(/(?=\n(?:Slide \d+|Title Slide):)/);
                documentContent = {
                  slides: slides.map((slide, index) => {
                    const [title, ...content] = slide.split("\n");
                    return {
                      slideNumber: index + 1,
                      title: title.replace(/^(Slide \d+:|Title Slide:)\s*/, "").trim(),
                      textContent: content.join("\n").trim(),
                      images: [],
                    };
                  }),
                };
              }
            }
          } else if (["powerpoint", "excel", "msword", "pdf", "odt", "odp", "ods"].includes(fileType)) {
            // For non-Google files, download the file content
            const response = await drive.files.get(
              {
                fileId,
                alt: "media",
              },
              { responseType: "arraybuffer" }
            );

            if (response.status === 200 && response.data) {
              const buffer = Buffer.from(response.data as ArrayBuffer);
              content = buffer.toString("base64");

              try {
                const parsedContent = (await parseOfficeAsync(buffer)) as ParsedOfficeContent;

                if (typeof parsedContent === "string") {
                  documentContent = {
                    pages: [
                      {
                        pageNumber: 1,
                        content: parsedContent,
                        images: [],
                      },
                    ],
                    rawContent: content,
                  };
                } else if (parsedContent.sheets) {
                  documentContent = {
                    sheets: parsedContent.sheets.map((sheet, index) => ({
                      name: sheet.name || `Sheet ${index + 1}`,
                      data: sheet.data.map((row) => row.map((cell) => String(cell))),
                    })),
                    rawContent: content,
                  };
                } else if (parsedContent.slides) {
                  documentContent = {
                    slides: parsedContent.slides.map((slide, index) => ({
                      slideNumber: index + 1,
                      title: slide.title || "",
                      textContent: slide.content || "",
                      images: [],
                    })),
                    rawContent: content,
                  };
                }
              } catch (error) {
                context.logger.error(`Error parsing ${fileType} file: ${error}`);
                documentContent = {
                  pages: [
                    {
                      pageNumber: 1,
                      content: `Unable to extract readable content from ${fileType.toUpperCase()} file. File size: ${buffer.length} bytes.`,
                      images: [],
                    },
                  ],
                  rawContent: content,
                };
              }
            }
          } else if (fileType === "image") {
            // Handle image files
            const response = await drive.files.get(
              {
                fileId,
                alt: "media",
              },
              { responseType: "arraybuffer" }
            );

            if (response.status === 200 && response.data) {
              const imageBuffer = Buffer.from(response.data as ArrayBuffer);
              content = imageBuffer.toString("base64");
              documentContent = {
                pages: [
                  {
                    pageNumber: 1,
                    content: `Image file. Size: ${imageBuffer.length} bytes.`,
                    images: [
                      {
                        id: fileId,
                        name: metadataResponse.data.name || "image",
                        mimeType: metadataResponse.data.mimeType || "image/*",
                        content: content,
                      },
                    ],
                  },
                ],
              };
            }
          }

          // Create metadata object with proper type handling
          const metadata: DriveFileMetadata = {
            id: fileId,
            name: metadataResponse.data.name?.toString(),
            mimeType: mimeType,
            createdTime: metadataResponse.data.createdTime?.toString(),
            modifiedTime: metadataResponse.data.modifiedTime?.toString(),
            owners: metadataResponse.data.owners?.map((owner) => ({
              displayName: owner.displayName || undefined,
              emailAddress: owner.emailAddress || undefined,
            })),
            lastModifyingUser: metadataResponse.data.lastModifyingUser
              ? {
                  displayName: metadataResponse.data.lastModifyingUser.displayName || undefined,
                  emailAddress: metadataResponse.data.lastModifyingUser.emailAddress || undefined,
                }
              : undefined,
            webViewLink: metadataResponse.data.webViewLink?.toString(),
            thumbnailLink: metadataResponse.data.thumbnailLink?.toString(),
          };

          return {
            fileId,
            fileType,
            isAccessible: true,
            metadata,
            content: documentContent || content,
            contentType: mimeType,
            isStructured: !!documentContent,
            isBase64: !documentContent && !!content,
            rawSize: content ? Math.round(Buffer.from(content, "base64").length / 1024) : undefined,
          };
        } catch (error) {
          // If content fetch fails, we'll still return metadata
          context.logger.error(`Failed to fetch or parse file content: ${error}`);
          console.error("Failed to fetch or parse file content:", error);

          return {
            fileId,
            fileType,
            isAccessible: true,
            metadata: {
              id: fileId,
              name: name?.toString(),
              mimeType: mimeType,
            },
            content: `Error: Unable to fetch or parse file content. ${error}`,
          };
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("403")) {
          const serviceAccountEmail = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY).client_email;
          const accessMessage = serviceAccountEmail
            ? `Please share the file with ${serviceAccountEmail} to grant access.`
            : "Please ensure the file is shared with the service account (contact administrator for the email address).";

          return {
            fileId,
            fileType: "unknown",
            isAccessible: false,
            metadata: {
              id: fileId,
              accessMessage,
            },
          };
        }
        throw error;
      }
    },

    /**
     * Generate a permission request URL for a file
     */
    generatePermissionUrl: async (fileId: string): Promise<string> => {
      const serviceAccountEmail = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY).client_email;
      if (!serviceAccountEmail) {
        throw new Error("Could not fetch service account email");
      }
      console.log("Service account email:", serviceAccountEmail);
      // Generate sharing link that pre-fills the service account email
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
