/**
 * Git Overlay Initialization for AgentFS
 * 
 * Provides helpers to initialize AgentFS with a git repository as the base layer,
 * enabling copy-on-write modifications that leave the original repo unchanged.
 */

import type { FileSystem, Stats } from '../../filesystem/interface.js';
import type { OverlayConfig, OverlayChange } from './types.js';
import { readdir, readFile, lstat, readlink as nodeReadlink } from 'fs/promises';
import { join, relative } from 'path';

/**
 * Initialize AgentFS overlay from a git repository base
 * 
 * This copies the file metadata structure from a git checkout into AgentFS,
 * establishing it as the "base layer". All subsequent modifications are
 * tracked as overlay changes.
 * 
 * @param fs - AgentFS filesystem instance
 * @param config - Overlay configuration
 */
export async function initializeOverlay(
  fs: FileSystem,
  config: OverlayConfig
): Promise<OverlayInitResult> {
  const {
    basePath,
    excludePatterns = [],
    mountPath = '/',
  } = config;

  const result: OverlayInitResult = {
    filesImported: 0,
    directoriesCreated: 0,
    bytesImported: 0,
    excludedPaths: [],
  };

  // Create mount point if needed
  if (mountPath !== '/') {
    await ensureDirectory(fs, mountPath);
    result.directoriesCreated++;
  }

  // Walk the base directory and import files
  await walkDirectory(
    basePath,
    mountPath,
    async (srcPath, destPath, stats) => {
      // Check exclusion patterns
      const relativePath = relative(basePath, srcPath);
      if (shouldExclude(relativePath, excludePatterns)) {
        result.excludedPaths.push(relativePath);
        return;
      }

      if (stats.isDirectory()) {
        await ensureDirectory(fs, destPath);
        result.directoriesCreated++;
      } else if (stats.isFile()) {
        const content = await readFile(srcPath);
        await fs.writeFile(destPath, content);
        result.filesImported++;
        result.bytesImported += content.length;
      } else if (stats.isSymbolicLink()) {
        const target = await nodeReadlink(srcPath);
        await fs.symlink(target, destPath);
        result.filesImported++;
      }
    }
  );

  return result;
}

/**
 * Result of overlay initialization
 */
export interface OverlayInitResult {
  /** Number of files imported */
  filesImported: number;
  /** Number of directories created */
  directoriesCreated: number;
  /** Total bytes imported */
  bytesImported: number;
  /** Paths that were excluded */
  excludedPaths: string[];
}

/**
 * Get all changes made in the overlay since initialization
 * 
 * This compares the current AgentFS state with the base layer to identify
 * all added, modified, and deleted files.
 * 
 * @param fs - AgentFS filesystem instance
 * @param basePath - Path to the original git checkout
 * @param mountPath - Mount path in AgentFS (default: '/')
 * @returns Array of overlay changes
 */
export async function getOverlayChanges(
  fs: FileSystem,
  basePath: string,
  mountPath: string = '/'
): Promise<OverlayChange[]> {
  const changes: OverlayChange[] = [];

  // Build set of base files
  const baseFiles = new Map<string, { size: number; isDir: boolean }>();
  await walkDirectory(
    basePath,
    mountPath,
    async (srcPath, destPath, stats) => {
      const relativePath = destPath.startsWith(mountPath) 
        ? destPath.slice(mountPath.length) || '/'
        : destPath;
      baseFiles.set(relativePath, {
        size: stats.size,
        isDir: stats.isDirectory(),
      });
    }
  );

  // Walk AgentFS and compare
  const overlayFiles = new Set<string>();
  await walkAgentFS(
    fs,
    mountPath,
    async (path, stats) => {
      const relativePath = path.startsWith(mountPath) 
        ? path.slice(mountPath.length) || '/'
        : path;
      overlayFiles.add(relativePath);

      const baseInfo = baseFiles.get(relativePath);
      
      if (!baseInfo) {
        // File was added
        if (!stats.isDirectory()) {
          const content = await fs.readFile(path);
          changes.push({
            path: relativePath,
            type: 'added',
            content: new Uint8Array(content),
            mode: stats.mode,
          });
        }
      } else if (!baseInfo.isDir && !stats.isDirectory()) {
        // Check if file was modified (compare size for quick check)
        if (stats.size !== baseInfo.size) {
          const content = await fs.readFile(path);
          const srcPath = join(basePath, relativePath);
          const originalContent = await readFile(srcPath);
          
          changes.push({
            path: relativePath,
            type: 'modified',
            content: new Uint8Array(content),
            originalContent: new Uint8Array(originalContent),
            mode: stats.mode,
          });
        } else {
          // Same size - compare content
          const content = await fs.readFile(path);
          const srcPath = join(basePath, relativePath);
          const originalContent = await readFile(srcPath);
          
          if (!buffersEqual(content, originalContent)) {
            changes.push({
              path: relativePath,
              type: 'modified',
              content: new Uint8Array(content),
              originalContent: new Uint8Array(originalContent),
              mode: stats.mode,
            });
          }
        }
      }
    }
  );

  // Check for deleted files
  for (const [path, info] of baseFiles) {
    if (!overlayFiles.has(path) && !info.isDir) {
      changes.push({
        path,
        type: 'deleted',
      });
    }
  }

  return changes;
}

/**
 * Export overlay changes as a unified diff patch
 * 
 * @param changes - Array of overlay changes
 * @returns Unified diff format string
 */
export function exportOverlayAsPatch(changes: OverlayChange[]): string {
  const lines: string[] = [];

  for (const change of changes) {
    if (change.type === 'added') {
      lines.push(`diff --git a${change.path} b${change.path}`);
      lines.push('new file mode 100644');
      lines.push(`--- /dev/null`);
      lines.push(`+++ b${change.path}`);
      
      if (change.content) {
        const contentLines = new TextDecoder().decode(change.content).split('\n');
        lines.push(`@@ -0,0 +1,${contentLines.length} @@`);
        for (const line of contentLines) {
          lines.push(`+${line}`);
        }
      }
    } else if (change.type === 'deleted') {
      lines.push(`diff --git a${change.path} b${change.path}`);
      lines.push('deleted file mode 100644');
      lines.push(`--- a${change.path}`);
      lines.push(`+++ /dev/null`);
      // Note: Without original content, we can't show the removed lines
      lines.push('@@ -1 +0,0 @@');
      lines.push('-[content deleted]');
    } else if (change.type === 'modified') {
      lines.push(`diff --git a${change.path} b${change.path}`);
      lines.push(`--- a${change.path}`);
      lines.push(`+++ b${change.path}`);
      
      // Simple diff - show old and new content
      // In production, you'd want to use a proper diff algorithm
      if (change.originalContent && change.content) {
        const oldLines = new TextDecoder().decode(change.originalContent).split('\n');
        const newLines = new TextDecoder().decode(change.content).split('\n');
        
        lines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);
        for (const line of oldLines) {
          lines.push(`-${line}`);
        }
        for (const line of newLines) {
          lines.push(`+${line}`);
        }
      }
    }
    
    lines.push(''); // Empty line between files
  }

  return lines.join('\n');
}

/**
 * Reset overlay by removing all modifications
 * 
 * This deletes all files in the AgentFS mount point and re-imports from base.
 * 
 * @param fs - AgentFS filesystem instance
 * @param config - Original overlay configuration
 */
export async function resetOverlay(
  fs: FileSystem,
  config: OverlayConfig
): Promise<OverlayInitResult> {
  const mountPath = config.mountPath ?? '/';

  // Delete all files in mount point
  if (mountPath !== '/') {
    await fs.rm(mountPath, { recursive: true, force: true });
  } else {
    // For root mount, delete each top-level entry
    const entries = await fs.readdir('/');
    for (const entry of entries) {
      await fs.rm(`/${entry}`, { recursive: true, force: true });
    }
  }

  // Re-initialize from base
  return initializeOverlay(fs, config);
}

// Helper functions

async function ensureDirectory(fs: FileSystem, path: string): Promise<void> {
  try {
    await fs.stat(path);
  } catch {
    // Directory doesn't exist, create it
    const parts = path.split('/').filter(p => p);
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      try {
        await fs.stat(current);
      } catch {
        await fs.mkdir(current);
      }
    }
  }
}

async function walkDirectory(
  srcBase: string,
  destBase: string,
  callback: (srcPath: string, destPath: string, stats: Stats) => Promise<void>
): Promise<void> {
  const stack: Array<{ src: string; dest: string }> = [
    { src: srcBase, dest: destBase },
  ];

  while (stack.length > 0) {
    const { src, dest } = stack.pop()!;
    
    let stats: Stats;
    try {
      stats = await lstat(src) as unknown as Stats;
    } catch {
      continue;
    }

    await callback(src, dest, stats);

    if (stats.isDirectory()) {
      try {
        const entries = await readdir(src);
        for (const entry of entries) {
          // Skip .git directory
          if (entry === '.git') continue;
          
          stack.push({
            src: join(src, entry),
            dest: dest === '/' ? `/${entry}` : `${dest}/${entry}`,
          });
        }
      } catch {
        // Ignore errors reading directory
      }
    }
  }
}

async function walkAgentFS(
  fs: FileSystem,
  basePath: string,
  callback: (path: string, stats: Stats) => Promise<void>
): Promise<void> {
  const stack: string[] = [basePath];

  while (stack.length > 0) {
    const path = stack.pop()!;
    
    let stats: Stats;
    try {
      stats = await fs.stat(path);
    } catch {
      continue;
    }

    await callback(path, stats);

    if (stats.isDirectory()) {
      try {
        const entries = await fs.readdir(path);
        for (const entry of entries) {
          stack.push(path === '/' ? `/${entry}` : `${path}/${entry}`);
        }
      } catch {
        // Ignore errors
      }
    }
  }
}

function shouldExclude(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob matching
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    
    if (new RegExp(`^${regexPattern}$`).test(path) ||
        new RegExp(`^${regexPattern}$`).test('/' + path)) {
      return true;
    }
  }
  return false;
}

function buffersEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
