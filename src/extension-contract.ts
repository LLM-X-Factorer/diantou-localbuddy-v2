export interface BrowserExtensionSelection {
  allowedOrigins: readonly string[];
  allowActions?: boolean;
}

export interface RunExtensionSelection {
  skillIds?: readonly string[];
  mcpServerIds?: readonly string[];
  allowMcpWrites?: boolean;
  browser?: BrowserExtensionSelection;
}
