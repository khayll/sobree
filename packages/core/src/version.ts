import { version } from "../package.json";

/**
 * The published `@sobree/core` version, baked in from `package.json` at
 * build time. Useful for confirming which renderer build is actually
 * running — e.g. past a stale CDN / browser cache after a deploy.
 */
export const VERSION: string = version;
