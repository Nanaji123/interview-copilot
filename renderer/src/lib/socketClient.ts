import { io, Socket } from "socket.io-client";

export type AudioSource = "screen" | "microphone";

export interface TranscriptResult {
  sessionId: string;
  source: AudioSource;
  text: string; // transcript text
  timestamp: string; // ISO string
  sequenceNumber: number; // monotonic per session
  is_final: boolean; // Deepgram final vs interim
}

/** Where an answer was triggered from — drives how it's labelled in the UI. */
export type AnswerSource = "transcript" | "manual" | "screen";

export interface AIAnswer {
  sessionId: string;
  /** The question this answer responds to */
  question?: string;
  source?: AnswerSource;
  answer: string;
  timestamp: string;
}

export interface AIAnswerChunk {
  sessionId: string;
  chunk: string;
  timestamp: string;
}

export interface AIAnswerStart {
  sessionId: string;
  /** Shown above the answer while it streams in */
  question?: string;
  source?: AnswerSource;
  timestamp: string;
}

export interface TranscriptSkipped {
  sessionId: string;
  text: string;
  timestamp: string;
}

/** Emitted each metered minute with the user's remaining credit balance. */
export interface CreditsUpdate {
  sessionId: string;
  balance: number;
}

/** Emitted when the balance crosses a low threshold (5, 2, 1 credits). */
export interface CreditsWarning {
  sessionId: string;
  balance: number;
  message: string;
}

/**
 * Emitted when the server ends the session on its own — currently only when
 * credits run out. The session is already ended server-side, so the client
 * must tear down locally and must NOT call /end again.
 */
export interface SessionTerminated {
  sessionId: string;
  reason: "INSUFFICIENT_CREDITS" | string;
  message: string;
  balance: number;
}

export interface SocketClientOptions {
  baseUrl: string;
  sessionId: string;
  userId: string;
  stream?: MediaStream;
  audioSource?: AudioSource;
  language?: string; // Deepgram language code (e.g., 'en-US')
  onTranscript?: (result: TranscriptResult) => void;
  onAnswer?: (event: AIAnswer) => void;
  onAnswerStart?: (event: AIAnswerStart) => void;
  onAnswerChunk?: (event: AIAnswerChunk) => void;
  onConnectionStatus?: (status: any) => void;
  onStreamStatus?: (status: any) => void;
  onReconnectionAttempt?: (attempt: number, maxAttempts: number) => void;
  onReconnectionSuccess?: () => void;
  onTranscriptSkipped?: (event: TranscriptSkipped) => void;
  onCreditsUpdate?: (event: CreditsUpdate) => void;
  onCreditsWarning?: (event: CreditsWarning) => void;
  onSessionTerminated?: (event: SessionTerminated) => void;
  onError?: (err: any) => void;
}

export class InterviewSocketClient {
  private socket: Socket | null = null;
  private sequenceNumber = 0;
  private mediaRecorder: MediaRecorder | null = null;
  private mediaRecorders: Record<string, MediaRecorder> = {};

  constructor(private opts: SocketClientOptions) {}

  connect() {
    if (this.socket) return;
    console.log("Connecting to socket with baseUrl:", this.opts.baseUrl);

    this.socket = io(`${this.opts.baseUrl}/copilot`, {
      transports: ["websocket"],
    });

    this.socket.on("connect", () => {
      // console.log("🔌 Connected to copilot namespace");

      // Join the session
      this.socket?.emit("join_session", {
        sessionId: this.opts.sessionId,
        userId: this.opts.userId,
      });

      // Start audio stream
      // this.socket?.emit("audio_stream_start", {
      //   sessionId: this.opts.sessionId,
      // });
    });

    this.socket.on("connection_status", (data) => {
      this.opts.onConnectionStatus?.(data);
    });

    this.socket.on("audio_stream_status", (data) => {
      // Handle reconnection status updates
      if (data.status === "reconnecting" && data.reconnectionAttempt) {
        this.opts.onReconnectionAttempt?.(
          data.reconnectionAttempt,
          data.maxReconnectionAttempts || 5
        );
      } else if (data.status === "active" && data.reconnected) {
        this.opts.onReconnectionSuccess?.();
      }

      this.opts.onStreamStatus?.(data);
    });

    this.socket.on("transcription_result", (data: TranscriptResult) => {
      // console.log("📝 Transcription result received:", data);
      this.opts.onTranscript?.(data);
    });

    this.socket.on("audio_processing_error", (err) => {
      // console.error("❌ Audio processing error:", err);
      this.opts.onError?.(err);
    });

    this.socket.on("transcription_metadata", (data) => {
      // console.log("📊 Transcription metadata:", data);
    });

    this.socket.on("audio_chunk_received", (data) => {
      // console.log("✅ Audio chunk acknowledged:", data);
    });

    this.socket.on("ai_answer_start", (data: AIAnswerStart) => {
      // console.log(" AI Answer streaming started:", data);
      this.opts.onAnswerStart?.(data);
    });

    this.socket.on("ai_answer_chunk", (data: AIAnswerChunk) => {
      // console.log("📝 AI Answer chunk:", data.chunk);
      this.opts.onAnswerChunk?.(data);
    });

    this.socket.on("ai_answer", (data: AIAnswer) => {
      // console.log("💡 AI Final Answer:", data);
      this.opts.onAnswer?.(data);
    });

    this.socket.on("disconnect", () => {
      // console.log("🔌 Disconnected from interview namespace");
    });

    this.socket.on("transcript_skipped", (data: TranscriptSkipped) => {
      this.opts.onTranscriptSkipped?.(data);
    });

    // ─── Credit metering ─────────────────────────────────────────
    this.socket.on("credits_update", (data: CreditsUpdate) => {
      this.opts.onCreditsUpdate?.(data);
    });

    this.socket.on("credits_warning", (data: CreditsWarning) => {
      console.warn(`[PathMaker4u] ${data.message}`);
      this.opts.onCreditsWarning?.(data);
    });

    this.socket.on("session_terminated", (data: SessionTerminated) => {
      console.warn(`[PathMaker4u] Session terminated: ${data.reason}`);
      this.opts.onSessionTerminated?.(data);
    });
  }

  sendTranscript(text: string, isFinal: boolean, language?: string) {
    if (!this.socket) return;
    this.socket.emit("transcript_final", {
      sessionId: this.opts.sessionId,
      text,
      isFinal,
      language,
      timestamp: new Date().toISOString(),
    });
  }

  sendManualQuestion(question: string, language?: string) {
    if (!this.socket) return;
    this.socket.emit("manual_question", {
      sessionId: this.opts.sessionId,
      question,
      language,
    });
  }

  /**
   * Fastest path: emit binary image data over socket.io.
   * Server should listen for 'screen_capture_binary' and accept binary payload as second arg.
   * We emit metadata first (object) and the raw ArrayBuffer/Uint8Array as second argument.
   */
  async sendScreenCapture(blob: Blob) {
    if (!this.socket) return;
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    this.socket.emit("screen_capture", {
      sessionId: this.opts.sessionId,
      mimeType: blob.type || "image/png",
      uint8Array, // binary payload as second argument
    });
  }

  setAnswerMode(mode: "auto" | "normal") {
    if (!this.socket) return;
    this.socket.emit("set_answer_mode", {
      sessionId: this.opts.sessionId,
      mode,
    });
  }

  requestAnswer(text: string, language?: string) {
    if (!this.socket) return;
    this.socket.emit("request_answer", {
      sessionId: this.opts.sessionId,
      text,
      language,
    });
  }

  disconnect() {
    this.socket?.emit("leave_session", {
      sessionId: this.opts.sessionId,
      userId: this.opts.userId,
    });
    this.socket?.disconnect();
    this.socket = null;
  }
}
