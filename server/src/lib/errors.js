/**
 * Custom Error classes for the Voice Assistant
 */

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation error') {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded. Please wait a moment before trying again.') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class STTError extends AppError {
  constructor(message = 'Speech-to-text transcription failed', originalError = null) {
    super(message, 502, 'STT_ERROR');
    if (originalError) {
      this.cause = originalError;
    }
  }
}

export class LLMError extends AppError {
  constructor(message = 'Language model generation failed', originalError = null) {
    super(message, 502, 'LLM_ERROR');
    if (originalError) {
      this.cause = originalError;
    }
  }
}
