/**
 * API endpoints module
 * Defines the monitor endpoints for the ZAI and ZHIPU platforms
 */

import type { Platform } from './platforms.js';

/**
 * Endpoint URLs type
 */
type Endpoints = {
  readonly modelUsage: string;
  readonly toolUsage: string;
  readonly quotaLimit: string;
};

/**
 * API endpoints configuration by platform
 */
const ENDPOINTS = {
  ZAI: {
    modelUsage: 'https://api.z.ai/api/monitor/usage/model-usage',
    toolUsage: 'https://api.z.ai/api/monitor/usage/tool-usage',
    quotaLimit: 'https://api.z.ai/api/monitor/usage/quota/limit'
  },
  ZHIPU: {
    modelUsage: 'https://open.bigmodel.cn/api/monitor/usage/model-usage',
    toolUsage: 'https://open.bigmodel.cn/api/monitor/usage/tool-usage',
    quotaLimit: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'
  }
} as const satisfies Record<Platform, Endpoints>;

/**
 * Get endpoints for a platform
 * @param platform - The platform type
 * @returns Endpoints configuration
 */
function getEndpoints(platform: Platform): Endpoints {
  // Keyed by Platform: a new platform without endpoints fails to compile
  // instead of silently falling back to api.z.ai.
  return ENDPOINTS[platform];
}

export type { Endpoints };
export { getEndpoints };
