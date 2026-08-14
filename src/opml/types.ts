export interface OpmlPreviewEntry {
  key: string;
  feedUrl: string;
  rawXmlUrl: string;
  title: string | null;
  htmlUrl: string | null;
  folderPath: string[];
  status: "new" | "duplicate" | "invalid";
  reason?: string;
}

export interface OpmlPreviewResult {
  documentTitle: string | null;
  entries: OpmlPreviewEntry[];
  totalFound: number;
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  folderNames: string[];
}

export interface OpmlImportSummary {
  found: number;
  imported: number;
  alreadySubscribed: number;
  invalid: number;
  foldersCreated: number;
}
