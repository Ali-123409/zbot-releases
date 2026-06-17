# Zbot

> Private multi-device WhatsApp bot fleet for single-admin use. Built on FTGM's proven architecture, extended with Firebase-controlled admin coordination layer.

## 📦 Latest Release

Download the latest APK from the [Releases page](https://github.com/Ali-123409/zbot-releases/releases).

**Direct download (v1.0.0):** [Zbot-v1.0.0-debug.apk](https://github.com/Ali-123409/zbot-releases/releases/download/v1.0.0/Zbot-v1.0.0-debug.apk)

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ZBOT FLEET (your phones)                      │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Phone 1         │  │ Phone 2         │  │ Phone 3         │  │
│  │ Zbot APK        │  │ Zbot APK        │  │ Zbot APK        │  │
│  │                 │  │                 │  │                 │  │
│  │ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌─────────────┐ │  │
│  │ │ Public UI   │ │  │ │ Public UI   │ │  │ │ Public UI   │ │  │
│  │ │ (pair, etc.)│ │  │ │ (pair, etc.)│ │  │ │ (pair, etc.)│ │  │
│  │ └─────────────┘ │  │ └─────────────┘ │  │ └─────────────┘ │  │
│  │                 │  │                 │  │                 │  │
│  │ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌─────────────┐ │  │
│  │ │ HIDDEN      │ │  │ │ HIDDEN      │ │  │ │ HIDDEN      │ │  │
│  │ │ ADMIN PANEL │ │  │ │ ADMIN PANEL │ │  │ │ ADMIN PANEL │ │  │
│  │ │ (7-tap +    │ │  │ │ (7-tap +    │ │  │ │ (7-tap +    │ │  │
│  │ │  PIN 4390)  │ │  │ │  PIN 4390)  │ │  │ │  PIN 4390)  │ │  │
│  │ └─────────────┘ │  │ └─────────────┘ │  │ └─────────────┘ │  │
│  │                 │  │                 │  │                 │  │
│  │ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌─────────────┐ │  │
│  │ │ BotService  │ │  │ │ BotService  │ │  │ │ BotService  │ │  │
│  │ │ +Node.js    │ │  │ │ +Node.js    │ │  │ │ +Node.js    │ │  │
│  │ │ +Baileys    │ │  │ │ +Baileys    │ │  │ │ +Baileys    │ │  │
│  │ │ +Anon Auth  │ │  │ │ +Anon Auth  │ │  │ │ +Anon Auth  │ │  │
│  │ │ +FS listen  │◄┼──┼─┤ +FS listen  │◄┼──┼─┤ +FS listen  │ │  │
│  │ └─────────────┘ │  │ └─────────────┘ │  │ └─────────────┘ │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│           │                      │                    │         │
└───────────┼──────────────────────┼────────────────────┼─────────┘
            │                      │                    │
            │  Firebase (Spark plan — FREE forever)
            │  • Firestore (real-time listeners)
            │  • Realtime DB (live status)
            │  • Auth (Anonymous for bots, Email/Pass for admin)
            │  • NO Cloud Functions
            │  • NO FCM
            │  • NO Storage
            └──────────────────────┼────────────────────┘
                                   │
                                   ▼
                        Admin opens APK on Phone 1
                        → 7-tap on "About → Version"
                        → Enter PIN: 4390
                        → Admin email/password login
                        → Admin panel:
                          • Numbers (approve/revoke)
                          • Broadcast (send msg from all #s)
                          • Report Scammer (from all #s)
                          • Scammer DB (view/clear)
                          • Command History (live results)
                          • Per-bot config editor
```

## 📁 Project Structure

```
zbot/
├── bot/                    ← Phase 2: Node.js bot bundle (TypeScript)
│   ├── src/
│   │   ├── index.ts        ← entry point
│   │   ├── socket.ts       ← Baileys WhatsApp socket
│   │   ├── firebase/       ← Firebase integration (8 files)
│   │   ├── http/server.ts  ← Express on 127.0.0.1:3001
│   │   ├── commands/       ← 30 FTGM-style commands
│   │   └── admin/          ← 5 admin command handlers
│   ├── esbuild.config.ts   ← bundler config
│   ├── encrypt.ts          ← AES-256-GCM encryptor
│   └── package.json
│
├── android-bot/            ← Phase 3: Android APK (Kotlin + Compose)
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml
│   │   │   ├── assets/bot.bundle.enc          ← encrypted bot bundle
│   │   │   ├── jniLibs/arm64-v8a/             ← native libs (NOT in repo — see README)
│   │   │   ├── java/com/zbot/wa/
│   │   │   │   ├── ZbotApp.kt                 ← Application + Hilt
│   │   │   │   ├── BotService.kt              ← foreground service, launches Node
│   │   │   │   ├── Crypto.kt                  ← AES-256-GCM decryptor
│   │   │   │   ├── BootReceiver.kt
│   │   │   │   ├── KeepAliveWorker.kt
│   │   │   │   ├── data/                      ← AuthManager, BotRepository, AdminPrefs
│   │   │   │   ├── di/AppModule.kt
│   │   │   │   └── ui/
│   │   │   │       ├── MainActivity.kt
│   │   │   │       ├── nav/AppNav.kt
│   │   │   │       ├── theme/
│   │   │   │       └── screens/               ← Compose UI (12 screens)
│   │   │   └── res/
│   │   ├── build.gradle.kts
│   │   ├── google-services.json               ← (you must provide)
│   │   └── proguard-rules.pro
│   ├── build.gradle.kts
│   ├── settings.gradle.kts
│   ├── gradle.properties
│   └── gradlew
│
├── firebase/               ← Firebase security rules
│   ├── firestore.rules
│   ├── database.rules.json
│   ├── firestore.indexes.json
│   └── firebase.json
│
└── README.md               ← (this file)
```

## 🚀 Build Instructions

### Prerequisites

- Android Studio (Hedgehog or newer)
- JDK 17+
- Android SDK 34 + build-tools 34.0.0
- Native libs (libnode.so etc.) — extracted from [FTGM.Bot.apk](https://github.com/Ali-123409/apkrepo/releases/download/All/FTGM.Bot.apk)

### Step 1: Set up native libs

```bash
# Download FTGM APK
wget https://github.com/Ali-123409/apkrepo/releases/download/All/FTGM.Bot.apk

# Extract native libs
unzip FTGM.Bot.apk "lib/arm64-v8a/*" -d ftgm-extract

# Copy to project
mkdir -p android-bot/app/src/main/jniLibs/arm64-v8a
cp ftgm-extract/lib/arm64-v8a/*.so android-bot/app/src/main/jniLibs/arm64-v8a/
```

### Step 2: Provide google-services.json

1. Go to Firebase Console → your project → Project Settings → Your apps
2. Add an Android app with package name `com.zbot.wa`
3. Download `google-services.json`
4. Place at `android-bot/app/google-services.json`

### Step 3: Build APK

```bash
cd android-bot
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

Or open in Android Studio → Build → Generate Signed Bundle/APK.

### Step 4: Build bot bundle (if modifying TypeScript)

```bash
cd bot
npm install
npm run bundle   # builds + encrypts → dist/bot.bundle.enc
cp dist/bot.bundle.enc ../android-bot/app/src/main/assets/
```

## 🔐 Configuration

All config is hardcoded in `android-bot/app/build.gradle.kts` (BuildConfig):

```kotlin
buildConfigField("String", "BUNDLE_PASSPHRASE", "\"Zbot2026SecureKey!@#xBot\"")
buildConfigField("String", "ADMIN_PANEL_PIN", "\"4390\"")
buildConfigField("String", "ADMIN_UID", "\"mBJdBiyAQ1Xsy301Ndu5teFnjUr1\"")
```

And in `bot/src/firebase/config.ts`:

```typescript
export const firebaseConfig = {
  apiKey: 'AIzaSyBktNHjRK5_RI4trEZastvKR7dDPHv0O3Y',
  authDomain: 'zbot-e39f8.firebaseapp.com',
  databaseURL: 'https://zbot-e39f8-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'zbot-e39f8',
  storageBucket: 'zbot-e39f8.firebasestorage.app',
  messagingSenderId: '569996077528',
  appId: '1:569996077528:web:4173b9701e77304dfaeaad',
};
```

## 🎯 Features

### Bot commands (30)

| Category | Commands |
|---|---|
| General | menu, ping, alive, getjid |
| Utility | vv, sticker, tovoice, dp, save |
| Downloaders | tiktok, instagram, facebook, youtube |
| Lookup | simdata, truecaller |
| Privacy | antidelete, antiedit, autoseen, autostatusreact, anticall, alwaysonline, mode |
| Automation | autoreact, autoreply |
| Admin | block, setpp, kickall, antitagall, antilink, welcome, goodbye |

### Admin fleet commands (5 — via Firestore, triggered from admin panel)

- `broadcast` — send msg from this number to target
- `report` — report scammer from this number
- `disconnect` — wipe this number's session
- `block` — block a JID
- `config_update` — apply new config

### Anti-pattern measures

- Random delays (3-15s broadcast, 30-90s report)
- Per-device cap: 1 report per scammer per phone (ever)
- Always-online presence (60s interval)
- Auto-reconnect with exponential backoff

## 🛡️ Security

- AES-256-GCM encrypted bot bundle (60-byte overhead)
- Local HTTP bound to 127.0.0.1 only (not 0.0.0.0)
- Anonymous Auth for bots (UID = deviceId)
- Admin UID whitelisted in Firestore rules
- Per-device approval required before commands flow
- Auto-revocation: admin marks `status: 'revoked'` → bot self-destructs

## 📊 Firebase Project

- **Project ID:** zbot-e39f8
- **Plan:** Spark (free, no credit card)
- **Admin email:** accu9095@gmail.com
- **Admin UID:** mBJdBiyAQ1Xsy301Ndu5teFnjUr1

## ⚠️ Disclaimer

- WhatsApp ToS prohibits unofficial clients — your numbers can get banned
- Reusing FTGM's Cloudflare Workers (sim-api.fakcloud.tech, faisal-ali-truecaller.ftgmhacks.workers.dev) means Rana Faisal sees every lookup you make
- Use burner SIMs, not personal numbers
- Mass-reporting is coordinated abuse — use only against confirmed scammers

## 📝 License

Private project. Not for redistribution.

## 🤝 Credits

- Architecture inspired by [FTGM Bot](https://github.com/Ali-123409/apkrepo) (Rana Faisal)
- WhatsApp protocol: [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)
- Node.js on Android: [nodejs-mobile](https://github.com/staltz/nodejs-mobile)
