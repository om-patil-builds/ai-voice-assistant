import mongoose from 'mongoose';

const PausedSegmentSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const PausedResponseSchema = new mongoose.Schema(
  {
    sourceTurnId: { type: String, default: null },
    generatedText: { type: String, default: '' },
    lastSpokenSegmentIndex: { type: Number, default: -1 },
    generationComplete: { type: Boolean, default: false },
    segments: [PausedSegmentSchema],
    timestamp: { type: Number, default: Date.now },
  },
  { _id: false }
);

const SessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['IDLE', 'LISTENING', 'TRANSCRIBING', 'THINKING', 'SPEAKING', 'INTERRUPTED', 'PAUSED', 'ERROR'],
      default: 'IDLE',
    },
    pausedResponse: {
      type: PausedResponseSchema,
      default: null,
    },
    metadata: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
  },
  {
    timestamps: true,
  }
);

export const Session = mongoose.models.Session || mongoose.model('Session', SessionSchema);
