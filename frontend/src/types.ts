export type Screen = 'signup' | 'intro' | 'profile' | 'constellation'| 'swipe' | 'done' | 'lab' | 'trace' | 'chat';

export type Account = {
  email: string;
  password: string;
  /** backend account id; absent when the server was unreachable */
  id?: string;
};

export type Profile = {
  name: string;
  photo: string | null;
  answers: Record<string, string>;
  /** what the drawing depicts — the classifier's output, hand-set for now */
  category?: string;
  /** the uploaded file, kept so it can be POSTed to the classifier */
  file?: File | null;
  /** id assigned by the backend once the profile is created */
  id?: string;
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

export type Message = {
  id: number;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
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
