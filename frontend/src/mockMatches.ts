import type { MatchProfile } from './types';

/** wrap hand-drawn svg paths as a data-uri image, like an uploaded photo */
function drawing(paper: string, ink: string, inner: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">` +
    `<rect width="300" height="300" fill="${paper}"/>` +
    `<g fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${inner}</g>` +
    `</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const cat = drawing('#f6f5f2', '#2b18e0', `
  <circle cx="150" cy="135" r="62"/>
  <path d="M102 84 92 34l58 26"/>
  <path d="M198 84l10-50-58 26"/>
  <path d="M120 132q15-11 30 0"/>
  <path d="M150 132q15-11 30 0"/>
  <path d="M142 150h16l-8 11Z"/>
  <path d="M139 163q11 6 22 0"/>
  <path d="M96 145H64M98 158l-32 11"/>
  <path d="M204 145h32M202 158l32 11"/>
  <path d="M98 197q-6 58 10 88h84q16-30 10-88"/>
  <path d="M190 258q32 20 2 46"/>
  <path d="M122 228q7 5 14 0M164 228q7 5 14 0"/>
`);

const flower = drawing('#fdf6ec', '#d92d20', `
  <path d="M150 292V212"/>
  <path d="M150 212c-19 0-28 11-27 23-12-4-25 4-27 17s11 23 22 23c-6 10-2 25 12 29s26-6 28-17c6 9 19 13 29 6s10-23 2-31c12-2 20-14 17-25s-18-18-28-12c2-12-9-21-28-13Z"/>
  <path d="M139 232q11 7 22 0"/>
  <path d="M150 302q-38 11-55-26"/>
  <path d="M150 272q34-5 49-29"/>
  <circle cx="232" cy="78" r="18"/>
  <path d="M232 36V22M232 134v14M186 78h-14M278 78h14M200 46l-12-12M200 110l-12 12M264 46l12-12M264 110l12 12"/>
  <path d="M64 292q4-26-8-48M96 292q-4-20 5-40M206 292q-5-24 4-44M232 292q2-18-4-34"/>
`);

const mountains = drawing('#eef3f8', '#3b3b46', `
  <path d="M34 268 108 168l44 52 36-44 70 92H34Z"/>
  <path d="M62 288 152 208l62 80H62Z"/>
  <path d="M108 168l-13 24 13-5 13 5-13-24Z"/>
  <path d="M152 208l-11 20 11-4 11 4-11-20Z"/>
  <circle cx="226" cy="76" r="22"/>
  <path d="M226 30V18M226 134v12M180 76h-12M272 76h12M194 44l-9-9M194 108l-9 9M258 44l9-9M258 108l9 9"/>
  <path d="M54 64q8-9 15 0M84 44q8-9 15 0"/>
  <path d="M246 258v32M246 258l-20 16M246 258l20 16"/>
  <path d="M38 292q6-30-6-54"/>
`);

const fish = drawing('#eef7ef', '#12915a', `
  <path d="M58 172c0-48 37-76 82-76s82 28 82 76-37 76-82 76-82-28-82-76Z"/>
  <path d="M222 172l44-35v70Z"/>
  <circle cx="120" cy="158" r="6"/>
  <path d="M80 180q9 9 18 0"/>
  <path d="M140 100l16-26 20 24"/>
  <path d="M154 244l8 28 22-22"/>
  <circle cx="72" cy="120" r="7"/>
  <circle cx="54" cy="98" r="5"/>
  <circle cx="42" cy="80" r="4"/>
  <path d="M16 262q14-9 28 0t28 0 28 0 28 0 28 0 28 0 28 0 28 0"/>
`);

const rocket = drawing('#f4f1fa', '#7a1fd9', `
  <path d="M150 44c-42 0-70 50-70 96l28 88h84l28-88c0-46-28-96-70-96Z"/>
  <circle cx="150" cy="130" r="22"/>
  <path d="M128 130h44M150 108v44"/>
  <path d="M80 196 48 240l48 11M220 196l32 44-48 11"/>
  <path d="M124 244q-15 42 4 72M176 244q15 42-4 72"/>
  <path d="M134 270q4 20 16 26 12-6 16-26"/>
  <path d="M232 62l5 12 12 5-12 5-5 12-5-12-12-5 12-5Z"/>
  <path d="M56 250l4 9 10 4-10 4-4 9-4-9-10-4 10-4Z"/>
  <circle cx="88" cy="100" r="4"/>
  <circle cx="208" cy="176" r="3"/>
`);

const mushroom = drawing('#fdf0e9', '#e2620b', `
  <path d="M120 212h60v76q-9 20-30 20t-30-20Z"/>
  <path d="M72 216c0-84 35-130 78-130s78 46 78 130c-51-20-105-20-156 0Z"/>
  <circle cx="118" cy="140" r="9"/>
  <circle cx="170" cy="164" r="11"/>
  <circle cx="146" cy="112" r="7"/>
  <path d="M96 210q4-11 12-11M196 210q8-6 13 2"/>
  <path d="M58 292q4-28-10-52M96 292q-4-22 8-42M204 292q4-26-8-48M232 292q-2-18 6-34"/>
`);

const heart = drawing('#f9f0f6', '#e6187f', `
  <path d="M150 296C96 254 60 222 60 190c0-25 18-43 42-43 16 0 30 8 44 23 14-15 28-23 44-23 24 0 42 18 42 43 0 32-36 64-82 106Z"/>
  <path d="M112 176q11-12 22 0t22 0 22 0 22 0"/>
  <path d="M58 106l5 12 12 5-12 5-5 12-5-12-12-5 12-5Z"/>
  <path d="M242 76l4 10 10 4-10 4-4 10-4-10-10-4 10-4Z"/>
  <path d="M244 196c-8-7-14-12-14-17 0-3 2-5 4-5 2 0 4 2 5 5 1-3 3-5 5-5 3 0 5 2 5 5 0 5-6 10-5 17Z"/>
`);

const house = drawing('#f5f5f2', '#0d8f9e', `
  <path d="M98 196h104v104H98Z"/>
  <path d="M80 202 150 126l70 76"/>
  <path d="M130 300v-56h40v56"/>
  <circle cx="118" cy="236" r="11"/>
  <path d="M118 225v22M107 236h22"/>
  <path d="M230 300v-66"/>
  <path d="M230 238c-22 0-35 17-35 35h70c0-18-13-35-35-35Z"/>
  <circle cx="86" cy="80" r="17"/>
  <path d="M86 40V28M86 132v12M44 80H32M140 80h12M56 52l-9-9M56 108l-9 9M116 52l9-9M116 108l9 9"/>
  <path d="M184 102c-12-2-18-9-15-19 10-1 16-8 15-17 12 0 20-7 23-17 11 5 19 15 18 26 8 2 12 8 8 17-2 3-49 10-49 10Z"/>
`);

/** fake people to swipe through — the backend doesn't exist yet, so these do the job */
export const MOCK_PROFILES: MatchProfile[] = [
  {
    id: 'miso',
    name: 'miso',
    photo: cat,
    category: 'cat',
    note: 'i draw you, you draw me',
    answers: { medium: 'pencil', style: 'suspiciously good', looking: 'a doodle partner' },
  },
  {
    id: 'daisy',
    name: 'daisy',
    photo: flower,
    category: 'flower',
    note: 'petals, obviously',
    answers: { medium: 'crayon', style: 'stick figures', looking: 'no idea yet' },
  },
  {
    id: 'oslo',
    name: 'oslo',
    photo: mountains,
    category: 'mountains',
    note: 'peaks > people',
    answers: { medium: 'ballpoint pen', style: 'abstract', looking: 'something serious' },
  },
  {
    id: 'fin',
    name: 'fin',
    photo: fish,
    category: 'fish',
    note: 'freshwater feelings',
    answers: { medium: 'tablet', style: 'unhinged', looking: 'gallery dates' },
  },
  {
    id: 'leo',
    name: 'leo',
    photo: rocket,
    category: 'rocket',
    note: 'escape velocity',
    answers: { medium: 'ballpoint pen', style: 'suspiciously good', looking: 'something serious' },
  },
  {
    id: 'poppy',
    name: 'poppy',
    photo: mushroom,
    category: 'mushroom',
    note: 'fungi over fun guys',
    answers: { medium: 'pencil', style: 'unhinged', looking: 'a doodle partner' },
  },
  {
    id: 'nova',
    name: 'nova',
    photo: heart,
    category: 'heart',
    note: 'i drew this for you',
    answers: { medium: 'crayon', style: 'stick figures', looking: 'gallery dates' },
  },
  {
    id: 'mo',
    name: 'mo',
    photo: house,
    category: 'house',
    note: 'home is a doodle',
    answers: { medium: 'tablet', style: 'abstract', looking: 'no idea yet' },
  },
];
