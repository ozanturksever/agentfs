/**
 * Convex Streaming Adapter for AgentFS Toolcalls
 * 
 * Streams toolcall events from AgentFS to Convex mutations in real-time,
 * providing an audit trail of all agent operations.
 */

import type { ToolCalls, ToolCall } from '../../toolcalls.js';
import type {
  ConvexStreamConfig,
  ConvexToolcallEvent,
  OOSSMetadata,
} from './types.js';

/**
 * Convex Toolcall Streamer
 * 
 * Watches for new toolcall events in AgentFS and streams them to Convex
 * mutations for persistence and UI updates.
 */
export class ConvexToolcallStreamer {
  private tools: ToolCalls;
  private config: Required<Omit<ConvexStreamConfig, 'oossContext'>> & { oossContext?: Partial<OOSSMetadata> };
  private buffer: ConvexToolcallEvent[] = [];
  private lastSeenId = 0;
  private pollInterval?: ReturnType<typeof setInterval>;
  private flushInterval?: ReturnType<typeof setInterval>;
  private isRunning = false;
  private isFlushing = false;
  private pollIntervalMs = 500;

  constructor(tools: ToolCalls, config: ConvexStreamConfig) {
    this.tools = tools;
    this.config = {
      convexClient: config.convexClient,
      mutationPath: config.mutationPath,
      batchSize: config.batchSize ?? 10,
      flushIntervalMs: config.flushIntervalMs ?? 1000,
      includeResults: config.includeResults ?? true,
      oossContext: config.oossContext,
    };
  }

  /**
   * Start streaming toolcall events to Convex
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Poll for new toolcalls
    this.pollInterval = setInterval(() => {
      this.pollForNewToolcalls().catch(err => {
        console.error('[ConvexToolcallStreamer] Poll error:', err);
      });
    }, this.pollIntervalMs);

    // Periodic flush
    this.flushInterval = setInterval(() => {
      this.flush().catch(err => {
        console.error('[ConvexToolcallStreamer] Flush error:', err);
      });
    }, this.config.flushIntervalMs);
  }

  /**
   * Stop streaming and flush remaining events
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }

    // Final flush
    await this.flush();
  }

  /**
   * Manually flush buffered events to Convex
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.isFlushing) return;

    this.isFlushing = true;
    const eventsToSend = [...this.buffer];
    this.buffer = [];

    try {
      await this.sendToConvex(eventsToSend);
    } catch (err) {
      // On error, put events back in buffer (at the front)
      this.buffer = [...eventsToSend, ...this.buffer];
      throw err;
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Get the number of buffered events
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Check if the streamer is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Update the OOSS context for future events
   */
  setOOSSContext(context: Partial<OOSSMetadata>): void {
    this.config.oossContext = context;
  }

  /**
   * Poll for new toolcalls since last seen
   */
  private async pollForNewToolcalls(): Promise<void> {
    // Get recent toolcalls (in the last minute)
    const since = Math.floor(Date.now() / 1000) - 60;
    const recentCalls = await this.tools.getRecent(since);

    // Filter to only new ones
    const newCalls = recentCalls.filter(call => call.id > this.lastSeenId);

    if (newCalls.length === 0) return;

    // Update last seen ID
    const maxId = Math.max(...newCalls.map(c => c.id));
    this.lastSeenId = maxId;

    // Convert to events and add to buffer
    for (const call of newCalls) {
      const event = this.toolcallToEvent(call);
      this.buffer.push(event);
    }

    // Flush if buffer is full
    if (this.buffer.length >= this.config.batchSize) {
      await this.flush();
    }
  }

  /**
   * Convert a ToolCall to a ConvexToolcallEvent
   */
  private toolcallToEvent(call: ToolCall): ConvexToolcallEvent {
    const event: ConvexToolcallEvent = {
      id: call.id,
      name: call.name,
      parameters: call.parameters,
      status: call.status,
      startedAt: call.started_at,
      completedAt: call.completed_at,
      durationMs: call.duration_ms,
    };

    if (this.config.includeResults && call.result !== undefined) {
      event.result = call.result;
    }

    if (call.error) {
      event.error = call.error;
    }

    if (this.config.oossContext) {
      event.oossContext = this.config.oossContext;
    }

    return event;
  }

  /**
   * Send events to Convex mutation
   */
  private async sendToConvex(events: ConvexToolcallEvent[]): Promise<void> {
    if (events.length === 0) return;

    try {
      await this.config.convexClient.mutation(this.config.mutationPath, {
        events,
      });
    } catch (err) {
      // Log but don't throw to allow retry on next flush
      console.error('[ConvexToolcallStreamer] Failed to send events:', err);
      throw err;
    }
  }
}

/**
 * Create a Convex toolcall streamer
 * 
 * @param tools - AgentFS ToolCalls instance
 * @param config - Convex streaming configuration
 * @returns Configured streamer instance
 */
export function createConvexStreamer(
  tools: ToolCalls,
  config: ConvexStreamConfig
): ConvexToolcallStreamer {
  return new ConvexToolcallStreamer(tools, config);
}

/**
 * Wrapper for ToolCalls that automatically streams to Convex
 * 
 * This wrapper intercepts toolcall recording and sends events to Convex
 * in real-time without needing a polling streamer.
 */
export class ConvexToolcallsWrapper {
  private tools: ToolCalls;
  private config: ConvexStreamConfig;
  private buffer: ConvexToolcallEvent[] = [];
  private flushTimeout?: ReturnType<typeof setTimeout>;

  constructor(tools: ToolCalls, config: ConvexStreamConfig) {
    this.tools = tools;
    this.config = {
      batchSize: 10,
      flushIntervalMs: 1000,
      includeResults: true,
      ...config,
    };
  }

  /**
   * Start a new tool call and mark it as pending
   */
  async start(name: string, parameters?: unknown): Promise<number> {
    const id = await this.tools.start(name, parameters);
    
    // Queue event for sending
    this.queueEvent({
      id,
      name,
      parameters,
      status: 'pending',
      startedAt: Math.floor(Date.now() / 1000),
      oossContext: this.config.oossContext,
    });

    return id;
  }

  /**
   * Mark a tool call as successful
   */
  async success(id: number, result?: unknown): Promise<void> {
    await this.tools.success(id, result);
    
    const call = await this.tools.get(id);
    if (call) {
      this.queueEvent({
        id,
        name: call.name,
        parameters: call.parameters,
        result: this.config.includeResults ? result : undefined,
        status: 'success',
        startedAt: call.started_at,
        completedAt: call.completed_at,
        durationMs: call.duration_ms,
        oossContext: this.config.oossContext,
      });
    }
  }

  /**
   * Mark a tool call as failed
   */
  async error(id: number, error: string): Promise<void> {
    await this.tools.error(id, error);
    
    const call = await this.tools.get(id);
    if (call) {
      this.queueEvent({
        id,
        name: call.name,
        parameters: call.parameters,
        error,
        status: 'error',
        startedAt: call.started_at,
        completedAt: call.completed_at,
        durationMs: call.duration_ms,
        oossContext: this.config.oossContext,
      });
    }
  }

  /**
   * Record a completed tool call
   */
  async record(
    name: string,
    startedAt: number,
    completedAt: number,
    parameters?: unknown,
    result?: unknown,
    error?: string
  ): Promise<number> {
    const id = await this.tools.record(name, startedAt, completedAt, parameters, result, error);

    this.queueEvent({
      id,
      name,
      parameters,
      result: this.config.includeResults ? result : undefined,
      error,
      status: error ? 'error' : 'success',
      startedAt,
      completedAt,
      durationMs: (completedAt - startedAt) * 1000,
      oossContext: this.config.oossContext,
    });

    return id;
  }

  /**
   * Get underlying ToolCalls instance
   */
  getTools(): ToolCalls {
    return this.tools;
  }

  /**
   * Manually flush buffered events
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = [...this.buffer];
    this.buffer = [];

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = undefined;
    }

    await this.config.convexClient.mutation(this.config.mutationPath, {
      events,
    });
  }

  private queueEvent(event: ConvexToolcallEvent): void {
    this.buffer.push(event);

    // Flush immediately if batch is full
    if (this.buffer.length >= (this.config.batchSize ?? 10)) {
      this.flush().catch(err => {
        console.error('[ConvexToolcallsWrapper] Flush error:', err);
      });
      return;
    }

    // Schedule flush if not already scheduled
    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => {
        this.flushTimeout = undefined;
        this.flush().catch(err => {
          console.error('[ConvexToolcallsWrapper] Scheduled flush error:', err);
        });
      }, this.config.flushIntervalMs ?? 1000);
    }
  }
}

/**
 * Create a Convex-streaming wrapper around ToolCalls
 */
export function wrapToolcallsWithConvex(
  tools: ToolCalls,
  config: ConvexStreamConfig
): ConvexToolcallsWrapper {
  return new ConvexToolcallsWrapper(tools, config);
}
