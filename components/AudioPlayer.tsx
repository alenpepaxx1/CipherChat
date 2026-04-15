'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause } from 'lucide-react';

export default function AudioPlayer({ src, isMe }: { src: string, isMe: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
        setCurrentTime(audio.currentTime);
      }
    };
    const handleEnded = () => { setIsPlaying(false); setProgress(0); setCurrentTime(0); };
    const handleLoadedMetadata = () => {
      if (audio.duration !== Infinity && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, []);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (progressBarRef.current && audioRef.current && duration) {
      const rect = progressBarRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clickedProgress = (x / rect.width);
      const newTime = clickedProgress * duration;
      audioRef.current.currentTime = newTime;
      setProgress(clickedProgress * 100);
      setCurrentTime(newTime);
    }
  };

  const togglePlaybackRate = () => {
    const rates = [1, 1.5, 2];
    const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return "0:00";
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex items-center gap-3 p-3 rounded-2xl min-w-[260px] border transition-all duration-300 ${
      isMe 
        ? 'bg-white/10 border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.2)]' 
        : 'bg-neutral-800/90 border-neutral-700/50 shadow-xl'
    }`}>
      <button 
        onClick={togglePlay} 
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 shadow-lg ${
          isMe 
            ? 'bg-white text-blue-600 hover:bg-blue-50' 
            : 'bg-blue-500 text-white hover:bg-blue-600'
        }`}
      >
        {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
      </button>

      <div className="flex-1 flex flex-col gap-2">
        <div 
          ref={progressBarRef}
          onClick={handleSeek}
          className="h-1.5 bg-black/20 rounded-full cursor-pointer relative group"
        >
          <div 
            className={`absolute top-0 left-0 h-full rounded-full transition-all duration-100 ${
              isMe ? 'bg-white' : 'bg-blue-500'
            }`} 
            style={{ width: `${progress}%` }} 
          />
          <div 
            className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity ${
              isMe ? 'bg-white' : 'bg-blue-400'
            }`}
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>
        <div className="flex justify-between items-center text-[10px] font-bold tracking-wider opacity-60 uppercase">
          <span>{formatTime(currentTime)}</span>
          <div className="flex items-center gap-2">
            <button 
              onClick={togglePlaybackRate}
              aria-label={`Change playback speed. Current speed is ${playbackRate}x`}
              className={`px-2 py-0.5 rounded-md text-[9px] font-black transition-all duration-200 active:scale-95 flex items-center justify-center min-w-[32px] ${
                playbackRate > 1 
                  ? (isMe ? 'bg-white text-blue-600 shadow-sm' : 'bg-blue-500 text-white shadow-sm') 
                  : 'bg-black/20 hover:bg-black/30'
              }`}
            >
              {playbackRate}x
            </button>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
      <audio ref={audioRef} src={src} preload="metadata" />
    </div>
  );
}
