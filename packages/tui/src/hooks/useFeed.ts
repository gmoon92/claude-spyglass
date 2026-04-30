/**
 * useFeed — read from feedStore via useSyncExternalStore.
 */

import { useSyncExternalStore } from 'react';
import { feedStore } from '../stores/feed-store';

export function useFeed() {
  return useSyncExternalStore(feedStore.subscribe, () => feedStore.getSnapshot(), () => feedStore.getServerSnapshot());
}
