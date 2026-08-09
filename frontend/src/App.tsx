import { useState } from 'react';
import SignUp from './screens/SignUp';
import Intro from './screens/Intro';
import CreateProfile from './screens/CreateProfile';
import Constellation from './screens/Constellation';
import Done from './screens/Done';
import Lab from './screens/Lab';
import Trace from './screens/Trace';
import type { RawStroke } from './lab/strokes';
import ColorLab from './components/ColorLab';
import { MarginDoodles } from './components/Doodles';
import type { Account, MatchProfile, Profile, Screen } from './types';

const ORDER: Screen[] = ['signup', 'intro', 'profile', 'swipe', 'done'];

/** where the user was before hopping into a tool */
const LAB_RETURN: Screen = 'signup';

const isTool = (screen: Screen) => screen === 'lab' || screen === 'trace';

function App() {
  const [screen, setScreen] = useState<Screen>('signup');
  const [, setAccount] = useState<Account | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [liked, setLiked] = useState<MatchProfile[]>([]);
  const [swipeRound, setSwipeRound] = useState(0);
  const [returnTo, setReturnTo] = useState<Screen>(LAB_RETURN);
  const [labStrokes, setLabStrokes] = useState<RawStroke[] | null>(null);

  /** remember only real app screens, so "back" never lands on another tool */
  function openTool(tool: Screen) {
    if (!isTool(screen)) setReturnTo(screen);
    setScreen(tool);
  }

  return (
    <>
      <MarginDoodles />
      <div className="app">
        <ColorLab />

        {/* The tool screens carry their own "back to the app" button in the
            same corner, so keep these chips off them entirely rather than
            stacking two controls on top of each other. */}
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
              setAccount(account);
              setScreen('intro');
            }}
          />
        )}

        {screen === 'intro' && <Intro onStart={() => setScreen('profile')} />}

        {screen === 'profile' && (
          <CreateProfile
            onSubmit={(next) => {
              setProfile(next);
              setScreen('swipe');
            }}
            onBack={() => setScreen('intro')}
          />
        )}

        {screen === 'swipe' && profile && (
          <Constellation
            key={swipeRound}
            you={profile}
            onDone={(matches) => {
              setLiked(matches);
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
