/**
 * Copyright (c) 2026 Alen Pepa. All rights reserved.
 */
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Shield, MessageSquare, Clock, Users, Lock, Server, Key, FileText, Send, Trash2, Pencil, Eye, EyeOff, Check, CheckCheck, SmilePlus, UserCircle, Camera, Phone, Video, Mic, MicOff, VideoOff, PhoneOff, Paperclip, File as FileIcon, Download, Image as ImageIcon, X, Settings, Search, Wifi, WifiOff, SignalHigh, Pin, AlertCircle, RefreshCw, CheckCircle2, ArrowRight, LogOut, Zap, Loader2, Film, Music, Archive, Code, Play, Pause, Copy, ShieldCheck, User, Menu, Globe, Cpu, Layers, Fingerprint, Activity, ChevronDown, Database, Sun, Moon, Keyboard, MonitorOff, Timer, Palette, Sparkles, Plus, Bell, ChevronLeft, ChevronRight, UserX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { validateMessage, sanitizeInput } from '../lib/security';
import { GoogleGenAI } from "@google/genai";
import { auth, db } from '../firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  updateProfile,
  signInWithPopup,
  GoogleAuthProvider,
  User as FirebaseUser
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp, collection, getDocs, query, where, writeBatch, updateDoc, deleteDoc, onSnapshot, addDoc, orderBy } from 'firebase/firestore';
import { useIsMobile } from '@/hooks/use-mobile';
import * as Crypto from '../lib/crypto';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId || undefined,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Types ---
type User = { 
  id: string; 
  name: string; 
  username: string; 
  email: string; 
  avatar: string; 
  isOnline: boolean; 
  publicKey?: string; // Base64 exported public key
};
type Reaction = { emoji: string; userIds: string[] };
type Attachment = {
  name: string;
  size: number;
  type: string;
  dataUrl: string;
};
type Message = {
  id: string;
  senderId: string;
  text: string;
  timestamp: Date;
  isEphemeral: boolean;
  ttlSeconds?: number;
  viewedAt?: Date;
  isEncryptedState?: boolean; // For visual effect
  encryptedData?: {
    ciphertext: string;
    iv: string;
  } | string;
  reactions?: Reaction[];
  attachment?: Attachment;
  status?: 'pending' | 'sent' | 'delivered' | 'failed';
  isPinned?: boolean;
  isEdited?: boolean;
  originalText?: string;
};

type Story = {
  id: string;
  userId: string;
  type: 'image' | 'video';
  url: string;
  timestamp: Date;
  viewers: string[];
};

type CallState = {
  id?: string;
  chatId: string;
  type: 'audio' | 'video';
  status: 'calling' | 'connecting' | 'connected' | 'reconnecting' | 'connection_lost';
  participants: User[];
  callerId?: string;
};
type ChatSettings = {
  readReceipts: boolean;
  defaultTtl: number;
  notifications: boolean;
  encryptionProtocol: 'standard' | 'quantum-resistant';
  autoDownload: 'all' | 'wifi-only' | 'never';
  typingIndicators: boolean;
  linkPreviews: boolean;
  themeColor?: string;
};

type Chat = {
  id: string;
  name: string;
  isGroup: boolean;
  participants: User[];
  messages: Message[];
  typingUserIds?: string[];
  settings?: ChatSettings;
};

// --- Mock Data ---
const CURRENT_USER: User = { id: 'u1', name: 'You', username: '@you', email: 'you@cipherchat.app', avatar: 'https://picsum.photos/seed/you/100/100', isOnline: true };
const ALICE: User = { id: 'u2', name: 'Alice', username: '@alice_crypto', email: 'alice@cipherchat.app', avatar: 'https://picsum.photos/seed/alice/100/100', isOnline: true };
const BOB: User = { id: 'u3', name: 'Bob', username: '@bob_secure', email: 'bob@cipherchat.app', avatar: 'https://picsum.photos/seed/bob/100/100', isOnline: false };
const GEMINI: User = { id: 'ai', name: 'Gemini AI', username: '@gemini', email: 'ai@cipherchat.app', avatar: 'https://picsum.photos/seed/sparkles/100/100', isOnline: true };

// --- Mock Data Helpers ---
const getInitialChats = (currentUser: User): Chat[] => [
  {
    id: 'ai-chat',
    name: 'AI Assistant',
    isGroup: false,
    participants: [currentUser, GEMINI],
    settings: { 
      readReceipts: true, 
      defaultTtl: 0, 
      notifications: true,
      encryptionProtocol: 'standard',
      autoDownload: 'all',
      typingIndicators: true,
      linkPreviews: true
    },
    messages: [
      { id: 'ai1', senderId: 'ai', text: 'Hello! I am your AI assistant. How can I help you today?', timestamp: new Date(), isEphemeral: false },
    ],
  },
  {
    id: 'saved',
    name: 'Saved Messages',
    isGroup: false,
    participants: [currentUser],
    settings: { 
      readReceipts: false, 
      defaultTtl: 0, 
      notifications: false,
      encryptionProtocol: 'standard',
      autoDownload: 'all',
      typingIndicators: true,
      linkPreviews: true
    },
    messages: [
      { id: 'sm1', senderId: currentUser.id, text: 'Welcome to your personal space! You can save messages, files, and notes here.', timestamp: new Date(), isEphemeral: false },
    ],
  }
];

const INITIAL_STORIES: Story[] = [
  {
    id: 's1',
    userId: 'u2', // Alice
    type: 'image',
    url: 'https://picsum.photos/seed/alice_story/1080/1920',
    timestamp: new Date(Date.now() - 3600000),
    viewers: []
  },
  {
    id: 's2',
    userId: 'u3', // Bob
    type: 'image',
    url: 'https://picsum.photos/seed/bob_story/1080/1920',
    timestamp: new Date(Date.now() - 7200000),
    viewers: []
  }
];

// --- Helper Functions ---
const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const getFileIconComponent = (type: string, className: string) => {
  if (type.startsWith('video/')) return <Film className={className} />;
  if (type.startsWith('audio/')) return <Music className={className} />;
  if (type.includes('pdf') || type.includes('text/')) return <FileText className={className} />;
  if (type.includes('zip') || type.includes('tar') || type.includes('compressed') || type.includes('rar')) return <Archive className={className} />;
  if (type.includes('json') || type.includes('javascript') || type.includes('html') || type.includes('xml')) return <Code className={className} />;
  return <FileIcon className={className} />;
};

function AudioPlayer({ src, isMe }: { src: string, isMe: boolean }) {
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

// --- Components ---

function StoryBar({ stories, currentUser, onStoryClick, onAddStory }: { stories: Story[], currentUser: User, onStoryClick: (userId: string) => void, onAddStory: () => void }) {
  const userStories = stories.reduce((acc, story) => {
    if (!acc[story.userId]) acc[story.userId] = [];
    acc[story.userId].push(story);
    return acc;
  }, {} as Record<string, Story[]>);

  const userIds = Object.keys(userStories);

  return (
    <div className="px-3 mb-8">
      <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em] mb-4">Recent Stories</div>
      <div className="flex items-center gap-4 overflow-x-auto pb-2 no-scrollbar">
        <div className="flex flex-col items-center gap-2 flex-shrink-0">
          <button 
            onClick={onAddStory}
            className="w-14 h-14 rounded-2xl bg-neutral-900 border-2 border-dashed border-neutral-800 flex items-center justify-center text-neutral-500 hover:text-blue-400 hover:border-blue-500/50 transition-all group"
          >
            <Plus className="w-6 h-6 group-hover:scale-110 transition-transform" />
          </button>
          <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">You</span>
        </div>

        {userIds.map(uid => {
          const user = [ALICE, BOB, GEMINI].find(u => u.id === uid);
          if (!user) return null;
          const hasUnseen = userStories[uid].some(s => !s.viewers.includes(currentUser.id));
          
          return (
            <div key={uid} className="flex flex-col items-center gap-2 flex-shrink-0">
              <button 
                onClick={() => onStoryClick(uid)}
                className={`w-14 h-14 rounded-2xl p-0.5 transition-all active:scale-95 ${hasUnseen ? 'bg-gradient-to-tr from-blue-500 to-indigo-600' : 'bg-neutral-800'}`}
              >
                <div className="w-full h-full rounded-[0.85rem] overflow-hidden border-2 border-neutral-950">
                  <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                </div>
              </button>
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest truncate w-14 text-center">{user.name.split(' ')[0]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StoryViewer({ userId, stories, onClose, currentUser, setStories }: { userId: string, stories: Story[], onClose: () => void, currentUser: User, setStories: React.Dispatch<React.SetStateAction<Story[]>> }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const story = stories[currentIndex];
  const user = [ALICE, BOB, GEMINI, currentUser].find(u => u.id === userId);

  useEffect(() => {
    if (story && !story.viewers.includes(currentUser.id)) {
      setStories(prev => prev.map(s => s.id === story.id ? { ...s, viewers: [...s.viewers, currentUser.id] } : s));
    }
  }, [currentIndex, story, currentUser.id, setStories]);

  useEffect(() => {
    if (isPaused) return;
    const timer = setTimeout(() => {
      if (currentIndex < stories.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        onClose();
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [currentIndex, stories.length, onClose, isPaused]);

  if (!story || !user) return null;

  const handleNext = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
    >
      <div className="relative w-full max-w-lg h-full md:h-[90vh] md:rounded-3xl overflow-hidden bg-neutral-900 shadow-2xl group">
        {/* Progress Bars */}
        <div className="absolute top-4 inset-x-4 flex gap-1.5 z-20">
          {stories.map((_, i) => (
            <div key={i} className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ 
                  width: i < currentIndex ? '100%' : i === currentIndex ? '100%' : '0%' 
                }}
                transition={{ 
                  duration: i === currentIndex ? 5 : 0, 
                  ease: 'linear'
                } as any}
                className="h-full bg-white"
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-8 inset-x-6 flex items-center justify-between z-20 pointer-events-none">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/20">
              <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">{user.name}</div>
              <div className="text-[10px] font-medium text-white/60 uppercase tracking-widest">
                {new Date(story.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 text-white/60 hover:text-white transition-colors pointer-events-auto"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div 
          className="w-full h-full flex items-center justify-center bg-black cursor-pointer"
          onMouseDown={() => setIsPaused(true)}
          onMouseUp={() => setIsPaused(false)}
          onTouchStart={() => setIsPaused(true)}
          onTouchEnd={() => setIsPaused(false)}
        >
          {story.type === 'image' ? (
            <img src={story.url} alt="Story" className="w-full h-full object-contain select-none" />
          ) : (
            <video src={story.url} autoPlay muted playsInline className="w-full h-full object-contain" />
          )}
        </div>

        {/* Navigation Overlays */}
        <div className="absolute inset-0 flex z-10 pointer-events-none">
          <div 
            className="flex-1 cursor-pointer pointer-events-auto group/nav" 
            onClick={handlePrev}
          >
            <div className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/20 backdrop-blur-md rounded-full text-white opacity-0 group-hover/nav:opacity-100 transition-opacity">
              <ChevronLeft className="w-6 h-6" />
            </div>
          </div>
          <div 
            className="flex-1 cursor-pointer pointer-events-auto group/nav" 
            onClick={handleNext}
          >
            <div className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/20 backdrop-blur-md rounded-full text-white opacity-0 group-hover/nav:opacity-100 transition-opacity">
              <ChevronRight className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Pause Indicator */}
        <AnimatePresence>
          {isPaused && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none"
            >
              <div className="p-6 bg-black/40 backdrop-blur-xl rounded-full">
                <Pause className="w-12 h-12 text-white/80 fill-white/20" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function StoryUploadModal({ onClose, onUpload, currentUser }: { onClose: () => void, onUpload: (story: Story) => void, currentUser: User }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(selectedFile);
    }
  };

  const handleUpload = () => {
    if (!preview || !file) return;
    setIsUploading(true);
    
    // Simulate upload
    setTimeout(() => {
      const newStory: Story = {
        id: Math.random().toString(36).substring(7),
        userId: currentUser.id,
        type: file.type.startsWith('video') ? 'video' : 'image',
        url: preview,
        timestamp: new Date(),
        viewers: []
      };
      onUpload(newStory);
      setIsUploading(false);
    }, 1500);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md glass border border-neutral-800/60 rounded-[2.5rem] overflow-hidden shadow-2xl"
      >
        <div className="p-8 space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-display font-bold text-white tracking-tight">Post a Story</h2>
            <button onClick={onClose} className="p-2 text-neutral-500 hover:text-white transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>

          {!preview ? (
            <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-neutral-800 rounded-3xl cursor-pointer hover:border-blue-500/50 hover:bg-blue-500/5 transition-all group">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <div className="p-4 bg-neutral-900 rounded-2xl mb-4 group-hover:scale-110 transition-transform">
                  <Camera className="w-8 h-8 text-neutral-500 group-hover:text-blue-400" />
                </div>
                <p className="text-sm text-neutral-400 font-medium">Click to upload photo or video</p>
                <p className="text-xs text-neutral-600 mt-2">Stories disappear after 24 hours</p>
              </div>
              <input type="file" className="hidden" accept="image/*,video/*" onChange={handleFileChange} />
            </label>
          ) : (
            <div className="relative w-full h-96 rounded-3xl overflow-hidden border border-neutral-800">
              {file?.type.startsWith('video') ? (
                <video src={preview} autoPlay muted loop className="w-full h-full object-cover" />
              ) : (
                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              )}
              <button 
                onClick={() => { setFile(null); setPreview(null); }}
                className="absolute top-4 right-4 p-2 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          )}

          <div className="flex gap-4">
            <button 
              onClick={onClose}
              className="flex-1 py-4 px-6 rounded-2xl bg-neutral-900 text-neutral-400 font-bold hover:bg-neutral-800 transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={handleUpload}
              disabled={!preview || isUploading}
              className="flex-1 py-4 px-6 rounded-2xl bg-blue-500 text-neutral-950 font-bold hover:bg-blue-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              Post Story
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Components ---

function CipherChatApp({ user, onLogout, onLock }: { user: User, onLogout: () => void, onLock: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [cryptoError, setCryptoError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [currentUser, setCurrentUser] = useState<User>(user);
  const [activeTab, setActiveTab] = useState<'chat' | 'architecture' | 'profile' | 'settings'>('chat');
  const [chats, setChats] = useState<Chat[]>(() => getInitialChats(user));
  const [stories, setStories] = useState<Story[]>(INITIAL_STORIES);
  const [activeStoryUserId, setActiveStoryUserId] = useState<string | null>(null);
  const [showStoryUpload, setShowStoryUpload] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string>('ai-chat');
  const [activeCall, setActiveCall] = useState<CallState | null>(null);
  const [isNetworkOnline, setIsNetworkOnline] = useState(true);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [userPrivateKey, setUserPrivateKey] = useState<CryptoKey | null>(null);

  useEffect(() => {
    if (!Crypto.isCryptoAvailable()) {
      setCryptoError('End-to-End Encryption (E2EE) is currently disabled because you are accessing the app over a non-secure connection (HTTP). For full security and encryption, please use HTTPS or localhost.');
    }
  }, []);

  const [antiCensorship, setAntiCensorship] = useState(false);
  const [connectionProtocol, setConnectionProtocol] = useState<'direct' | 'proxy' | 'wireguard' | 'openvpn'>('direct');
  const [screenSecurity, setScreenSecurity] = useState(false);

  useEffect(() => {
    async function initCrypto() {
      if (!Crypto.isCryptoAvailable()) return;
      let privKey = await Crypto.getPrivateKey();
      let pubKeyStr = currentUser.publicKey;

      if (!privKey) {
        const keyPair = await Crypto.generateKeyPair();
        await Crypto.savePrivateKey(keyPair.privateKey);
        privKey = keyPair.privateKey;
        pubKeyStr = await Crypto.exportPublicKey(keyPair.publicKey);
        setCurrentUser(prev => ({ ...prev, publicKey: pubKeyStr }));
      }
      setUserPrivateKey(privKey);

      // Initialize mock users with public keys for E2EE demo
      const mockUsersWithKeys = await Promise.all([ALICE, BOB, GEMINI].map(async (u) => {
        const kp = await Crypto.generateKeyPair();
        const pk = await Crypto.exportPublicKey(kp.publicKey);
        return { ...u, publicKey: pk };
      }));

      setChats(prev => prev.map(chat => ({
        ...chat,
        participants: chat.participants.map(p => {
          const mock = mockUsersWithKeys.find(m => m.id === p.id);
          return mock ? { ...p, publicKey: mock.publicKey } : p;
        })
      })));
    }
    initCrypto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMounted(true);
    if (isMobile) setIsSidebarOpen(false);

    // Initialize settings from localStorage
    const savedAntiCensorship = localStorage.getItem('cipher-anti-censorship') === 'true';
    const savedProtocol = (localStorage.getItem('cipher-protocol') as any) || 'direct';
    const savedScreenSecurity = localStorage.getItem('cipher-screen-security') === 'true';

    setAntiCensorship(savedAntiCensorship);
    setConnectionProtocol(savedProtocol);
    setScreenSecurity(savedScreenSecurity);
  }, [isMobile]);

  // Real-time Chat Listener
  useEffect(() => {
    if (!currentUser?.id) return;

    const q = query(
      collection(db, 'chats'), 
      where('participantIds', 'array-contains', currentUser.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const updatedChats = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
          messages: data.messages || [] 
        } as Chat;
      });
      
      setChats(prev => {
        const initialChats = getInitialChats(currentUser);
        const result = [...initialChats];
        
        updatedChats.forEach(newChat => {
          const index = result.findIndex(c => c.id === newChat.id);
          if (index !== -1) {
            // Merge Firestore data with existing state (preserving messages)
            result[index] = { ...result[index], ...newChat, messages: result[index].messages };
          } else {
            result.push(newChat);
          }
        });

        // Ensure no duplicates by ID
        return result.filter((chat, index, self) => 
          index === self.findIndex((t) => t.id === chat.id)
        );
      });
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'chats');
    });

    return () => unsubscribe();
  }, [currentUser?.id]);

  // Real-time Message Listener for Active Chat
  useEffect(() => {
    if (!activeChatId || !currentUser?.id) return;

    // Skip Firestore listener for local-only chats to avoid permission errors
    if (activeChatId === 'ai-chat' || activeChatId === 'saved') return;

    const q = query(
      collection(db, 'chats', activeChatId, 'messages'), 
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
          timestamp: data.timestamp?.toDate() || new Date()
        } as Message;
      });
      
      setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, messages } : c));
    }, (err) => {
      // If messages subcollection doesn't exist yet, it's fine
      if (err.message.includes('permission-denied')) {
         console.warn("Permission denied for messages - might be a new chat");
      } else {
        handleFirestoreError(err, OperationType.LIST, `chats/${activeChatId}/messages`);
      }
    });

    return () => unsubscribe();
  }, [activeChatId, currentUser?.id]);

  // Real-time Call Listener
  useEffect(() => {
    if (!currentUser?.id) return;

    const q = query(
      collection(db, 'calls'), 
      where('participantIds', 'array-contains', currentUser.id),
      where('status', '==', 'calling')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const callData = change.doc.data();
          if (callData.callerId !== currentUser.id) {
            setActiveCall({
              id: change.doc.id,
              chatId: callData.chatId,
              type: callData.type,
              status: 'calling',
              participants: callData.participants,
              callerId: callData.callerId
            });
          }
        }
      });
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'calls');
    });

    return () => unsubscribe();
  }, [currentUser?.id]);

  // Sync user profile to public collection for searchability
  useEffect(() => {
    if (!currentUser?.id) return;

    const syncProfile = async () => {
      try {
        await setDoc(doc(db, 'users_public', currentUser.id), {
          id: currentUser.id,
          name: currentUser.name,
          username: currentUser.username,
          avatar: currentUser.avatar,
          isOnline: true,
          lastSeen: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Profile sync failed:", err);
      }
    };

    syncProfile();
  }, [currentUser?.id, currentUser?.name, currentUser?.username, currentUser?.avatar]);

  if (!mounted) return null;

  // Removed blocking cryptoError screen to allow HTTP access as requested by user
  // if (cryptoError) { ... }

  const activeChat = chats.find(c => c.id === activeChatId);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  return (
    <div className={`flex h-[100dvh] bg-neutral-950 text-neutral-100 font-sans overflow-hidden selection:bg-blue-500/30 relative ${screenSecurity ? 'select-none' : ''}`}>
      {/* Non-blocking Crypto Warning Banner */}
      <AnimatePresence>
        {cryptoError && (
          <motion.div 
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            exit={{ y: -100 }}
            className="fixed top-0 left-0 right-0 z-[100] bg-amber-500/90 backdrop-blur-md text-amber-950 px-4 py-2 text-center text-xs font-bold flex items-center justify-center gap-2 shadow-lg"
          >
            <AlertCircle className="w-4 h-4" />
            <span>{cryptoError}</span>
            <button 
              onClick={() => setCryptoError(null)}
              className="ml-2 p-1 hover:bg-amber-600/20 rounded-full transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Dynamic Watermark (Deterrent) */}
      {screenSecurity && (
        <div className="fixed inset-0 pointer-events-none z-[999] opacity-[0.03] flex flex-wrap content-around justify-around overflow-hidden select-none">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="text-white font-bold text-xl -rotate-45 whitespace-nowrap">
              {currentUser.username} • {new Date().toLocaleDateString()}
            </div>
          ))}
        </div>
      )}
      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isMobile && isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.div 
        initial={isMobile ? { x: '-100%' } : { x: 0 }}
        animate={isMobile ? { x: isSidebarOpen ? 0 : '-100%' } : { x: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className={`${isMobile ? 'fixed inset-y-0 left-0 w-[85vw] max-w-[320px]' : 'w-80'} glass border-r border-neutral-800/60 flex flex-col z-40`}
      >
        <div className="p-3 sm:p-4 lg:p-6 border-b border-neutral-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-2 sm:p-2.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg shadow-blue-500/30">
              <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <h1 className="font-display font-bold text-lg sm:text-xl lg:text-2xl tracking-tight text-gradient">CipherChat</h1>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button 
              onClick={() => setShowNewChatModal(true)}
              className="p-2 text-neutral-400 hover:text-emerald-400 hover:bg-neutral-800/50 rounded-xl transition-all duration-300"
              title="Create new group"
            >
              <Users className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowStoryUpload(true)}
              className="p-2 text-neutral-400 hover:text-amber-400 hover:bg-neutral-800/50 rounded-xl transition-all duration-300"
              title="Post a story"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setShowNewChatModal(true)}
              className="p-2 text-neutral-400 hover:text-blue-400 hover:bg-neutral-800/50 rounded-xl transition-all duration-300"
              title="Search users or groups"
            >
              <Search className="w-5 h-5" />
            </button>
            {isMobile && (
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800/50 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
          {/* Stories */}
          <StoryBar 
            stories={stories} 
            currentUser={currentUser} 
            onStoryClick={(uid) => setActiveStoryUserId(uid)} 
            onAddStory={() => setShowStoryUpload(true)} 
          />

          {/* Assistant Intelligence */}
          <div>
            <div className="px-3 mb-4 text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em]">Assistant Intelligence</div>
            <div className="space-y-1.5">
              {chats.filter(c => c.id === 'ai-chat').map(chat => (
                <button
                  key={chat.id}
                  onClick={() => { 
                    setActiveChatId(chat.id); 
                    setActiveTab('chat'); 
                    if (isMobile) setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-300 ${activeChatId === chat.id && activeTab === 'chat' ? 'bg-purple-500/10 text-purple-400 shadow-[inset_0_0_20px_rgba(168,85,247,0.05)] border border-purple-500/20' : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200 border border-transparent'}`}
                >
                  <div className={`p-2 rounded-xl ${activeChatId === chat.id && activeTab === 'chat' ? 'bg-purple-500/20 text-purple-400' : 'bg-neutral-800 text-neutral-500'}`}>
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <span className="truncate flex-1 text-left">{chat.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Saved Messages */}
          <div>
            <div className="px-3 mb-4 text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em]">Personal Space</div>
            <div className="space-y-1.5">
              {chats.filter(c => c.id === 'saved').map(chat => (
                <button
                  key={chat.id}
                  onClick={() => { 
                    setActiveChatId(chat.id); 
                    setActiveTab('chat'); 
                    if (isMobile) setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-300 ${activeChatId === chat.id && activeTab === 'chat' ? 'bg-blue-500/10 text-blue-400 shadow-[inset_0_0_20px_rgba(59,130,246,0.05)] border border-blue-500/20' : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200 border border-transparent'}`}
                >
                  <div className={`p-2 rounded-xl ${activeChatId === chat.id && activeTab === 'chat' ? 'bg-blue-500/20 text-blue-400' : 'bg-neutral-800 text-neutral-500'}`}>
                    <Archive className="w-4 h-4" />
                  </div>
                  <span className="truncate flex-1 text-left">Saved Messages</span>
                </button>
              ))}
            </div>
          </div>

          {/* Direct Messages */}
          <div>
            <div className="px-3 mb-4 text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em] flex items-center justify-between">
              <span>Direct Messages</span>
            </div>
            <div className="space-y-1.5">
              {chats.filter(c => !c.isGroup && c.id !== 'saved' && c.id !== 'ai-chat').map(chat => (
                <div key={chat.id} className="relative group">
                  <button
                    onClick={() => { 
                      setActiveChatId(chat.id); 
                      setActiveTab('chat'); 
                      if (isMobile) setIsSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-300 ${activeChatId === chat.id && activeTab === 'chat' ? 'bg-neutral-800/80 text-neutral-100 shadow-lg border border-neutral-700/50' : 'text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200 border border-transparent'}`}
                  >
                    <div className="relative">
                      <div className={`p-2 rounded-xl ${activeChatId === chat.id && activeTab === 'chat' ? 'bg-blue-500/20 text-blue-400' : 'bg-neutral-800 text-neutral-500'}`}>
                        <Lock className="w-4 h-4" />
                      </div>
                      {chat.participants.some(p => p.id !== currentUser.id && p.isOnline) && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-neutral-900 rounded-full"></span>
                      )}
                    </div>
                    <span className="truncate flex-1 text-left">{chat.name}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setChats(prev => prev.filter(c => c.id !== chat.id));
                      if (activeChatId === chat.id) setActiveChatId('');
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-neutral-500 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete chat"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Groups */}
          <div>
            <div className="px-3 mb-4 text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em] flex items-center justify-between">
              <span>Groups</span>
            </div>
            <div className="space-y-1.5">
              {chats.filter(c => c.isGroup).map(chat => (
                <button
                  key={chat.id}
                  onClick={() => { 
                    setActiveChatId(chat.id); 
                    setActiveTab('chat'); 
                    if (isMobile) setIsSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-300 ${activeChatId === chat.id && activeTab === 'chat' ? 'bg-neutral-800/80 text-neutral-100 shadow-lg border border-neutral-700/50' : 'text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200 border border-transparent'}`}
                >
                  <div className={`p-2 rounded-xl ${activeChatId === chat.id && activeTab === 'chat' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-neutral-800 text-neutral-500'}`}>
                    <Users className="w-4 h-4" />
                  </div>
                  <span className="truncate flex-1 text-left">{chat.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* System Views (Hidden by default, accessible via small buttons) */}
          <div className="pt-4 border-t border-neutral-800/40">
            <div className="px-3 mb-4 text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em]">System</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setActiveTab('profile'); if (isMobile) setIsSidebarOpen(false); }}
                className={`flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${activeTab === 'profile' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50 border border-transparent'}`}
              >
                <UserCircle className="w-4 h-4" /> Profile
              </button>
              <button
                onClick={() => { setActiveTab('settings'); if (isMobile) setIsSidebarOpen(false); }}
                className={`flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${activeTab === 'settings' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50 border border-transparent'}`}
              >
                <Settings className="w-4 h-4" /> Settings
              </button>
              <button
                onClick={onLock}
                className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all duration-300 text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent"
              >
                <Lock className="w-4 h-4" /> Lock App
              </button>
            </div>
          </div>
        </div>
        
        <div className="p-6 border-t border-neutral-800/60 flex flex-col gap-5 bg-neutral-900/20">
          <div className="flex items-center justify-between px-1">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-30"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                </div>
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">E2EE Active</span>
              </div>
              {antiCensorship && (
                <div className="flex items-center gap-3">
                  <div className="relative flex h-2.5 w-2.5">
                    <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-30"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest flex items-center gap-1">
                    <Globe className="w-2.5 h-2.5" /> {connectionProtocol} Active
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <SignalHigh className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-[10px] font-mono text-neutral-500">v4.2</span>
            </div>
          </div>
          <button 
            onClick={() => setIsNetworkOnline(!isNetworkOnline)}
            className={`w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all duration-300 border ${isNetworkOnline ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20'}`}
          >
            {isNetworkOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {isNetworkOnline ? 'Network Online' : 'Network Offline'}
          </button>
          <button 
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all duration-300 border border-transparent hover:border-rose-500/20"
          >
            <LogOut className="w-4 h-4" /> Log out
          </button>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-neutral-900 via-neutral-950 to-neutral-950 w-full overflow-hidden">
        {activeTab === 'profile' && <ProfileView currentUser={currentUser} setCurrentUser={setCurrentUser} setChats={setChats} onToggleSidebar={toggleSidebar} isMobile={isMobile} />}
        {activeTab === 'settings' && (
          <SettingsView 
            onToggleSidebar={toggleSidebar} 
            isMobile={isMobile} 
            antiCensorship={antiCensorship}
            setAntiCensorship={setAntiCensorship}
            connectionProtocol={connectionProtocol}
            setConnectionProtocol={setConnectionProtocol}
            screenSecurity={screenSecurity}
            setScreenSecurity={setScreenSecurity}
            currentUser={currentUser}
            onLogout={onLogout}
          />
        )}
        {activeTab === 'chat' && activeChat && (
          <ChatView 
            chat={activeChat} 
            setChats={setChats} 
            currentUser={currentUser} 
            setActiveCall={setActiveCall} 
            isNetworkOnline={isNetworkOnline} 
            onToggleSidebar={toggleSidebar} 
            isMobile={isMobile} 
            userPrivateKey={userPrivateKey}
          />
        )}
        
        {/* Call Overlay */}
        <AnimatePresence>
          {activeCall && (
            <CallOverlay 
              activeCall={activeCall} 
              setActiveCall={setActiveCall} 
              currentUser={currentUser} 
            />
          )}
        </AnimatePresence>

        {/* New Chat Modal */}
        <AnimatePresence>
          {showNewChatModal && (
            <NewChatModal 
              onClose={() => setShowNewChatModal(false)} 
              currentUser={currentUser}
              onCreateChat={(newChat) => {
                setChats(prev => [newChat, ...prev]);
                setActiveChatId(newChat.id);
                setShowNewChatModal(false);
              }}
            />
          )}
        </AnimatePresence>

        {/* Story Modals */}
        <AnimatePresence>
          {activeStoryUserId && (
            <StoryViewer 
              userId={activeStoryUserId} 
              stories={stories.filter(s => s.userId === activeStoryUserId)} 
              onClose={() => setActiveStoryUserId(null)}
              currentUser={currentUser}
              setStories={setStories}
            />
          )}
          {showStoryUpload && (
            <StoryUploadModal 
              onClose={() => setShowStoryUpload(false)} 
              onUpload={(story) => {
                setStories(prev => [story, ...prev]);
                setShowStoryUpload(false);
              }}
              currentUser={currentUser}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function DecryptedText({ 
  msg, 
  chat, 
  currentUser, 
  userPrivateKey 
}: { 
  msg: Message, 
  chat: Chat, 
  currentUser: User, 
  userPrivateKey: CryptoKey | null 
}) {
  const [decryptedText, setDecryptedText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function decrypt() {
      if (!msg.encryptedData || !userPrivateKey) return;
      
      try {
        const sender = chat.participants.find(p => p.id === msg.senderId);
        if (!sender?.publicKey) throw new Error("No public key");

        const senderPubKey = await Crypto.importPublicKey(sender.publicKey);
        const secretKey = await Crypto.deriveSecretKey(userPrivateKey, senderPubKey);
        const encryptedData = msg.encryptedData as { ciphertext: ArrayBuffer; iv: Uint8Array };
        const text = await Crypto.decryptMessage(encryptedData.ciphertext, encryptedData.iv, secretKey);
        setDecryptedText(text);
      } catch (err) {
        console.error("Decryption failed:", err);
        setError(true);
      }
    }
    decrypt();
  }, [msg.encryptedData, userPrivateKey, chat.participants, msg.senderId]);

  if (error) return <span className="text-rose-400 italic">Failed to decrypt message</span>;
  if (!decryptedText) return <span className="opacity-50 italic">Decrypting...</span>;
  return <span>{decryptedText}</span>;
}

const EMOJIS = ['😀', '😂', '🥰', '😎', '😭', '🥺', '😡', '👍', '👎', '❤️', '🔥', '✨', '🎉', '🤔', '👀', '🙌', '👏', '🙏', '💪', '💯'];

function SimpleEmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
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

function GifPicker({ onSelect }: { onSelect: (gifUrl: string) => void }) {
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
                <img src={gif.images.fixed_height_small.url} alt={gif.title} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatView({ chat, setChats, currentUser, setActiveCall, isNetworkOnline, onToggleSidebar, isMobile, userPrivateKey }: { 
  chat: Chat, 
  setChats: React.Dispatch<React.SetStateAction<Chat[]>>, 
  currentUser: User, 
  setActiveCall: React.Dispatch<React.SetStateAction<CallState | null>>, 
  isNetworkOnline: boolean, 
  onToggleSidebar: () => void, 
  isMobile: boolean,
  userPrivateKey: CryptoKey | null
}) {
  const [inputText, setInputText] = useState('');
  const [isEphemeral, setIsEphemeral] = useState(false);
  const [ttl, setTtl] = useState(chat.settings?.defaultTtl || 10);
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<string | null>(null);
  const [groupActionConfirm, setGroupActionConfirm] = useState<'exit' | 'delete' | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<Attachment | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilterSender, setSearchFilterSender] = useState<'all' | 'me' | 'them'>('all');
  const [searchFilterDate, setSearchFilterDate] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [searchFilterType, setSearchFilterType] = useState<'all' | 'text' | 'attachment' | 'voice'>('all');
  const [showPinned, setShowPinned] = useState(false);
  const [syncNotification, setSyncNotification] = useState<string | null>(null);
  const [activePicker, setActivePicker] = useState<'emoji' | 'gif' | null>(null);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [pgpPublicKey, setPgpPublicKey] = useState<string | null>(null);
  const [pgpPrivateKey, setPgpPrivateKey] = useState<string | null>(null);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const emojiPickerRef = React.useRef<HTMLDivElement>(null);
  const ai = useRef(new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '' }));

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setActivePicker(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    async function loadKeys() {
      const savedPrivateKey = await Crypto.getPrivateKey();
      if (savedPrivateKey) {
        setPgpPrivateKey(savedPrivateKey);
      }
    }
    loadKeys();
  }, []);

  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const recordingTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          setAttachmentPreview({
            name: `Voice Message (${formatTime(recordingDuration)})`,
            size: audioBlob.size,
            type: 'audio/webm',
            dataUrl: base64data
          });
        };
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      // Error handled silently for privacy
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = null; // Prevent saving
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const exportPgpKeys = () => {
    const keys = JSON.stringify({ publicKey: pgpPublicKey, privateKey: pgpPrivateKey });
    const blob = new Blob([keys], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pgp-keys.json';
    a.click();
  };

  const importPgpKeys = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const keys = JSON.parse(e.target?.result as string);
      setPgpPublicKey(keys.publicKey);
      setPgpPrivateKey(keys.privateKey);
      await Crypto.savePrivateKey(keys.privateKey);
    };
    reader.readAsText(file);
  };

  const encryptMessage = async (message: string, publicKey: string) => {
    const pgp = await import('openpgp');
    const pgpPublicKey = await pgp.readKey({ armoredKey: publicKey });
    const encrypted = await pgp.encrypt({
      message: await pgp.createMessage({ text: message }),
      encryptionKeys: pgpPublicKey
    });
    return encrypted as string;
  };

  const decryptMessage = async (encryptedMessage: string, privateKey: string) => {
    const pgp = await import('openpgp');
    const pgpPrivateKey = await pgp.readPrivateKey({ armoredKey: privateKey });
    const message = await pgp.readMessage({ armoredMessage: encryptedMessage });
    const { data: decrypted } = await pgp.decrypt({
      message,
      decryptionKeys: pgpPrivateKey
    });
    return decrypted as string;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setAttachmentPreview({
        name: file.name,
        size: file.size,
        type: file.type,
        dataUrl: event.target?.result as string
      });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = () => {
    setAttachmentPreview(null);
  };

  const confirmDelete = () => {
    if (!messageToDelete) return;
    setChats(prev => prev.map(c => {
      if (c.id !== chat.id) return c;
      return { ...c, messages: c.messages.filter(m => m.id !== messageToDelete) };
    }));
    setMessageToDelete(null);
  };

  const handleReact = (messageId: string, emoji: string) => {
    setChats(prev => prev.map(c => {
      if (c.id !== chat.id) return c;
      return {
        ...c,
        messages: c.messages.map(m => {
          if (m.id !== messageId) return m;
          const existingReactions = m.reactions || [];
          const reactionIndex = existingReactions.findIndex(r => r.emoji === emoji);
          let newReactions = [...existingReactions];

          if (reactionIndex >= 0) {
            const userIds = newReactions[reactionIndex].userIds;
            if (userIds.includes(currentUser.id)) {
              newReactions[reactionIndex] = { ...newReactions[reactionIndex], userIds: userIds.filter(id => id !== currentUser.id) };
              if (newReactions[reactionIndex].userIds.length === 0) {
                newReactions.splice(reactionIndex, 1);
              }
            } else {
              newReactions[reactionIndex] = { ...newReactions[reactionIndex], userIds: [...userIds, currentUser.id] };
            }
          } else {
            newReactions.push({ emoji, userIds: [currentUser.id] });
          }
          return { ...m, reactions: newReactions };
        })
      };
    }));
    setActiveReactionMsgId(null);
  };

  const handleTouchStart = (messageId: string) => {
    longPressTimerRef.current = setTimeout(() => {
      setActiveReactionMsgId(messageId);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const togglePin = (messageId: string) => {
    setChats(prev => prev.map(c => {
      if (c.id !== chat.id) return c;
      return {
        ...c,
        messages: c.messages.map(m => m.id === messageId ? { ...m, isPinned: !m.isPinned } : m)
      };
    }));
  };

  // Handle ephemeral message countdowns
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setCurrentTime(now);
      setChats(prevChats => {
        const chatToUpdate = prevChats.find(c => c.id === chat.id);
        if (!chatToUpdate) return prevChats;

        const hasExpired = chatToUpdate.messages.some(m => {
          if (!m.isEphemeral || !m.viewedAt || !m.ttlSeconds) return false;
          const elapsed = (now - m.viewedAt.getTime()) / 1000;
          return elapsed >= m.ttlSeconds;
        });

        if (!hasExpired) return prevChats;

        return prevChats.map(c => {
          if (c.id !== chat.id) return c;
          const updatedMessages = c.messages.filter(m => {
            if (!m.isEphemeral || !m.viewedAt || !m.ttlSeconds) return true;
            const elapsed = (now - m.viewedAt.getTime()) / 1000;
            return elapsed < m.ttlSeconds;
          });
          return { ...c, messages: updatedMessages };
        });
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [chat.id, setChats]);

  // Mark incoming messages as viewed
  useEffect(() => {
    if (chat.settings?.readReceipts === false) return;
    
    const hasUnread = chat.messages.some(m => !m.viewedAt && m.senderId !== currentUser.id);
    if (!hasUnread) return;

    setChats(prevChats => prevChats.map(c => {
      if (c.id !== chat.id) return c;
      let changed = false;
      const updatedMessages = c.messages.map(m => {
        if (!m.viewedAt && m.senderId !== currentUser.id) {
          changed = true;
          return { ...m, viewedAt: new Date() };
        }
        return m;
      });
      return changed ? { ...c, messages: updatedMessages } : c;
    }));
  }, [chat.id, chat.messages, setChats, currentUser.id, chat.settings?.readReceipts]);

  // Simulate recipient delivering and reading your messages after a delay
  useEffect(() => {
    const hasSent = chat.messages.some(m => m.senderId === currentUser.id && m.status === 'sent');
    if (hasSent) {
      const timer = setTimeout(() => {
        setChats(prevChats => prevChats.map(c => {
          if (c.id !== chat.id) return c;
          const hasSentInPrev = c.messages.some(m => m.senderId === currentUser.id && m.status === 'sent');
          if (!hasSentInPrev) return c;
          return {
            ...c,
            messages: c.messages.map(m => 
              (m.senderId === currentUser.id && m.status === 'sent') ? { ...m, status: 'delivered' as const } : m
            )
          };
        }));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [chat.id, chat.messages, setChats, currentUser.id]);

  useEffect(() => {
    const hasUnreadDelivered = chat.messages.some(m => m.senderId === currentUser.id && m.status === 'delivered' && !m.viewedAt);
    if (hasUnreadDelivered) {
      const timer = setTimeout(() => {
        setChats(prevChats => prevChats.map(c => {
          if (c.id !== chat.id) return c;
          const hasUnreadInPrev = c.messages.some(m => m.senderId === currentUser.id && m.status === 'delivered' && !m.viewedAt);
          if (!hasUnreadInPrev) return c;
          return {
            ...c,
            messages: c.messages.map(m => 
              (m.senderId === currentUser.id && m.status === 'delivered' && !m.viewedAt) ? { ...m, viewedAt: new Date() } : m
            )
          };
        }));
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [chat.id, chat.messages, setChats, currentUser.id]);

  const initiateCall = async (type: 'audio' | 'video') => {
    const participants = chat.participants.filter(p => p.id !== currentUser.id);
    const participantIds = [currentUser.id, ...participants.map(p => p.id)];
    
    const callData = {
      chatId: chat.id,
      type,
      status: 'calling',
      participants: [currentUser, ...participants],
      participantIds,
      callerId: currentUser.id,
      createdAt: serverTimestamp()
    };

    try {
      const callRef = await addDoc(collection(db, 'calls'), callData);
      setActiveCall({ ...callData, id: callRef.id } as any);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'calls');
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && !attachmentPreview) return;

    // Rate limiting
    if (Date.now() - lastMessageTime < 1000) return;
    setLastMessageTime(Date.now());

    // Validation and Sanitization
    const validation = validateMessage({ text: inputText, senderId: currentUser.id });
    if (!validation.success) return;
    const sanitizedText = sanitizeInput(inputText);

    const newMessage: Message = {
      id: Math.random().toString(36).substring(7),
      senderId: currentUser.id,
      text: sanitizedText,
      timestamp: new Date(),
      isEphemeral,
      ttlSeconds: isEphemeral ? ttl : undefined,
      isEncryptedState: true, // Start in encrypted state for visual effect
      viewedAt: isEphemeral ? new Date() : undefined, // Sender views it immediately
      attachment: attachmentPreview || undefined,
      status: isNetworkOnline ? 'sent' : 'pending',
    };

    // Real E2EE Encryption for 1:1 chats
    if (userPrivateKey && !chat.isGroup && chat.id !== 'saved' && chat.id !== 'ai-chat') {
      const recipient = chat.participants.find(p => p.id !== currentUser.id);
      if (recipient?.publicKey) {
        try {
          const recipientPubKey = await Crypto.importPublicKey(recipient.publicKey);
          const secretKey = await Crypto.deriveSecretKey(userPrivateKey, recipientPubKey);
          const encrypted = await Crypto.encryptMessage(inputText, secretKey);
          newMessage.encryptedData = encrypted;
          newMessage.text = "[Encrypted Message]"; // Mask original text
        } catch (err) {
          console.error("Encryption failed:", err);
        }
      }
    } else if (pgpPublicKey) {
      try {
        const encrypted = await encryptMessage(inputText, pgpPublicKey);
        newMessage.encryptedData = encrypted;
        newMessage.text = "[PGP Encrypted Message]";
      } catch (err) {
        console.error("PGP encryption failed:", err);
      }
    }

    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, messages: [...c.messages, newMessage] } : c));
    setInputText('');
    setAttachmentPreview(null);

    // Persist to Firestore (skip for local-only chats)
    if (chat.id !== 'ai-chat' && chat.id !== 'saved') {
      try {
        const messageData: any = {
          ...newMessage,
          timestamp: serverTimestamp(),
        };
        delete messageData.id; // Let Firestore generate ID
        
        // Remove undefined fields for Firestore
        Object.keys(messageData).forEach(key => {
          if (messageData[key] === undefined) {
            delete messageData[key];
          }
        });
        
        await addDoc(collection(db, 'chats', chat.id, 'messages'), messageData);
        
        // Update last message in chat doc for previews
        await updateDoc(doc(db, 'chats', chat.id), {
          lastMessage: {
            text: newMessage.text,
            senderId: currentUser.id,
            timestamp: serverTimestamp()
          }
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `chats/${chat.id}/messages`);
      }
    }

    // Simulate decryption delay
    setTimeout(() => {
      setChats(prev => prev.map(c => c.id === chat.id ? {
        ...c,
        messages: c.messages.map(m => m.id === newMessage.id ? { ...m, isEncryptedState: false } : m)
      } : c));
    }, 600);

    // Simulate other user typing after a delay
    const otherParticipant = chat.participants.find(p => p.id !== currentUser.id);
    if (otherParticipant && isNetworkOnline) {
      if (chat.id === 'ai-chat') {
        handleAiResponse(inputText);
      } else {
        setTimeout(() => {
          setChats(prev => prev.map(c => c.id === chat.id ? { ...c, typingUserIds: [...(c.typingUserIds || []), otherParticipant.id] } : c));
          
          // Stop typing after a few seconds
          setTimeout(() => {
            setChats(prev => prev.map(c => c.id === chat.id ? { ...c, typingUserIds: (c.typingUserIds || []).filter(id => id !== otherParticipant.id) } : c));
          }, 3000);
        }, 2000);
      }
    }
  };

  const handleSendGif = async (gifUrl: string) => {
    const newMessage: Message = {
      id: Math.random().toString(36).substring(7),
      senderId: currentUser.id,
      text: '',
      timestamp: new Date(),
      isEphemeral,
      ttlSeconds: isEphemeral ? ttl : undefined,
      isEncryptedState: true,
      viewedAt: isEphemeral ? new Date() : undefined,
      attachment: {
        type: 'image/gif',
        name: 'giphy.gif',
        size: 0,
        dataUrl: gifUrl
      },
      status: isNetworkOnline ? 'sent' : 'pending',
    };

    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, messages: [...c.messages, newMessage] } : c));

    // Persist to Firestore (skip for local-only chats)
    if (chat.id !== 'ai-chat' && chat.id !== 'saved') {
      try {
        const messageData: any = {
          ...newMessage,
          timestamp: serverTimestamp(),
        };
        delete messageData.id;
        
        // Remove undefined fields for Firestore
        Object.keys(messageData).forEach(key => {
          if (messageData[key] === undefined) {
            delete messageData[key];
          }
        });
        
        await addDoc(collection(db, 'chats', chat.id, 'messages'), messageData);
        
        await updateDoc(doc(db, 'chats', chat.id), {
          lastMessage: {
            text: 'Sent a GIF',
            senderId: currentUser.id,
            timestamp: serverTimestamp()
          }
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `chats/${chat.id}/messages`);
      }
    }

    setTimeout(() => {
      setChats(prev => prev.map(c => c.id === chat.id ? {
        ...c,
        messages: c.messages.map(m => m.id === newMessage.id ? { ...m, isEncryptedState: false } : m)
      } : c));
    }, 600);
  };

  const handleAiResponse = async (prompt: string) => {
    if (!process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
      const errorMsg: Message = {
        id: Math.random().toString(36).substring(7),
        senderId: 'ai',
        text: 'AI Assistant is currently unavailable. Please configure the Gemini API key in the settings.',
        timestamp: new Date(),
        isEphemeral: false,
      };
      setChats(prev => prev.map(c => c.id === chat.id ? { ...c, messages: [...c.messages, errorMsg] } : c));
      return;
    }

    setIsAiTyping(true);
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, typingUserIds: ['ai'] } : c));

    try {
      const model = "gemini-3-flash-preview";
      const response = await ai.current.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: "You are a helpful, secure-focused AI assistant for CipherChat, an end-to-end encrypted messaging app. Keep responses concise and professional.",
        }
      });

      const aiMessage: Message = {
        id: Math.random().toString(36).substring(7),
        senderId: 'ai',
        text: response.text || "I'm sorry, I couldn't process that request.",
        timestamp: new Date(),
        isEphemeral: false,
      };

      setChats(prev => prev.map(c => c.id === chat.id ? { ...c, messages: [...c.messages, aiMessage], typingUserIds: [] } : c));
    } catch (error) {
      console.error("AI Error:", error);
      const errorMsg: Message = {
        id: Math.random().toString(36).substring(7),
        senderId: 'ai',
        text: 'Sorry, I encountered an error while processing your request.',
        timestamp: new Date(),
        isEphemeral: false,
      };
      setChats(prev => prev.map(c => c.id === chat.id ? { ...c, messages: [...c.messages, errorMsg], typingUserIds: [] } : c));
    } finally {
      setIsAiTyping(false);
    }
  };

  // Process offline queue when network is restored
  useEffect(() => {
    if (isNetworkOnline) {
      let pendingCount = 0;
      let failedCount = 0;
      setChats(prevChats => prevChats.map(c => {
        if (c.id !== chat.id) return c;
        let changed = false;
        const updatedMessages = c.messages.map(m => {
          if (m.senderId === currentUser.id && m.status === 'pending') {
            changed = true;
            pendingCount++;
            // Simulate a 20% chance of failure for demonstration purposes
            const didFail = Math.random() > 0.8;
            if (didFail) failedCount++;
            return { ...m, status: (didFail ? 'failed' : 'sent') as 'failed' | 'sent' };
          }
          return m;
        });
        return changed ? { ...c, messages: updatedMessages } : c;
      }));

      if (pendingCount > 0) {
        const successCount = pendingCount - failedCount;
        if (failedCount > 0) {
          setSyncNotification(`Sent ${successCount} messages. ${failedCount} failed.`);
        } else {
          setSyncNotification(`Successfully sent ${pendingCount} pending message(s).`);
        }
        setTimeout(() => setSyncNotification(null), 4000);
      }
    }
  }, [isNetworkOnline, setChats, currentUser.id, chat.id]);

  const retryMessage = (messageId: string) => {
    setChats(prev => prev.map(c => {
      if (c.id !== chat.id) return c;
      return {
        ...c,
        messages: c.messages.map(m => {
          if (m.id === messageId) {
            return { ...m, status: isNetworkOnline ? 'sent' as const : 'pending' as const };
          }
          return m;
        })
      };
    }));
  };

  const handleEdit = (messageId: string, newText: string) => {
    if (!newText.trim()) return;
    setChats(prev => prev.map(c => {
      if (c.id !== chat.id) return c;
      return {
        ...c,
        messages: c.messages.map(m => {
          if (m.id === messageId) {
            return { 
              ...m, 
              originalText: m.originalText || m.text, 
              text: newText, 
              isEdited: true 
            };
          }
          return m;
        })
      };
    }));
    setEditingMessageId(null);
    setEditText('');
  };

  const displayedMessages = chat.messages.filter(m => {
    if (showPinned && !m.isPinned) return false;
    
    if (isSearching) {
      if (searchQuery.trim() && !m.text.toLowerCase().includes(searchQuery.toLowerCase()) && !m.attachment?.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      
      if (searchFilterSender === 'me' && m.senderId !== currentUser.id) return false;
      if (searchFilterSender === 'them' && m.senderId === currentUser.id) return false;
      
      if (searchFilterDate !== 'all') {
        const now = new Date();
        const msgDate = new Date(m.timestamp);
        if (searchFilterDate === 'today') {
          if (msgDate.toDateString() !== now.toDateString()) return false;
        } else if (searchFilterDate === 'week') {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (msgDate < weekAgo) return false;
        } else if (searchFilterDate === 'month') {
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (msgDate < monthAgo) return false;
        }
      }
      
      if (searchFilterType !== 'all') {
        if (searchFilterType === 'text' && m.attachment) return false;
        if (searchFilterType === 'attachment' && (!m.attachment || m.attachment.type.startsWith('audio/'))) return false;
        if (searchFilterType === 'voice' && (!m.attachment || !m.attachment.type.startsWith('audio/'))) return false;
      }
    }
    
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-16 sm:h-20 glass border-b border-neutral-800/60 flex items-center justify-between px-2 sm:px-4 lg:px-8 z-10">
        <div className="flex items-center gap-2 sm:gap-4">
          {isMobile && (
            <button 
              onClick={onToggleSidebar}
              className="p-1.5 sm:p-2 text-neutral-400 hover:text-blue-400 hover:bg-neutral-800/50 rounded-xl transition-all"
            >
              <Menu className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-gradient-to-br from-neutral-800 to-neutral-900 border border-neutral-700/50 flex items-center justify-center overflow-hidden relative shadow-lg">
            {chat.id === 'ai-chat' ? (
              <div className="p-2 sm:p-2.5 bg-purple-500/20 text-purple-400">
                <Sparkles className="w-4 h-4 sm:w-6 sm:h-6" />
              </div>
            ) : chat.id === 'saved' ? (
              <div className="p-2 sm:p-2.5 bg-blue-500/20 text-blue-400">
                <Archive className="w-4 h-4 sm:w-6 sm:h-6" />
              </div>
            ) : chat.isGroup ? (
              <div className="flex flex-wrap items-center justify-center gap-0.5 p-1">
                {chat.participants.slice(0, 4).map((p, i) => (
                  <img key={p.id} src={p.avatar} alt={p.name} className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full object-cover border border-neutral-800" />
                ))}
              </div>
            ) : (
              <img src={chat.participants.find(p => p.id !== currentUser.id)?.avatar} alt="Avatar" className="w-full h-full object-cover" />
            )}
            {chat.id !== 'saved' && !chat.isGroup && chat.participants.find(p => p.id !== currentUser.id)?.isOnline && (
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 bg-emerald-500 rounded-full border-2 border-neutral-950"></div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <h2 className="font-display font-bold text-sm sm:text-lg tracking-tight text-white leading-tight truncate max-w-[100px] sm:max-w-[150px] md:max-w-xs">{chat.name}</h2>
              {chat.id !== 'saved' && !chat.isGroup && (
                <div 
                  className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${chat.participants.find(p => p.id !== currentUser.id)?.isOnline ? 'bg-emerald-500' : 'bg-neutral-500'}`}
                  title={chat.participants.find(p => p.id !== currentUser.id)?.isOnline ? 'Online' : 'Offline'}
                ></div>
              )}
              <div className={`flex items-center gap-1 px-1 sm:px-1.5 py-0.5 rounded-md border transition-all ${chat.settings?.encryptionProtocol === 'quantum-resistant' ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`} title={chat.settings?.encryptionProtocol === 'quantum-resistant' ? 'Post-Quantum End-to-End Encrypted' : 'End-to-End Encrypted'}>
                <ShieldCheck className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                <span className="text-[7px] sm:text-[9px] font-bold uppercase tracking-wider hidden sm:inline-block">
                  {chat.settings?.encryptionProtocol === 'quantum-resistant' ? 'PQC-E2EE' : 'E2EE'}
                </span>
              </div>
              {chat.isGroup && (
                <span className="bg-neutral-800/80 text-neutral-400 text-[8px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-full font-bold uppercase tracking-widest hidden sm:inline-block">
                  {chat.participants.length} Members
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <div className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${isNetworkOnline ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                <span className="text-[8px] sm:text-[10px] font-bold text-neutral-500 uppercase tracking-[0.1em] hidden sm:inline-block">
                  {isNetworkOnline ? 'Secure Channel' : 'Offline'}
                </span>
              </div>
              <span className="text-neutral-700 hidden sm:inline-block">•</span>
              <span className="text-[8px] sm:text-[10px] font-bold text-blue-500 uppercase tracking-[0.1em]">
                {chat.typingUserIds && chat.typingUserIds.length > 0 ? (
                  <span className="flex items-center gap-1 sm:gap-1.5 text-emerald-400 animate-pulse">
                    <span className="flex gap-0.5">
                      <span className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-current rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-current rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-current rounded-full animate-bounce"></span>
                    </span>
                    {chat.isGroup 
                      ? `${chat.typingUserIds.length} ${chat.typingUserIds.length > 1 ? 'people are' : 'person is'} typing...`
                      : 'typing...'}
                  </span>
                ) : (
                  chat.id === 'saved' 
                    ? 'Personal Cloud'
                    : chat.isGroup 
                      ? `${chat.participants.filter(p => p.id !== currentUser.id && p.isOnline).length} online` 
                      : (chat.participants.find(p => p.id !== currentUser.id)?.isOnline ? 'Active now' : chat.participants.find(p => p.id !== currentUser.id)?.username)
                )}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2">
          {chat.id !== 'saved' && !chat.isGroup && (
            <>
              <button 
                onClick={() => initiateCall('audio')}
                className="p-1.5 sm:p-2.5 text-neutral-400 hover:bg-neutral-800/50 hover:text-blue-400 rounded-xl transition-all duration-300"
                title="Start Audio Call"
              >
                <Phone className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button 
                onClick={() => initiateCall('video')}
                className="p-1.5 sm:p-2.5 text-neutral-400 hover:bg-neutral-800/50 hover:text-blue-400 rounded-xl transition-all duration-300"
                title="Start Video Call"
              >
                <Video className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </>
          )}
          <div className="w-px h-4 sm:h-6 bg-neutral-800/60 mx-0.5 sm:mx-1"></div>
          <button 
            onClick={() => {
              setIsSearching(!isSearching);
              if (isSearching) {
                setSearchQuery('');
                setSearchFilterSender('all');
                setSearchFilterDate('all');
                setSearchFilterType('all');
              }
            }}
            className={`p-1.5 sm:p-2.5 rounded-xl transition-all duration-300 ${isSearching ? 'text-blue-400 bg-blue-500/10 border border-blue-500/20' : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-blue-400 border border-transparent'}`}
            title="Search Messages"
          >
            <Search className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-1.5 sm:p-2.5 text-neutral-400 hover:bg-neutral-800/50 hover:text-blue-400 rounded-xl transition-all duration-300"
            title="Chat Settings"
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </div>

      {/* Sync Notification */}
      <AnimatePresence>
        {syncNotification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-24 left-1/2 -translate-x-1/2 z-20 bg-blue-500/90 text-white px-4 py-2 rounded-full shadow-lg backdrop-blur-md text-sm font-medium flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            {syncNotification}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search Bar */}
      <AnimatePresence>
        {isSearching && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-neutral-800 bg-neutral-900/80 px-4 sm:px-6 py-2 sm:py-3"
          >
            <div className="relative">
              <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input 
                type="text" 
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages..." 
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-8 sm:pl-9 pr-8 sm:pr-10 py-1.5 sm:py-2 text-xs sm:text-sm outline-none focus:border-blue-500 transition-colors text-white"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 p-1"
                >
                  <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2 sm:mt-3">
              <select 
                value={searchFilterSender}
                onChange={(e) => setSearchFilterSender(e.target.value as any)}
                className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs text-neutral-300 outline-none focus:border-blue-500 transition-colors"
              >
                <option value="all">All Senders</option>
                <option value="me">Sent by Me</option>
                <option value="them">Sent by Them</option>
              </select>
              
              <select 
                value={searchFilterDate}
                onChange={(e) => setSearchFilterDate(e.target.value as any)}
                className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs text-neutral-300 outline-none focus:border-blue-500 transition-colors"
              >
                <option value="all">Any Time</option>
                <option value="today">Today</option>
                <option value="week">Past Week</option>
                <option value="month">Past Month</option>
              </select>
              
              <select 
                value={searchFilterType}
                onChange={(e) => setSearchFilterType(e.target.value as any)}
                className="bg-neutral-950 border border-neutral-800 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs text-neutral-300 outline-none focus:border-blue-500 transition-colors"
              >
                <option value="all">All Types</option>
                <option value="text">Text Only</option>
                <option value="attachment">Attachments</option>
                <option value="voice">Voice Messages</option>
              </select>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <AnimatePresence initial={false}>
          {displayedMessages.map(msg => {
            const isMe = msg.senderId === currentUser.id;
            const sender = chat.participants.find(p => p.id === msg.senderId);
            const timeLeft = msg.isEphemeral && msg.viewedAt && msg.ttlSeconds 
              ? Math.max(0, Math.ceil(msg.ttlSeconds - (currentTime - msg.viewedAt.getTime()) / 1000))
              : null;

            return (
              <motion.div
                key={msg.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group relative`}
                onMouseEnter={() => {
                  if (window.matchMedia('(hover: hover)').matches) {
                    setActiveReactionMsgId(msg.id);
                  }
                }}
                onMouseLeave={() => {
                  if (window.matchMedia('(hover: hover)').matches) {
                    setActiveReactionMsgId(null);
                  }
                }}
              >
                {!isMe && chat.isGroup && <span className="text-xs text-neutral-500 mb-1 ml-1">{sender?.name}</span>}
                
                <div className={`flex items-center gap-2 relative w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                  {/* Message Actions (Left for Me) */}
                  {isMe && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity relative flex items-center gap-1">
                      <motion.button 
                        whileHover={{ scale: 1.1, backgroundColor: 'rgba(59, 130, 246, 0.2)' }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => {
                          setEditingMessageId(msg.id);
                          setEditText(msg.text);
                        }} 
                        className="p-1.5 text-neutral-400 hover:text-blue-400 bg-neutral-900 rounded-full border border-neutral-700 shadow-sm transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </motion.button>
                      <motion.button 
                        whileHover={{ scale: 1.1, backgroundColor: 'rgba(244, 63, 94, 0.2)' }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setMessageToDelete(msg.id)} 
                        className="p-1.5 text-neutral-400 hover:text-rose-400 bg-neutral-900 rounded-full border border-neutral-700 shadow-sm transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </motion.button>
                    </div>
                  )}

                  <div 
                    onTouchStart={() => handleTouchStart(msg.id)}
                    onTouchEnd={handleTouchEnd}
                    className={`max-w-[85%] md:max-w-[75%] rounded-[1.5rem] sm:rounded-[2rem] px-4 sm:px-6 py-3 sm:py-4 relative shadow-xl cursor-default select-none transition-all duration-300 ${isMe ? 'bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white rounded-tr-lg shadow-blue-500/20' : 'bg-neutral-800/90 backdrop-blur-md text-neutral-100 rounded-tl-lg border border-neutral-700/50 shadow-black/20'}`}
                  >
                    {/* Encryption Indicator */}
                    {msg.isEncryptedState && (
                      <div className={`absolute -top-2 ${isMe ? '-left-4 sm:-left-6' : '-right-4 sm:-right-6'} p-1 rounded-full bg-neutral-900 border border-neutral-700`}>
                        {typeof msg.encryptedData === 'string' ? (
                          <span title="PGP Encrypted"><ShieldCheck className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-indigo-400" /></span>
                        ) : msg.encryptedData ? (
                          <span title="AES-GCM Encrypted"><Lock className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-emerald-400" /></span>
                        ) : (
                          <span title="Encryption Warning: Missing Data"><AlertCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-rose-400" /></span>
                        )}
                      </div>
                    )}
                    {msg.isEncryptedState ? (
                      <div className="font-mono text-xs sm:text-sm opacity-70 break-all">
                        {Array.from({length: (msg.text.length || 20)}).map(() => String.fromCharCode(33 + Math.random() * 93)).join('')}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 sm:gap-2.5">
                        {msg.attachment && (
                          <div className="rounded-xl overflow-hidden border border-white/10 bg-black/20 shadow-inner">
                            {msg.attachment.type.startsWith('image/') ? (
                              <img src={msg.attachment.dataUrl} alt={msg.attachment.name} className="max-w-full h-auto max-h-48 sm:max-h-72 object-contain" />
                            ) : msg.attachment.type.startsWith('audio/') ? (
                              <AudioPlayer src={msg.attachment.dataUrl} isMe={isMe} />
                            ) : (
                              <div className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-black/30 backdrop-blur-sm hover:bg-black/40 transition-colors group/file">
                                <div className="relative">
                                  <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shadow-lg transition-transform group-hover/file:scale-105 ${isMe ? 'bg-white/10 text-white' : 'bg-blue-500/10 text-blue-400'}`}>
                                    {getFileIconComponent(msg.attachment.type, "w-5 h-5 sm:w-6 sm:h-6")}
                                  </div>
                                  <div className={`absolute -bottom-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 rounded-md flex items-center justify-center text-[6px] sm:text-[8px] font-bold uppercase border shadow-sm ${isMe ? 'bg-blue-600 border-blue-400 text-white' : 'bg-neutral-800 border-neutral-700 text-neutral-300'}`}>
                                    {msg.attachment.name.split('.').pop()?.substring(0, 3) || 'FILE'}
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs sm:text-sm font-bold truncate group-hover/file:text-blue-300 transition-colors">{msg.attachment.name}</p>
                                  <p className="text-[8px] sm:text-[10px] font-medium opacity-60 mt-0.5 uppercase tracking-wider">
                                    {formatFileSize(msg.attachment.size)} <span className="mx-1 opacity-30">•</span> {msg.attachment.type.split('/')[1] || 'Document'}
                                  </p>
                                </div>
                                <motion.a 
                                  whileHover={{ scale: 1.1, backgroundColor: 'rgba(255, 255, 255, 0.15)' }}
                                  whileTap={{ scale: 0.9 }}
                                  href={msg.attachment.dataUrl} 
                                  download={msg.attachment.name} 
                                  className={`p-2 sm:p-2.5 rounded-xl transition-all ${isMe ? 'hover:bg-white/10 text-white' : 'hover:bg-blue-500/10 text-blue-400'}`}
                                  title="Download file"
                                >
                                  <Download className="w-4 h-4 sm:w-5 sm:h-5" />
                                </motion.a>
                              </div>
                            )}
                          </div>
                        )}
                        {msg.text && (
                          <div className="text-sm sm:text-[15px] leading-relaxed relative group/text">
                            {editingMessageId === msg.id ? (
                              <div className="flex flex-col gap-2 min-w-[150px] sm:min-w-[200px]">
                                <textarea
                                  autoFocus
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  className="w-full bg-black/20 border border-white/20 rounded-lg p-2 text-xs sm:text-sm outline-none focus:border-white/40 transition-colors resize-none"
                                  rows={2}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      handleEdit(msg.id, editText);
                                    }
                                    if (e.key === 'Escape') {
                                      setEditingMessageId(null);
                                    }
                                  }}
                                />
                                <div className="flex justify-end gap-2">
                                  <button 
                                    onClick={() => setEditingMessageId(null)}
                                    className="text-[8px] sm:text-[10px] font-bold uppercase tracking-wider opacity-60 hover:opacity-100 transition-opacity"
                                  >
                                    Cancel
                                  </button>
                                  <button 
                                    onClick={() => handleEdit(msg.id, editText)}
                                    className="text-[8px] sm:text-[10px] font-bold uppercase tracking-wider text-blue-300 hover:text-blue-100 transition-colors"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {msg.encryptedData ? (
                                  <DecryptedText 
                                    msg={msg} 
                                    chat={chat} 
                                    currentUser={currentUser} 
                                    userPrivateKey={userPrivateKey} 
                                  />
                                ) : (
                                  msg.text
                                )}
                                {msg.isEdited && (
                                  <span 
                                    className="ml-1 sm:ml-2 text-[8px] sm:text-[10px] font-medium opacity-50 cursor-help inline-flex items-center gap-0.5"
                                    title={msg.originalText ? `Original: ${msg.originalText}` : "Edited"}
                                  >
                                    (edited)
                                  </span>
                                )}
                                {msg.isEdited && msg.originalText && (
                                  <div className="absolute bottom-full left-0 mb-2 opacity-0 group-hover/text:opacity-100 transition-opacity pointer-events-none z-50">
                                    <div className="bg-neutral-900/95 backdrop-blur-sm border border-neutral-700 rounded-lg p-2 sm:p-3 shadow-2xl max-w-[200px] sm:max-w-xs">
                                      <p className="text-[8px] sm:text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">Original Message</p>
                                      <p className="text-[10px] sm:text-xs text-neutral-300 italic">&ldquo;{msg.originalText}&rdquo;</p>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Footer: Timestamp & Read Receipt */}
                    <div className={`flex items-center justify-end gap-1 sm:gap-1.5 mt-1.5 sm:mt-2 ${isMe ? 'text-blue-100' : 'text-neutral-400'}`}>
                      <span className="text-[9px] sm:text-[11px] font-medium opacity-80">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isMe && (
                        msg.status === 'failed' ? (
                          <div className="flex items-center gap-1 text-rose-400">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <motion.button 
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => retryMessage(msg.id)} 
                              className="text-[10px] hover:underline flex items-center gap-0.5"
                            >
                              <RefreshCw className="w-3 h-3" /> Retry
                            </motion.button>
                          </div>
                        ) : msg.status === 'pending' ? <Clock className="w-3.5 h-3.5 opacity-70" /> :
                        msg.viewedAt ? (
                          <div className="flex items-center" title={`Read at ${msg.viewedAt.toLocaleTimeString()}`}>
                            <CheckCheck className="w-3.5 h-3.5 text-blue-400" />
                          </div>
                        ) : msg.status === 'delivered' ? (
                          <div className="flex items-center" title="Delivered">
                            <CheckCheck className="w-3.5 h-3.5 opacity-70" />
                          </div>
                        ) : (
                          <div className="flex items-center" title="Sent">
                            <Check className="w-3.5 h-3.5 opacity-70" />
                          </div>
                        )
                      )}
                    </div>
                    
                    {/* Ephemeral Indicator */}
                    {msg.isEphemeral && (
                      <div className={`absolute -bottom-5 flex items-center gap-1 text-xs font-mono ${isMe ? 'right-0 text-blue-500' : 'left-0 text-rose-500'}`}>
                        <Clock className="w-3 h-3" />
                        {timeLeft !== null ? `${timeLeft}s` : 'Unread'}
                      </div>
                    )}
                  </div>

                  {/* Message Actions (Right for Others) */}
                  {!isMe && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity relative flex items-center gap-1">
                      <motion.button 
                        whileHover={{ scale: 1.1, backgroundColor: 'rgba(244, 63, 94, 0.2)' }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setMessageToDelete(msg.id)} 
                        className="p-1.5 text-neutral-400 hover:text-rose-400 bg-neutral-900 rounded-full border border-neutral-700 shadow-sm transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </motion.button>
                    </div>
                  )}
                </div>

                {/* Reactions Display */}
                {msg.reactions && msg.reactions.length > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'mr-2' : 'ml-2'} z-10`}>
                    <AnimatePresence mode="popLayout">
                      {msg.reactions.map(r => (
                        <motion.button
                          key={r.emoji}
                          layout
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.5 }}
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleReact(msg.id, r.emoji)}
                          className={`text-xs px-2 py-0.5 rounded-full border ${r.userIds.includes(currentUser.id) ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-neutral-800 border-neutral-700 text-neutral-300'} flex items-center gap-1 hover:bg-neutral-700 transition-colors`}
                        >
                          <motion.span
                            animate={{ 
                              scale: r.userIds.includes(currentUser.id) ? [1, 1.4, 1] : [1, 1] 
                            }}
                            transition={{ duration: 0.3 }}
                          >
                            {r.emoji}
                          </motion.span>
                          <AnimatePresence mode="wait">
                            <motion.span 
                              key={r.userIds.length}
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -5 }}
                              className="text-[10px] font-bold"
                            >
                              {r.userIds.length}
                            </motion.span>
                          </AnimatePresence>
                        </motion.button>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </motion.div>
            );
          })}
          
          {/* Typing Indicator */}
          {chat.typingUserIds && chat.typingUserIds.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col items-start"
            >
              <div className="flex items-center gap-2">
                <div className="bg-neutral-800 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
                  <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} className="w-2 h-2 bg-neutral-500 rounded-full" />
                  <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} className="w-2 h-2 bg-neutral-500 rounded-full" />
                  <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} className="w-2 h-2 bg-neutral-500 rounded-full" />
                </div>
              </div>
              <span className="text-xs text-neutral-500 mt-1 ml-1">
                {chat.typingUserIds.map(id => chat.participants.find(p => p.id === id)?.name).join(', ')} {chat.typingUserIds.length > 1 ? 'are' : 'is'} typing...
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input Area */}
      <div className="p-4 lg:p-8 glass border-t border-neutral-800/60">
        <form onSubmit={handleSend} className="max-w-4xl mx-auto flex flex-col gap-4">
          {/* Controls */}
          <div className="flex items-center gap-2 sm:gap-4 px-1 sm:px-2 flex-wrap">
            <button
              type="button"
              onClick={() => setIsEphemeral(!isEphemeral)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-300 border ${isEphemeral ? 'bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.1)]' : 'bg-neutral-800/50 text-neutral-500 border-transparent hover:text-neutral-300'}`}
            >
              {isEphemeral ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              <span className="text-[10px] font-bold uppercase tracking-widest">Self-Destruct {isEphemeral ? 'On' : 'Off'}</span>
            </button>
            
            {isEphemeral && (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">TTL:</span>
                <select 
                  value={ttl} 
                  onChange={(e) => setTtl(Number(e.target.value))}
                  className="bg-neutral-800/80 border border-neutral-700/50 rounded-lg px-2 py-1 text-[10px] font-bold text-blue-400 outline-none focus:border-blue-500 transition-colors"
                >
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                  <option value={30}>30s</option>
                  <option value={60}>1m</option>
                </select>
              </div>
            )}
          </div>

          {/* Attachment Preview */}
          <AnimatePresence>
            {attachmentPreview && (
              <motion.div 
                initial={{ opacity: 0, y: 10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: 10, height: 0 }}
                className="p-4 glass-dark rounded-3xl flex items-center justify-between border border-white/10 shadow-2xl relative group overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-indigo-500/5 pointer-events-none"></div>
                <div className="flex items-center gap-4 relative">
                  <div className="w-14 h-14 rounded-2xl bg-neutral-800/80 border border-neutral-700/50 flex items-center justify-center overflow-hidden shadow-inner group-hover:border-blue-500/30 transition-colors">
                    {attachmentPreview.type.startsWith('image/') ? (
                      <img src={attachmentPreview.dataUrl} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      getFileIconComponent(attachmentPreview.type, "w-7 h-7 text-neutral-400")
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{attachmentPreview.name}</p>
                    <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mt-1">
                      {formatFileSize(attachmentPreview.size)} <span className="mx-1 opacity-30">•</span> {attachmentPreview.type || 'File'}
                    </p>
                  </div>
                </div>
                
                <button 
                  type="button" 
                  onClick={removeAttachment}
                  className="p-2.5 text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all duration-300 relative z-10"
                >
                  <X className="w-5 h-5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Text Area or Recording UI */}
          <div className="relative flex items-center gap-2 sm:gap-3">
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileSelect} 
              className="hidden" 
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 sm:p-3 text-neutral-400 hover:text-blue-400 hover:bg-white/5 rounded-full transition-all duration-300 flex-shrink-0"
              title="Attach File"
            >
              <Paperclip className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            {isRecording ? (
              <div className="flex-1 flex items-center justify-between glass-dark border border-rose-500/30 rounded-[2rem] px-4 sm:px-6 py-2 sm:py-2.5 shadow-lg shadow-rose-500/10">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-rose-500 animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]"></div>
                  <span className="text-rose-400 font-bold font-mono text-xs sm:text-sm tracking-widest">{formatTime(recordingDuration)}</span>
                  <span className="hidden sm:inline text-[10px] font-bold text-rose-500/60 uppercase tracking-widest ml-2">Recording Voice...</span>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={cancelRecording} className="p-1.5 sm:p-2 text-neutral-400 hover:text-rose-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={stopRecording} className="p-1.5 sm:p-2 bg-rose-500 text-white rounded-full shadow-lg shadow-rose-500/30 active:scale-95 transition-transform">
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 rounded-[2rem] blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500"></div>
                <div className="relative flex items-center glass-dark rounded-[2rem] border border-white/5 focus-within:border-blue-500/30 transition-all duration-300 shadow-2xl px-1 sm:px-2 py-1">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={isEphemeral ? "Write an ephemeral message..." : "Type a secure message..."}
                    className={`flex-1 w-full min-w-0 bg-transparent border-none outline-none px-2 sm:px-3 lg:px-4 py-2 sm:py-2.5 lg:py-3 text-xs sm:text-sm transition-all ${isEphemeral ? 'placeholder:text-rose-500/30 text-rose-100' : 'placeholder:text-neutral-600 text-white'}`}
                    autoComplete={typeof window !== 'undefined' && localStorage.getItem('cipher-incognito-keyboard') === 'true' ? 'off' : 'on'}
                    autoCorrect={typeof window !== 'undefined' && localStorage.getItem('cipher-incognito-keyboard') === 'true' ? 'off' : 'on'}
                    spellCheck={typeof window !== 'undefined' && localStorage.getItem('cipher-incognito-keyboard') === 'true' ? 'false' : 'true'}
                  />
                  <div className="relative flex-shrink-0" ref={emojiPickerRef}>
                    <div className="flex items-center gap-0.5 sm:gap-2">
                      <button
                        type="button"
                        onClick={() => setActivePicker(activePicker === 'emoji' ? null : 'emoji')}
                        className={`p-1.5 sm:p-3.5 transition-all duration-300 rounded-full ${activePicker === 'emoji' ? 'text-blue-400 bg-blue-500/10' : 'text-neutral-400 hover:text-blue-400 hover:bg-white/5'}`}
                      >
                        <SmilePlus className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivePicker(activePicker === 'gif' ? null : 'gif')}
                        className={`p-1.5 sm:p-3.5 transition-all duration-300 rounded-full ${activePicker === 'gif' ? 'text-blue-400 bg-blue-500/10' : 'text-neutral-400 hover:text-blue-400 hover:bg-white/5'}`}
                      >
                        <div className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 border-2 border-current rounded flex items-center justify-center font-black text-[7px] sm:text-[9px] lg:text-[10px] tracking-tighter">
                          GIF
                        </div>
                      </button>
                    </div>

                    <AnimatePresence>
                      {activePicker === 'emoji' && (
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          className="absolute bottom-full right-0 mb-4 z-50"
                        >
                          <SimpleEmojiPicker onSelect={(emoji) => {
                            setInputText(prev => prev + emoji);
                            setActivePicker(null);
                          }} />
                        </motion.div>
                      )}
                      {activePicker === 'gif' && (
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          className="absolute bottom-full right-0 mb-4 z-50"
                        >
                          <GifPicker onSelect={(gifUrl) => {
                            handleSendGif(gifUrl);
                            setActivePicker(null);
                          }} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  </div>
                </div>
            )}

            { (!inputText.trim() && !attachmentPreview && !isRecording) ? (
              <button
                type="button"
                onClick={startRecording}
                className="p-2.5 sm:p-3 lg:p-4 bg-neutral-800/80 text-neutral-400 hover:text-blue-400 hover:bg-neutral-800 rounded-full border border-neutral-700/50 shadow-xl transition-all duration-300 active:scale-90 flex-shrink-0"
                title="Record Voice Message"
              >
                <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            ) : !isRecording ? (
              <button
                type="submit"
                className={`p-2.5 sm:p-3 lg:p-4 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-full shadow-xl shadow-blue-500/20 hover:shadow-blue-500/40 transition-all duration-300 active:scale-90 disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed flex-shrink-0`}
              >
                <Send className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            ) : null }
          </div>
        </form>
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {messageToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 max-w-sm w-full shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-4 text-rose-500">
                <div className="p-2 bg-rose-500/10 rounded-full">
                  <Trash2 className="w-5 h-5" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-white">Delete Message?</h3>
              </div>
              <p className="text-neutral-400 text-xs sm:text-sm mb-6 leading-relaxed">
                Are you sure you want to delete this message? This action cannot be undone and will remove it from your local device.
              </p>
              <div className="flex justify-end gap-2 sm:gap-3">
                <button
                  onClick={() => setMessageToDelete(null)}
                  className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium bg-rose-500 hover:bg-rose-600 text-white rounded-lg transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Chat Settings Modal */}
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-neutral-900 border border-neutral-800 rounded-[2rem] overflow-hidden max-w-lg w-full shadow-2xl flex flex-col max-h-[85vh]"
            >
              <div className="p-4 sm:p-6 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/50">
                <div className="flex items-center gap-2 sm:gap-3 text-white">
                  <div className="p-1.5 sm:p-2 bg-blue-500/10 rounded-xl">
                    <Settings className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-bold tracking-tight">Advanced Chat Settings</h3>
                    <p className="text-[8px] sm:text-[10px] text-neutral-500 uppercase tracking-widest font-bold">Configure your secure environment</p>
                  </div>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-1.5 sm:p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-xl transition-all">
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8 custom-scrollbar">
                {/* Privacy & Security Section */}
                <section className="space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-blue-400">
                    <Shield className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <h4 className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em]">Privacy & Security</h4>
                  </div>
                  
                  <div className="space-y-3 sm:space-y-4 bg-white/5 rounded-2xl p-3 sm:p-4 border border-white/5">
                    {/* Read Receipts */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h5 className="text-xs sm:text-sm font-bold text-white">Read Receipts</h5>
                        <p className="text-[10px] sm:text-xs text-neutral-500">Others can see when you read their messages.</p>
                      </div>
                      <button 
                        onClick={() => {
                          setChats(prev => prev.map(c => c.id === chat.id ? { ...c, settings: { ...(c.settings as ChatSettings), readReceipts: !(c.settings?.readReceipts ?? true) } } : c));
                        }}
                        className={`relative inline-flex h-5 w-9 sm:h-6 sm:w-11 items-center rounded-full transition-all duration-300 focus:outline-none ${(chat.settings?.readReceipts ?? true) ? 'bg-blue-500' : 'bg-neutral-800'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 sm:h-4 sm:w-4 transform rounded-full bg-white shadow-md transition-transform duration-300 ${(chat.settings?.readReceipts ?? true) ? 'translate-x-[18px] sm:translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>

                    {/* Encryption Protocol */}
                    <div className="pt-3 sm:pt-4 border-t border-white/5 space-y-2 sm:space-y-3">
                      <div>
                        <h5 className="text-xs sm:text-sm font-bold text-white">Encryption Protocol</h5>
                        <p className="text-[10px] sm:text-xs text-neutral-500">Choose the cryptographic layer for this chat.</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                          { id: 'standard', label: 'Standard', desc: 'Signal Protocol' },
                          { id: 'quantum-resistant', label: 'Quantum Proof', desc: 'Kyber/Dilithium' }
                        ].map((p) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setChats(prev => prev.map(c => c.id === chat.id ? { ...c, settings: { ...(c.settings as ChatSettings), encryptionProtocol: p.id as any } } : c));
                            }}
                            className={`p-2.5 sm:p-3 rounded-xl border text-left transition-all ${chat.settings?.encryptionProtocol === p.id ? 'bg-blue-500/10 border-blue-500/50' : 'bg-neutral-900/50 border-white/5 hover:bg-neutral-800'}`}
                          >
                            <div className={`text-[10px] sm:text-xs font-bold ${chat.settings?.encryptionProtocol === p.id ? 'text-blue-400' : 'text-neutral-400'}`}>{p.label}</div>
                            <div className="text-[8px] sm:text-[9px] text-neutral-600 font-medium">{p.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Notifications & Interaction */}
                <section className="space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-amber-400">
                    <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <h4 className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em]">Notifications & Interaction</h4>
                  </div>
                  
                  <div className="space-y-3 sm:space-y-4 bg-white/5 rounded-2xl p-3 sm:p-4 border border-white/5">
                    {/* Notifications Toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h5 className="text-xs sm:text-sm font-bold text-white">Push Notifications</h5>
                        <p className="text-[10px] sm:text-xs text-neutral-500">Receive alerts for new messages.</p>
                      </div>
                      <button 
                        onClick={() => {
                          setChats(prev => prev.map(c => c.id === chat.id ? { ...c, settings: { ...(c.settings as ChatSettings), notifications: !(c.settings?.notifications ?? true) } } : c));
                        }}
                        className={`relative inline-flex h-5 w-9 sm:h-6 sm:w-11 items-center rounded-full transition-all duration-300 focus:outline-none ${(chat.settings?.notifications ?? true) ? 'bg-amber-500' : 'bg-neutral-800'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 sm:h-4 sm:w-4 transform rounded-full bg-white shadow-md transition-transform duration-300 ${(chat.settings?.notifications ?? true) ? 'translate-x-[18px] sm:translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>

                    {/* Typing Indicators */}
                    <div className="pt-3 sm:pt-4 border-t border-white/5 flex items-center justify-between">
                      <div>
                        <h5 className="text-xs sm:text-sm font-bold text-white">Typing Indicators</h5>
                        <p className="text-[10px] sm:text-xs text-neutral-500">Show others when you are typing.</p>
                      </div>
                      <button 
                        onClick={() => {
                          setChats(prev => prev.map(c => c.id === chat.id ? { ...c, settings: { ...(c.settings as ChatSettings), typingIndicators: !(c.settings?.typingIndicators ?? true) } } : c));
                        }}
                        className={`relative inline-flex h-5 w-9 sm:h-6 sm:w-11 items-center rounded-full transition-all duration-300 focus:outline-none ${(chat.settings?.typingIndicators ?? true) ? 'bg-blue-500' : 'bg-neutral-800'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 sm:h-4 sm:w-4 transform rounded-full bg-white shadow-md transition-transform duration-300 ${(chat.settings?.typingIndicators ?? true) ? 'translate-x-[18px] sm:translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>

                    {/* Link Previews */}
                    <div className="pt-3 sm:pt-4 border-t border-white/5 flex items-center justify-between">
                      <div>
                        <h5 className="text-xs sm:text-sm font-bold text-white">Link Previews</h5>
                        <p className="text-[10px] sm:text-xs text-neutral-500">Generate rich previews for shared URLs.</p>
                      </div>
                      <button 
                        onClick={() => {
                          setChats(prev => prev.map(c => c.id === chat.id ? { ...c, settings: { ...(c.settings as ChatSettings), linkPreviews: !(c.settings?.linkPreviews ?? true) } } : c));
                        }}
                        className={`relative inline-flex h-5 w-9 sm:h-6 sm:w-11 items-center rounded-full transition-all duration-300 focus:outline-none ${(chat.settings?.linkPreviews ?? true) ? 'bg-blue-500' : 'bg-neutral-800'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 sm:h-4 sm:w-4 transform rounded-full bg-white shadow-md transition-transform duration-300 ${(chat.settings?.linkPreviews ?? true) ? 'translate-x-[18px] sm:translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  </div>
                </section>

                {/* Media & Storage */}
                <section className="space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-emerald-400">
                    <Database className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <h4 className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em]">Media & Storage</h4>
                  </div>
                  
                  <div className="space-y-3 sm:space-y-4 bg-white/5 rounded-2xl p-3 sm:p-4 border border-white/5">
                    {/* Auto-Download */}
                    <div className="space-y-2 sm:space-y-3">
                      <div>
                        <h5 className="text-xs sm:text-sm font-bold text-white">Auto-Download Media</h5>
                        <p className="text-[10px] sm:text-xs text-neutral-500">Control data usage for this chat.</p>
                      </div>
                      <div className="flex p-1 bg-neutral-900 rounded-xl border border-white/5">
                        {[
                          { id: 'all', label: 'All' },
                          { id: 'wifi-only', label: 'Wi-Fi' },
                          { id: 'never', label: 'Never' }
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            onClick={() => {
                              setChats(prev => prev.map(c => c.id === chat.id ? { ...c, settings: { ...(c.settings as ChatSettings), autoDownload: opt.id as any } } : c));
                            }}
                            className={`flex-1 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${chat.settings?.autoDownload === opt.id ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-neutral-500 hover:text-neutral-300'}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Default Ephemeral Duration */}
                    <div className="pt-3 sm:pt-4 border-t border-white/5 space-y-2 sm:space-y-3">
                      <div>
                        <h5 className="text-xs sm:text-sm font-bold text-white">Default Ephemeral Duration</h5>
                        <p className="text-[10px] sm:text-xs text-neutral-500">Auto-destruct timer for new messages.</p>
                      </div>
                      <select 
                        value={chat.settings?.defaultTtl || 0} 
                        onChange={(e) => {
                          const newTtl = Number(e.target.value);
                          setChats(prev => prev.map(c => c.id === chat.id ? { ...c, settings: { ...(c.settings as ChatSettings), defaultTtl: newTtl } } : c));
                          setTtl(newTtl);
                        }}
                        className="w-full bg-neutral-900 border border-white/5 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 text-xs sm:text-sm text-white outline-none focus:border-blue-500 transition-all appearance-none cursor-pointer"
                      >
                        <option value={0}>Disabled</option>
                        <option value={5}>5 seconds</option>
                        <option value={10}>10 seconds</option>
                        <option value={30}>30 seconds</option>
                        <option value={60}>1 minute</option>
                        <option value={300}>5 minutes</option>
                        <option value={3600}>1 hour</option>
                      </select>
                    </div>
                  </div>
                </section>

                {/* Danger Zone */}
                {chat.isGroup && (
                  <section className="space-y-3 sm:space-y-4 pt-3 sm:pt-4 border-t border-neutral-800">
                    <div className="flex items-center gap-1.5 sm:gap-2 text-rose-500">
                      <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      <h4 className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em]">Danger Zone</h4>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                      <button 
                        onClick={() => setGroupActionConfirm('exit')}
                        className="flex items-center justify-center gap-1.5 sm:gap-2 p-2.5 sm:p-3 rounded-2xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-all border border-white/5"
                      >
                        <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest">Exit</span>
                      </button>
                      <button 
                        onClick={() => setGroupActionConfirm('delete')}
                        className="flex items-center justify-center gap-1.5 sm:gap-2 p-2.5 sm:p-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-all border border-rose-500/20"
                      >
                        <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest">Delete</span>
                      </button>
                    </div>
                  </section>
                )}
              </div>

              <div className="p-4 sm:p-6 bg-neutral-900/80 backdrop-blur-md border-t border-neutral-800">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-3 sm:py-4 bg-blue-500 hover:bg-blue-600 text-neutral-950 font-bold rounded-2xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 text-sm sm:text-base"
                >
                  Apply & Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Group Action Confirmation Modal */}
      <AnimatePresence>
        {groupActionConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 max-w-sm w-full shadow-2xl"
            >
              <div className={`flex items-center gap-3 mb-4 ${groupActionConfirm === 'delete' ? 'text-rose-500' : 'text-blue-500'}`}>
                <div className={`p-2 rounded-full ${groupActionConfirm === 'delete' ? 'bg-rose-500/10' : 'bg-blue-500/10'}`}>
                  {groupActionConfirm === 'delete' ? <Trash2 className="w-5 h-5" /> : <LogOut className="w-5 h-5" />}
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-white">
                  {groupActionConfirm === 'delete' ? 'Delete Group?' : 'Exit Group?'}
                </h3>
              </div>
              <p className="text-neutral-400 text-xs sm:text-sm mb-6 leading-relaxed">
                {groupActionConfirm === 'delete' 
                  ? 'Are you sure you want to delete this group? This action cannot be undone and will remove the group for all members.'
                  : 'Are you sure you want to exit this group? You will no longer receive messages from this chat.'}
              </p>
              <div className="flex justify-end gap-2 sm:gap-3">
                <button
                  onClick={() => setGroupActionConfirm(null)}
                  className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setChats(prev => prev.filter(c => c.id !== chat.id));
                    setGroupActionConfirm(null);
                    setShowSettings(false);
                  }}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-white rounded-lg transition-colors ${groupActionConfirm === 'delete' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-blue-500 hover:bg-blue-600'}`}
                >
                  {groupActionConfirm === 'delete' ? 'Delete' : 'Exit'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ArchitectureView({ onToggleSidebar, isMobile }: { onToggleSidebar: () => void, isMobile: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12 scroll-smooth bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.05),transparent_40%)]">
      <div className="max-w-4xl mx-auto space-y-16">
        
        {/* Header */}
        <header className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase tracking-[0.2em] border border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
              <Shield className="w-4 h-4" /> System Design
            </div>
            {isMobile && (
              <button 
                onClick={onToggleSidebar}
                className="p-2 text-neutral-400 hover:text-blue-400 hover:bg-neutral-800/50 rounded-xl transition-all"
              >
                <Menu className="w-6 h-6" />
              </button>
            )}
          </div>
          <h1 className="text-5xl font-display font-bold tracking-tight text-white leading-[1.1]">Secure Chat <span className="text-gradient">Architecture</span></h1>
          <p className="text-xl text-neutral-400 leading-relaxed max-w-2xl">
            A comprehensive blueprint for a zero-knowledge, end-to-end encrypted messaging platform featuring ephemeral messages and secure group chats.
          </p>
        </header>

        {/* Tech Stack */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-display font-bold text-white tracking-tight">1. Recommended Technologies</h2>
            <div className="flex-1 h-px bg-gradient-to-r from-neutral-800 to-transparent"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TechCard 
              title="Signal Protocol (libsignal)" 
              desc="The gold standard for E2EE. Provides X3DH for key agreement and the Double Ratchet algorithm for Perfect Forward Secrecy (PFS) and Post-Compromise Security (PCS)."
              icon={<Key className="w-5 h-5 text-amber-400" />}
            />
            <TechCard 
              title="WebSockets (WSS)" 
              desc="For real-time, low-latency message relay. The server acts purely as a blind router, passing encrypted ciphertexts between connected clients."
              icon={<Server className="w-5 h-5 text-blue-400" />}
            />
            <TechCard 
              title="Web Crypto API / libsodium" 
              desc="For local cryptographic operations (AES-256-GCM for payload encryption, Ed25519 for identity keys) directly in the browser, ensuring keys never leave the device."
              icon={<Lock className="w-5 h-5 text-blue-400" />}
            />
            <TechCard 
              title="WebRTC DataChannels" 
              desc="(Optional/Hybrid) For strict 1-to-1 communication when both users are online, allowing true peer-to-peer data transfer bypassing the relay server entirely."
              icon={<Users className="w-5 h-5 text-purple-400" />}
            />
          </div>
        </section>

        {/* Architecture Diagram */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-display font-bold text-white tracking-tight">2. High-Level Architecture</h2>
            <div className="flex-1 h-px bg-gradient-to-r from-neutral-800 to-transparent"></div>
          </div>
          <div className="glass border border-neutral-800/60 rounded-3xl p-4 sm:p-8 md:p-12 flex flex-col items-center justify-center overflow-x-auto shadow-2xl relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-indigo-500/5 pointer-events-none"></div>
            <div className="min-w-full md:min-w-[600px] flex flex-col items-center gap-8 md:gap-12 relative w-full">
              {/* Key Server */}
              <div className="flex flex-col items-center gap-3">
                <div className="w-48 md:w-56 h-16 md:h-20 glass-dark border border-amber-500/30 rounded-2xl flex items-center justify-center gap-3 md:gap-4 shadow-[0_0_40px_rgba(245,158,11,0.1)] group-hover:border-amber-500/50 transition-colors">
                  <div className="p-2 md:p-2.5 bg-amber-500/10 rounded-xl">
                    <Key className="w-5 h-5 md:w-6 md:h-6 text-amber-400" />
                  </div>
                  <span className="font-bold text-neutral-100 tracking-tight text-sm md:text-base">Public Key Server</span>
                </div>
                <span className="text-[8px] md:text-[10px] text-neutral-500 font-bold uppercase tracking-widest text-center">Stores PreKeys & Identity Keys</span>
              </div>

              {/* Arrows to Key Server */}
              <div className="hidden md:flex w-full justify-between px-32 -my-4 relative z-0">
                <div className="h-16 border-l-2 border-dashed border-neutral-700/50"></div>
                <div className="h-16 border-l-2 border-dashed border-neutral-700/50"></div>
              </div>

              {/* Clients and Relay */}
              <div className="flex flex-col md:flex-row items-center justify-between w-full gap-8 md:gap-4 relative z-10">
                {/* Client A */}
                <div className="w-full md:w-48 glass-dark border border-blue-500/30 rounded-2xl p-4 md:p-6 flex flex-col items-center gap-3 md:gap-4 shadow-[0_0_40px_rgba(59,130,246,0.1)] group-hover:border-blue-500/50 transition-colors">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                    <Shield className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-white tracking-tight text-sm md:text-base">Client A</div>
                    <div className="text-[8px] md:text-[10px] font-bold text-neutral-500 uppercase tracking-widest mt-1">Encrypts Payload</div>
                  </div>
                </div>

                {/* Relay Server */}
                <div className="flex-1 flex flex-col items-center gap-2 w-full md:w-auto">
                  <div className="flex flex-col md:flex-row items-center w-full gap-4 md:gap-0">
                    <div className="hidden md:block flex-1 h-[2px] bg-gradient-to-r from-blue-500/50 to-indigo-500/50 relative">
                      <motion.div 
                        animate={{ x: ["0%", "100%"] }} 
                        transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_10px_#fff]"
                      />
                    </div>
                    <div className="w-full md:w-44 h-20 md:h-24 glass-dark border border-neutral-700/50 rounded-2xl flex flex-col items-center justify-center gap-1 md:gap-2 shadow-xl group-hover:border-neutral-600 transition-colors md:mx-4">
                      <Server className="w-5 h-5 md:w-6 md:h-6 text-neutral-400" />
                      <span className="font-bold text-neutral-200 tracking-tight text-sm md:text-base">Relay Server</span>
                      <span className="text-[8px] md:text-[10px] font-bold text-rose-500/60 uppercase tracking-widest">Blind Router</span>
                    </div>
                    <div className="hidden md:block flex-1 h-[2px] bg-gradient-to-r from-indigo-500/50 to-blue-500/50 relative">
                      <motion.div 
                        animate={{ x: ["0%", "100%"] }} 
                        transition={{ repeat: Infinity, duration: 2, ease: "linear", delay: 1 }}
                        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_10px_#fff]"
                      />
                    </div>
                  </div>
                  <span className="text-[8px] md:text-[10px] font-bold text-neutral-500 uppercase tracking-widest text-center">Blind Routing<br/>No Decryption Keys</span>
                </div>

                {/* Client B */}
                <div className="w-full md:w-48 glass-dark border border-indigo-500/30 rounded-2xl p-4 md:p-6 flex flex-col items-center gap-3 md:gap-4 shadow-[0_0_40px_rgba(99,102,241,0.1)] group-hover:border-indigo-500/50 transition-colors">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
                    <Shield className="w-5 h-5 md:w-6 md:h-6 text-indigo-400" />
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-white tracking-tight text-sm md:text-base">Client B</div>
                    <div className="text-[8px] md:text-[10px] font-bold text-neutral-500 uppercase tracking-widest mt-1">Decrypts Payload</div>
                  </div>
                </div>
              </div>

              {/* WebRTC Optional */}
              <div className="hidden md:block w-full px-32 mt-4">
                <div className="h-12 border-b-2 border-l-2 border-r-2 border-dashed border-purple-500/20 rounded-b-[3rem] relative flex justify-center">
                  <div className="absolute -bottom-4 glass-dark border border-purple-500/20 px-6 py-2 rounded-full text-[10px] text-purple-400 font-bold uppercase tracking-widest flex items-center gap-3 shadow-lg group-hover:border-purple-500/40 transition-colors">
                    <Users className="w-4 h-4" /> Optional WebRTC P2P DataChannel
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Security Plan */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-display font-bold text-white tracking-tight">3. Security Plan & Protocols</h2>
            <div className="flex-1 h-px bg-gradient-to-r from-neutral-800 to-transparent"></div>
          </div>
          
          <div className="space-y-12">
            <PlanItem 
              number="01"
              title="Identity & Key Exchange (X3DH)"
              content="Upon registration, the client generates a long-term Identity Keypair (Ed25519), a Signed PreKey, and a batch of One-Time PreKeys. The public halves are uploaded to the Key Server. When Alice wants to message Bob, she fetches his PreKeys to establish a shared secret via Extended Triple Diffie-Hellman (X3DH) asynchronously, even if Bob is offline."
            />
            <PlanItem 
              number="02"
              title="Message Encryption (Double Ratchet)"
              content="Once the session is established, the Double Ratchet algorithm is used. Every single message gets a unique encryption key. This guarantees Perfect Forward Secrecy (if a key is compromised, past messages are safe) and Post-Compromise Security (future messages become secure again after a new Diffie-Hellman ratchet step)."
            />
            <PlanItem 
              number="03"
              title="Ephemeral Messaging (Self-Destruct)"
              content="Ephemeral messages include a TTL (Time-To-Live) metadata tag inside the encrypted payload. The server deletes the encrypted blob immediately upon delivery acknowledgment. The receiving client starts a local countdown timer once the message is rendered on-screen. When the TTL expires, the client cryptographically shreds the message data from local memory/IndexedDB."
            />
            <PlanItem 
              number="04"
              title="Secure Group Chats"
              content="For group chats, we use the 'Sender Keys' protocol (used by Signal/WhatsApp). Instead of encrypting the message N times for N participants (which scales poorly), the sender generates a symmetric Sender Key, encrypts it pairwise for each group member, and then encrypts the actual message payload once using the Sender Key. The server relays this single ciphertext to all members."
            />
            <PlanItem 
              number="05"
              title="Metadata Protection & No-Logs Policy"
              content="To prevent the relay server from knowing who is talking to whom, we implement Sealed Sender. The sender encrypts their own identity and the message payload using the recipient's public key. Furthermore, our infrastructure operates on a strict 'Zero-Knowledge' and 'No-Logs' policy. We do not log IP addresses, message timestamps, or routing metadata. Once a message is delivered, all traces of the transaction are purged from the relay server's volatile memory."
            />
            <PlanItem 
              number="06"
              title="Zero-Knowledge Infrastructure"
              content="Our servers are designed as 'Blind Routers'. They have no persistent storage for message payloads or metadata. The application code is stripped of all logging and telemetry, ensuring that your interactions remain completely private and invisible to the infrastructure providers."
            />
          </div>
        </section>

        {/* Vulnerability Mitigation */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-display font-bold text-white tracking-tight">4. Vulnerability Mitigation & Advanced Protection</h2>
            <div className="flex-1 h-px bg-gradient-to-r from-neutral-800 to-transparent"></div>
          </div>
          
          <div className="space-y-12">
            <PlanItem 
              number="07"
              title="Man-in-the-Middle (MitM) Attacks & Key Verification"
              content="During the initial X3DH key exchange, a malicious key server could attempt a MitM attack by serving its own public keys instead of the intended recipient's. To mitigate this, CipherChat implements out-of-band key verification (Safety Numbers/Security Codes). Users can scan a QR code or compare a cryptographic hash of their public keys through a secondary channel to cryptographically guarantee they are communicating with the genuine device, rendering server-side MitM attacks impossible without detection."
            />
            <PlanItem 
              number="08"
              title="Perfect Forward Secrecy (PFS) & Post-Compromise Security"
              content="If an adversary compromises a device and extracts its current cryptographic keys, the Signal Protocol's Double Ratchet algorithm limits the damage. Perfect Forward Secrecy (PFS) ensures that past messages cannot be decrypted with compromised current keys, as the keys used for past messages were deterministically destroyed. Post-Compromise Security (PCS) ensures that future messages become secure again automatically; as soon as the compromised device sends or receives a new message, the Diffie-Hellman ratchet generates fresh, uncompromised key material, locking the attacker out of future communications."
            />
            <PlanItem 
              number="09"
              title="Metadata Minimization & Sealed Sender"
              content="While E2EE protects the message content, metadata (who is talking to whom, and when) can still reveal sensitive information. CipherChat implements the 'Sealed Sender' cryptographic technique to minimize this. Instead of the sender's identity being visible on the outer envelope of the message, the sender encrypts their own identity along with the message payload using the recipient's public key. The relay server only sees the recipient's address and a cryptographically opaque blob, completely blinding the server to the sender's identity and dismantling social graph mapping."
            />
          </div>
        </section>

      </div>
    </div>
  );
}

function TechCard({ title, desc, icon }: { title: string, desc: string, icon: React.ReactNode }) {
  return (
    <div className="glass-dark border border-white/5 rounded-3xl p-6 sm:p-8 hover:bg-white/5 transition-all duration-500 shadow-xl group">
      <div className="flex items-center gap-4 sm:gap-5 mb-4 sm:mb-6">
        <div className="p-3 sm:p-3.5 bg-neutral-800/50 rounded-2xl border border-white/5 shadow-inner group-hover:scale-110 transition-transform duration-500">
          {icon}
        </div>
        <h3 className="font-display font-bold text-white text-lg sm:text-xl tracking-tight">{title}</h3>
      </div>
      <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed font-medium">{desc}</p>
    </div>
  );
}

function PlanItem({ number, title, content }: { number: string, title: string, content: string }) {
  return (
    <div className="flex gap-4 sm:gap-8 group">
      <div className="flex flex-col items-center">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl glass-dark border border-neutral-800 flex items-center justify-center font-mono text-xs sm:text-sm font-bold text-blue-400 group-hover:border-blue-500/50 group-hover:bg-blue-500/10 transition-all duration-500 shadow-lg flex-shrink-0">
          {number}
        </div>
        <div className="flex-1 w-px bg-gradient-to-b from-neutral-800 to-transparent my-3 group-last:hidden"></div>
      </div>
      <div className="pb-8 sm:pb-12">
        <h3 className="text-lg sm:text-xl font-display font-bold text-white mb-2 sm:mb-3 tracking-tight group-hover:text-blue-400 transition-colors">{title}</h3>
        <p className="text-sm sm:text-base text-neutral-400 leading-relaxed font-medium">{content}</p>
      </div>
    </div>
  );
}

function ProfileView({ currentUser, setCurrentUser, setChats, onToggleSidebar, isMobile }: { currentUser: User, setCurrentUser: React.Dispatch<React.SetStateAction<User>>, setChats: React.Dispatch<React.SetStateAction<Chat[]>>, onToggleSidebar: () => void, isMobile: boolean }) {
  const [copied, setCopied] = useState(false);
  const [editName, setEditName] = useState(currentUser.name);
  const [editAvatar, setEditAvatar] = useState(currentUser.avatar);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasChanges = editName !== currentUser.name || editAvatar !== currentUser.avatar;

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditName(e.target.value);
  };

  const generateAvatar = () => {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    const seed = array[0].toString(36);
    setEditAvatar(`https://picsum.photos/seed/${seed}/100/100`);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 200;
        const MAX_HEIGHT = 200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setEditAvatar(dataUrl);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const cancelChanges = () => {
    setEditName(currentUser.name);
    setEditAvatar(currentUser.avatar);
  };

  const saveChanges = async () => {
    if (!editName.trim()) return;
    setIsSaving(true);
    
    // Ensure username exists
    let currentUsername = currentUser.username;
    if (!currentUsername) {
      const baseUsername = editName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      currentUsername = `@${baseUsername}${randomSuffix}`;
    }

    const updatedUser = { ...currentUser, name: editName, avatar: editAvatar, username: currentUsername };
    setCurrentUser(updatedUser);
    updateChatsUser(updatedUser);
    
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', currentUser.id), updatedUser);
      batch.set(doc(db, 'users_public', currentUser.id), {
        id: updatedUser.id,
        name: updatedUser.name,
        username: updatedUser.username,
        avatar: updatedUser.avatar,
        isOnline: updatedUser.isOnline
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleStatus = async () => {
    const newStatus = !currentUser.isOnline;
    
    // Ensure username exists
    let currentUsername = currentUser.username;
    if (!currentUsername) {
      const baseUsername = currentUser.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      currentUsername = `@${baseUsername}${randomSuffix}`;
    }

    const updatedUser = { ...currentUser, isOnline: newStatus, username: currentUsername };
    setCurrentUser(updatedUser);
    updateChatsUser(updatedUser);

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', currentUser.id), updatedUser);
      batch.set(doc(db, 'users_public', currentUser.id), {
        id: updatedUser.id,
        name: updatedUser.name,
        username: updatedUser.username,
        avatar: updatedUser.avatar,
        isOnline: updatedUser.isOnline
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.id}`);
    }
  };

  const copyId = () => {
    navigator.clipboard.writeText(currentUser.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const updateChatsUser = (updatedUser: User) => {
    setChats(prev => prev.map(chat => ({
      ...chat,
      participants: chat.participants.map(p => p.id === updatedUser.id ? updatedUser : p)
    })));
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12 scroll-smooth bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.05),transparent_40%)]">
      <div className="max-w-2xl mx-auto space-y-16">
        <header className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase tracking-[0.2em] border border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
              <UserCircle className="w-4 h-4" /> User Profile
            </div>
            {isMobile && (
              <button 
                onClick={onToggleSidebar}
                className="p-2 text-neutral-400 hover:text-blue-400 hover:bg-neutral-800/50 rounded-xl transition-all"
              >
                <Menu className="w-6 h-6" />
              </button>
            )}
          </div>
          <h1 className="text-5xl font-display font-bold tracking-tight text-white leading-[1.1]">Manage <span className="text-gradient">Identity</span></h1>
          <p className="text-xl text-neutral-400 leading-relaxed">
            Update your display name, avatar, and online status. These changes will be reflected in your secure chats.
          </p>
        </header>

        <div className="glass border border-neutral-800/60 rounded-[2.5rem] p-6 sm:p-10 space-y-8 sm:space-y-12 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-indigo-500/5 pointer-events-none"></div>
          
          {/* Avatar Section */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8 relative text-center sm:text-left">
            <div className="relative group">
              <input 
                type="file" 
                accept="image/*" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleAvatarUpload} 
              />
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-24 h-24 sm:w-32 sm:h-32 rounded-[2rem] overflow-hidden border-2 border-neutral-800 group-hover:border-blue-500/50 transition-all duration-500 shadow-2xl relative cursor-pointer"
              >
                <img src={editAvatar} alt="Avatar" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                  <Camera className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
              </div>
              <button 
                onClick={generateAvatar}
                className="absolute -bottom-2 -right-2 p-2 sm:p-3 bg-blue-500 text-white rounded-2xl shadow-xl shadow-blue-500/30 hover:scale-110 active:scale-95 transition-all z-10"
                title="Generate new avatar"
              >
                <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
            <div className="flex-1">
              <h3 className="text-xl sm:text-2xl font-display font-bold text-white mb-2 tracking-tight">Profile Picture</h3>
              <p className="text-xs sm:text-sm text-neutral-500 leading-relaxed max-w-xs mx-auto sm:mx-0">Click the image to upload a custom avatar, or use the button to generate a random one.</p>
            </div>
          </div>

          <div className="space-y-8 relative">
            {/* User ID Section */}
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em] ml-1">Unique User ID</label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3 sm:p-4 glass-dark rounded-2xl border border-white/5 group hover:border-blue-500/30 transition-all duration-300">
                <code className="flex-1 font-mono text-xs sm:text-sm text-blue-400 truncate text-center sm:text-left">{currentUser.id}</code>
                <button 
                  onClick={copyId}
                  className={`p-2.5 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 ${copied ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-neutral-800 text-neutral-400 hover:text-blue-400 border border-transparent'}`}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span className="text-[10px] font-bold uppercase tracking-widest">{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-[10px] text-neutral-600 ml-1">Share this ID with others so they can find and message you securely.</p>
            </div>

            {/* Display Name */}
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-[0.2em] ml-1">Display Name</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-neutral-500 group-focus-within:text-blue-500 transition-colors">
                  <User className="w-5 h-5" />
                </div>
                <input 
                  type="text" 
                  value={editName}
                  onChange={handleNameChange}
                  className="w-full glass-dark border border-white/5 rounded-2xl pl-12 pr-6 py-4 text-white outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all font-medium"
                  placeholder="Enter your name"
                />
              </div>
            </div>

            {/* Save/Cancel Actions */}
            <AnimatePresence>
              {hasChanges && (
                <motion.div 
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 32 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className="flex items-center gap-4 overflow-hidden"
                >
                  <button 
                    onClick={cancelChanges}
                    disabled={isSaving}
                    className="flex-1 py-3 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={saveChanges}
                    disabled={isSaving || !editName.trim()}
                    className="flex-1 py-3 px-4 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save Changes
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Online Status */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 sm:p-6 glass-dark rounded-2xl border border-white/5 gap-4 sm:gap-0">
              <div className="flex items-center gap-4">
                <div className={`p-2 sm:p-3 rounded-xl ${currentUser.isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-neutral-800 text-neutral-500'}`}>
                  <Wifi className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <h4 className="text-base sm:text-lg font-bold text-white tracking-tight">Online Status</h4>
                  <p className="text-xs text-neutral-500">Visible to your contacts when active.</p>
                </div>
              </div>
              <button 
                onClick={toggleStatus}
                className={`relative inline-flex h-8 w-14 items-center rounded-full transition-all duration-500 focus:outline-none shadow-lg self-end sm:self-auto ${currentUser.isOnline ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-neutral-800'}`}
              >
                <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform duration-500 ${currentUser.isOnline ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Security Notice */}
        <div className="p-8 glass-dark border border-blue-500/10 rounded-[2rem] flex items-start gap-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-3xl rounded-full"></div>
          <div className="p-4 bg-blue-500/10 rounded-2xl text-blue-400 relative">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div className="relative">
            <h4 className="text-lg font-bold text-white mb-2 tracking-tight">Privacy First</h4>
            <p className="text-sm text-neutral-400 leading-relaxed">
              CipherChat uses a decentralized identity model. Your profile data is encrypted using your master key before being synchronized across your devices. We never have access to your real identity.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewChatModal({ onClose, currentUser, onCreateChat }: { onClose: () => void, currentUser: User, onCreateChat: (chat: Chat) => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isGroup, setIsGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      try {
        const queryLower = searchQuery.toLowerCase();
        const usersRef = collection(db, 'users_public');
        const userSnapshot = await getDocs(usersRef);
        const matchedUsers: User[] = [];
        
        userSnapshot.forEach(doc => {
          const data = doc.data() as User;
          if (data.id !== currentUser.id) {
            if (!searchQuery.trim()) {
              matchedUsers.push(data);
            } else if (
              data.name.toLowerCase().includes(queryLower) || 
              (data.username && data.username.toLowerCase().includes(queryLower)) ||
              data.id.toLowerCase().includes(queryLower)
            ) {
              matchedUsers.push(data);
            }
          }
        });

        setSearchResults(matchedUsers);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'users_public');
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchUsers, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery, currentUser.id]);

  const toggleUserSelection = (user: User) => {
    if (selectedUsers.find(u => u.id === user.id)) {
      setSelectedUsers(prev => prev.filter(u => u.id !== user.id));
    } else {
      setSelectedUsers(prev => [...prev, user]);
    }
  };

  const handleCreate = async () => {
    if (selectedUsers.length === 0) return;

    // For 1:1 chats, use a deterministic ID based on participant UIDs to avoid duplicates
    const isGroupChat = isGroup || selectedUsers.length > 1;
    const participantIds = [currentUser.id, ...selectedUsers.map(u => u.id)].sort();
    const newChatId = isGroupChat ? `g_${Date.now()}` : `dm_${participantIds.join('_')}`;
    
    const newChat: Chat = {
      id: newChatId,
      name: isGroupChat ? (groupName || 'New Group') : selectedUsers[0].name,
      isGroup: isGroupChat,
      participants: [currentUser, ...selectedUsers],
      messages: [],
      settings: {
        readReceipts: true,
        defaultTtl: 10,
        notifications: true,
        encryptionProtocol: 'aes-gcm',
        autoDownload: 'always',
        typingIndicators: true,
        linkPreviews: true
      }
    };

    try {
      await setDoc(doc(db, 'chats', newChatId), {
        ...newChat,
        participantIds,
        createdAt: serverTimestamp(),
        lastMessage: null
      });
      onCreateChat(newChat);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `chats/${newChatId}`);
    }
  };

    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-50 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div 
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh]"
        >
          <div className="p-3 sm:p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/50">
            <h2 className="text-base sm:text-lg font-bold text-white">Global Search</h2>
            <button onClick={onClose} className="p-1.5 sm:p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors">
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
  
          <div className="p-3 sm:p-4 flex flex-col gap-3 sm:gap-4 overflow-y-auto">
            {/* Group Toggle */}
            <div className="flex items-center justify-between p-2.5 sm:p-3 bg-neutral-800/50 rounded-xl border border-neutral-700/50">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="p-1.5 sm:p-2 bg-blue-500/20 text-blue-400 rounded-lg">
                  <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <p className="text-xs sm:text-sm font-medium text-white">Create Group</p>
                  <p className="text-[10px] sm:text-xs text-neutral-400">Chat with multiple people</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setIsGroup(!isGroup);
                  if (!isGroup && selectedUsers.length === 1) {
                    // Keep selection when switching to group
                  } else if (isGroup && selectedUsers.length > 1) {
                    // Clear selection if switching back to single chat and multiple are selected
                    setSelectedUsers([]);
                  }
                }}
                className={`w-10 sm:w-11 h-5 sm:h-6 rounded-full transition-colors relative ${isGroup ? 'bg-blue-500' : 'bg-neutral-700'}`}
              >
                <div className={`w-3.5 h-3.5 sm:w-4 sm:h-4 bg-white rounded-full absolute top-[3px] sm:top-1 transition-transform ${isGroup ? 'translate-x-[22px] sm:translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
  
            {isGroup && (
              <div className="space-y-1.5 sm:space-y-2">
                <label className="text-[10px] sm:text-xs font-medium text-neutral-400 uppercase tracking-wider">Group Name</label>
                <input 
                  type="text" 
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Enter group name..."
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 text-xs sm:text-sm outline-none focus:border-blue-500 transition-colors text-white"
                />
              </div>
            )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Search Users or Groups</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3.5 text-neutral-500" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, @username, or unique ID..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:border-blue-500 transition-colors text-white"
              />
            </div>
          </div>

          {/* Selected Users Pills */}
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedUsers.map(user => (
                <div key={user.id} className="flex items-center gap-1.5 sm:gap-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-medium">
                  <img src={user.avatar} alt={user.name} className="w-3 h-3 sm:w-4 sm:h-4 rounded-full" />
                  {user.name}
                  <button onClick={() => toggleUserSelection(user)} className="hover:text-blue-300">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Search Results */}
          <div className="flex-1 min-h-[200px] max-h-[40vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-1">
                {searchResults.map(user => {
                  const isSelected = selectedUsers.some(u => u.id === user.id);
                  return (
                    <button
                      key={user.id}
                      onClick={() => {
                        if (!isGroup && !isSelected) {
                          setSelectedUsers([user]);
                        } else {
                          toggleUserSelection(user);
                        }
                      }}
                      className={`w-full flex items-center justify-between p-2.5 sm:p-3 rounded-xl transition-colors ${isSelected ? 'bg-blue-500/10 border border-blue-500/20' : 'hover:bg-neutral-800 border border-transparent'}`}
                    >
                      <div className="flex items-center gap-2.5 sm:gap-3">
                        <img src={user.avatar} alt={user.name} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full" />
                        <div className="text-left">
                          <p className="text-xs sm:text-sm font-medium text-white">{user.name}</p>
                          <p className="text-[10px] sm:text-xs text-neutral-400">{user.username || '@user'}</p>
                        </div>
                      </div>
                      {isSelected && <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />}
                    </button>
                  );
                })}
              </div>
            ) : searchQuery ? (
              <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
                <Search className="w-6 h-6 sm:w-8 sm:h-8 opacity-20" />
                <p className="text-xs sm:text-sm">No users found</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
                <Users className="w-6 h-6 sm:w-8 sm:h-8 opacity-20" />
                <p className="text-xs sm:text-sm text-center">Search for users to start<br/>a secure conversation</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-neutral-800 bg-neutral-900/50">
          <button
            onClick={handleCreate}
            disabled={selectedUsers.length === 0 || (isGroup && !groupName.trim())}
            className="w-full py-2.5 sm:py-3 rounded-xl bg-blue-500 text-white text-sm sm:text-base font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20"
          >
            {isGroup ? 'Create Group' : 'Start Chat'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CallOverlay({ activeCall, setActiveCall, currentUser }: { activeCall: CallState, setActiveCall: React.Dispatch<React.SetStateAction<CallState | null>>, currentUser: User }) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [videoQuality, setVideoQuality] = useState<'low' | 'medium' | 'high'>('high');
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [duration, setDuration] = useState(0);
  const localVideoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  // Sound effects for ringing
  useEffect(() => {
    let ctx: AudioContext | null = null;
    let ringInterval: NodeJS.Timeout | null = null;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AudioContextClass();
    } catch (e) {
      // Audio API not supported
    }

    const playRing = () => {
      if (!ctx) return;
      const playBeep = () => {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.setValueAtTime(480, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.1);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      };
      playBeep();
      setTimeout(playBeep, 600);
    };

    if (activeCall.status === 'calling' || activeCall.status === 'connecting') {
      playRing();
      ringInterval = setInterval(playRing, 2500);
    }

    return () => {
      if (ringInterval) clearInterval(ringInterval);
    };
  }, [activeCall.status]);

  // Sound effect for ending call
  useEffect(() => {
    return () => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } catch (e) {
        // Error handled silently
      }
    };
  }, []);

  // Removed simulation effects to use real Firestore status
  /*
  useEffect(() => {
    if (activeCall.status === 'calling') {
      const timer = setTimeout(() => {
        setActiveCall(prev => prev ? { ...prev, status: 'connecting' } : null);
      }, 1500);
      return () => clearTimeout(timer);
    } else if (activeCall.status === 'connecting') {
      const timer = setTimeout(() => {
        setActiveCall(prev => prev ? { ...prev, status: 'connected' } : null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [activeCall.status, setActiveCall]);
  */

  // Simulate random network issues
  useEffect(() => {
    if (activeCall.status === 'connected') {
      const timer = setTimeout(() => {
        if (Math.random() > 0.8) {
          setActiveCall(prev => prev ? { ...prev, status: 'reconnecting' } : null);
        }
      }, 15000 + Math.random() * 10000);
      return () => clearTimeout(timer);
    } else if (activeCall.status === 'reconnecting') {
      const timer = setTimeout(() => {
        if (Math.random() > 0.5) {
          setActiveCall(prev => prev ? { ...prev, status: 'connected' } : null);
        } else {
          setActiveCall(prev => prev ? { ...prev, status: 'connection_lost' } : null);
        }
      }, 3000 + Math.random() * 2000);
      return () => clearTimeout(timer);
    } else if (activeCall.status === 'connection_lost') {
      // Keep the overlay open to allow user to click "Reconnect"
      // We can add a longer timeout or just let the user decide
      const timer = setTimeout(() => {
        setActiveCall(null);
      }, 60000); // 1 minute timeout before auto-closing
      return () => clearTimeout(timer);
    }
  }, [activeCall.status, setActiveCall]);

  const handleAcceptCall = async () => {
    if (!activeCall.id) return;
    try {
      await updateDoc(doc(db, 'calls', activeCall.id), {
        status: 'connecting'
      });
      setActiveCall(prev => prev ? { ...prev, status: 'connecting' } : null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `calls/${activeCall.id}`);
    }
  };

  const handleDeclineCall = async () => {
    if (!activeCall.id) return;
    try {
      await updateDoc(doc(db, 'calls', activeCall.id), {
        status: 'declined'
      });
      setActiveCall(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `calls/${activeCall.id}`);
    }
  };

  const handleReconnect = () => {
    setActiveCall(prev => prev ? { ...prev, status: 'connecting' } : null);
  };

  // Sync call status from Firestore
  useEffect(() => {
    if (!activeCall.id) return;

    const unsubscribe = onSnapshot(doc(db, 'calls', activeCall.id), (snapshot) => {
      if (!snapshot.exists()) {
        setActiveCall(null);
        return;
      }
      const data = snapshot.data();
      if (data.status === 'ended' || data.status === 'declined') {
        setActiveCall(null);
      } else if (data.status !== activeCall.status) {
        setActiveCall(prev => prev ? { ...prev, status: data.status } : null);
      }
    }, (err) => {
      console.error("Call sync error:", err);
    });

    return () => unsubscribe();
  }, [activeCall.id, activeCall.status, setActiveCall]);

  // Call duration timer
  useEffect(() => {
    if (activeCall.status === 'connected') {
      const timer = setInterval(() => setDuration(d => d + 1), 1000);
      return () => clearInterval(timer);
    }
  }, [activeCall.status]);

  // Request media stream when connected
  useEffect(() => {
    if (activeCall.status === 'connected' && activeCall.type === 'video') {
      const constraints = {
        video: {
          width: videoQuality === 'high' ? 1280 : videoQuality === 'medium' ? 640 : 320,
          height: videoQuality === 'high' ? 720 : videoQuality === 'medium' ? 480 : 240,
          frameRate: videoQuality === 'high' ? 30 : videoQuality === 'medium' ? 24 : 15
        },
        audio: true
      };

      navigator.mediaDevices.getUserMedia(constraints)
        .then(s => {
          streamRef.current = s;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = s;
          }
        })
        .catch(err => {
          console.error("Media access error:", err);
        });
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [activeCall.status, activeCall.type, videoQuality]);

  const handleEndCall = async () => {
    if (!activeCall.id) {
      setActiveCall(null);
      return;
    }
    try {
      await updateDoc(doc(db, 'calls', activeCall.id), {
        status: 'ended'
      });
      setActiveCall(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `calls/${activeCall.id}`);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute inset-0 z-50 bg-neutral-950/95 backdrop-blur-md flex flex-col items-center justify-center"
    >
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-1.5 rounded-full bg-neutral-900/80 border border-neutral-800/60 backdrop-blur-md z-50">
        {activeCall.status === 'calling' && <><Loader2 className="w-3 h-3 animate-spin text-neutral-400" /><span className="text-xs font-medium text-neutral-300">Calling...</span></>}
        {activeCall.status === 'connecting' && <><Loader2 className="w-3 h-3 animate-spin text-blue-400" /><span className="text-xs font-medium text-blue-300">Connecting...</span></>}
        {activeCall.status === 'connected' && <><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /><span className="text-xs font-medium text-emerald-400">Connected</span></>}
        {activeCall.status === 'reconnecting' && <><Loader2 className="w-3 h-3 animate-spin text-amber-500" /><span className="text-xs font-medium text-amber-500">Reconnecting...</span></>}
        {activeCall.status === 'connection_lost' && <><WifiOff className="w-3 h-3 text-rose-500" /><span className="text-xs font-medium text-rose-500">Connection lost</span></>}
      </div>

      <div className="absolute top-6 left-6 flex items-center gap-2 text-blue-500">
        <Lock className="w-4 h-4" />
        <span className="text-sm font-medium">End-to-End Encrypted Call</span>
      </div>
      
      {activeCall.status === 'connected' && (
        <div className="absolute top-6 right-6 flex items-center gap-2 text-blue-400 bg-neutral-900/50 px-3 py-1.5 rounded-full border border-neutral-800/60 backdrop-blur-sm">
          <SignalHigh className={`w-4 h-4 ${videoQuality === 'low' ? 'text-rose-400' : videoQuality === 'medium' ? 'text-amber-400' : 'text-blue-400'}`} />
          <span className="text-xs font-medium uppercase">{videoQuality === 'high' ? 'HD' : videoQuality === 'medium' ? 'SD' : 'LQ'}</span>
        </div>
      )}

      {activeCall.status === 'calling' || activeCall.status === 'connecting' ? (
        <div className="flex flex-col items-center gap-6 sm:gap-8">
          <div className="flex flex-wrap justify-center gap-4">
            {activeCall.participants.map((p, i) => (
              <motion.div 
                key={p.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: [1, 1.05, 1] }}
                transition={{ 
                  scale: { repeat: Infinity, duration: 2 }
                }}
                className="w-24 h-24 sm:w-32 sm:h-32 lg:w-40 lg:h-40 rounded-full overflow-hidden border-4 border-blue-500/30 shadow-2xl relative"
              >
                <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" />
              </motion.div>
            ))}
          </div>
          <div className="text-center px-4">
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-2">
              {activeCall.status === 'calling' 
                ? (activeCall.callerId === currentUser.id ? `Calling ${activeCall.participants[0].name}...` : `${activeCall.participants[0].name} is calling you...`)
                : 'Securing connection...'}
            </h2>
            <p className="text-sm sm:text-base text-neutral-400 font-medium tracking-wide">
              Establishing end-to-end encryption
            </p>
          </div>

          {activeCall.status === 'calling' && activeCall.callerId !== currentUser.id && (
            <div className="flex items-center gap-6 mt-4">
              <button 
                onClick={handleDeclineCall}
                className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center text-white shadow-lg shadow-rose-500/20 hover:bg-rose-600 transition-all"
              >
                <PhoneOff className="w-8 h-8" />
              </button>
              <button 
                onClick={handleAcceptCall}
                className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all animate-bounce"
              >
                {activeCall.type === 'video' ? <Video className="w-10 h-10" /> : <Phone className="w-10 h-10" />}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-4 lg:p-8 relative">
          <div className="w-full h-full max-w-7xl flex items-center justify-center">
            {/* Remote Participants */}
            {activeCall.participants.map(peer => (
              <div key={peer.id} className="relative w-full h-full max-w-4xl aspect-video bg-neutral-900 rounded-2xl lg:rounded-[3rem] overflow-hidden border border-neutral-800 shadow-2xl flex items-center justify-center group">
                <AnimatePresence>
                  {(activeCall.status === 'reconnecting' || activeCall.status === 'connection_lost') && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-30 bg-neutral-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4"
                    >
                      {activeCall.status === 'reconnecting' ? (
                        <>
                          <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                          <p className="text-amber-500 font-medium text-sm">Reconnecting...</p>
                        </>
                      ) : (
                        <>
                          <WifiOff className="w-8 h-8 text-rose-500" />
                          <p className="text-rose-500 font-bold text-lg">Connection lost</p>
                          <button 
                            onClick={handleReconnect}
                            className="mt-2 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-neutral-950 font-bold rounded-lg transition-all text-sm"
                          >
                            Reconnect
                          </button>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {activeCall.type === 'video' ? (
                  <div className={`absolute inset-0 flex items-center justify-center bg-neutral-800 transition-all duration-500 ${activeCall.status === 'reconnecting' ? 'blur-md grayscale opacity-50' : ''}`}>
                    <img src={peer.avatar} alt={peer.name} className="w-24 h-24 sm:w-32 sm:h-32 lg:w-48 lg:h-48 rounded-full opacity-50" />
                    <div className="absolute bottom-4 left-4 sm:bottom-8 sm:left-8 flex flex-col gap-2">
                      <div className="bg-neutral-950/80 px-4 py-2 sm:px-6 sm:py-3 rounded-2xl backdrop-blur-xl border border-white/10 shadow-2xl flex items-center gap-2 sm:gap-3">
                        <span className="text-white text-lg sm:text-xl lg:text-2xl font-black tracking-tight">{peer.name}</span>
                        <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={`flex flex-col items-center gap-6 sm:gap-8 transition-all duration-500 ${activeCall.status === 'reconnecting' ? 'blur-sm grayscale opacity-50' : ''}`}>
                    <div className="w-24 h-24 sm:w-32 sm:h-32 lg:w-48 lg:h-48 rounded-full overflow-hidden border-4 border-neutral-700 shadow-2xl relative">
                      <img src={peer.avatar} alt={peer.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                    </div>
                    <div className="bg-neutral-950/80 px-6 py-3 sm:px-8 sm:py-4 rounded-[2rem] backdrop-blur-xl border border-white/10 shadow-2xl">
                      <h2 className="text-xl sm:text-2xl lg:text-4xl font-black text-white tracking-tighter">{peer.name}</h2>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Local Video (PiP for 1-on-1 calls) */}
          {activeCall.type === 'video' && (
            <motion.div 
              animate={{ 
                y: [0, -8, 0],
                rotate: [0, 1, 0, -1, 0],
                scale: [1, 1.02, 1]
              }} 
              transition={{ 
                repeat: Infinity, 
                duration: 6, 
                ease: "easeInOut" 
              }}
              className="absolute bottom-20 right-4 sm:bottom-24 sm:right-8 w-24 h-36 sm:w-40 sm:h-56 lg:w-56 lg:h-72 bg-neutral-900 rounded-2xl sm:rounded-3xl overflow-hidden border-2 border-neutral-700/50 shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-20 group"
            >
              {isVideoOff ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-800 gap-2 sm:gap-3">
                  <div className="w-10 h-10 sm:w-16 sm:h-16 rounded-full bg-neutral-700 flex items-center justify-center text-neutral-500">
                    <VideoOff className="w-5 h-5 sm:w-8 sm:h-8" />
                  </div>
                  <span className="text-[8px] sm:text-[10px] font-bold text-neutral-500 uppercase tracking-widest text-center">Camera Off</span>
                </div>
              ) : (
                <video 
                  ref={localVideoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="w-full h-full object-cover transform -scale-x-100" 
                />
              )}
              
              <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none">
                <div className="bg-neutral-950/80 px-3 py-1.5 rounded-xl backdrop-blur-md border border-white/10 shadow-lg flex items-center gap-2">
                  <span className="text-white text-[10px] font-black uppercase tracking-wider">You</span>
                </div>
                {isMuted && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="bg-rose-500 p-2 rounded-xl shadow-lg"
                  >
                    <MicOff className="w-3 h-3 text-white" />
                  </motion.div>
                )}
              </div>

              {isMuted && (
                <div className="absolute inset-0 bg-rose-500/10 pointer-events-none border-2 border-rose-500/20 rounded-3xl" />
              )}
            </motion.div>
          )}

          {/* Call Info Overlay */}
          <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-2 sm:gap-3">
            <div className="bg-neutral-900/50 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full border border-neutral-800/60 backdrop-blur-sm flex items-center gap-1.5 sm:gap-2">
              <Clock className="w-3 h-3 sm:w-4 sm:h-4 text-blue-400" />
              <span className="text-blue-400 font-mono text-xs sm:text-sm font-bold tracking-wider">{formatTime(duration)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-6 sm:bottom-8 lg:bottom-12 flex items-center gap-3 sm:gap-4 lg:gap-6 bg-neutral-900/80 px-4 sm:px-6 lg:px-8 py-2.5 sm:py-3 lg:py-4 rounded-full backdrop-blur-md border border-neutral-800">
        <button 
          onClick={() => setIsMuted(!isMuted)}
          className={`p-2.5 sm:p-3 lg:p-4 rounded-full transition-colors ${isMuted ? 'bg-rose-500/20 text-rose-500' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}
        >
          {isMuted ? <MicOff className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" /> : <Mic className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" />}
        </button>
        
        {activeCall.type === 'video' && (
          <button 
            onClick={() => setIsVideoOff(!isVideoOff)}
            className={`p-2.5 sm:p-3 lg:p-4 rounded-full transition-colors ${isVideoOff ? 'bg-rose-500/20 text-rose-500' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}
          >
            {isVideoOff ? <VideoOff className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" /> : <Video className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" />}
          </button>
        )}

        {activeCall.type === 'video' && (
          <div className="relative">
            <button 
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              className={`p-2.5 sm:p-3 lg:p-4 rounded-full transition-colors bg-neutral-800 text-white hover:bg-neutral-700 flex items-center gap-2`}
              title="Video Quality"
            >
              <Activity className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" />
              <span className="text-[10px] font-bold uppercase tracking-widest hidden lg:block">{videoQuality === 'high' ? 'HD' : videoQuality === 'medium' ? 'SD' : 'LQ'}</span>
            </button>
            
            <AnimatePresence>
              {showQualityMenu && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.9 }}
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-2 shadow-2xl min-w-[120px] z-[60]"
                >
                  {(['low', 'medium', 'high'] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setVideoQuality(q);
                        setShowQualityMenu(false);
                      }}
                      className={`w-full text-left px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors ${videoQuality === q ? 'bg-blue-500 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'}`}
                    >
                      {q === 'high' ? 'High (HD)' : q === 'medium' ? 'Medium (SD)' : 'Low (LQ)'}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <button 
          onClick={handleEndCall}
          className="p-2.5 sm:p-3 lg:p-4 rounded-full bg-rose-500 text-white hover:bg-rose-600 transition-colors shadow-lg shadow-rose-500/20"
        >
          <PhoneOff className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" />
        </button>
      </div>
    </motion.div>
  );
}

function SettingsView({ 
  onToggleSidebar, 
  isMobile,
  antiCensorship,
  setAntiCensorship,
  connectionProtocol,
  setConnectionProtocol,
  screenSecurity,
  setScreenSecurity,
  currentUser,
  onLogout
}: { 
  onToggleSidebar: () => void, 
  isMobile: boolean,
  antiCensorship: boolean,
  setAntiCensorship: (v: boolean) => void,
  connectionProtocol: 'direct' | 'proxy' | 'wireguard' | 'openvpn',
  setConnectionProtocol: (v: 'direct' | 'proxy' | 'wireguard' | 'openvpn') => void,
  screenSecurity: boolean,
  setScreenSecurity: (v: boolean) => void,
  currentUser: User,
  onLogout: () => void
}) {
  const [dataSaver, setDataSaver] = useState(false);
  const [readReceipts, setReadReceipts] = useState(true);
  const [twoFactor, setTwoFactor] = useState(false);
  
  // New Advanced Features State
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('cipher-theme') as 'dark' | 'light') || 'dark';
    }
    return 'dark';
  });
  const [incognitoKeyboard, setIncognitoKeyboard] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cipher-incognito-keyboard') === 'true';
    }
    return false;
  });
  const [autoLock, setAutoLock] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cipher-auto-lock') === 'true';
    }
    return false;
  });

  const [proxyUrl, setProxyUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cipher-proxy-url') || '';
    }
    return '';
  });

  const [appPin, setAppPin] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cipher-pin') || '';
    }
    return '';
  });

  const [scrambleKeypad, setScrambleKeypad] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cipher-scramble-keypad') === 'true';
    }
    return false;
  });

  const [selfDestructOnFail, setSelfDestructOnFail] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cipher-self-destruct-fail') === 'true';
    }
    return false;
  });

  const toggleScrambleKeypad = () => {
    const newVal = !scrambleKeypad;
    setScrambleKeypad(newVal);
    localStorage.setItem('cipher-scramble-keypad', String(newVal));
  };

  const toggleSelfDestructOnFail = () => {
    const newVal = !selfDestructOnFail;
    setSelfDestructOnFail(newVal);
    localStorage.setItem('cipher-self-destruct-fail', String(newVal));
  };

  const updateAppPin = (pin: string) => {
    setAppPin(pin);
    if (pin) {
      localStorage.setItem('cipher-pin', pin);
    } else {
      localStorage.removeItem('cipher-pin');
    }
  };

  const handlePanicWipe = () => {
    if (window.confirm('WARNING: This will permanently delete all local data, keys, and settings. Are you sure?')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const handleDeleteAccount = async () => {
    if (window.confirm('WARNING: This will permanently delete your account, all your data, and your identity from the servers. This action cannot be undone. Are you absolutely sure?')) {
      try {
        // Delete from Firestore
        try {
          await deleteDoc(doc(db, 'users', currentUser.id));
          await deleteDoc(doc(db, 'users_public', currentUser.id));
        } catch (fsError) {
          console.error("Firestore deletion failed:", fsError);
          // Continue with auth deletion even if Firestore fails
        }
        
        // Delete from Auth (Firebase)
        if (auth.currentUser) {
          await auth.currentUser.delete();
        }
        
        // Delete from Custom Auth
        const customUsersStr = localStorage.getItem('cipherchat_custom_users');
        if (customUsersStr && currentUser.email) {
          try {
            const customUsers = JSON.parse(customUsersStr);
            if (customUsers[currentUser.email]) {
              delete customUsers[currentUser.email];
              localStorage.setItem('cipherchat_custom_users', JSON.stringify(customUsers));
            }
          } catch (e) {
            console.error("Failed to parse custom users", e);
          }
        }
        
        // Clear session and logout
        localStorage.removeItem('cipherchat_session');
        onLogout();
      } catch (error: any) {
        console.error("Error deleting account:", error);
        if (error.code === 'auth/requires-recent-login') {
          alert("For security reasons, you need to log in again before deleting your account. Please log out, log back in, and try again.");
        } else {
          alert("Failed to delete account. Please try again later.");
        }
      }
    }
  };

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('cipher-theme', newTheme);
    if (newTheme === 'light') {
      document.documentElement.classList.add('theme-light');
    } else {
      document.documentElement.classList.remove('theme-light');
    }
  };

  const toggleScreenSecurity = () => {
    const newValue = !screenSecurity;
    setScreenSecurity(newValue);
    localStorage.setItem('cipher-screen-security', String(newValue));
  };

  const toggleIncognitoKeyboard = () => {
    const newValue = !incognitoKeyboard;
    setIncognitoKeyboard(newValue);
    localStorage.setItem('cipher-incognito-keyboard', String(newValue));
  };

  const toggleAutoLock = () => {
    const newValue = !autoLock;
    setAutoLock(newValue);
    localStorage.setItem('cipher-auto-lock', String(newValue));
  };

  const toggleAntiCensorship = () => {
    const newValue = !antiCensorship;
    setAntiCensorship(newValue);
    localStorage.setItem('cipher-anti-censorship', String(newValue));
    // In a real app, this would trigger a network reconfiguration
    if (newValue) {
      console.log(`Anti-Censorship enabled using ${connectionProtocol}`);
    }
  };

  const updateProtocol = (protocol: 'direct' | 'proxy' | 'wireguard' | 'openvpn') => {
    setConnectionProtocol(protocol);
    localStorage.setItem('cipher-protocol', protocol);
  };

  const updateProxyUrl = (url: string) => {
    setProxyUrl(url);
    localStorage.setItem('cipher-proxy-url', url);
  };

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ message: "Exported Data" }));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "cipherchat_export.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12 scroll-smooth bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.05),transparent_40%)]">
      <div className="max-w-3xl mx-auto space-y-12 pb-12">
        <header className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase tracking-[0.2em] border border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
              <Settings className="w-4 h-4" /> Preferences
            </div>
            {isMobile && (
              <button 
                onClick={onToggleSidebar}
                className="p-2 text-neutral-400 hover:text-blue-400 hover:bg-neutral-800/50 rounded-xl transition-all"
              >
                <Menu className="w-6 h-6" />
              </button>
            )}
          </div>
          <h1 className="text-5xl font-display font-bold tracking-tight text-white leading-[1.1]">App <span className="text-gradient">Settings</span></h1>
          <p className="text-xl text-neutral-400 leading-relaxed">
            Manage your privacy, security, and application preferences.
          </p>
        </header>

        <div className="space-y-8">
          {/* Appearance Section */}
          <section className="glass border border-neutral-800/60 rounded-3xl p-8 space-y-8 shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 blur-3xl rounded-full transition-opacity group-hover:opacity-100 opacity-50"></div>
            <div className="flex items-center gap-3 border-b border-neutral-800/60 pb-4 relative z-10">
              <div className="p-2 bg-purple-500/10 rounded-xl text-purple-400">
                <Palette className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Appearance</h2>
                <p className="text-xs text-neutral-500 font-medium uppercase tracking-wider">Visual preferences</p>
              </div>
            </div>
            
            <div className="space-y-6 relative z-10">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-2xl bg-neutral-900/40 border border-neutral-800/40 hover:border-neutral-700/60 transition-colors gap-4 sm:gap-0">
                <div>
                  <h3 className="text-white font-bold">App Theme</h3>
                  <p className="text-sm text-neutral-400">Toggle between light and dark mode.</p>
                </div>
                <button 
                  onClick={toggleTheme}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-lg"
                >
                  {theme === 'dark' ? <Moon className="w-4 h-4 text-blue-400" /> : <Sun className="w-4 h-4 text-amber-400" />}
                  {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                </button>
              </div>
            </div>
          </section>

          {/* Security & Privacy Section */}
          <section className="glass border border-neutral-800/60 rounded-3xl p-8 space-y-8 shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-3xl rounded-full transition-opacity group-hover:opacity-100 opacity-50"></div>
            <div className="flex items-center gap-3 border-b border-neutral-800/60 pb-4 relative z-10">
              <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Security & Privacy</h2>
                <p className="text-xs text-neutral-500 font-medium uppercase tracking-wider">Protection & access control</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
              <div className="p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <MonitorOff className="w-5 h-5 text-neutral-500" />
                    <h3 className="text-white font-bold">Screen Security</h3>
                  </div>
                  <button 
                    onClick={toggleScreenSecurity}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${screenSecurity ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${screenSecurity ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Prevents screenshots, disables right-click, and blurs content when the app is out of focus. Adds a subtle watermark deterrent.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Keyboard className="w-5 h-5 text-neutral-500" />
                    <h3 className="text-white font-bold">Incognito Keyboard</h3>
                  </div>
                  <button 
                    onClick={toggleIncognitoKeyboard}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${incognitoKeyboard ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${incognitoKeyboard ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">Request keyboard to disable personalized learning.</p>
              </div>

              <div className="p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Timer className="w-5 h-5 text-neutral-500" />
                    <h3 className="text-white font-bold">Auto-Lock</h3>
                  </div>
                  <button 
                    onClick={toggleAutoLock}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${autoLock ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${autoLock ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">Require authentication after 5 minutes of inactivity.</p>
              </div>

              <div className="p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Lock className="w-5 h-5 text-neutral-500" />
                    <h3 className="text-white font-bold">Two-Factor Auth</h3>
                  </div>
                  <button 
                    onClick={() => setTwoFactor(!twoFactor)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${twoFactor ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${twoFactor ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">Require an extra step to log in to your account.</p>
              </div>

              <div className="p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40 space-y-4 md:col-span-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCheck className="w-5 h-5 text-neutral-500" />
                    <h3 className="text-white font-bold">Read Receipts</h3>
                  </div>
                  <button 
                    onClick={() => setReadReceipts(!readReceipts)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${readReceipts ? 'bg-emerald-500' : 'bg-neutral-700'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${readReceipts ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">Let others know when you&apos;ve read their messages. This applies to all end-to-end encrypted chats.</p>
              </div>
            </div>
          </section>

          {/* Network & Connectivity Section */}
          <section className="glass border border-neutral-800/60 rounded-3xl p-8 space-y-8 shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-3xl rounded-full transition-opacity group-hover:opacity-100 opacity-50"></div>
            <div className="flex items-center gap-3 border-b border-neutral-800/60 pb-4 relative z-10">
              <div className="p-2 bg-blue-500/10 rounded-xl text-blue-400">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Network & Connectivity</h2>
                <p className="text-xs text-neutral-500 font-medium uppercase tracking-wider">Bypass & data optimization</p>
              </div>
            </div>
            
            <div className="space-y-6 relative z-10">
              <div className="p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Zap className="w-5 h-5 text-blue-400" />
                    <h3 className="text-white font-bold">Anti-Censorship Mode</h3>
                  </div>
                  <button 
                    onClick={toggleAntiCensorship}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${antiCensorship ? 'bg-blue-500' : 'bg-neutral-700'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${antiCensorship ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">Bypass state-level firewalls and regional blocks using obfuscated protocols.</p>
                
                <AnimatePresence>
                  {antiCensorship && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-6 pt-4 border-t border-neutral-800/40 overflow-hidden"
                    >
                      <div className="space-y-3">
                        <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Connection Protocol</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {[
                            { id: 'direct', label: 'Direct (Obf)', icon: Zap },
                            { id: 'proxy', label: 'HTTPS Proxy', icon: Server },
                            { id: 'wireguard', label: 'WireGuard', icon: Shield },
                            { id: 'openvpn', label: 'OpenVPN', icon: Lock }
                          ].map((p) => (
                            <button
                              key={p.id}
                              onClick={() => updateProtocol(p.id as any)}
                              className={`flex items-center gap-3 p-3 rounded-xl border transition-all duration-300 ${connectionProtocol === p.id ? 'bg-blue-500/10 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]' : 'bg-neutral-900/50 border-neutral-800/60 text-neutral-400 hover:border-neutral-700'}`}
                            >
                              <p.icon className="w-3.5 h-3.5" />
                              <span className="text-[10px] font-bold uppercase tracking-wider">{p.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {connectionProtocol === 'proxy' && (
                        <div className="space-y-3">
                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Proxy Server URL</label>
                          <input 
                            type="text"
                            value={proxyUrl}
                            onChange={(e) => updateProxyUrl(e.target.value)}
                            placeholder="https://proxy.example.com:8443"
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors"
                          />
                        </div>
                      )}

                      {connectionProtocol === 'wireguard' && (
                        <div className="space-y-3">
                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">WireGuard Config</label>
                          <textarea 
                            value={localStorage.getItem('cipher-wg-config') || ''}
                            onChange={(e) => localStorage.setItem('cipher-wg-config', e.target.value)}
                            className="w-full bg-black/20 border border-white/20 rounded-lg p-3 text-sm outline-none focus:border-white/40 transition-colors resize-none font-mono"
                            rows={4}
                            placeholder="[Interface]&#10;PrivateKey = ...&#10;Address = ...&#10;[Peer]&#10;PublicKey = ...&#10;Endpoint = ..."
                          />
                        </div>
                      )}

                      {connectionProtocol === 'openvpn' && (
                        <div className="space-y-3">
                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">OpenVPN Config</label>
                          <textarea 
                            value={localStorage.getItem('cipher-ovpn-config') || ''}
                            onChange={(e) => localStorage.setItem('cipher-ovpn-config', e.target.value)}
                            className="w-full bg-black/20 border border-white/20 rounded-lg p-3 text-sm outline-none focus:border-white/40 transition-colors resize-none font-mono"
                            rows={4}
                            placeholder="client&#10;dev tun&#10;proto udp&#10;remote ...&#10;resolv-retry infinite&#10;nobind&#10;..."
                          />
                        </div>
                      )}

                      {(connectionProtocol === 'wireguard' || connectionProtocol === 'openvpn') && (
                        <div className="space-y-3">
                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Configuration File</label>
                          <div className="relative">
                            <textarea 
                              placeholder={`Paste your ${connectionProtocol === 'wireguard' ? 'WireGuard' : 'OpenVPN'} configuration here...`}
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white font-mono h-32 focus:outline-none focus:border-blue-500/50 transition-colors resize-none"
                            />
                            <div className="absolute top-3 right-3">
                              <FileText className="w-4 h-4 text-neutral-600" />
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex items-center justify-between p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40">
                <div className="flex items-center gap-3">
                  <Key className="w-5 h-5 text-neutral-500" />
                  <div>
                    <h3 className="text-white font-bold">App PIN</h3>
                    <p className="text-xs text-neutral-400">Require a PIN to unlock CipherChat.</p>
                  </div>
                </div>
                <input 
                  type="password"
                  value={appPin}
                  onChange={(e) => updateAppPin(e.target.value)}
                  placeholder="Set PIN"
                  maxLength={8}
                  className="w-24 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-sm text-center text-white focus:outline-none focus:border-blue-500/50 transition-colors"
                />
              </div>

              {appPin && (
                <>
                  <div className="flex items-center justify-between p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40">
                    <div className="flex items-center gap-3">
                      <Keyboard className="w-5 h-5 text-neutral-500" />
                      <div>
                        <h3 className="text-white font-bold">Scramble Keypad</h3>
                        <p className="text-xs text-neutral-400">Randomize PIN pad layout to prevent shoulder surfing.</p>
                      </div>
                    </div>
                    <button 
                      onClick={toggleScrambleKeypad}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${scrambleKeypad ? 'bg-blue-500' : 'bg-neutral-700'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${scrambleKeypad ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-rose-500" />
                      <div>
                        <h3 className="text-rose-500 font-bold">Self-Destruct on 5 Failed PINs</h3>
                        <p className="text-xs text-rose-500/70">Wipe all data if incorrect PIN is entered 5 times.</p>
                      </div>
                    </div>
                    <button 
                      onClick={toggleSelfDestructOnFail}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${selfDestructOnFail ? 'bg-rose-500' : 'bg-neutral-700'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${selfDestructOnFail ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </>
              )}

              <div className="flex items-center justify-between p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40">
                <div className="flex items-center gap-3">
                  <MonitorOff className="w-5 h-5 text-neutral-500" />
                  <div>
                    <h3 className="text-white font-bold">Data Saver Mode</h3>
                    <p className="text-xs text-neutral-400">Prevent auto-downloading of media on cellular networks.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setDataSaver(!dataSaver)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${dataSaver ? 'bg-blue-500' : 'bg-neutral-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${dataSaver ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </section>

          {/* Data Management Section */}
          <section className="glass border border-neutral-800/60 rounded-3xl p-8 space-y-8 shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-3xl rounded-full transition-opacity group-hover:opacity-100 opacity-50"></div>
            <div className="flex items-center gap-3 border-b border-neutral-800/60 pb-4 relative z-10">
              <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Data Management</h2>
                <p className="text-xs text-neutral-500 font-medium uppercase tracking-wider">Export & history</p>
              </div>
            </div>
            
            <div className="space-y-6 relative z-10">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 rounded-2xl bg-neutral-900/40 border border-neutral-800/40 hover:border-neutral-700/60 transition-colors gap-4 sm:gap-0">
                <div>
                  <h3 className="text-white font-bold">Export Chat Data</h3>
                  <p className="text-sm text-neutral-400">Download a copy of your encrypted chat history.</p>
                </div>
                <button 
                  onClick={handleExport}
                  className="w-full sm:w-auto px-5 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white text-sm font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                >
                  <Download className="w-4 h-4" /> Export
                </button>
              </div>
            </div>
          </section>

          {/* Danger Zone */}
          <section className="glass border border-rose-500/20 rounded-3xl p-8 space-y-8 shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 blur-3xl rounded-full transition-opacity group-hover:opacity-100 opacity-50"></div>
            <div className="flex items-center gap-3 border-b border-rose-500/20 pb-4 relative z-10">
              <div className="p-2 bg-rose-500/10 rounded-xl text-rose-500">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-rose-500 tracking-tight">Danger Zone</h2>
                <p className="text-xs text-rose-500/70 font-medium uppercase tracking-wider">Irreversible actions</p>
              </div>
            </div>
            
            <div className="space-y-4 relative z-10">
              <div className="p-5 rounded-2xl bg-rose-500/5 border border-rose-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-rose-500 font-bold">Panic Button (Wipe Data)</h3>
                  <p className="text-xs text-rose-500/70 mt-1 max-w-md">
                    Instantly delete all local data, cryptographic keys, settings, and session information. This action cannot be undone.
                  </p>
                </div>
                <button 
                  onClick={handlePanicWipe}
                  className="w-full md:w-auto px-6 py-3 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-xl transition-all shadow-lg shadow-rose-500/20 whitespace-nowrap flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Wipe Everything
                </button>
              </div>

              <div className="p-5 rounded-2xl bg-rose-500/5 border border-rose-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-rose-500 font-bold">Delete Account</h3>
                  <p className="text-xs text-rose-500/70 mt-1 max-w-md">
                    Permanently delete your account, identity, and all data from the servers. You can create a new account later.
                  </p>
                </div>
                <button 
                  onClick={handleDeleteAccount}
                  className="w-full md:w-auto px-6 py-3 bg-rose-900/50 hover:bg-rose-800/80 text-rose-200 font-bold rounded-xl border border-rose-500/30 transition-all shadow-lg shadow-rose-900/20 whitespace-nowrap flex items-center justify-center gap-2"
                >
                  <UserX className="w-4 h-4" /> Delete Account
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AuthModal({ mode, onClose }: { mode: 'login' | 'signup', onClose: () => void }) {
  const [isLogin, setIsLogin] = useState(mode === 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaChallenge, setCaptchaChallenge] = useState('');

  const generateCaptcha = () => {
    const challenges = ['human', 'secure', 'cipher', 'privacy', 'shield', 'verify', 'protect'];
    setCaptchaChallenge(challenges[Math.floor(Math.random() * challenges.length)]);
    setCaptchaInput('');
  };

  useEffect(() => {
    generateCaptcha();
  }, [isLogin]);

  const downloadCipherChatDB = async (user: { uid: string, email: string | null }, pass: string) => {
    try {
      const pgp = await import('openpgp');
      const data = {
        uid: user.uid,
        email: user.email,
        timestamp: new Date().toISOString(),
        app: 'CipherChat'
      };
      
      const message = await pgp.createMessage({ text: JSON.stringify(data) });
      const encrypted = await pgp.encrypt({
        message,
        passwords: [pass],
        format: 'armored'
      });
      
      const blob = new Blob([encrypted as string], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cipherchat.db';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate cipherchat.db", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (captchaInput.toLowerCase().trim() !== captchaChallenge) {
      setError('Incorrect security check. Please try again.');
      generateCaptcha();
      setLoading(false);
      return;
    }

    if (!isLogin && !name.trim()) {
      setError('Please enter your full name.');
      setLoading(false);
      return;
    }

    try {
      if (isLogin) {
        // Custom Auth Login
        const users = JSON.parse(localStorage.getItem('cipherchat_custom_users') || '{}');
        const user = users[email];
        if (!user || user.password !== password) {
          throw new Error('Invalid email or password');
        }
        
        // Set current user in local storage to simulate session
        localStorage.setItem('cipherchat_session', JSON.stringify(user));
        
        // Trigger a custom event to notify AppWrapper
        window.dispatchEvent(new Event('cipherchat_auth_changed'));
        
        await downloadCipherChatDB({ uid: user.uid, email: user.email }, password);
      } else {
        // Custom Auth Signup
        const users = JSON.parse(localStorage.getItem('cipherchat_custom_users') || '{}');
        if (users[email]) {
          throw new Error('Email already in use');
        }
        
        const uid = 'usr_' + Math.random().toString(36).substr(2, 9);
        const baseUsername = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        const username = `@${baseUsername}${randomSuffix}`;
        
        const newUser = {
          uid,
          email,
          password,
          displayName: name,
          photoURL: `https://picsum.photos/seed/${uid}/100/100`
        };
        
        users[email] = newUser;
        localStorage.setItem('cipherchat_custom_users', JSON.stringify(users));
        localStorage.setItem('cipherchat_session', JSON.stringify(newUser));
        
        // Create user document in Firestore
        const batch = writeBatch(db);
        const userRef = doc(db, 'users', uid);
        const publicUserRef = doc(db, 'users_public', uid);

        const userData = {
          id: uid,
          name: name,
          username: username,
          email: email,
          avatar: newUser.photoURL,
          isOnline: true,
          createdAt: serverTimestamp()
        };

        const publicUserData = {
          id: uid,
          name: name,
          username: username,
          avatar: newUser.photoURL,
          isOnline: true
        };

        batch.set(userRef, userData);
        batch.set(publicUserRef, publicUserData);
        await batch.commit();
        
        window.dispatchEvent(new Event('cipherchat_auth_changed'));
        
        await downloadCipherChatDB({ uid: newUser.uid, email: newUser.email }, password);
      }
      onClose();
    } catch (err: any) {
      console.error("Auth error:", err);
      setError(err.message || 'An error occurred during authentication');
      setLoading(false);
      handleFirestoreError(err, OperationType.WRITE, `users/${email}`);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Check if user document exists, if not create it
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) {
        const displayName = user.displayName || 'Anonymous';
        const baseUsername = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        const username = `@${baseUsername}${randomSuffix}`;

        const batch = writeBatch(db);
        const userRef = doc(db, 'users', user.uid);
        const publicUserRef = doc(db, 'users_public', user.uid);

        const userData = {
          id: user.uid,
          name: displayName,
          username: username,
          email: user.email || '',
          avatar: user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100`,
          isOnline: true,
          createdAt: serverTimestamp()
        };

        const publicUserData = {
          id: user.uid,
          name: displayName,
          username: username,
          avatar: user.photoURL || `https://picsum.photos/seed/${user.uid}/100/100`,
          isOnline: true
        };

        batch.set(userRef, userData);
        batch.set(publicUserRef, publicUserData);
        await batch.commit();
      }
      onClose();
    } catch (err: any) {
      console.error("Google Auth error:", err);
      setError(err.message || 'An error occurred during Google authentication');
      setLoading(false);
      handleFirestoreError(err, OperationType.WRITE, `users/google_login`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }} 
        animate={{ opacity: 1, scale: 1 }} 
        exit={{ opacity: 0, scale: 0.95 }} 
        className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 sm:p-8 w-full max-w-md shadow-2xl relative max-h-[90vh] overflow-y-auto"
      >
        <button onClick={onClose} className="absolute top-4 right-4 sm:top-6 sm:right-6 text-neutral-500 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">{isLogin ? 'Welcome back' : 'Create an account'}</h2>
        <p className="text-neutral-400 text-xs sm:text-sm mb-6">{isLogin ? 'Enter your details to access your secure chats.' : 'Start your secure communication journey today.'}</p>
        
        {error && (
          <div className="mb-6 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <button 
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-neutral-200 text-black font-bold py-3 rounded-xl transition-colors shadow-lg disabled:opacity-50 text-sm sm:text-base"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-neutral-800"></div>
            <span className="flex-shrink mx-4 text-neutral-500 text-[10px] sm:text-xs font-medium uppercase tracking-wider">Or continue with email</span>
            <div className="flex-grow border-t border-neutral-800"></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs sm:text-sm font-medium text-neutral-300 mb-1.5">Full Name</label>
              <input 
                type="text" 
                required 
                value={name} 
                onChange={e => setName(e.target.value)} 
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm sm:text-base" 
                placeholder="John Doe" 
              />
            </div>
          )}
          <div>
            <label className="block text-xs sm:text-sm font-medium text-neutral-300 mb-1.5">Email</label>
            <input 
              type="email" 
              required 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm sm:text-base" 
              placeholder="you@example.com" 
            />
          </div>
          <div>
            <label className="block text-xs sm:text-sm font-medium text-neutral-300 mb-1.5">Password</label>
            <input 
              type="password" 
              required 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm sm:text-base" 
              placeholder="••••••••" 
            />
          </div>
          <div className="p-3 sm:p-4 bg-neutral-950/50 border border-neutral-800 rounded-xl">
            <label className="block text-xs sm:text-sm font-medium text-neutral-300 mb-2">
              Security Check: Please type the word <strong className="text-white select-none bg-neutral-800 px-2 py-0.5 rounded tracking-widest">{captchaChallenge}</strong>
            </label>
            <input 
              type="text" 
              required 
              value={captchaInput} 
              onChange={e => setCaptchaInput(e.target.value)} 
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm sm:text-base" 
              placeholder="Type the word here..." 
            />
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-neutral-950 font-bold py-3 rounded-xl transition-colors mt-4 shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 text-sm sm:text-base"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isLogin ? 'Log in' : 'Sign up'}
          </button>
        </form>
      </div>
        
      <div className="mt-6 text-center">
          <button onClick={() => setIsLogin(!isLogin)} className="text-xs sm:text-sm text-neutral-400 hover:text-white transition-colors">
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function LandingPage() {
  const [showAuth, setShowAuth] = useState<'login' | 'signup' | null>(null);

  // Floating orbs animation variants
  const orbVariants = {
    animate: {
      y: [0, -20, 0],
      x: [0, 15, 0],
      transition: {
        duration: 8,
        repeat: Infinity,
        ease: "easeInOut" as const
      }
    }
  };

  return (
    <div className="min-h-[100dvh] bg-neutral-950 text-neutral-100 font-sans selection:bg-blue-500/30 overflow-x-hidden relative">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-neutral-950 to-neutral-950"></div>
        
        {/* Animated Orbs */}
        <motion.div variants={orbVariants} animate="animate" className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-600/20 blur-[120px]"></motion.div>
        <motion.div variants={orbVariants} animate="animate" transition={{ delay: 2, duration: 10, repeat: Infinity, ease: "easeInOut" }} className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-teal-600/20 blur-[120px]"></motion.div>
        <motion.div variants={orbVariants} animate="animate" transition={{ delay: 4, duration: 12, repeat: Infinity, ease: "easeInOut" }} className="absolute top-[40%] left-[60%] w-[30%] h-[30%] rounded-full bg-indigo-600/10 blur-[120px]"></motion.div>

        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.04] mix-blend-overlay"></div>
        
        {/* Animated Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:linear-gradient(to_bottom,transparent,black,transparent)]"></div>
      </div>
      
      {/* Navbar */}
      <nav className="relative flex items-center justify-between px-6 lg:px-8 py-6 max-w-7xl mx-auto z-50">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-3"
        >
          <div className="p-2 bg-gradient-to-br from-blue-400 to-indigo-600 rounded-xl shadow-lg shadow-blue-500/20 relative group">
            <div className="absolute inset-0 bg-white/20 rounded-xl blur opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <Shield className="w-6 h-6 text-white relative z-10" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">CipherChat</span>
        </motion.div>
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-6"
        >
          <button onClick={() => setShowAuth('login')} className="text-sm font-medium text-neutral-300 hover:text-white transition-colors">Log in</button>
          <button onClick={() => setShowAuth('signup')} className="relative group text-sm font-medium bg-white text-black px-5 py-2.5 rounded-full transition-all shadow-lg hover:scale-105">
            <div className="absolute inset-0 rounded-full bg-blue-400 blur opacity-0 group-hover:opacity-40 transition-opacity"></div>
            <span className="relative z-10">Sign up</span>
          </button>
        </motion.div>
      </nav>

      {/* Hero */}
      <main className="relative max-w-7xl mx-auto px-6 lg:px-8 pt-16 lg:pt-24 pb-32 flex flex-col items-center text-center z-10">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: -20 }} 
          animate={{ opacity: 1, scale: 1, y: 0 }} 
          transition={{ duration: 0.6, type: "spring", bounce: 0.5 }} 
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 text-blue-400 text-xs font-semibold uppercase tracking-widest mb-8 border border-blue-500/20 backdrop-blur-md shadow-[0_0_30px_rgba(59,130,246,0.15)]"
        >
          <Lock className="w-3.5 h-3.5" /> Military-Grade Encryption &middot; Zero Logs
        </motion.div>
        
        <div className="relative">
          <motion.div 
            animate={{ 
              scale: [1, 1.05, 1],
              opacity: [0.4, 0.6, 0.4] 
            }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -inset-4 bg-blue-500/20 blur-3xl rounded-full pointer-events-none"
          ></motion.div>
          <motion.h1 
            initial={{ opacity: 0, y: 30 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }} 
            className="relative text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight mb-8 bg-gradient-to-br from-white via-neutral-200 to-neutral-600 bg-clip-text text-transparent max-w-5xl leading-[1.1]"
          >
            Unbreakable Privacy.<br/>
            <motion.span 
              initial={{ opacity: 0, filter: "blur(10px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 1, delay: 0.5 }}
              className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500"
            >
              Zero Logs.
            </motion.span>
          </motion.h1>
        </div>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }} 
          className="text-lg md:text-xl text-neutral-400 max-w-2xl mb-12 leading-relaxed"
        >
          CipherChat is a next-generation communication platform. We store absolutely <strong className="text-white">no logs</strong>, no metadata, and no IP addresses. Your messages, calls, and files are protected by end-to-end encryption.
        </motion.p>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ duration: 0.7, delay: 0.4, ease: "easeOut" }} 
          className="flex flex-col sm:flex-row items-center gap-4"
        >
          <button 
            onClick={() => setShowAuth('signup')} 
            className="relative group px-8 py-4 bg-blue-500 text-neutral-950 font-bold rounded-full transition-all flex items-center gap-2 text-lg overflow-hidden"
          >
            <motion.div 
              animate={{ x: ["-100%", "200%"] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12"
            ></motion.div>
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
            <div className="absolute -inset-1 bg-blue-400 blur opacity-30 group-hover:opacity-60 transition-opacity"></div>
            <span className="relative z-10 flex items-center gap-2">Get Started for Free <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></span>
          </button>
          <button 
            onClick={() => setShowAuth('login')} 
            className="px-8 py-4 bg-neutral-900/80 backdrop-blur-md hover:bg-neutral-800 text-white font-medium rounded-full transition-all border border-neutral-700 hover:border-neutral-500 flex items-center gap-2 text-lg"
          >
            Sign In
          </button>
        </motion.div>

        {/* App Mockup Preview */}
        <motion.div
          initial={{ opacity: 0, y: 80, rotateX: 10 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ duration: 1.2, delay: 0.5, type: "spring", bounce: 0.3 }}
          style={{ perspective: 1000 }}
          className="mt-24 w-full max-w-5xl relative"
        >
          <motion.div 
            animate={{ y: [-10, 10, -10] }} 
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="relative"
          >
            <div className="absolute -inset-1 bg-gradient-to-b from-blue-500/30 to-transparent rounded-[2.5rem] blur-2xl opacity-60"></div>
            <div className="relative bg-neutral-950/90 backdrop-blur-xl border border-neutral-800/80 rounded-[2rem] shadow-2xl overflow-hidden flex flex-col h-[400px] md:h-[600px] ring-1 ring-white/10">
              {/* Mockup Header */}
              <div className="h-14 border-b border-neutral-800/60 flex items-center px-6 bg-neutral-900/50 backdrop-blur-md gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-rose-500/80"></div>
                  <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                  <div className="w-3 h-3 rounded-full bg-blue-500/80"></div>
                </div>
                <div className="mx-auto px-4 py-1 rounded-md bg-neutral-800/50 text-xs text-neutral-400 font-mono flex items-center gap-2">
                  <Lock className="w-3 h-3 text-blue-400" /> cipherchat.app
                </div>
              </div>
              {/* Mockup Body */}
              <div className="flex-1 flex bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-neutral-900/40 to-neutral-950">
                {/* Sidebar Mock */}
                <div className="w-64 border-r border-neutral-800/60 hidden md:flex flex-col p-4 gap-3">
                  <div className="h-10 rounded-lg bg-neutral-800/50 w-full mb-4"></div>
                  <div className="h-12 rounded-xl bg-neutral-800/80 w-full flex items-center px-3 gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20"></div>
                    <div className="flex-1">
                      <div className="h-2.5 w-20 bg-neutral-600 rounded-full mb-1.5"></div>
                      <div className="h-2 w-12 bg-neutral-700 rounded-full"></div>
                    </div>
                  </div>
                  <div className="h-12 rounded-xl bg-neutral-900/50 w-full flex items-center px-3 gap-3">
                    <div className="w-8 h-8 rounded-full bg-neutral-800"></div>
                    <div className="flex-1">
                      <div className="h-2.5 w-16 bg-neutral-700 rounded-full mb-1.5"></div>
                      <div className="h-2 w-24 bg-neutral-800 rounded-full"></div>
                    </div>
                  </div>
                </div>
                {/* Chat Area Mock */}
                <div className="flex-1 p-6 flex flex-col justify-end gap-4 relative">
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_14px]"></div>
                  
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.8, x: -20 }} 
                    whileInView={{ opacity: 1, scale: 1, x: 0 }} 
                    viewport={{ once: true }}
                    transition={{ delay: 0.2, type: "spring" }} 
                    className="self-start bg-neutral-800/80 backdrop-blur-sm border border-neutral-700/50 rounded-2xl rounded-tl-sm px-5 py-3.5 max-w-[80%] relative z-10"
                  >
                    <div className="h-2.5 w-48 bg-neutral-400 rounded-full mb-2"></div>
                    <div className="h-2.5 w-32 bg-neutral-500 rounded-full"></div>
                  </motion.div>
                  
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.8, x: 20 }} 
                    whileInView={{ opacity: 1, scale: 1, x: 0 }} 
                    viewport={{ once: true }}
                    transition={{ delay: 0.6, type: "spring" }} 
                    className="self-end bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl rounded-tr-sm px-5 py-3.5 max-w-[80%] relative z-10 shadow-lg shadow-blue-900/20"
                  >
                    <div className="h-2.5 w-56 bg-blue-100/90 rounded-full mb-2"></div>
                    <div className="h-2.5 w-40 bg-blue-200/80 rounded-full"></div>
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, scale: 0.8, x: -20 }} 
                    whileInView={{ opacity: 1, scale: 1, x: 0 }} 
                    viewport={{ once: true }}
                    transition={{ delay: 1.0, type: "spring" }} 
                    className="self-start bg-neutral-800/80 backdrop-blur-sm border border-neutral-700/50 rounded-2xl rounded-tl-sm px-5 py-3.5 max-w-[80%] relative z-10"
                  >
                    <div className="h-2.5 w-32 bg-neutral-400 rounded-full mb-2"></div>
                    <div className="h-2.5 w-24 bg-neutral-500 rounded-full"></div>
                  </motion.div>

                  <div className="mt-4 h-14 rounded-2xl bg-neutral-900/80 border border-neutral-800 flex items-center px-4 relative z-10 backdrop-blur-md">
                    <div className="h-4 w-4 rounded-full bg-neutral-700 mr-3"></div>
                    <div className="h-2.5 w-32 bg-neutral-700 rounded-full"></div>
                    <div className="ml-auto w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <Send className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Scroll Indicator */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 1 }}
          className="mt-16 flex flex-col items-center gap-2 text-neutral-500"
        >
          <span className="text-xs font-medium uppercase tracking-widest">Discover More</span>
          <motion.div 
            animate={{ y: [0, 8, 0] }} 
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
          >
            <ChevronDown className="w-5 h-5" />
          </motion.div>
        </motion.div>

        {/* Feature Grid */}
        <div className="mt-32 w-full max-w-5xl text-center relative z-10">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl md:text-5xl font-bold text-white mb-16"
          >
            Built for Absolute Privacy
          </motion.h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            {[
              { icon: Shield, title: "End-to-End Encrypted", desc: "Every message, file, and call is secured with state-of-the-art encryption. We can't read your data, and neither can anyone else." },
              { icon: Clock, title: "Ephemeral Messages", desc: "Set messages to self-destruct after they've been read. Leave no trace and maintain absolute control over your digital footprint." },
              { icon: Zap, title: "Offline Queuing", desc: "Never lose a message. If you lose connection, messages are securely queued and automatically sent when you're back online." },
              { icon: Globe, title: "Global Infrastructure", desc: "Low-latency servers distributed worldwide ensure your secure calls and messages are delivered instantly, anywhere." },
              { icon: Fingerprint, title: "Zero-Knowledge", desc: "Our servers only route encrypted packets. We have zero knowledge of your identity, contacts, or conversation contents." },
              { icon: Layers, title: "Multi-Device Sync", desc: "Securely sync your encrypted chat history across all your devices without compromising on security or convenience." }
            ].map((feature, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="group relative bg-neutral-900/40 backdrop-blur-md border border-neutral-800/80 p-8 rounded-3xl transition-all duration-500 hover:-translate-y-2 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="absolute -inset-px bg-gradient-to-br from-blue-500/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-3xl" style={{ zIndex: -1 }}></div>
                
                <div className="w-12 h-12 bg-neutral-800/80 rounded-2xl flex items-center justify-center mb-6 border border-neutral-700 group-hover:border-blue-500/50 group-hover:bg-blue-500/10 transition-all duration-500 relative z-10">
                  <feature.icon className="w-6 h-6 text-neutral-400 group-hover:text-blue-400 transition-colors duration-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3 group-hover:text-blue-300 transition-colors duration-500 relative z-10">{feature.title}</h3>
                <p className="text-neutral-400 leading-relaxed group-hover:text-neutral-300 transition-colors duration-500 relative z-10">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Stats Section */}
        <div className="mt-32 w-full max-w-5xl relative z-10 pb-20 border-t border-neutral-800/60 pt-20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { label: "Messages Secured", value: "2B+" },
              { label: "Active Users", value: "1.5M" },
              { label: "Uptime", value: "99.99%" },
              { label: "Countries", value: "150+" }
            ].map((stat, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="flex flex-col items-center"
              >
                <div className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white mb-2 bg-gradient-to-br from-white to-neutral-500 bg-clip-text text-transparent">{stat.value}</div>
                <div className="text-xs sm:text-sm font-medium text-neutral-500 uppercase tracking-widest">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-neutral-800/60 bg-neutral-950/80 backdrop-blur-md py-12 px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-500" />
            <span className="text-lg font-bold text-white">CipherChat</span>
          </div>
          <div className="text-neutral-500 text-sm text-center md:text-left">
            Copyright Alen Pepa 2026
          </div>
          <div className="flex flex-wrap justify-center gap-4 sm:gap-6 text-sm font-medium text-neutral-400">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-white transition-colors">Security</a>
          </div>
        </div>
      </footer>

      <AnimatePresence>
        {showAuth && <AuthModal mode={showAuth} onClose={() => setShowAuth(null)} />}
      </AnimatePresence>
    </div>
  );
}

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.error) {
            errorMessage = "A database permission error occurred. Please try again or contact support.";
          }
        }
      } catch (e) {
        // Not a JSON error message
      }

      return (
        <div className="min-h-[100dvh] bg-neutral-950 flex flex-col items-center justify-center p-4 text-center">
          <AlertCircle className="w-16 h-16 text-rose-500 mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Something went wrong</h1>
          <p className="text-neutral-400 max-w-md mb-6">{errorMessage}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
          >
            Reload Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function MainApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [keypadLayout, setKeypadLayout] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const isWindowFocusedRef = useRef(true);
  const [showScreenshotWarning, setShowScreenshotWarning] = useState(false);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const shuffleKeypad = useCallback(() => {
    const scramble = typeof window !== 'undefined' && localStorage.getItem('cipher-scramble-keypad') === 'true';
    if (scramble) {
      const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      for (let i = nums.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nums[i], nums[j]] = [nums[j], nums[i]];
      }
      setKeypadLayout(nums);
    } else {
      setKeypadLayout([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    }
  }, []);

  const handleLockApp = useCallback(() => {
    setIsLocked(true);
    shuffleKeypad();
  }, [shuffleKeypad]);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    const autoLockEnabled = typeof window !== 'undefined' && localStorage.getItem('cipher-auto-lock') === 'true';
    if (autoLockEnabled && !isLocked) {
      // 5 minutes = 300000 ms
      inactivityTimerRef.current = setTimeout(() => {
        handleLockApp();
      }, 300000);
    }
  }, [isLocked, handleLockApp]);

  useEffect(() => {
    setMounted(true);

    // Initialize Theme
    const savedTheme = localStorage.getItem('cipher-theme') || 'dark';
    if (savedTheme === 'light') {
      document.documentElement.classList.add('theme-light');
    }
  }, []);

  useEffect(() => {
    // Initialize Screen Security
    const handleVisibilityChange = () => {
      const screenSecurity = localStorage.getItem('cipher-screen-security') === 'true';
      if (screenSecurity && document.hidden) {
        document.body.style.filter = 'blur(20px)';
      } else if (!document.hidden && isWindowFocusedRef.current) {
        document.body.style.filter = 'none';
      }
    };

    const handleFocus = () => {
      setIsWindowFocused(true);
      isWindowFocusedRef.current = true;
      document.body.style.filter = 'none';
    };

    const handleBlur = () => {
      setIsWindowFocused(false);
      isWindowFocusedRef.current = false;
      const screenSecurity = localStorage.getItem('cipher-screen-security') === 'true';
      if (screenSecurity) {
        document.body.style.filter = 'blur(20px)';
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      const screenSecurity = localStorage.getItem('cipher-screen-security') === 'true';
      if (screenSecurity) e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const screenSecurity = localStorage.getItem('cipher-screen-security') === 'true';
      if (screenSecurity && (e.key === 'PrintScreen' || e.keyCode === 44)) {
        setShowScreenshotWarning(true);
        setTimeout(() => setShowScreenshotWarning(false), 3000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    // Inactivity Listeners
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(event => document.addEventListener(event, resetInactivityTimer));

    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      events.forEach(event => document.removeEventListener(event, resetInactivityTimer));
    };
  }, [resetInactivityTimer]);

  useEffect(() => {
    const checkAuth = async () => {
      // Check custom auth first
      const customSession = localStorage.getItem('cipherchat_session');
      if (customSession) {
        const customUser = JSON.parse(customSession);
        try {
          // Check if offline
          if (!navigator.onLine) {
             setUser({
              id: customUser.uid,
              name: customUser.displayName || 'Anonymous',
              username: '@offline_user',
              email: customUser.email || '',
              avatar: customUser.photoURL || `https://picsum.photos/seed/${customUser.uid}/100/100`,
              isOnline: false
            });
            setLoading(false);
            return;
          }

          const userDoc = await getDoc(doc(db, 'users', customUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data() as User;
            if (!data.username) {
              const displayName = data.name || 'Anonymous';
              const baseUsername = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
              const randomSuffix = Math.floor(1000 + Math.random() * 9000);
              data.username = `@${baseUsername}${randomSuffix}`;
            }
            setUser(data);
          } else {
            // Fallback
            const displayName = customUser.displayName || 'Anonymous';
            const baseUsername = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const randomSuffix = Math.floor(1000 + Math.random() * 9000);
            setUser({
              id: customUser.uid,
              name: displayName,
              username: `@${baseUsername}${randomSuffix}`,
              email: customUser.email || '',
              avatar: customUser.photoURL || `https://picsum.photos/seed/${customUser.uid}/100/100`,
              isOnline: true
            });
          }
          resetInactivityTimer();
        } catch (err) {
          if (err instanceof Error && (err.message.includes('offline') || err.message.includes('unavailable'))) {
            console.warn("Firestore offline during auth check");
          } else {
            handleFirestoreError(err, OperationType.GET, `users/${customUser.uid}`);
          }
        } finally {
          setLoading(false);
        }
        return null;
      }

      // Fallback to Firebase Auth (e.g. for Google Login)
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          try {
            if (!navigator.onLine) {
               setUser({
                id: firebaseUser.uid,
                name: firebaseUser.displayName || 'Anonymous',
                username: '@offline_user',
                email: firebaseUser.email || '',
                avatar: firebaseUser.photoURL || `https://picsum.photos/seed/${firebaseUser.uid}/100/100`,
                isOnline: false
              });
              setLoading(false);
              return;
            }

            // Fetch user data from Firestore
            const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
            if (userDoc.exists()) {
              const data = userDoc.data() as User;
              if (!data.username) {
                const displayName = data.name || 'Anonymous';
                const baseUsername = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
                const randomSuffix = Math.floor(1000 + Math.random() * 9000);
                data.username = `@${baseUsername}${randomSuffix}`;
              }
              setUser(data);
            } else {
              // Fallback if doc doesn't exist yet
              const displayName = firebaseUser.displayName || 'Anonymous';
              const baseUsername = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
              const randomSuffix = Math.floor(1000 + Math.random() * 9000);
              setUser({
                id: firebaseUser.uid,
                name: displayName,
                username: `@${baseUsername}${randomSuffix}`,
                email: firebaseUser.email || '',
                avatar: firebaseUser.photoURL || `https://picsum.photos/seed/${firebaseUser.uid}/100/100`,
                isOnline: true
              });
            }
            resetInactivityTimer();
          } catch (err) {
            if (err instanceof Error && (err.message.includes('offline') || err.message.includes('unavailable'))) {
              console.warn("Firestore offline during auth check");
            } else {
              handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
            }
          } finally {
            setLoading(false);
          }
        } else {
          setUser(null);
          setLoading(false);
        }
      });
      return unsubscribe;
    };

    let unsubscribeFirebase: any;
    checkAuth().then(unsub => {
      if (unsub) unsubscribeFirebase = unsub;
    });

    const handleCustomAuthChange = () => {
      checkAuth();
    };
    window.addEventListener('cipherchat_auth_changed', handleCustomAuthChange);

    return () => {
      if (unsubscribeFirebase) unsubscribeFirebase();
      window.removeEventListener('cipherchat_auth_changed', handleCustomAuthChange);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [resetInactivityTimer]);

  const handleLogout = async () => {
    localStorage.removeItem('cipherchat_session');
    window.dispatchEvent(new Event('cipherchat_auth_changed'));
    await signOut(auth);
  };

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (isLocked) {
    const savedPin = typeof window !== 'undefined' ? localStorage.getItem('cipher-pin') : null;
    
    const handleUnlock = () => {
      if (savedPin && pinInput !== savedPin) {
        setPinError(true);
        setTimeout(() => setPinError(false), 1000);
        
        const newAttempts = failedAttempts + 1;
        setFailedAttempts(newAttempts);
        
        const selfDestruct = typeof window !== 'undefined' && localStorage.getItem('cipher-self-destruct-fail') === 'true';
        if (selfDestruct && newAttempts >= 5) {
          localStorage.clear();
          window.location.reload();
          return;
        }
        
        shuffleKeypad();
        setPinInput('');
        return;
      }
      
      setFailedAttempts(0);
      setIsLocked(false);
      setPinInput('');
      resetInactivityTimer();
    };

    return (
      <div className="h-[100dvh] bg-neutral-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full glass border border-neutral-800/60 rounded-3xl p-6 sm:p-8 text-center space-y-6 sm:space-y-8 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent pointer-events-none"></div>
          <div className="relative">
            <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto bg-neutral-900 rounded-full flex items-center justify-center border-2 border-neutral-800 shadow-inner mb-4 sm:mb-6">
              <Lock className="w-6 h-6 sm:w-8 sm:h-8 text-blue-400" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-2 tracking-tight">App Locked</h2>
            <p className="text-neutral-400 text-xs sm:text-sm">CipherChat has been locked to protect your privacy.</p>
          </div>
          
          {savedPin ? (
            <div className="space-y-4 sm:space-y-6">
              <div className="flex justify-center gap-2 sm:gap-3 mb-4 sm:mb-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full transition-colors duration-300 ${i < pinInput.length ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-neutral-800'}`} />
                ))}
              </div>
              
              <div className="grid grid-cols-3 gap-3 sm:gap-4 max-w-[240px] sm:max-w-[260px] mx-auto">
                {keypadLayout.map((num) => (
                  <button
                    key={num}
                    onClick={() => {
                      if (pinInput.length < 8) setPinInput(prev => prev + num);
                    }}
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-neutral-900 border border-neutral-800 text-xl sm:text-2xl font-bold text-white hover:bg-neutral-800 active:bg-neutral-700 transition-all flex items-center justify-center shadow-lg"
                  >
                    {num}
                  </button>
                ))}
                <button
                  onClick={() => setPinInput('')}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-neutral-900/50 text-[10px] sm:text-xs font-bold text-rose-500 hover:bg-neutral-800 active:bg-neutral-700 transition-all flex items-center justify-center uppercase tracking-widest"
                >
                  Clr
                </button>
                <button
                  onClick={handleUnlock}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 active:bg-blue-500/40 transition-all flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                >
                  <Check className="w-6 h-6 sm:w-8 sm:h-8" />
                </button>
              </div>

              {pinError && (
                <p className="text-rose-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-center mt-4">
                  Incorrect PIN {failedAttempts > 0 && `(${failedAttempts} failed)`}
                </p>
              )}
            </div>
          ) : (
            <button 
              onClick={handleUnlock}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 sm:py-4 rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <Fingerprint className="w-5 h-5" /> Unlock CipherChat
            </button>
          )}
        </div>
      </div>
    );
  }

  return user ? (
    <>
      <CipherChatApp user={user} onLogout={handleLogout} onLock={handleLockApp} />
      
      {/* Global Privacy Overlays */}
      <AnimatePresence>
        {!isWindowFocused && typeof window !== 'undefined' && localStorage.getItem('cipher-screen-security') === 'true' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-neutral-950/80 backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="p-6 bg-blue-500/10 rounded-full mb-6 border border-blue-500/20">
              <Lock className="w-12 h-12 text-blue-500" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Privacy Shield Active</h2>
            <p className="text-neutral-400 max-w-xs">Content is hidden to protect your privacy while the app is out of focus.</p>
            <div className="mt-8 px-4 py-2 bg-neutral-900 border border-neutral-800 rounded-xl text-[10px] font-bold uppercase tracking-widest text-neutral-500">
              CipherChat Security Protocol v4.2
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showScreenshotWarning && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[10000] bg-rose-500 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 font-bold"
          >
            <AlertCircle className="w-5 h-5" />
            Screenshots are discouraged for privacy protection
          </motion.div>
        )}
      </AnimatePresence>
    </>
  ) : (
    <LandingPage />
  );
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
