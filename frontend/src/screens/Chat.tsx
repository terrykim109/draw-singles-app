import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { MatchProfile, Message } from '../types';

type ChatProps = {
  youId: string;
  them: MatchProfile;
  onBack: () => void;
};

export default function Chat({ youId, them, onBack }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    const msgs = await api.getMessages(youId, them.id);
    setMessages(Array.isArray(msgs) ? msgs : []);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 2500);
    return () => clearInterval(interval);
  }, [youId, them.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!text.trim()) return;
    await api.sendMessage(youId, them.id, text.trim());
    setText('');
    await load();
  }

  return (
    <div className="shell shell--narrow" style={{ gap: 18, height: '85vh' }}>
      <div className="chat-header">
        <button className="btn btn--ghost" type="button" onClick={onBack}>
          ← back
        </button>
        <div className="chat-peer">
          {them.photo && <img src={them.photo} alt={them.name} />}
          <span className="hand">{them.name}</span>
        </div>
      </div>

      <div className="card chat-card">
        <div className="chat-messages">
          {messages.length === 0 && (
            <p className="hand muted center" style={{ padding: 24 }}>
              no messages yet.
              <br />
              break the ice.
            </p>
          )}
          {messages.map((m) => {
            const isMe = m.sender_id === youId;
            return (
              <div
                key={m.id}
                className={`chat-bubble${isMe ? ' chat-bubble--me' : ''}`}
              >
                <p>{m.body}</p>
                <span className="chat-time">
                  {new Date(m.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-row">
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="say something..."
          />
          <button className="btn btn--soft" type="button" onClick={send}>
            send
          </button>
        </div>
      </div>
    </div>
  );
}