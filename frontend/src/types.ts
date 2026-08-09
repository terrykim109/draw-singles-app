export type Screen = 'signup' | 'intro' | 'profile' | 'swipe' | 'done' | 'lab' | 'trace';

export type Account = {
  email: string;
  password: string;
};

export type Profile = {
  name: string;
  photo: string | null;
  answers: Record<string, string>;
};

/** a profile you encounter while swiping */
export type MatchProfile = Profile & {
  id: string;
  note?: string;
};

export type Question = {
  id: string;
  prompt: string;
  options: string[];
};

export const QUESTIONS: Question[] = [
  {
    id: 'medium',
    prompt: 'what do you draw with?',
    options: ['pencil', 'ballpoint pen', 'crayon', 'tablet'],
  },
  {
    id: 'style',
    prompt: 'how would a stranger describe your art?',
    options: ['stick figures', 'suspiciously good', 'abstract', 'unhinged'],
  },
  {
    id: 'looking',
    prompt: 'what are you here for?',
    options: ['a doodle partner', 'gallery dates', 'something serious', 'no idea yet'],
  },
];
