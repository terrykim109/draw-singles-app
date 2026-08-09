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
import { api } from './api';

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

        {screen === 'lab' && <Lab onBack={() => setScreen(returnTo)} />}

        {screen === 'trace' && <Trace onBack={() => setScreen(returnTo)} />}

        {screen === 'signup' && (
          <SignUp
            onSubmit={async (account) => {
              const res = await api.register(account.email, account.password);
              setAccount(account);
              setUserId(res.id);
              setScreen('intro');
            }}
          />
        )}

        {screen === 'intro' && <Intro onStart={() => setScreen('profile')} />}

        {screen === 'profile' && (
          <CreateProfile
            onSubmit={async (next) => {
              if (!userId) return;
              await api.createProfile(userId, next);
              setProfile(next);
              setScreen('swipe');
            }}
            onBack={() => setScreen('intro')}
          />
        )}

        {screen === 'swipe' && profile && userId && (
          <Swipe
            key={swipeRound}
            you={profile}
            userId={userId}
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