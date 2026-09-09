// ChallengeChat — Discord-style live chat shown only during the challenge phase.
//
// - Public read (no login required to read messages).
// - requireAuth to post.
// - Admins see a delete button on every message (hover to reveal).
// - Auto-scrolls to the bottom on new messages when already near the bottom.
// - Polls every 8 seconds for new messages.
// - Never shown on the archive page — the parent only renders this during the
//   challenge phase.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MessageSquare, Send, Trash2, ShieldCheck, X } from 'lucide-react';
import { api, ApiChatMessage } from '../../api/client';
import { AuthUser } from './NavHeader';

const POLL_INTERVAL_MS = 8_000;
const MAX_BODY = 500;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return 'Today';
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function groupByDay(
  messages: ApiChatMessage[]
): Array<{ date: string; messages: ApiChatMessage[] }> {
  const groups: Array<{ date: string; messages: ApiChatMessage[] }> = [];
  for (const msg of messages) {
    const date = formatDate(msg.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.date === date) {
      last.messages.push(msg);
    } else {
      groups.push({ date, messages: [msg] });
    }
  }
  return groups;
}

interface ChallengeChatProps {
  user: AuthUser | null;
  onLogin?: () => void;
}

export function ChallengeChat({ user, onLogin }: ChallengeChatProps) {
  const [messages, setMessages] = useState<ApiChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Track whether the user is scrolled near the bottom (Discord behaviour).
  const nearBottomRef = useRef(true);

  const load = useCallback(async () => {
    const data = await api.challenge.chat.list();
    if (data) {
      setMessages((prev) => {
        if (
          prev.length === data.length &&
          prev[prev.length - 1]?.id === data[data.length - 1]?.id
        ) {
          return prev;
        }
        return data;
      });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    const result = await api.challenge.chat.post(text);
    setSending(false);
    if (!result.ok) {
      setSendError(result.error);
      return;
    }
    setDraft('');
    setMessages((prev) => [...prev, result.data.message]);
    nearBottomRef.current = true;
    void load();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    const result = await api.admin.deleteChatMessage(id);
    setDeletingId(null);
    if (result.ok) {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }
  };

  const groups = groupByDay(messages);

  return (
    <div
      className="bg-[#0d1526] border border-purple-500/20 rounded-2xl flex flex-col overflow-hidden"
      style={{ height: '480px' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800/60 flex-shrink-0">
        <MessageSquare className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-black text-white">#challenge-chat</span>
        <span className="ml-auto text-[10px] text-slate-600 font-mono uppercase tracking-wider">
          Challenge phase only
        </span>
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <MessageSquare className="w-10 h-10 text-slate-700" />
            <p className="text-slate-500 text-sm font-medium">No messages yet.</p>
            <p className="text-xs text-slate-600">Be the first to say something!</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.date}>
              {/* Date divider */}
              <div className="flex items-center gap-3 my-3">
                <div className="flex-1 h-px bg-slate-800" />
                <span className="text-[10px] text-slate-600 font-mono uppercase tracking-wider flex-shrink-0">
                  {group.date}
                </span>
                <div className="flex-1 h-px bg-slate-800" />
              </div>

              {group.messages.map((msg, i) => {
                const prev = group.messages[i - 1];
                // Compact mode: same author within 5 minutes — skip avatar/name.
                const compact =
                  prev !== undefined &&
                  prev.userId === msg.userId &&
                  new Date(msg.createdAt).getTime() -
                    new Date(prev.createdAt).getTime() <
                    5 * 60_000;

                const isMe = user !== null && msg.userId === user.id;

                return (
                  <div
                    key={msg.id}
                    className={`group flex items-start gap-3 rounded-lg px-2 py-0.5 hover:bg-slate-800/40 transition-colors ${
                      compact ? 'mt-0.5' : 'mt-3'
                    }`}
                  >
                    {/* Avatar column */}
                    <div className="w-8 flex-shrink-0 flex justify-center">
                      {compact ? (
                        <span className="text-[9px] text-slate-700 font-mono opacity-0 group-hover:opacity-100 transition-opacity mt-1 leading-none">
                          {formatTime(msg.createdAt)}
                        </span>
                      ) : msg.avatarUrl ? (
                        <img
                          src={msg.avatarUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-8 h-8 rounded-full object-cover bg-slate-800"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-black text-slate-400">
                          {msg.username.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {!compact && (
                        <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                          <span
                            className={`text-sm font-bold leading-none ${
                              isMe
                                ? 'text-amber-400'
                                : msg.isAdmin
                                ? 'text-purple-300'
                                : 'text-white'
                            }`}
                          >
                            {msg.username}
                          </span>
                          {msg.isAdmin && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-black uppercase tracking-wider text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-full">
                              <ShieldCheck className="w-2.5 h-2.5" />
                              Admin
                            </span>
                          )}
                          <span className="text-[10px] text-slate-600 font-mono">
                            {formatTime(msg.createdAt)}
                          </span>
                        </div>
                      )}
                      <p className="text-sm text-slate-300 leading-relaxed break-words whitespace-pre-wrap">
                        {msg.body}
                      </p>
                    </div>

                    {/* Admin delete — hover to reveal */}
                    {user?.isAdmin && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(msg.id)}
                        disabled={deletingId === msg.id}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-1 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Delete message"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-slate-800/60 px-4 py-3">
        {sendError && (
          <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2 mb-2">
            <p className="text-[11px] text-rose-300 flex-1">{sendError}</p>
            <button
              type="button"
              onClick={() => setSendError(null)}
              className="opacity-60 hover:opacity-100"
            >
              <X className="w-3 h-3 text-rose-300" />
            </button>
          </div>
        )}

        {user ? (
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message #challenge-chat"
              maxLength={MAX_BODY}
              rows={1}
              className="flex-1 bg-slate-900/80 border border-slate-700/60 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 resize-none focus:outline-none focus:border-purple-500/50 transition-colors leading-relaxed"
              style={{ minHeight: '40px', maxHeight: '120px' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || draft.trim() === ''}
              className="flex-shrink-0 p-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title="Send (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Log in to join the conversation.</p>
            <button
              type="button"
              onClick={onLogin}
              className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs rounded-xl transition-all flex-shrink-0"
            >
              Login with osu!
            </button>
          </div>
        )}

        {draft.length > MAX_BODY * 0.8 && (
          <p
            className={`text-[10px] mt-1 text-right ${
              draft.length >= MAX_BODY ? 'text-rose-400' : 'text-slate-600'
            }`}
          >
            {draft.length}/{MAX_BODY}
          </p>
        )}
      </div>
    </div>
  );
}
