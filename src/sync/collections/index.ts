import { progressCollection } from './progress';
import { highlightsCollection } from './highlights';
import { notesCollection } from './notes';
import { favoritesCollection } from './favorites';
import { memorySrsCollection } from './memorySrs';
import { memoryAttemptsCollection } from './memoryAttempts';
import { memorySelectionCollection } from './memorySelection';
import { badQuestionsCollection } from './badQuestions';
import type { SyncCollection } from '../types';

export const SYNC_COLLECTIONS: readonly SyncCollection[] = [
  progressCollection,
  highlightsCollection,
  notesCollection,
  favoritesCollection,
  memorySrsCollection,
  memoryAttemptsCollection,
  memorySelectionCollection,
  badQuestionsCollection,
];

const byName = new Map(SYNC_COLLECTIONS.map((collection) => [collection.name, collection]));

export function collectionFor(name: string): SyncCollection | undefined {
  return byName.get(name);
}
