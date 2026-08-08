import { useState } from 'react';
import SignUp from './screens/SignUp';
import Intro from './screens/Intro';
import CreateProfile from './screens/CreateProfile';
import Swipe from './screens/Swipe';
import Done from './screens/Done';
import Lab from './screens/Lab';
import Trace from './screens/Trace';
import ColorLab from './components/ColorLab';
import { MarginDoodles } from './components/Doodles';
import type { Account, MatchProfile, Profile, Screen } from './types';

const ORDER: Screen[] = ['signup', 'intro', 'profile', 'swipe', 'done'];

/** where the user was before hopping into the lab */
const LAB_RETURN: Screen = 'signup';

function App() {
  const [screen, setScreen] = useState<Screen>('signup');
  const [, setAccount] = useState<Account | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [liked, setLiked] = useState<MatchProfile[]>([]);
  const [swipeRound, setSwipeRound] = useState(0);
  const [returnTo, setReturnTo] = useState<Screen>(LAB_RETURN);

  return (
    <>
      <MarginDoodles />
      <div className="app">
        <ColorLab />

        <div className="lab-links">
          {screen !== 'lab' && (
            <button
              className="lab-link"
              type="button"
              onClick={() => {
                setReturnTo(screen);
                setScreen('lab');
              }}
            >
              ✎ animation lab
            </button>
          )}
          {screen !== 'trace' && (
            <button
              className="lab-link"
              type="button"
              onClick={() => {
                setReturnTo(screen);
                setScreen('trace');
              }}
            >
              ✦ image → svg
            </button>
          )}
        </div>

        {screen === 'lab' && <Lab onBack={() => setScreen(returnTo)} />}

        {screen === 'trace' && <Trace onBack={() => setScreen(returnTo)} />}

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
          <Swipe
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
