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

export interface DriveFileMetadata {
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
  accessMessage?: string;
}

export interface ParsedOfficeContent {
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

export interface DocumentContent {
  pages?: Array<{
    pageNumber: number;
    content?: string;
    tables?: Array<{
      rowCount: number;
      columnCount: number;
      data: string[][];
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
  }>;
  image?: Array<{
    title?: string;
    content?: string;
  }>;
  rawContent?: string;
}

export interface ParsedDriveLink {
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
