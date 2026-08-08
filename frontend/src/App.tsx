import { useEffect, useState } from 'react';

function App() {
  const [message, setMessage] = useState('Loading...');

  useEffect(() => {
    fetch('http://localhost:5001/api/health')
      .then(res => res.json())
      .then(data => setMessage(data.status))
      .catch(() => setMessage('backend not running'));
  }, []);

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h1>Draw Singles, where you can draw to match with special someone</h1>
      <p>Backend is running: <strong>{message}</strong></p>
    </div>
  );
}

export default App;
