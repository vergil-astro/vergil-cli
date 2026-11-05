// ── Content Types ──
export type ContentType = 'post' | 'page' | 'project' | 'album' | 'thought' | 'moment' | 'doc';

export interface ContentMeta {
  title: string;
  description?: string;
  date: string;
  draft?: boolean;
  tags?: string[];
  cover?: string;
  series?: string;
  [key: string]: unknown;
}

// ── CLI Options ──
export interface InitOptions {
  template?: string;
  skipInstall?: boolean;
  skipServe?: boolean;
}

export interface NewOptions {
  draft?: boolean;
  tags?: string;
  cover?: string;
  series?: string;
  website?: string;
  repo?: string;
  description?: string;
  theme?: string;
  path?: string;
}

export interface ServeOptions {
  port?: string;
  host?: boolean;
}

export interface DeployOptions {
  target?: string;
}

export interface JsonOptions {
  /** Print one JSON document to stdout instead of text */
  json?: boolean;
}

export interface ListOptions extends JsonOptions {
  drafts?: boolean;
}
