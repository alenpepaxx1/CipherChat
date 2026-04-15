'use client';

import React, { useState, useEffect } from 'react';
import { Message, Chat, User } from '../types';
import * as Crypto from '../lib/crypto';

export default function DecryptedText({ 
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
