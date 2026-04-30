/**
 * useSSE — connect to /events, push records into feedStore, expose connection state.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/signature-pulse.md §6
 */

import { useEffect, useRef, useState } from 'react';
import { EventSource as NodeEventSource } from 'eventsource';
import { feedStore } from '../stores/feed-store';
import type { Request } from '../types';

export type SSEStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Milliseconds of silence before connection is considered stale. */
export const STALE_MS = 2000;

export type UseSSEResult = {
  status: SSEStatus;
  eventsPerSec: number;
  lastEventAt: number | null;
  /** True for 400ms after the first event on a freshly-opened connection. */
  flashOk: boolean;
  /** 10s-bucketed token counts for the past 30 minutes. */
  pulseBuckets: readonly number[];
  /** 10s-bucketed request counts for the past 30 minutes (actual request count, not tokens). */
  requestBuckets: readonly number[];
};

const BUCKET_COUNT = 180;
const BUCKET_MS = 10_000;

export function useSSE(apiUrl: string): UseSSEResult {
  const [status, setStatus] = useState<SSEStatus>('connecting');
  const [eventsPerSec, setEventsPerSec] = useState(0);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [flashOk, setFlashOk] = useState(false);
  const [pulseBuckets, setPulseBuckets] = useState<number[]>(() => Array(BUCKET_COUNT).fill(0));
  const [requestBuckets, setRequestBuckets] = useState<number[]>(() => Array(BUCKET_COUNT).fill(0));
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buckets = useRef<number[]>(Array(BUCKET_COUNT).fill(0));
  const reqBuckets = useRef<number[]>(Array(BUCKET_COUNT).fill(0));
  const bucketStartRef = useRef<number>(Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS);
  const eventCounter = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    const tick = () => {
      // Roll bucket if needed.
      const now = Date.now();
      const startedAt = bucketStartRef.current;
      const elapsed = now - startedAt;
      const slots = Math.floor(elapsed / BUCKET_MS);
      if (slots > 0) {
        for (let i = 0; i < slots; i++) {
          buckets.current.shift();
          buckets.current.push(0);
          reqBuckets.current.shift();
          reqBuckets.current.push(0);
        }
        bucketStartRef.current = startedAt + slots * BUCKET_MS;
        setPulseBuckets(buckets.current.slice());
        setRequestBuckets(reqBuckets.current.slice());
      }
      setEventsPerSec(eventCounter.current);
      eventCounter.current = 0;
    };

    const interval = setInterval(tick, 1000);

    const connect = () => {
      if (cancelled) return;
      try {
        // Bun does not expose globalThis.EventSource — use the node `eventsource` package.
        es = new NodeEventSource(`${apiUrl}/events`) as unknown as EventSource;
        setStatus('connecting');

        es.addEventListener('open', () => {
          if (cancelled) return;
          setStatus('open');
          retryDelay = 1000;
          // Flash OK for 400ms on reconnect.
          setFlashOk(true);
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlashOk(false), 400);
        });

        es.addEventListener('error', () => {
          if (cancelled) return;
          setStatus('reconnecting');
          es?.close();
          es = null;
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 15_000);
        });

        es.addEventListener('new_request', (ev: MessageEvent) => {
          handleEvent(ev);
        });
        es.addEventListener('session_update', (ev: MessageEvent) => {
          // No-op for v1 — session-store would consume.
          void ev;
        });
        es.addEventListener('ping', () => {
          // Heartbeat keeps connection alive.
        });
      } catch (err) {
        setStatus('reconnecting');
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15_000);
      }
    };

    const handleEvent = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data);
        const data = parsed.data ?? parsed;
        const r: Request = {
          id: data.id,
          session_id: data.session_id,
          type: data.type,
          request_type: data.request_type,
          tool_name: data.tool_name,
          tool_detail: data.tool_detail,
          tool_use_id: data.tool_use_id,
          event_type: data.event_type,
          tokens_input: data.tokens_input,
          tokens_output: data.tokens_output,
          tokens_total: data.tokens_total,
          tokens_cache_read: data.tokens_cache_read ?? data.cache_read_tokens,
          tokens_cache_creation: data.tokens_cache_creation ?? data.cache_creation_tokens,
          duration_ms: data.duration_ms,
          model: data.model,
          timestamp: data.timestamp ?? Date.now(),
          payload: data.payload,
          status: data.status,
          arrivedAt: Date.now(),
        };
        feedStore.push(r);
        eventCounter.current += 1;
        setLastEventAt(Date.now());

        // Update pulse bucket (token amounts).
        const idx = BUCKET_COUNT - 1;
        const tokenCount = r.tokens_total ?? 0;
        buckets.current[idx] = (buckets.current[idx] ?? 0) + tokenCount;
        // Update request count bucket.
        reqBuckets.current[idx] = (reqBuckets.current[idx] ?? 0) + 1;
      } catch {
        // ignore
      }
    };

    connect();

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (retryTimer) clearTimeout(retryTimer);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (es) es.close();
    };
  }, [apiUrl]);

  return { status, eventsPerSec, lastEventAt, flashOk, pulseBuckets, requestBuckets };
}

