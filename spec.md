Spec.md 


spec.md — Real-Time AI Voice Assistant
1. Objective
Build a fast, friendly, browser-based voice assistant with MERN. Users speak, see a live text response, hear the answer, interrupt the bot by speaking, then say “continue” to resume the interrupted answer. Target Chrome desktop first; English first; single-user sessions.
2. Technology (free-tier demo)
Layer	Choice
UI	React + Vite; Web Audio API, microphone/VAD, browser speechSynthesis (free TTS)
API	Node.js + Express (ES modules) + WebSocket (ws) for turn events and streamed text
Database	MongoDB + Mongoose: chat history, conversation state, playback checkpoints
Speech-to-text	Groq whisper-large-v3-turbo: send each finished short utterance; file-based, not true live-streaming STT
AI	Groq openai/gpt-oss-20b, streamed tokens; short conversational answers
Future TTS	Groq Orpheus (optional, English only), behind provider adapter


Free API quotas are rate-limited; no assumption of unlimited free usage. Store API credentials on server only. Speech recognition in the browser is optional, not the only STT path (inconsistent browser support).
3. Functional requirements (must build)
4. Voice + text: Start/stop microphone, typed-text fallback, live user transcript, live assistant text, speaking animation, mute and clear buttons.
5. Fast reply: VAD detects end of speech (~400–700 ms configurable); send audio to STT, then stream LLM text. Speak completed small sentences as soon as ready, without waiting for the full answer.
6. Barge-in (highest priority): Microphone/VAD stays on during AI playback. When the user speaks, immediately stop TTS, clear pending audio, cancel old LLM generation, and listen to the new request. Use echo cancellation + noise suppression to avoid the bot detecting its own speech.
7. Resume: If interrupted, save generated text and the last confirmed spoken sentence/chunk. On the standalone commands “continue” / “continue last response”, speak remaining unspoken text. If the generation was canceled early, request a continuation using the saved answer prefix and chat context. Do not restart the whole answer; word-perfect resumption is not guaranteed.
8. Voice commands: stop, continue, repeat that, mute, unmute, clear chat. Only classify them as commands when spoken as commands, not when embedded in an ordinary question.
9. Context: Remember recent turns in the session. Refresh restores the transcript and any paused response. Display Listening / Transcribing / Thinking / Speaking / Paused / Error states.
10. Architecture
Mic → VAD → short audio upload → Groq STT → Groq streaming LLM → WebSocket text chunks → browser TTS + transcript
Use a deterministic state machine:
IDLE → LISTENING → TRANSCRIBING → THINKING → SPEAKING → LISTENING;
SPEAKING → INTERRUPTED → LISTENING; continue → SPEAKING/THINKING.
Each turn requires a turnId, increasing seq, and AbortController. On interruption, reject all late events from canceled turns. Store pausedResponse: {sourceTurnId, generatedText, lastSpokenSegmentIndex, generationComplete}. Never mark queued audio as spoken until playback confirms it.
Minimal module structure:
client/src/
  components/{VoiceControls,Chat,Status}.jsx
  hooks/{useVoiceSession,useMicrophone}.js
  audio/{vad,ttsPlayer,playbackCursor}.js
  services/{socketClient,apiClient}.js
server/src/
  routes/{sessions,transcriptions}.js
  ws/voiceGateway.js
  modules/voice/{turnManager,commandParser,sessionController}.js
  providers/{groqStt,groqLlm}.js
  models/{Session,Message}.js
  lib/{config,logger,errors}.js
  tests/
All JavaScript must use ES import/export. Keep UI, provider adapters, business state, and persistence separate.
5. API & nonfunctional requirements
- WebSocket input: start_turn, interrupt, continue, stop; output: status, user_transcript, assistant_delta, assistant_segment, turn_complete, error.
- REST: POST /api/transcriptions (audio), GET /api/sessions/:id, GET /health.
- Performance targets: audible stop ≤250 ms p95 from local speech detection; first audible AI sentence ≤2 s p50 after user finishes on stable network. Measure; don't promise universally.
- Safety/reliability: HTTPS, mic permission UI, API keys server-side, session isolation, origin validation, audio size/duration limits, rate limits, timeouts, handled 429, safe reconnect, no stale playback, no raw-audio persistence.
- Telemetry: STT latency, LLM first token, TTS start, end-to-end time, interruptions, errors. Test speaker vs headset (speaker echo can cause false interruptions).
6. Completion criteria
- 10 spoken questions return audible answers with correct visible transcripts.
- 10 mid-answer interruptions stop audio quickly; zero late chunks play.
- “Continue” resumes the closest saved spoken segment, and a new question replaces the previous turn safely.
- Repeat/stop/clear/refresh work. Test silence, noisy room, mic denied, STT failure, provider 429, and WebSocket disconnect.
- Unit tests for command parser, state transitions, cancellation and resume cursor; 20-run latency report.
- Deliver GitHub repo, .env.example, setup README, tests, and working demo video.
Intern split: A — React UI, VAD, browser audio/interrupts. B — Express/WebSocket, Groq integrations, MongoDB. Both — state machine, integration tests, latency and demo.
7. Ten stretch improvements
8. True streaming STT; 2. Better acoustic echo control; 3. Word-level playback checkpoints; 4. Streaming neural TTS; 5. Hindi/Marathi support; 6. Long-term user memory; 7. Wake word; 8. Network-quality adaptation; 9. Offline fallback; 10. Retention/deletion controls.