
/**
 * Advanced End-to-End Encryption Utility using Web Crypto API
 * Implements ECDH for key exchange and AES-GCM for message encryption.
 */

export function isCryptoAvailable() {
  return typeof window !== 'undefined' && !!window.crypto && !!window.crypto.subtle;
}

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await window.crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveKey", "deriveBits"]
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("spki", key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importPublicKey(base64Key: string): Promise<CryptoKey> {
  const binaryKey = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
  return await window.crypto.subtle.importKey(
    "spki",
    binaryKey,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    []
  );
}

export async function deriveSecretKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  return await window.crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: publicKey,
    },
    privateKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptMessage(text: string, secretKey: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    secretKey,
    encoded
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
  };
}

export async function decryptMessage(ciphertext: string, iv: string, secretKey: CryptoKey): Promise<string> {
  const binaryCiphertext = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const binaryIv = Uint8Array.from(atob(iv), c => c.charCodeAt(0));

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: binaryIv,
    },
    secretKey,
    binaryCiphertext
  );

  return new TextDecoder().decode(decrypted);
}

// Helper to store/retrieve private key from IndexedDB (more secure than localStorage)
// For this applet, we'll use a simplified version or localStorage for demonstration if needed, 
// but IndexedDB is preferred for CryptoKeys.

const DB_NAME = "CipherChatCrypto";
const STORE_NAME = "keys";

export async function savePrivateKey(key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(key, "privateKey");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}

export async function getPrivateKey(): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE_NAME, "readonly");
      const getReq = tx.objectStore(STORE_NAME).get("privateKey");
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => reject(getReq.error);
    };
    request.onerror = () => reject(request.error);
  });
}
