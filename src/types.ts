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

export interface ListOptions {
  drafts?: boolean;
}

// ── Directive ──
export interface DirectiveInfo {
  name: string;
  type: 'block' | 'inline' | 'code';
  description: string;
  example: string;
}
