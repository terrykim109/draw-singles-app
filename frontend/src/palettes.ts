export type Palette = {
  id: string;
  name: string;
  ink: string;
  inkDeep: string;
  surface: string;
  surfaceHover: string;
  muted: string;
};

export const PALETTES: Palette[] = [
  {
    id: 'ballpoint',
    name: 'ballpoint blue',
    ink: '#2b18e0',
    inkDeep: '#1f0fb8',
    surface: '#e3e0f6',
    surfaceHover: '#dbd7f3',
    muted: '#a9a6c9',
  },
  {
    id: 'crayon',
    name: 'crayon red',
    ink: '#d92d20',
    inkDeep: '#b21f14',
    surface: '#f7e2df',
    surfaceHover: '#f3d7d3',
    muted: '#c9a5a1',
  },
  {
    id: 'highlighter',
    name: 'highlighter pink',
    ink: '#e6187f',
    inkDeep: '#bd1268',
    surface: '#f9dcea',
    surfaceHover: '#f5d0e2',
    muted: '#cba1b7',
  },
  {
    id: 'grape',
    name: 'grape marker',
    ink: '#7a1fd9',
    inkDeep: '#6015ad',
    surface: '#ebdefa',
    surfaceHover: '#e2d2f7',
    muted: '#b8a4cd',
  },
  {
    id: 'felttip',
    name: 'felt-tip green',
    ink: '#12915a',
    inkDeep: '#0b7146',
    surface: '#d9f0e4',
    surfaceHover: '#cde9db',
    muted: '#9dbfae',
  },
  {
    id: 'sharpie',
    name: 'tangerine sharpie',
    ink: '#e2620b',
    inkDeep: '#b84c05',
    surface: '#fae4d0',
    surfaceHover: '#f6d9be',
    muted: '#cbaa8c',
  },
  {
    id: 'graphite',
    name: 'graphite pencil',
    ink: '#3b3b46',
    inkDeep: '#23232b',
    surface: '#e2e2e6',
    surfaceHover: '#d8d8dd',
    muted: '#a3a3ad',
  },
  {
    id: 'gelpen',
    name: 'teal gel pen',
    ink: '#0d8f9e',
    inkDeep: '#076f7c',
    surface: '#d6eef1',
    surfaceHover: '#c8e7eb',
    muted: '#96b8bd',
  },
];

const STORAGE_KEY = 'draw-singles.palette';

export function applyPalette(palette: Palette) {
  const root = document.documentElement;
  root.style.setProperty('--ink', palette.ink);
  root.style.setProperty('--ink-deep', palette.inkDeep);
  root.style.setProperty('--surface', palette.surface);
  root.style.setProperty('--surface-hover', palette.surfaceHover);
  root.style.setProperty('--ink-muted', palette.muted);
  localStorage.setItem(STORAGE_KEY, palette.id);
}

export function storedPalette(): Palette {
  const id = localStorage.getItem(STORAGE_KEY);
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];
}
