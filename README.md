# CipherChat

CipherChat is a highly secure, privacy-first real-time messaging application designed to keep your communications safe from prying eyes. It features end-to-end encryption, advanced local security measures, and ephemeral messaging.

## 🚀 Core Features

### 🔐 Security & Privacy
* **End-to-End Encryption (E2EE):** All messages are encrypted using PGP/RSA cryptographic protocols before they leave your device.
* **App Lock & PIN Protection:** Secure the app with a custom PIN. Includes a "Scramble Keypad" option to prevent shoulder surfing.
* **Self-Destruct Mode:** Automatically wipes all local data, keys, and sessions after 5 consecutive failed PIN attempts.
* **Anti-Screenshot Shield:** Detects and warns about screenshot attempts, and overlays a privacy shield when the app loses focus.
* **Incognito Keyboard:** Disables autocomplete, autocorrect, and spellcheck to prevent keyboard logging (where supported).
* **Anti-Censorship & Proxy Support:** Built-in configuration options for VPN/Proxy routing.

### 💬 Messaging
* **Real-Time Chat:** Lightning-fast message delivery powered by Firebase Firestore.
* **Ephemeral Messages (TTL):** Set messages to automatically self-destruct after a specific time-to-live (TTL) once viewed.
* **Rich Media:** Support for sending GIFs (via Giphy integration) and standard media.
* **Read Receipts & Typing Indicators:** See when your messages are read and when the other person is typing (can be toggled off for privacy).
* **AI Assistant:** Built-in AI chat assistant for quick queries and help.

### 📞 Audio & Video Calls
* **Secure Calling:** Peer-to-peer audio and video calling capabilities.
* **Quality Control:** Adjustable video quality settings (High, Medium, Low) to save bandwidth.

### 👤 User & Account Management
* **Flexible Authentication:** Sign in anonymously, use Google Login, or use the custom local Email/Password authentication system.
* **Public/Private Profiles:** Share a public `@username` while keeping your sensitive data completely private.
* **Data Export:** Download and backup your entire CipherChat database and keys securely.
* **Complete Account Deletion:** A "nuclear" delete option that permanently wipes your identity, public profile, private data, and authentication records from all servers and local storage.

### 🎨 UI/UX
* **Dark & Light Themes:** Fully customizable interface themes.
* **Responsive Design:** Optimized for both desktop and mobile experiences.
* **Fluid Animations:** Smooth transitions and interactions powered by Framer Motion.

## 🛠️ Technology Stack
* **Frontend:** Next.js, React, Tailwind CSS, Framer Motion, Lucide Icons.
* **Backend/Database:** Firebase Firestore (Real-time database), Firebase Auth.
* **Cryptography:** OpenPGP.js, Web Crypto API.
* **Icons & UI:** Radix UI components, custom glassmorphism design system.

## 🛡️ Architecture Notes
CipherChat utilizes a hybrid authentication approach, allowing users to bypass standard cloud authentication in favor of local, session-based custom auth for heightened anonymity. The Firestore security rules are strictly configured to ensure users can only ever read or write their own private data, while public profiles are strictly validated to prevent data pollution.
