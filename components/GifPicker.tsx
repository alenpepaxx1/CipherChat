'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';

export default function GifPicker({ onSelect }: { onSelect: (gifUrl: string) => void }) {
  const [gifs, setGifs] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchGifs = async () => {
      setLoading(true);
      try {
        const endpoint = query.trim() 
          ? `https://api.giphy.com/v1/gifs/search?api_key=dc6zaTOxFJmzC&q=${encodeURIComponent(query)}&limit=20`
          : `https://api.giphy.com/v1/gifs/trending?api_key=dc6zaTOxFJmzC&limit=20`;
        const res = await fetch(endpoint);
        const data = await res.json();
        setGifs(data.data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchGifs, 500);
    return () => clearTimeout(timeoutId);
  }, [query]);

  return (
    <div className="w-72 sm:w-80 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-80">
      <div className="p-3 border-b border-neutral-800">
        <input 
          type="text" 
          placeholder="Search GIFs..." 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-blue-500 transition-colors"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {gifs.map((gif) => (
              <button 
                key={gif.id} 
                type="button"
                onClick={() => onSelect(gif.images.fixed_height.url)}
                className="relative aspect-video rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all"
              >
                <div className="relative w-full h-full">
                  <Image 
                    src={gif.images.fixed_height_small.url} 
                    alt={gif.title} 
                    fill 
                    className="object-cover" 
                    referrerPolicy="no-referrer"
                  />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
