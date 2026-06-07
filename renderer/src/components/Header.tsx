import { useEffect, useState } from "react";
import logoImage from "../assets/logo.png";
import { DEEPGRAM_LANGUAGES, DeepgramLanguage } from "../lib/deepgramLanguages";

interface SessionData {
  userId?: string;
  token?: string;
  session?: any;
  credits?: number;
}

type Props = {
  onStart?: () => void;
  hasDeepLinkData?: boolean;
  sessionData?: SessionData | null;
  selectedLanguage?: string;
  onLanguageChange?: (language: string) => void;
  isSessionStarted?: boolean;
  onEnd?: () => void;
  onAnalyzeScreen?: () => void;
  isMicEnabled?: boolean;
  onToggleMic?: () => void;
};

declare global {
  interface Window {
    coprep: {
      checkScreenPermission: () => Promise<boolean>;
      requestScreenPermission: () => Promise<boolean>;
      openExternal: (url: string) => void;
      getScreenSources: () => Promise<any[]>;
      onScreenPermissionStatus: (
        callback: (hasPermission: boolean) => void,
      ) => void;
      onSessionStart: (callback: (payload: SessionData) => void) => void;
      onAnalyzeScreenShortcut: (callback: () => void) => () => void;
      checkForUpdates: () => Promise<unknown>;
      quitAndInstall: () => Promise<void>;
      quitApp: () => void;
      onUpdateAvailable: (callback: () => void) => () => void;
      onUpdateDownloaded: (callback: () => void) => () => void;
      onUpdateProgress: (callback: (progress: any) => void) => () => void;
      // Audio capture methods (dual-window architecture)
      startAudioCapture: () => Promise<boolean>;
      stopAudioCapture: () => Promise<boolean>;
      onAudioData: (callback: (data: ArrayBuffer) => void) => () => void;
      onAudioCaptureStarted: (callback: () => void) => () => void;
      onAudioCaptureStopped: (callback: () => void) => () => void;
      onAudioCaptureError: (callback: (error: string) => void) => () => void;
      // Click-through: ignore mouse events on transparent areas, forward:true
      // keeps scroll events firing in the renderer even while ignoring clicks.
      setIgnoreMouseEvents: (ignore: boolean) => void;
      copyTextToClipboard: (text: string) => void;
    };
  }
}

export default function Header({
  onStart,
  hasDeepLinkData,
  sessionData,
  selectedLanguage = "en",
  onLanguageChange,
  isSessionStarted = false,
  onEnd,
  onAnalyzeScreen,
  isMicEnabled = true,
  onToggleMic,
}: Props): JSX.Element {
  const [hasScreenPermission, setHasScreenPermission] = useState<
    boolean | null
  >(null);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [bgOpacity, setBgOpacity] = useState<number>(() => {
    const saved = localStorage.getItem("coprep-bg-opacity");
    return saved !== null ? parseFloat(saved) : 0.5;
  });
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform?.toLowerCase().includes("mac");
  const modKey = isMac ? "⌘" : "Ctrl";
  const altKey = isMac ? "⌥" : "Alt";

  useEffect(() => {
    // Check initial screen permission status
    if (window.coprep) {
      window.coprep.checkScreenPermission().then(setHasScreenPermission);

      // Listen for permission status updates
      window.coprep.onScreenPermissionStatus(setHasScreenPermission);
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-bg-opacity",
      String(bgOpacity),
    );
    localStorage.setItem("coprep-bg-opacity", String(bgOpacity));
  }, [bgOpacity]);

  const handleRequestScreenAccess = async () => {
    if (!window.coprep) return;

    setIsRequestingPermission(true);
    try {
      const granted = await window.coprep.requestScreenPermission();
      setHasScreenPermission(granted);
    } catch (error) {
      console.error("Failed to request screen permission:", error);
    } finally {
      setIsRequestingPermission(false);
    }
  };

  const renderButton = () => {
    if (hasScreenPermission === null) {
      // Still loading permission status
      return (
        <button disabled className="start-button">
          Loading...
        </button>
      );
    }

    if (!hasScreenPermission) {
      // No screen permission - show request button
      return (
        <button
          onClick={handleRequestScreenAccess}
          disabled={isRequestingPermission}
          className="start-button screen-access-button"
        >
          {isRequestingPermission ? "Requesting..." : "Request Screen Access"}
        </button>
      );
    }

    // If session is started, show session controls
    if (isSessionStarted) {
      return (
        <div className="session-controls">
          <button
            onClick={onToggleMic}
            className={`mic-button ${!isMicEnabled ? "muted" : ""}`}
            title={isMicEnabled ? "Mute Microphone" : "Unmute Microphone"}
          >
            {isMicEnabled ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-mic-icon lucide-mic"
              >
                <path d="M12 19v3" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <rect x="9" y="2" width="6" height="13" rx="3" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-mic-off-icon lucide-mic-off"
              >
                <path d="M12 19v3" />
                <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                <path d="M16.95 16.95A7 7 0 0 1 5 12v-2" />
                <path d="M18.89 13.23A7 7 0 0 0 19 12v-2" />
                <path d="m2 2 20 20" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
              </svg>
            )}
          </button>
          <button onClick={onAnalyzeScreen} className="analyze-button">
            Analyze Screen
          </button>
          <button onClick={onEnd} className="end-button">
            End
          </button>
        </div>
      );
    }

    // Has permission - show start/join button based on deep link data
    const buttonText = hasDeepLinkData ? "Join Session" : "Start Interview";
    return (
      <button onClick={onStart} className="start-button">
        {buttonText}
      </button>
    );
  };

  return (
    <header className="header">
      <div className="header-container">
        <div className="header-left">
          <img src={logoImage} alt="CoPrep" className="logo" />
          <span className="app-title whitespace-nowrap">VodKa AI</span>
        </div>
        <div className="header-right">
          {hasDeepLinkData && !isSessionStarted && (
            <select
              value={selectedLanguage}
              onChange={(e) => onLanguageChange?.(e.target.value)}
              className="language-dropdown"
            >
              {DEEPGRAM_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          )}
          {renderButton()}
          <button
            onClick={() => window.coprep?.quitApp?.()}
            title="Close App"
            style={{
              background: "#e51515ff",
              border: "none",
              color: "white",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginLeft: "12px",
              borderRadius: "4px",
              transition: "background-color 0.2s"
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.1)")}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <label className="opacity-slider-label">
          <span className="opacity-slider-icon">☀</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={bgOpacity}
            onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
            className="opacity-slider"
            title={`Background opacity: ${Math.round(bgOpacity * 100)}%`}
          />
          <span className="opacity-slider-value">
            {Math.round(bgOpacity * 100)}%
          </span>
        </label>
        <div className="keyboard-shortcuts">
          <p>
            Show/Hide: <span className="key-badge">{modKey}</span> +{" "}
            <span className="text-badge">Shift</span> +{" "}
            <span className="text-badge">H</span>
          </p>
          <p>
            Move: <span className="key-badge">{altKey}</span> +{" "}
            <span className="key-badge">← ↑ → ↓</span>
          </p>
          <p>
            Analyze: <span className="key-badge">{modKey}</span> +{" "}
            <span className="text-badge">Shift</span> +{" "}
            <span className="text-badge">A</span>
          </p>
        </div>
      </div>
    </header>
  );
}
