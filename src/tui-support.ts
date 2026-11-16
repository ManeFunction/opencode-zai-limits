/**
 * Everything the TUI part (`src/tui.tsx`) needs from the server part, in one
 * module. tui.tsx imports only `../dist/tui-support.js`, so its single link
 * into the compiled code is checked by `npm run typecheck` against the
 * emitted declarations.
 */

export { executeGlmQuota } from './index.js';
export { getCredentials } from './utils/credentials.js';
export { detectPlatform } from './api/platforms.js';
export { getEndpoints } from './api/endpoints.js';
export { queryEndpoint } from './api/client.js';
export { parseQuota } from './quota.js';
export type { Quota, QuotaWindow } from './quota.js';
export { formatDuration, timeUntil } from './utils/duration.js';
