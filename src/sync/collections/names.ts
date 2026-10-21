/** 同步集合名：与服务端 `collection` 列一一对应，改动需同步迁移。 */
export const COLLECTIONS = {
  progress: 'reading.progress',
  highlights: 'reading.highlights',
  notes: 'reading.notes',
  favorites: 'reading.favorites',
  memorySrs: 'memory.srs',
  memoryAttempts: 'memory.attempts',
  memorySelection: 'memory.selection',
  memoryBadQuestions: 'memory.badQuestions',
} as const;

export type CollectionName = typeof COLLECTIONS[keyof typeof COLLECTIONS];
export const RESET_RECORD_ID = '__reset__';
