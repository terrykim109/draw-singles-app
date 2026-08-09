import { useState } from 'react';
import SignUp from './screens/SignUp';
import Intro from './screens/Intro';
import CreateProfile from './screens/CreateProfile';
import Constellation from './screens/Constellation';
import Swipe from './screens/Swipe';  
import Done from './screens/Done';
import Lab from './screens/Lab';
import Trace from './screens/Trace';
import type { RawStroke } from './lab/strokes';
import ColorLab from './components/ColorLab';
import { MarginDoodles } from './components/Doodles';
import type { Account, MatchProfile, Profile, Screen } from './types';
import { completeProfile } from './api';

const ORDER: Screen[] = ['signup', 'intro', 'profile', 'swipe', 'done'];

const LAB_RETURN: Screen = 'signup';

const isTool = (screen: Screen) => screen === 'lab' || screen === 'trace';

function App() {
  const [screen, setScreen] = useState<Screen>('signup');
  const [, setAccount] = useState<Account | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [liked, setLiked] = useState<MatchProfile[]>([]);
  const [swipeRound, setSwipeRound] = useState(0);
  const [returnTo, setReturnTo] = useState<Screen>(LAB_RETURN);
  const [labStrokes, setLabStrokes] = useState<RawStroke[] | null>(null);

  function openTool(tool: Screen) {
    if (!isTool(screen)) setReturnTo(screen);
    setScreen(tool);
  }

  return (
    <>
      <MarginDoodles />
      <div className="app">
        <ColorLab />

        {!isTool(screen) && (
          <div className="lab-links">
            <button className="lab-link" type="button" onClick={() => openTool('lab')}>
              ✎ animation lab
            </button>
            <button className="lab-link" type="button" onClick={() => openTool('trace')}>
              ✦ image → svg
            </button>
          </div>
        )}

        {screen === 'lab' && (
          <Lab
            onBack={() => {
              setLabStrokes(null);
              setScreen(returnTo);
            }}
            initialStrokes={labStrokes}
          />
        )}

        {screen === 'trace' && (
          <Trace
            onBack={() => setScreen(returnTo)}
            onAnimate={(strokes) => {
              setLabStrokes(strokes);
              setReturnTo('trace');
              setScreen('lab');
            }}
          />
        )}

        {screen === 'signup' && (
          <SignUp
            onSubmit={(account) => {
              // SignUp has already registered (or logged in) and carries the id.
              // Registering again here hits "email already exists", whose body has
              // no id — userId became undefined and every later profile POST was
              // silently skipped, so nothing ever got classified.
              setAccount(account);
              if (account.id) setUserId(account.id);
              else console.warn('no account id — profile will not be classified');
              setScreen('intro');
            }}
          />
        )}

        {screen === 'intro' && <Intro onStart={() => setScreen('profile')} />}

        {screen === 'profile' && (
          <CreateProfile
            onSubmit={(next) => {
              // Show the next screen immediately and let the profile POST (which
              // runs the classifier) finish in the background — a slow or dead
              // backend must not block someone finishing their profile.
              setProfile(next);
              setScreen('swipe');

              if (!userId) return;
              completeProfile(userId, {
                name: next.name,
                photo: next.photo,
                answers: next.answers,
              })
                .then((created: { id: string; drawing_class?: string | null }) => {
                  setProfile((current) =>
                    current
                      ? {
                          ...current,
                          id: created.id,
                          category: created.drawing_class ?? current.category,
                        }
                      : current
                  );
                })
                .catch((error: unknown) => {
                  console.warn('classification unavailable, staying on sample data', error);
                });
            }}
            onBack={() => setScreen('intro')}
          />
        )}

       {screen === 'swipe' && profile && userId && (
          <Swipe
            key={swipeRound}
            you={profile}
            userId={userId}
            onDone={(liked) => {
              setLiked(liked);
              setSwipeRound((round) => round + 1);
              setScreen('done');
            }}
          />
        )}

        {screen === 'done' && profile && (
          <Done
            profile={profile}
            liked={liked}
            onKeepSwiping={() => setScreen('swipe')}
            onRestart={() => {
              setProfile(null);
              setLiked([]);
              setScreen('signup');
            }}
          />
        )}

        {screen !== 'lab' && screen !== 'trace' && (
          <div className="dots">
            {ORDER.map((step) => (
              <span key={step} className={`dot${step === screen ? ' dot--on' : ''}`} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default App;