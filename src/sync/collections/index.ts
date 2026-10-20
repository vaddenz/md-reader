import { progressCollection } from './progress';
import { highlightsCollection } from './highlights';
import { favoritesCollection } from './favorites';
import { memorySrsCollection } from './memorySrs';
import { memoryAttemptsCollection } from './memoryAttempts';
import { memorySelectionCollection } from './memorySelection';
import type { SyncCollection } from '../types';

export const SYNC_COLLECTIONS: readonly SyncCollection[] = [
  progressCollection,
  highlightsCollection,
  favoritesCollection,
  memorySrsCollection,
  memoryAttemptsCollection,
  memorySelectionCollection,
];

const byName = new Map(SYNC_COLLECTIONS.map((collection) => [collection.name, collection]));

export function collectionFor(name: string): SyncCollection | undefined {
  return byName.get(name);
}
