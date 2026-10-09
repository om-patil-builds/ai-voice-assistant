AI-Voice-Assistant/
│
├── client/                  # React + Vite
│   └── src/
│       ├── components/
│       │   ├── VoiceControls.jsx
│       │   ├── Chat.jsx
│       │   └── Status.jsx
│       ├── hooks/
│       │   ├── useVoiceSession.js
│       │   └── useMicrophone.js
│       ├── audio/
│       │   ├── vad.js
│       │   ├── ttsPlayer.js
│       │   └── playbackCursor.js
│       ├── services/
│       │   ├── socketClient.js
│       │   └── apiClient.js
│       └── App.jsx
│
├── server/                  # Node.js + Express
│   └── src/
│       ├── routes/
│       │   ├── sessions.js
│       │   └── transcriptions.js
│       ├── ws/
│       │   └── voiceGateway.js
│       ├── modules/voice/
│       │   ├── turnManager.js
│       │   ├── commandParser.js
│       │   └── sessionController.js
│       ├── providers/
│       │   ├── groqStt.js
│       │   └── groqLlm.js
│       ├── models/
│       │   ├── Session.js
│       │   └── Message.js
│       ├── lib/
│       │   ├── config.js
│       │   ├── logger.js
│       │   └── errors.js
│       ├── tests/
│       └── server.js
│
├── .gitignore
├── README.md
└── spec.md