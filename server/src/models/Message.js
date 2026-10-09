import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
      index: true,
    },
    turnId: {
      type: String,
      required: true,
      index: true,
    },
    sender: {
      type: String,
      enum: ['user', 'assistant', 'system'],
      required: true,
    },
    text: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['streaming', 'completed', 'interrupted', 'resumed', 'error'],
      default: 'completed',
    },
    lastSpokenSegmentIndex: {
      type: Number,
      default: -1,
    },
    timestamp: {
      type: Number,
      default: () => Date.now(),
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for quick ordered retrieval per session
MessageSchema.index({ sessionId: 1, timestamp: 1 });

export const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);
