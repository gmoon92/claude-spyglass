/**
 * feed-store.ts — External store with ring buffer and tool_use_id-keyed in-place update.
 *
 * @see adr.md ADR-T03
 *
 * Implements the React 18 `useSyncExternalStore` contract.
 * Microtask batching: SSE events queued in same tick are flushed once.
 */

import { tokens } from '../design-tokens';
import type { Request } from '../types';

const CAPACITY = tokens.buffer.feedMax;

type Listener = () => void;

class FeedStore {
  private rows: Request[] = [];
  /** O(1) lookup by tool_use_id (or id) for in-place update. */
  private byKey = new Map<string, number>();
  private listeners = new Set<Listener>();
  /** A version counter so React detects identity change cheaply. */
  private version = 0;
  private snapshot: readonly Request[] = [];
  private pending: Request[] = [];
  private microtaskScheduled = false;
  private freeze = false;
  private droppedDuringFreeze = 0;

  /** Add or update a single row. Coalesced via microtask if many arrive in same tick. */
  push(row: Request): void {
    if (this.freeze) {
      this.droppedDuringFreeze += 1;
      return;
    }
    this.pending.push(row);
    if (!this.microtaskScheduled) {
      this.microtaskScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  /** Replace contents (e.g. initial fetch). */
  reset(rows: Request[]): void {
    this.rows = rows.slice(-CAPACITY);
    this.byKey.clear();
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i]!;
      this.byKey.set(this.keyFor(r), i);
    }
    this.bump();
  }

  setFreeze(freeze: boolean): number {
    this.freeze = freeze;
    if (!freeze) {
      const dropped = this.droppedDuringFreeze;
      this.droppedDuringFreeze = 0;
      return dropped;
    }
    return 0;
  }

  isFrozen(): boolean {
    return this.freeze;
  }

  droppedCount(): number {
    return this.droppedDuringFreeze;
  }

  getSnapshot(): readonly Request[] {
    return this.snapshot;
  }

  getServerSnapshot(): readonly Request[] {
    return this.snapshot;
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private keyFor(r: Request): string {
    return r.tool_use_id || r.id;
  }

  private flush(): void {
    this.microtaskScheduled = false;
    if (this.pending.length === 0) return;

    const batch = this.pending;
    this.pending = [];

    for (const incoming of batch) {
      const key = this.keyFor(incoming);
      const existingIdx = this.byKey.get(key);
      if (existingIdx != null && existingIdx >= 0 && existingIdx < this.rows.length) {
        // In-place update — preserve position.
        const prev = this.rows[existingIdx]!;
        this.rows[existingIdx] = { ...prev, ...incoming };
      } else {
        // Prepend (Live Feed semantic = newest first).
        this.rows.unshift({ ...incoming, arrivedAt: incoming.arrivedAt ?? Date.now() });
        if (this.rows.length > CAPACITY) {
          const dropped = this.rows.pop()!;
          this.byKey.delete(this.keyFor(dropped));
        }
        // Rebuild index for prepended items only — cheaper than full rebuild for small batches.
        // Fall back to full rebuild if batch large.
      }
    }
    this.rebuildIndex();
    this.bump();
  }

  private rebuildIndex(): void {
    this.byKey.clear();
    for (let i = 0; i < this.rows.length; i++) {
      this.byKey.set(this.keyFor(this.rows[i]!), i);
    }
  }

  private bump(): void {
    this.version += 1;
    this.snapshot = this.rows.slice();
    for (const l of this.listeners) l();
  }
}

export const feedStore = new FeedStore();
