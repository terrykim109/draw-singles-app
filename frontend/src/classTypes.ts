/**
 * Supertypes for the classifier's 250-label vocabulary.
 *
 * Group names used to come from the 15-entry taxonomy in categories.ts, which
 * only overlaps the model on `cat` and `fish` — both animals — so a single cat
 * in a group named the entire group "beast type" no matter what else was in it.
 * This maps the model's real classes onto a handful of buckets instead.
 *
 * Anything not listed falls through to `trinket`, which is where the long tail
 * of everyday objects belongs anyway.
 */
export type Supertype = 'beast' | 'kin' | 'bloom' | 'morsel' | 'terrain' | 'machina' | 'trinket';

const MEMBERS: Record<Exclude<Supertype, 'trinket'>, string[]> = {
  beast: [
    'ant', 'bear (animal)', 'bee', 'butterfly', 'camel', 'cat', 'cow', 'crab',
    'crocodile', 'dog', 'dolphin', 'dragon', 'duck', 'elephant', 'fish',
    'flying bird', 'frog', 'giraffe', 'hedgehog', 'horse', 'kangaroo', 'lion',
    'lobster', 'monkey', 'mosquito', 'mouse (animal)', 'octopus', 'owl', 'panda',
    'parrot', 'penguin', 'pig', 'pigeon', 'rabbit', 'rooster', 'scorpion',
    'sea turtle', 'seagull', 'shark', 'sheep', 'snail', 'snake', 'spider',
    'squirrel', 'standing bird', 'swan', 'teddy-bear', 'tiger', 'zebra',
    // categories.ts ids, so sample data buckets the same way
    'bird', 'monster',
  ],
  kin: [
    'angel', 'arm', 'brain', 'ear', 'eye', 'face', 'foot', 'hand', 'head',
    'human-skeleton', 'mermaid', 'mouth', 'nose', 'person sitting',
    'person walking', 'santa claus', 'skull', 'sponge bob', 'tooth', 'person',
  ],
  bloom: [
    'bush', 'cactus', 'flower with stem', 'leaf', 'mushroom', 'palm tree',
    'potted plant', 'tree', 'flower',
  ],
  morsel: [
    'apple', 'banana', 'beer-mug', 'bread', 'cake', 'carrot', 'donut', 'grapes',
    'hamburger', 'hot-dog', 'ice-cream-cone', 'pear', 'pineapple', 'pizza',
    'pretzel', 'pumpkin', 'strawberry', 'tomato', 'wine-bottle', 'wineglass',
    'food',
  ],
  terrain: [
    'barn', 'bridge', 'castle', 'church', 'cloud', 'house', 'moon', 'rainbow',
    'skyscraper', 'sun', 'tent', 'windmill', 'mountains', 'star',
  ],
  machina: [
    'airplane', 'bicycle', 'blimp', 'bulldozer', 'bus', 'canoe', 'car (sedan)',
    'crane (machine)', 'flying saucer', 'helicopter', 'hot air balloon',
    'motorbike', 'parachute', 'pickup truck', 'race car', 'rollerblades',
    'sailboat', 'satellite', 'ship', 'skateboard', 'snowboard', 'space shuttle',
    'speed-boat', 'submarine', 'suv', 'tire', 'tractor', 'train', 'truck', 'van',
    'wheel', 'wheelbarrow', 'rocket',
  ],
};

const LOOKUP = new Map<string, Supertype>();
for (const [supertype, members] of Object.entries(MEMBERS)) {
  for (const member of members) LOOKUP.set(member, supertype as Supertype);
}

/** words that give a class away when it isn't listed explicitly */
const HINTS: [RegExp, Supertype][] = [
  [/\b(bird|fish|animal|dog|cat|bug)\b/, 'beast'],
  [/\b(person|human|face|head|hand)\b/, 'kin'],
  [/\b(tree|flower|plant|leaf)\b/, 'bloom'],
  [/\b(cake|fruit|pizza|burger)\b/, 'morsel'],
  [/\b(house|castle|church|tower)\b/, 'terrain'],
  [/\b(car|boat|ship|plane|truck|cycle)\b/, 'machina'],
];

export function supertypeOf(className: string | undefined | null): Supertype {
  if (!className) return 'trinket';
  const key = className.trim().toLowerCase();
  const exact = LOOKUP.get(key);
  if (exact) return exact;
  for (const [pattern, supertype] of HINTS) {
    if (pattern.test(key)) return supertype;
  }
  return 'trinket';
}

/** the supertype most of these drawings belong to */
export function dominantSupertype(classNames: (string | undefined)[]): Supertype {
  const counts = new Map<Supertype, number>();
  for (const name of classNames) {
    const supertype = supertypeOf(name);
    counts.set(supertype, (counts.get(supertype) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] ?? 'trinket';
}
