/**
 * What a drawing *is* — the axis the types are built on.
 *
 * This is the slot the image classifier fills: it returns a category (and,
 * later, an embedding), and the grouping follows from that. Until then the
 * category is set by hand, which is also the manual override you want anyway
 * for when the model gets it wrong.
 *
 * Tags exist so categories can be *near* each other rather than merely equal.
 * A cat and a fish are both creatures, so they should land closer together than
 * a cat and a house — one-hot over categories alone would make everything
 * equally distant and the types would be meaningless.
 */
export type Category = {
  id: string;
  label: string;
  tags: string[];
};

export const CATEGORIES: Category[] = [
  { id: 'cat', label: 'a cat', tags: ['creature', 'animal', 'face', 'furry'] },
  { id: 'fish', label: 'a fish', tags: ['creature', 'animal', 'water'] },
  { id: 'bird', label: 'a bird', tags: ['creature', 'animal', 'sky'] },
  { id: 'monster', label: 'a monster', tags: ['creature', 'face', 'weird'] },
  { id: 'person', label: 'a person', tags: ['creature', 'face', 'figure'] },

  { id: 'flower', label: 'a flower', tags: ['plant', 'nature', 'organic'] },
  { id: 'mushroom', label: 'a mushroom', tags: ['plant', 'nature', 'organic', 'weird'] },
  { id: 'tree', label: 'a tree', tags: ['plant', 'nature', 'organic', 'outdoor'] },

  { id: 'mountains', label: 'mountains', tags: ['scenery', 'outdoor', 'landscape'] },
  { id: 'house', label: 'a house', tags: ['scenery', 'built', 'landscape'] },

  { id: 'rocket', label: 'a rocket', tags: ['object', 'machine', 'sky'] },
  { id: 'star', label: 'a star', tags: ['object', 'sky', 'symbol'] },
  { id: 'heart', label: 'a heart', tags: ['object', 'symbol', 'feeling'] },
  { id: 'food', label: 'something edible', tags: ['object', 'thing'] },
  { id: 'squiggle', label: 'a squiggle', tags: ['abstract', 'weird', 'shape'] },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** every tag in use, in a fixed order, so vectors line up across profiles */
export const ALL_TAGS = [...new Set(CATEGORIES.flatMap((c) => c.tags))].sort();

/* Type names are read off the tag a group has most in common. An LLM would
   write nicer ones — this keeps them stable and offline. */
const TYPE_NAME: Record<string, string> = {
  creature: 'beast',
  animal: 'beast',
  face: 'kindred',
  furry: 'beast',
  water: 'tidal',
  sky: 'cosmic',
  plant: 'bloom',
  nature: 'bloom',
  organic: 'bloom',
  outdoor: 'terrain',
  scenery: 'terrain',
  landscape: 'terrain',
  built: 'homestead',
  object: 'trinket',
  machine: 'machina',
  symbol: 'sigil',
  feeling: 'sigil',
  thing: 'trinket',
  abstract: 'aether',
  weird: 'aether',
  shape: 'aether',
  figure: 'kindred',
};

export function typeNameForTags(tags: string[]): string {
  for (const tag of tags) {
    if (TYPE_NAME[tag]) return `${TYPE_NAME[tag]} type`;
  }
  return 'unsorted type';
}
