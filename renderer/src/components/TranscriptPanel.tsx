import React, { useEffect, useRef, useState } from "react";
import { TranscriptMessage } from "../types/transcript";

type Props = {
  isSessionStarted: boolean;
  transcript: TranscriptMessage[];
  onManualQuestion?: (question: string) => void;
  answerMode?: "auto" | "normal";
};

export default function TranscriptPanel({
  isSessionStarted,
  transcript,
  onManualQuestion,
  answerMode = "normal",
}: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Group messages by speaker and timestamp gap >= 5s
  const groupedMessages: Array<{
    id: string | number;
    speaker: string;
    startTimestamp: string;
    endTimestamp: string;
    is_final?: boolean;
    texts: string[];
  }> = [];

  transcript.forEach((msg) => {
    const speaker = msg.speaker;
    const currTs = new Date(msg.timestamp).getTime();
    const prevGroup = groupedMessages[groupedMessages.length - 1];

    // Start a new group if: no previous group, different speaker, or time gap >= 5s
    if (
      !prevGroup ||
      prevGroup.speaker !== speaker ||
      currTs - new Date(prevGroup.endTimestamp).getTime() >= 5000
    ) {
      groupedMessages.push({
        id: msg.id,
        speaker,
        startTimestamp: msg.timestamp,
        endTimestamp: msg.timestamp,
        is_final: msg.is_final,
        texts: [msg.message ?? msg.text ?? ""],
      });
    } else {
      // Append to previous group
      prevGroup.texts.push(msg.message ?? msg.text ?? "");
      prevGroup.endTimestamp = msg.timestamp;
      if (msg.is_final) prevGroup.is_final = true;
    }
  });

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [groupedMessages, autoScroll]);

  if (groupedMessages.length === 0) return <></>;

  return (
    <div className="transcript-panel">
      <div className="transcript-header">
        <h3 className="transcript-heading">Transcript</h3>
        <label className="auto-scroll-toggle">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          <p className="auto-scroll-label">
          <span>Auto Scroll</span>
          </p>
        </label>
      </div>
      <div ref={scrollRef} className="transcript-container">
        {!isSessionStarted ? (
          <p className="transcript-message">Start Interview</p>
        ) : groupedMessages.length > 0 ? (
          groupedMessages.map((group) => {
            const content = group.texts.join(" ");
            const isUser = group.speaker === "user";
            return (
              <div
                key={group.id}
                className={`transcript-message-group ${
                  isUser ? "user-message" : "interviewer-message"
                } ${group.is_final ? "final" : "interim"}`}
              >
                <div
                  className={`message-avatar ${
                    isUser ? "user" : "interviewer"
                  }`}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div className="message-content-wrapper">
                  <div className="message-header">
                    <div className="message-speaker">
                      {isUser ? "You" : "Interviewer"}
                    </div>
                    {!isUser && answerMode === "normal" && onManualQuestion && (
                      <button
                        className="answer-button"
                        onClick={() => onManualQuestion(content)}
                        title="Generate AI answer for this question"
                      >
                        Answer
                      </button>
                    )}
                  </div>
                  <div className="message-bubble">{content}</div>
                </div>
              </div>
            );
          })
        ) : (
          <p className="transcript-message">Transcript will appear here…</p>
        )}
      </div>
    </div>
  );
}
