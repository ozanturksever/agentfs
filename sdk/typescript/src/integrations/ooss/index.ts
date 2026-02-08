/**
 * OOSS Integration Module for AgentFS
 * 
 * This module provides all the components needed to integrate AgentFS with
 * the OOSS (OS-022) sandboxing platform:
 * 
 * - **Permission Hooks**: Access control hooks for filesystem operations
 * - **Metadata Helpers**: Standard OOSS metadata storage in KV store
 * - **Convex Streaming**: Real-time toolcall event streaming to Convex
 * - **Git Overlay**: Initialize AgentFS with a git repo as base layer
 * 
 * @example
 * ```typescript
 * import {
 *   setOOSSMetadata,
 *   createPermissionHooks,
 *   createConvexStreamer,
 *   initializeOverlay,
 * } from 'agentfs-sdk/ooss';
 * 
 * // Initialize AgentFS with OOSS integration
 * const agent = await AgentFS.open({ id: 'sandbox' });
 * 
 * // Set workspace metadata
 * await setOOSSMetadata(agent.kv, {
 *   workspaceId: 'ws_abc',
 *   workloadId: 'wl_xyz',
 *   sandboxId: 'sbx_123',
 *   trustClass: 'agent',
 *   allowedPaths: ['/workspace/**'],
 *   deniedPaths: ['/workspace/.env'],
 *   createdAt: Date.now(),
 * });
 * 
 * // Setup permission hooks
 * const hooks = createPermissionHooks(agent.kv);
 * hooks.setAccessHook(async (ctx) => {
 *   // Custom permission logic
 *   return true;
 * });
 * 
 * // Start streaming toolcalls to Convex
 * const streamer = createConvexStreamer(agent.tools, {
 *   convexClient,
 *   mutationPath: 'sandbox:recordToolcalls',
 * });
 * streamer.start();
 * ```
 * 
 * @packageDocumentation
 */

// Types
export type {
  FileOperation,
  AccessHook,
  AccessHookContext,
  OOSSMetadata,
  ConvexStreamConfig,
  ConvexClientLike,
  ConvexToolcallEvent,
  OverlayConfig,
  OverlayChange,
  PermissionCheckResult,
} from './types.js';

export { PermissionDeniedError } from './types.js';

// Permission Hooks
export {
  PermissionHooks,
  createPermissionHooks,
  createPatternAccessHook,
  matchPathPattern,
  checkPathPatterns,
} from './permission-hooks.js';

// Metadata Helpers
export {
  setOOSSMetadata,
  getOOSSMetadata,
  updateOOSSMetadata,
  deleteOOSSMetadata,
  hasOOSSMetadata,
  getWorkspaceId,
  getWorkloadId,
  getSandboxId,
  getTrustClass,
  getAllowedPaths,
  getDeniedPaths,
  setAllowedPaths,
  setDeniedPaths,
  isExpired,
  getCustomMetadata,
  setCustomMetadata,
  createDefaultMetadata,
} from './metadata.js';

// Convex Streaming
export {
  ConvexToolcallStreamer,
  createConvexStreamer,
  ConvexToolcallsWrapper,
  wrapToolcallsWithConvex,
} from './convex-streamer.js';

// Git Overlay
export {
  initializeOverlay,
  getOverlayChanges,
  exportOverlayAsPatch,
  resetOverlay,
  type OverlayInitResult,
} from './overlay.js';

// Protected Filesystem
export {
  ProtectedFileSystem,
  createProtectedFS,
} from './protected-fs.js';
