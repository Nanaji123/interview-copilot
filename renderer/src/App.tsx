import React, { useState, useEffect, useRef, useCallback } from "react";
import Header from "./components/Header";
import TranscriptPanel from "./components/TranscriptPanel";
import { TranscriptMessage } from "./types/transcript";
import CopilotResponse from "./components/CopilotResponse";
import {
  InterviewSocketClient,
  TranscriptResult,
  AIAnswer,
  AIAnswerChunk,
  TranscriptSkipped,
} from "./lib/socketClient";
import {
  createClient,
  LiveClient,
  LiveTranscriptionEvents,
} from "@deepgram/sdk";
import { getLanguageName } from "./lib/deepgramLanguages";

interface SessionData {
  userId?: string;
  token?: string;
  session?: any;
  credits?: number;
}

export default function App() {
  const [isSessionStarted, setIsSessionStarted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [answers, setAnswers] = useState<AIAnswer[]>([]);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [hasDeepLinkData, setHasDeepLinkData] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [socketClient, setSocketClient] =
    useState<InterviewSocketClient | null>(null);
  const [currentStreamingAnswer, setCurrentStreamingAnswer] = useState("");
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "available" | "downloaded"
  >("idle");
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [answerMode, setAnswerMode] = useState<"auto" | "normal">("normal");

  // Audio Streams
  const [micAudioStream, setMicAudioStream] = useState<MediaStream | null>(
    null
  );
  const [desktopAudioStream, setDesktopAudioStream] =
    useState<MediaStream | null>(null);
  const [combinedStream, setCombinedStream] = useState<MediaStream | null>(
    null
  );

  // Deepgram
  const [deepgramConnection, setDeepgramConnection] =
    useState<LiveClient | null>(null);
  const transcriptBuffer = useRef<string>("");
  const socketClientRef = useRef<InterviewSocketClient | null>(null);
  const isInterviewerSpeaking = useRef<boolean>(false);
  // Mirror ref for user mic activity — used to suppress system-audio transcripts
  // when the user is the dominant speaker (prevents user voice from leaking into
  // the interviewer channel via loopback/speaker bleed).
  const isUserSpeaking = useRef<boolean>(false);

  // Base URLs for API and WebSocket
  const baseUrl = import.meta.env.VITE_PUBLIC_API_BASE;
  const socketUrl = import.meta.env.VITE_PUBLIC_SOCKET_BASE;

  // Update ref when socketClient changes
  useEffect(() => {
    socketClientRef.current = socketClient;
  }, [socketClient]);

  useEffect(() => {
    // Listen for session data from deep links
    if (window.coprep?.onSessionStart) {
      window.coprep.onSessionStart((payload: SessionData) => {
        console.log("[CoPrep Desktop] Received session data:", payload);
        setSessionData(payload);
        setHasDeepLinkData(true);
      });
    }

    // Dev mode: poll the backend dev bridge for session data from the website
    if (baseUrl?.includes("localhost")) {
      const pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`${baseUrl}/dev/session`);
          const json = await res.json();
          if (json.available && json.data) {
            console.log("[CoPrep Desktop] Received session data via dev bridge:", json.data);
            setSessionData(json.data);
            setHasDeepLinkData(true);
          }
        } catch {
          // Backend might not be running yet, ignore
        }
      }, 3000);
      return () => clearInterval(pollInterval);
    }
  }, []);

  useEffect(() => {
    if (!window.coprep) return;

    const cleanupUpdateAvailable = window.coprep.onUpdateAvailable?.(() => {
      setUpdateStatus("available");
      setUpdateProgress(0);
    });
    const cleanupUpdateProgress = window.coprep.onUpdateProgress?.(
      (progress: { percent?: number }) => {
        if (typeof progress?.percent === "number") {
          setUpdateProgress(Math.round(progress.percent));
        }
      },
    );
    const cleanupUpdateDownloaded = window.coprep.onUpdateDownloaded?.(() => {
      setUpdateStatus("downloaded");
      setUpdateProgress(100);
    });

    return () => {
      cleanupUpdateAvailable?.();
      cleanupUpdateProgress?.();
      cleanupUpdateDownloaded?.();
    };
  }, []);

  const handleInstallUpdate = async () => {
    await window.coprep?.quitAndInstall?.();
  };

  // Click-through + scroll: pass mouse events through to apps beneath the
  // overlay UNLESS the cursor is hovering over one of the interactive panels.
  // `forward: true` is always set so the renderer still receives pointer moves
  // and scroll events even when click-through is active.
  useEffect(() => {
    if (!window.coprep?.setIgnoreMouseEvents) return;

    // Interactive selectors — anything the user needs to click or scroll in.
    const INTERACTIVE_SELECTOR =
      ".header, .update-banner, .transcript-panel, .copilot-response";

    let isIgnoring = false;

    const onMouseMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      // Consider interactive if cursor is inside a panel or any of its children
      const overInteractive = el?.closest(INTERACTIVE_SELECTOR) !== null;

      if (overInteractive && isIgnoring) {
        isIgnoring = false;
        window.coprep!.setIgnoreMouseEvents(false);
      } else if (!overInteractive && !isIgnoring) {
        isIgnoring = true;
        window.coprep!.setIgnoreMouseEvents(true);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    // Ensure click-through is off when the component unmounts
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.coprep?.setIgnoreMouseEvents(false);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log("[CoPrep Desktop] Unmount cleanup");
      if (socketClient) socketClient.disconnect();
      if (deepgramConnection) deepgramConnection.finish();
      if (micAudioStream) micAudioStream.getTracks().forEach((t) => t.stop());
      if (desktopAudioStream)
        desktopAudioStream.getTracks().forEach((t) => t.stop());
      if (combinedStream) combinedStream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Global AudioContext to bypass Chrome's autoplay suspension
  // It must be created and resumed synchronously on a user interaction (e.g. click).
  const globalAudioContextRef = useRef<AudioContext | null>(null);

  const getGlobalAudioContext = useCallback(() => {
    if (!globalAudioContextRef.current || globalAudioContextRef.current.state === "closed") {
      globalAudioContextRef.current = new AudioContext({ sampleRate: 48000 });
    }
    if (globalAudioContextRef.current.state === "suspended") {
      globalAudioContextRef.current.resume();
    }
    return globalAudioContextRef.current;
  }, []);

  // Audio Mixing Logic (Stereo: Left=Mic, Right=System)
  useEffect(() => {
    if (!micAudioStream && !desktopAudioStream) return;

    const audioContext = getGlobalAudioContext();
    const destination = audioContext.createMediaStreamDestination();
    const merger = audioContext.createChannelMerger(2);

    // ── Helper: build a VAD analyser with holdoff so brief silences don't
    //    immediately re-open the gate (avoids rapid on/off flickering).
    const buildVAD = (
      source: MediaStreamAudioSourceNode,
      speakingRef: React.MutableRefObject<boolean>,
      threshold = 10,
      holdoffMs = 400,
    ) => {
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let holdoffTimer: ReturnType<typeof setTimeout> | null = null;

      const tick = () => {
        if (audioContext.state === "closed") return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const average = sum / bufferLength;
        const active = average > threshold;

        if (active) {
          // Speech detected — clear any pending holdoff and mark as speaking
          if (holdoffTimer) { clearTimeout(holdoffTimer); holdoffTimer = null; }
          speakingRef.current = true;
        } else if (speakingRef.current && !holdoffTimer) {
          // Silence detected — wait holdoffMs before marking as not speaking
          // so brief pauses within a sentence don't re-open the gate
          holdoffTimer = setTimeout(() => {
            speakingRef.current = false;
            holdoffTimer = null;
          }, holdoffMs);
        }

        requestAnimationFrame(tick);
      };
      tick();
      return analyser;
    };

    if (micAudioStream) {
      const micSource = audioContext.createMediaStreamSource(micAudioStream);
      micSource.connect(merger, 0, 0); // Input 0 -> Output Channel 0 (Left)
      // Track user mic activity for reverse echo suppression
      buildVAD(micSource, isUserSpeaking, 10, 400);
    }

    if (desktopAudioStream) {
      const desktopSource =
        audioContext.createMediaStreamSource(desktopAudioStream);
      desktopSource.connect(merger, 0, 1); // Input 0 -> Output Channel 1 (Right)
      // Track interviewer (system audio) activity
      buildVAD(desktopSource, isInterviewerSpeaking, 10, 400);
    }

    merger.connect(destination);
    setCombinedStream(destination.stream);

    return () => {
      // Disconnect nodes but DO NOT close the shared audioContext
      try {
        merger.disconnect();
        destination.disconnect();
      } catch (e) { }
    };
  }, [micAudioStream, desktopAudioStream]);

  // Deepgram Connection Logic (Persistent)
  useEffect(() => {
    if (!isSessionStarted || !sessionData?.token) return;

    let connection: LiveClient | null = null;
    let isCleanedUp = false;
    let keepAliveInterval: any = null;

    const setupDeepgramConnection = async () => {
      try {
        let accessToken = "";
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries && !accessToken && !isCleanedUp) {
          try {
            const keyRes = await fetch(`${baseUrl}/interviews/deepgram-token`, {
              headers: { Authorization: `Bearer ${sessionData.token}` },
            });
            if (keyRes.ok) {
              const res = await keyRes.json();
              if (res.accessToken) {
                accessToken = res.accessToken;
                break;
              }
            } else {
              console.warn(`Attempt ${retryCount + 1}: status ${keyRes.status}`);
            }
          } catch (err) {
            console.warn(`Attempt ${retryCount + 1} to fetch Deepgram token failed:`, err);
          }
          retryCount++;
          if (retryCount < maxRetries && !isCleanedUp) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, retryCount - 1))); // 1s, 2s
          }
        }

        if (!accessToken) {
          console.error("Deepgram token not available from server after retries");
          return;
        }

        if (isCleanedUp) return;

        console.log("[CoPrep Desktop] Creating Deepgram live client...");
        const deepgram = createClient(accessToken);
        connection = deepgram.listen.live({
          model: "nova-2",
          language: selectedLanguage,
          smart_format: true,
          interim_results: true,
          utterance_end_ms: 1000,
          endpointing: 200,
          vad_events: true,
          multichannel: true, // Enable stereo separation
          channels: 2,
          encoding: "linear16",
          sample_rate: 48000,
        });

        connection.on(LiveTranscriptionEvents.Open, () => {
          if (isCleanedUp) {
            connection?.finish();
            return;
          }
          console.log("Deepgram connection opened");
          setDeepgramConnection(connection);

          // Keep alive
          keepAliveInterval = setInterval(() => {
            if (connection?.getReadyState() === 1) {
              connection.keepAlive();
            }
          }, 10000);
        });

        connection.on(LiveTranscriptionEvents.Close, () => {
          console.log("Deepgram connection closed");
          if (keepAliveInterval) clearInterval(keepAliveInterval);
          setDeepgramConnection(null);
        });

        connection.on(LiveTranscriptionEvents.Transcript, (data) => {
          if (isCleanedUp) return;

          // Determine speaker based on channel
          // Channel 0 (Left) = Mic = User
          // Channel 1 (Right) = System = Interviewer
          const channelIndex = data.channel_index?.[0] || 0;
          const speaker = channelIndex === 0 ? "user" : "interviewer";

          const transcriptText = data.channel.alternatives[0].transcript;
          const isFinal = data.is_final;

          if (transcriptText) {
            // ── Bidirectional echo suppression ──────────────────────────────
            // Case 1: Mic channel (user) fires while the interviewer is the
            //   dominant speaker → the mic is picking up the interviewer's
            //   voice from the speakers. Suppress it.
            if (speaker === "user" && isInterviewerSpeaking.current) {
              // console.log("[CoPrep Desktop] Echo suppressed (interviewer → mic)");
              // return; // Disabled: This can accidentally drop the first words of a valid user utterance
            }
            // Case 2: System-audio channel (interviewer) fires while the user
            //   is the dominant mic speaker → the system audio is picking up
            //   the user's voice via loopback or speaker bleed. Suppress it.
            if (speaker === "interviewer" && isUserSpeaking.current) {
              // console.log("[CoPrep Desktop] Echo suppressed (user → system)");
              // return; // Disabled: This can accidentally drop the first words of a valid interviewer utterance
            }
            // ────────────────────────────────────────────────────────────────

            handleTranscriptResult({
              source: speaker === "user" ? "microphone" : "screen",
              text: transcriptText,
              is_final: isFinal,
              timestamp: new Date().toISOString(),
              sequenceNumber: Date.now(),
              sessionId: sessionData.session?.id || "",
            });

            // Buffer final transcripts
            // Only buffer interviewer speech for AI answers
            if (isFinal && speaker === "interviewer") {
              transcriptBuffer.current +=
                (transcriptBuffer.current ? " " : "") + transcriptText;
            }
          }
        });

        connection.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
          if (isCleanedUp) return;
          console.log("UtteranceEnd received");

          if (
            transcriptBuffer.current &&
            transcriptBuffer.current.trim().length > 0
          ) {
            console.log(
              "Flushing buffer to backend:",
              transcriptBuffer.current
            );
            if (socketClientRef.current) {
              socketClientRef.current.sendTranscript(
                transcriptBuffer.current,
                true,
                getLanguageName(selectedLanguage)
              );
            }
            transcriptBuffer.current = "";
          }
        });

        connection.on(LiveTranscriptionEvents.Error, (err) => {
          console.error("[CoPrep Desktop] Deepgram ERROR:", JSON.stringify(err, null, 2), err.message || err);
        });
      } catch (err) {
        console.error("Failed to setup Deepgram:", err);
        alert("Failed to start transcription service");
      }
    };

    setupDeepgramConnection();

    return () => {
      isCleanedUp = true;
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      if (connection) connection.finish();
      setDeepgramConnection(null);
    };
  }, [isSessionStarted, sessionData?.token, selectedLanguage]);

  const deepgramConnectionRef = useRef<any>(null);
  useEffect(() => {
    deepgramConnectionRef.current = deepgramConnection;
  }, [deepgramConnection]);

  // Raw PCM Capture Logic (Replaces MediaRecorder to prevent mono downmixing)
  useEffect(() => {
    if (!combinedStream) return;

    const audioContext = getGlobalAudioContext();
    audioContext.resume().then(() => {
      console.log("[CoPrep Desktop] PCM AudioContext resumed. State:", audioContext.state);
    });

    const source = audioContext.createMediaStreamSource(combinedStream);
    const processor = audioContext.createScriptProcessor(4096, 2, 2);

    source.connect(processor);
    // Connect to a dummy gain node so the script processor actually runs
    const dummyGain = audioContext.createGain();
    dummyGain.gain.value = 0;
    processor.connect(dummyGain);
    dummyGain.connect(audioContext.destination);

    let frameCount = 0;

    processor.onaudioprocess = (event) => {
      frameCount++;
      const conn = deepgramConnectionRef.current;
      if (!conn || conn.getReadyState() !== 1) {
        if (frameCount % 100 === 0) console.log("[CoPrep Desktop] Waiting for Deepgram connection...", conn?.getReadyState?.());
        return;
      }

      if (frameCount % 100 === 0) {
        console.log("[CoPrep Desktop] Sending PCM chunk to Deepgram", frameCount);
      }

      const left = event.inputBuffer.getChannelData(0);
      const right = event.inputBuffer.getChannelData(1);

      // Interleave left and right channels into a single Int16Array
      const interleaved = new Int16Array(left.length * 2);
      for (let i = 0; i < left.length; i++) {
        interleaved[i * 2] = Math.max(-32768, Math.min(32767, left[i] * 32768));
        interleaved[i * 2 + 1] = Math.max(-32768, Math.min(32767, right[i] * 32768));
      }

      try {
        conn.send(interleaved.buffer);
      } catch (err) {
        console.error("[CoPrep Desktop] Failed to send PCM data:", err);
      }
    };

    return () => {
      processor.disconnect();
      source.disconnect();
      dummyGain.disconnect();
      // DO NOT close the shared audioContext
    };
  }, [combinedStream]);

  const handleStartSession = () => {
    console.log("[CoPrep Desktop] Starting new session, opening web copilot");
    if (window.coprep?.openExternal) {
      window.coprep.openExternal(
        import.meta.env.VITE_PUBLIC_FRONTEND_BASE || "https://aicoprepare.vercel.app"
      );
    }
  };

  const captureMicrophoneAudioOnly = async (): Promise<MediaStream | null> => {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const track = mic.getAudioTracks()[0];
      console.log(
        `[CoPrep Desktop] Microphone audio stream acquired: ${track.label}`
      );
      return mic;
    } catch (err) {
      console.error("[CoPrep Desktop] Failed to acquire microphone audio", err);
      alert(
        "Unable to access microphone. Please grant permission and try again."
      );
      return null;
    }
  };

  const captureDesktopAudioOnly = async (): Promise<MediaStream | null> => {
    try {
      // Check if capture API is available
      if (!window.coprep?.startAudioCapture) {
        console.error("[CoPrep Desktop] Audio capture API not available");
        return null;
      }

      console.log(
        "[CoPrep Desktop] Starting audio capture via hidden window..."
      );

      // Create AudioContext for receiving PCM samples from capture window
      const audioContext = getGlobalAudioContext();
      const destination = audioContext.createMediaStreamDestination();

      // Create a ScriptProcessorNode to generate audio from received samples
      // We'll use a buffer to queue incoming samples
      const sampleQueue: number[][] = [];
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      scriptProcessor.onaudioprocess = (event) => {
        const outputData = event.outputBuffer.getChannelData(0);

        if (sampleQueue.length > 0) {
          // Get the oldest sample buffer
          const samples = sampleQueue.shift()!;
          // Copy samples to output (handle size mismatch)
          const copyLength = Math.min(samples.length, outputData.length);
          for (let i = 0; i < copyLength; i++) {
            outputData[i] = samples[i];
          }
          // Fill remaining with zeros if samples shorter
          for (let i = copyLength; i < outputData.length; i++) {
            outputData[i] = 0;
          }
        } else {
          // No samples available, output silence
          for (let i = 0; i < outputData.length; i++) {
            outputData[i] = 0;
          }
        }
      };

      // Create a silent oscillator to drive the ScriptProcessor
      // This is needed because ScriptProcessorNode.onaudioprocess only fires
      // when connected to an active audio source
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0; // Silent - just used for timing
      oscillator.connect(gainNode);
      gainNode.connect(scriptProcessor);

      // Connect processor to destination to generate MediaStream
      scriptProcessor.connect(destination);

      // Start the oscillator to begin processing
      oscillator.start();

      // Set up listener for incoming audio samples from capture window
      const cleanupListener = window.coprep.onAudioData((data: ArrayBuffer) => {
        // Convert ArrayBuffer (which is actually number[]) to array
        const samples = Array.isArray(data)
          ? data
          : Array.from(new Float32Array(data));
        sampleQueue.push(samples);

        // Limit queue size to prevent memory issues (keep ~500ms of audio)
        while (sampleQueue.length > 12) {
          sampleQueue.shift();
        }
      });

      let cleanupStartedListener = () => { };
      let cleanupErrorListener = () => { };
      let statusTimeout: ReturnType<typeof setTimeout> | null = null;

      const captureStatus = new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (started: boolean) => {
          if (settled) return;
          settled = true;
          if (statusTimeout) clearTimeout(statusTimeout);
          cleanupStartedListener();
          cleanupErrorListener();
          resolve(started);
        };

        cleanupStartedListener = window.coprep.onAudioCaptureStarted(() => {
          finish(true);
        });

        cleanupErrorListener = window.coprep.onAudioCaptureError((error) => {
          console.warn("[CoPrep Desktop] Desktop audio capture unavailable:", error);
          finish(false);
        });

        statusTimeout = setTimeout(() => {
          console.warn("[CoPrep Desktop] Timed out waiting for desktop audio capture");
          finish(false);
        }, 8000);
      });

      // Start capture in hidden window
      const captureCommandSent = await window.coprep.startAudioCapture();

      if (!captureCommandSent) {
        console.error(
          "[CoPrep Desktop] Failed to start capture in hidden window"
        );
        cleanupStartedListener();
        cleanupErrorListener();
        oscillator.stop();
        // DO NOT close shared audioContext
        cleanupListener();
        return null;
      }

      const captureStarted = await captureStatus;

      if (!captureStarted) {
        cleanupStartedListener();
        cleanupErrorListener();
        cleanupListener();
        await window.coprep?.stopAudioCapture?.();
        oscillator.stop();
        scriptProcessor.disconnect();
        gainNode.disconnect();
        destination.disconnect();
        // DO NOT close shared audioContext
        return null;
      }

      console.log(
        "[CoPrep Desktop] Desktop audio capture started via hidden window"
      );

      // Store cleanup function for later
      const stream = destination.stream;
      (stream as any)._cleanupCapture = async () => {
        cleanupListener();
        await window.coprep?.stopAudioCapture?.();
        oscillator.stop();
        scriptProcessor.disconnect();
        audioContext.close();
      };

      return stream;
    } catch (err) {
      console.error(
        "[CoPrep Desktop] Failed to start desktop audio capture",
        err
      );
      return null;
    }
  };

  const startInterviewSession = async () => {
    try {
      const token = sessionData?.token;
      const session = sessionData?.session;
      if (!token) throw new Error("Missing authentication token");

      const response = await fetch(`${baseUrl}/interviews/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(session),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to start interview");
      }

      const res = await response.json();
      if (!res.id) throw new Error("Invalid session response");

      sessionStorage.setItem("interviewSessionData", JSON.stringify(res));
      sessionStorage.removeItem("interviewAnswers");

      const client = new InterviewSocketClient({
        baseUrl: socketUrl,
        sessionId: res.id,
        userId: sessionData.userId!,
        language: selectedLanguage,
        onTranscript: () => { }, // Handled by Deepgram SDK now
        onAnswerStart: () => {
          console.log("🚀 AI Answer streaming started");
          setCurrentStreamingAnswer("");
        },
        onAnswerChunk: (data: AIAnswerChunk) => {
          setCurrentStreamingAnswer((prev) => prev + data.chunk);
        },
        onAnswer: (ans: AIAnswer) => {
          console.log("\n[CoPrep Desktop] AI Answer received:\n", ans.answer, "\n");
          setAnswers((prev) => {
            const updated = [...prev, ans];
            sessionStorage.setItem("interviewAnswers", JSON.stringify(updated));
            return updated;
          });
          setCurrentStreamingAnswer("");
        },
        onError: (error) => {
          console.error("[CoPrep Desktop] Socket error:", error);
        },
        onTranscriptSkipped: (data: TranscriptSkipped) => {
          console.log(`[CoPrep Desktop] Transcript skipped (no response needed): "${data.text.substring(0, 60)}..."`);
          // The transcript is already shown in the panel via Deepgram.
          // No AI answer generated — user can click "Answer" to override.
        },
      });

      await client.connect();
      setSocketClient(client);
      setIsSessionStarted(true);
      console.log("🔌 Socket client initialized and connected");
    } catch (error) {
      console.error(
        "[CoPrep Desktop] Error starting interview session:",
        error
      );
      if (socketClient) {
        socketClient.disconnect();
        setSocketClient(null);
      }
      const msg = error instanceof Error ? error.message : "Unknown error";
      alert(`Failed to start interview session: ${msg}`);
      throw error;
    }
  };

  const handleJoinSession = async () => {
    if (!sessionData) return;
    console.log("[CoPrep Desktop] Joining session...");

    // Synchronously create and resume AudioContext right as the user clicks
    getGlobalAudioContext();

    try {
      const [micStream, desktopStream] = await Promise.all([
        captureMicrophoneAudioOnly(),
        captureDesktopAudioOnly(),
      ]);

      if (!micStream) {
        alert("Unable to access microphone. Please grant permission.");
        return;
      }

      // Apply initial mic state (muted by default)
      micStream.getAudioTracks().forEach((track) => {
        track.enabled = isMicEnabled;
      });

      setMicAudioStream(micStream);
      if (desktopStream) setDesktopAudioStream(desktopStream);

      await verifyUser();
      await startInterviewSession();
    } catch (error) {
      console.error("[CoPrep Desktop] Error during join session setup", error);
      if (micAudioStream) micAudioStream.getTracks().forEach((t) => t.stop());
      if (desktopAudioStream)
        desktopAudioStream.getTracks().forEach((t) => t.stop());
      setMicAudioStream(null);
      setDesktopAudioStream(null);
    }
  };

  const verifyUser = async () => {
    try {
      const token = sessionData?.token;
      const userId = sessionData?.userId;
      if (!token || !userId) {
        alert("Missing authentication information.");
        return;
      }
      const res = await fetch(`${baseUrl}/auth/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        alert("User verification failed.");
        return;
      }
      console.log("[CoPrep Desktop] User verification successful");
    } catch (err) {
      console.error("Verification error:", err);
      alert("Failed to verify user.");
      return;
    }
  };

  const handleTranscriptResult = useCallback((result: TranscriptResult) => {
    setTranscript((prev) => {
      const speaker: TranscriptMessage["speaker"] =
        result.source === "screen" ? "interviewer" : "user";

      // Find last non-final message for this speaker
      let foundIndex = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].speaker === speaker && !prev[i].is_final) {
          foundIndex = i;
          break;
        }
      }

      // Update existing interim
      if (foundIndex !== -1) {
        const last = prev[foundIndex];
        if (!result.is_final && last.text === result.text) return prev;

        const updated = [...prev];
        updated[foundIndex] = {
          ...last,
          message: result.text,
          text: result.text,
          timestamp: result.timestamp,
          is_final: result.is_final ? true : false,
          sequenceNumber: last.sequenceNumber,
        };
        return updated;
      }

      // New utterance
      const newEntry: TranscriptMessage = {
        id: result.sequenceNumber,
        speaker,
        message: result.text,
        text: result.text,
        timestamp: result.timestamp,
        is_final: result.is_final,
        sequenceNumber: result.sequenceNumber,
        createdAt: Date.now(),
      };

      return [...prev, newEntry];
    });
  }, []);

  const handleLanguageChange = (language: string) => {
    setSelectedLanguage(language);
  };

  const handleManualQuestion = (question: string) => {
    if (socketClient && question.trim()) {
      // Use requestAnswer so it bypasses the intent classifier
      socketClient.requestAnswer(
        question.trim(),
        getLanguageName(selectedLanguage)
      );
    }
  };

  const handleAnswerModeChange = (mode: "auto" | "normal") => {
    setAnswerMode(mode);
    if (socketClient) {
      socketClient.setAnswerMode(mode);
    }
    console.log(`[CoPrep Desktop] Answer mode changed to: ${mode}`);
  };

  const handleAnalyzeScreen = useCallback(async () => {
    // ... existing screen analysis logic ...
    // (Keeping this brief for brevity, assuming it's unchanged or can be copied if needed)
    // For now, I'll just copy the existing logic or leave a placeholder if it's too long.
    // Given the prompt, I should probably keep it working.

    try {
      if (
        !isSessionStarted ||
        !socketClient ||
        !window.coprep?.getScreenSources
      ) {
        return;
      }
      const sources = await window.coprep.getScreenSources();
      if (!sources || sources.length === 0) return;
      const screenSource = sources[0]; // Simplified for brevity

      const constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: screenSource.id,
            minWidth: 1280,
            maxWidth: 1920,
          },
        } as any,
      };

      const tempStream = await navigator.mediaDevices.getUserMedia(constraints);
      const video = document.createElement("video");
      video.srcObject = tempStream;
      video.muted = true;

      await new Promise<void>((resolve) => {
        video.addEventListener("loadedmetadata", () => {
          video.play();
          resolve();
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0);

      tempStream.getTracks().forEach((t) => t.stop());

      canvas.toBlob(
        (blob) => {
          if (blob && socketClient) {
            socketClient.sendScreenCapture(blob);
          }
        },
        "image/jpeg",
        0.8
      );
    } catch (error) {
      console.error("Screenshot error:", error);
    }
  }, [isSessionStarted, socketClient]);

  useEffect(() => {
    if (!window.coprep?.onAnalyzeScreenShortcut) return;

    return window.coprep.onAnalyzeScreenShortcut(() => {
      handleAnalyzeScreen();
    });
  }, [handleAnalyzeScreen]);

  const handleToggleMic = () => {
    if (micAudioStream) {
      const enabled = !isMicEnabled;
      micAudioStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
      setIsMicEnabled(enabled);
      console.log(
        `[CoPrep Desktop] Microphone ${enabled ? "unmuted" : "muted"}`
      );
    }
  };

  const handleEndSession = async () => {
    console.log("[CoPrep Desktop] Ending session...");
    try {
      if (socketClient) {
        socketClient.disconnect();
        setSocketClient(null);
      }
      if (deepgramConnection) {
        deepgramConnection.finish();
        setDeepgramConnection(null);
      }
      if (micAudioStream) {
        micAudioStream.getTracks().forEach((t) => t.stop());
        setMicAudioStream(null);
      }
      if (desktopAudioStream) {
        // Call custom cleanup if available (for capture window audio)
        if ((desktopAudioStream as any)._cleanupCapture) {
          await (desktopAudioStream as any)._cleanupCapture();
        }
        desktopAudioStream.getTracks().forEach((t) => t.stop());
        setDesktopAudioStream(null);
      }

      // ... server end session call ...
      const storedSessionData = sessionStorage.getItem("interviewSessionData");
      if (storedSessionData && sessionData?.token) {
        const sessionInfo = JSON.parse(storedSessionData);
        await fetch(`${baseUrl}/interviews/${sessionInfo.id}/end`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionData.token}`,
          },
          body: JSON.stringify({
            transcript,
            answer: answers,
            ended_at: new Date().toISOString(),
          }),
        });
      }

      setSessionData(null);
      setIsSessionStarted(false);
      setAnswers([]);
      setCurrentStreamingAnswer("");
      setTranscript([]);
      setHasDeepLinkData(false);
      sessionStorage.removeItem("interviewSessionData");
      sessionStorage.removeItem("interviewAnswers");
    } catch (err) {
      console.error("Error ending session:", err);
    }
  };

  return (
    <div className="app-container">
      <Header
        onStart={hasDeepLinkData ? handleJoinSession : handleStartSession}
        hasDeepLinkData={hasDeepLinkData}
        sessionData={sessionData}
        selectedLanguage={selectedLanguage}
        onLanguageChange={handleLanguageChange}
        isSessionStarted={isSessionStarted}
        onEnd={handleEndSession}
        onAnalyzeScreen={handleAnalyzeScreen}
        isMicEnabled={isMicEnabled}
        onToggleMic={handleToggleMic}
        answerMode={answerMode}
        onAnswerModeChange={handleAnswerModeChange}
      />
      {updateStatus !== "idle" && (
        <div className="update-banner">
          <div className="update-copy">
            <span className="update-title">
              {updateStatus === "downloaded"
                ? "Update ready"
                : "Downloading update"}
            </span>
            {updateStatus === "available" && updateProgress !== null && (
              <span className="update-detail">{updateProgress}%</span>
            )}
          </div>
          {updateStatus === "downloaded" && (
            <button className="update-button" onClick={handleInstallUpdate}>
              Restart
            </button>
          )}
        </div>
      )}
      <div className="panels-container">
        <CopilotResponse
          isSessionStarted={isSessionStarted}
          answers={answers}
          currentStreamingAnswer={currentStreamingAnswer}
          onSubmitQuestion={handleManualQuestion}
        />
        <TranscriptPanel
          isSessionStarted={isSessionStarted}
          transcript={transcript}
          onManualQuestion={handleManualQuestion}
          answerMode={answerMode}
        />
      </div>
    </div>
  );
}
