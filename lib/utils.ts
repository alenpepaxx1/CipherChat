import React from 'react';
import { FileText, Music, Film, ImageIcon, File as FileIcon } from 'lucide-react';

export const getFileIconComponent = (type: string, className: string) => {
  if (type.startsWith('image/')) return React.createElement(ImageIcon, { className });
  if (type.startsWith('video/')) return React.createElement(Film, { className });
  if (type.startsWith('audio/')) return React.createElement(Music, { className });
  if (type.includes('pdf')) return React.createElement(FileText, { className });
  return React.createElement(FileIcon, { className });
};

export const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};
