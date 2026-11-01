export type Framework =
  | 'next-app'
  | 'next-pages'
  | 'nuxt'
  | 'sveltekit'
  | 'remix'
  | 'react-router'
  | 'astro'
  | 'vue-router'
  | 'tanstack-router';

export type RouteKind = 'page' | 'index' | 'layout' | 'catch-all';

/** One route found by a scanner, before de-duplication and sample hints. */
export interface RawRoute {
  route: string;
  /** Posix path relative to the scanned app folder. */
  file: string;
  line?: number;
  framework: Framework;
  kind: RouteKind;
  /** Component, route name or file stem: a title hint. */
  name?: string;
  guards: string[];
  /** Values for dynamic params found next to the route (generateStaticParams, getStaticPaths). */
  staticParams?: Record<string, string[]>;
}

export interface SkippedRoute {
  file: string;
  line?: number;
  route?: string;
  reason: string;
}

export interface SampleHint {
  param: string;
  value: string;
  /** "file:line" where the value was found. */
  source: string;
}

export interface RouteCandidate {
  route: string;
  file: string;
  line?: number;
  framework: Framework;
  kind: RouteKind;
  name?: string;
  dynamicParams: string[];
  sampleHints: SampleHint[];
  /** The route with the first hint for each param filled in (only when every required param has one). */
  samplePath?: string;
  guards?: string[];
}
