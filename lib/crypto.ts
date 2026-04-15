
const DB_NAME = 'CipherChatCrypto';
const STORE_NAME = 'keys';

async function getDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePrivateKey(privateKey: string, password?: string) {
  const db = await getDb();
  // In a real app, you would encrypt the privateKey with the password using Web Crypto API
  // For now, we store it in IndexedDB which is more secure than localStorage
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(privateKey, 'pgpPrivateKey');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getPrivateKey(): Promise<string | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get('pgpPrivateKey');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export function isCryptoAvailable() {
  return typeof window !== 'undefined' && !!window.crypto && !!window.crypto.subtle;
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importPublicKey(pem: string): Promise<CryptoKey> {
  const binaryDerString = atob(pem);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }
  return await window.crypto.subtle.importKey(
    'spki',
    binaryDer,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

export async function generateKeyPair() {
  if (!isCryptoAvailable()) {
    throw new Error('Web Crypto API is not available. Please ensure you are using a secure context (HTTPS or localhost).');
  }
  return await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
}

export async function deriveSecretKey(privateKey: CryptoKey, publicKey: CryptoKey) {
  return await window.crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(text: string, secretKey: CryptoKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    secretKey,
    encoded
  );
  return { ciphertext, iv };
}

export async function decryptMessage(ciphertext: ArrayBuffer, iv: Uint8Array, secretKey: CryptoKey) {
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    secretKey,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}
