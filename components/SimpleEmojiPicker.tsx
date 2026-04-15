'use client';

import React from 'react';

const EMOJIS = ['😀', '😂', '🥰', '😎', '😭', '🥺', '😡', '👍', '👎', '❤️', '🔥', '✨', '🎉', '🤔', '👀', '🙌', '👏', '🙏', '💪', '💯'];

export default function SimpleEmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <div className="w-64 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-3">
      <div className="grid grid-cols-5 gap-2">
        {EMOJIS.map(emoji => (
          <button 
            key={emoji} 
            type="button"
            onClick={() => onSelect(emoji)}
            className="text-2xl hover:bg-neutral-800 rounded-lg p-2 transition-colors flex items-center justify-center"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
