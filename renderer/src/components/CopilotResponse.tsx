import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { AIAnswer } from "../lib/socketClient";

type Props = {
  isSessionStarted: boolean;
  answers: AIAnswer[];
  currentStreamingAnswer?: string;
  onSubmitQuestion?: (question: string) => void;
};

type CodeBlockProps = {
  language: string;
  children: React.ReactNode;
};

function CodeBlock({ language, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, "");

  const handleCopy = async () => {
    try {
      if (window.coprep?.copyTextToClipboard) {
        window.coprep.copyTextToClipboard(code);
      } else {
        await navigator.clipboard.writeText(code);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("[CoPrep Desktop] Failed to copy code block", error);
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-language">{language || "code"}</span>
        <button
          type="button"
          className={`code-copy-button ${copied ? "copied" : ""}`}
          onClick={handleCopy}
          title={copied ? "Copied" : "Copy code"}
          aria-label={copied ? "Copied code" : "Copy code"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="code-block-scroll">
        <SyntaxHighlighter
          style={oneDark}
          language={language || "text"}
          PreTag="div"
          className="code-highlighter"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            whiteSpace: "pre",
            overflowX: "auto",
            background: "transparent",
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

const markdownComponents = {
  code({
    node,
    inline,
    className,
    children,
    ...props
  }: {
    node?: any;
    inline?: boolean;
    className?: string;
    children?: React.ReactNode;
    [key: string]: any;
  }) {
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";

    return !inline ? (
      <CodeBlock language={language}>{children}</CodeBlock>
    ) : (
      <code
        className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono border overflow-x-auto"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
  blockquote({ children }: { children?: React.ReactNode }) {
    return (
      <blockquote className="border-l-4 pl-4 my-4 italic opacity-70">
        {children}
      </blockquote>
    );
  },
  h1({ children }: { children?: React.ReactNode }) {
    return <h1 className="text-xl font-bold my-2">{children}</h1>;
  },
  h2({ children }: { children?: React.ReactNode }) {
    return <h2 className="text-lg font-semibold my-2">{children}</h2>;
  },
  h3({ children }: { children?: React.ReactNode }) {
    return <h3 className="text-base font-medium my-2">{children}</h3>;
  },
  ul({ children }: { children?: React.ReactNode }) {
    return <ul className="list-disc pl-6 space-y-0.5 my-1">{children}</ul>;
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol className="list-decimal pl-6 space-y-0.5 my-1">{children}</ol>;
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li className="[&>p]:inline [&>p]:m-0">{children}</li>;
  },
  p({ children }: { children?: React.ReactNode }) {
    return <p className="leading-relaxed my-2 break-words">{children}</p>;
  },
  strong({ children }: { children?: React.ReactNode }) {
    return <strong className="font-semibold">{children}</strong>;
  },
  em({ children }: { children?: React.ReactNode }) {
    return <em className="italic opacity-80">{children}</em>;
  },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300 underline break-words"
      >
        {children}
      </a>
    );
  },
  table({ children }: { children?: React.ReactNode }) {
    return (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border rounded-md">{children}</table>
      </div>
    );
  },
  thead({ children }: { children?: React.ReactNode }) {
    return <thead className="bg-gray-700">{children}</thead>;
  },
  th({ children }: { children?: React.ReactNode }) {
    return <th className="border px-3 py-2 text-left font-medium">{children}</th>;
  },
  td({ children }: { children?: React.ReactNode }) {
    return <td className="border px-3 py-2 break-words">{children}</td>;
  },
};

// MemoizedAnswerContent component for performance
const MemoizedAnswerContent = React.memo(function MemoizedAnswerContent({
  answer,
}: {
  answer: string;
}) {
  return (
    <div className="answer-markdown prose prose-invert max-w-none prose-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {answer}
      </ReactMarkdown>
    </div>
  );
});

export default function CopilotResponse({
  isSessionStarted,
  answers,
  currentStreamingAnswer,
  onSubmitQuestion,
}: Props): JSX.Element {
  const [manualQuestion, setManualQuestion] = useState("");

  // Latest first for display
  const ordered = [...answers].reverse();

  const cleanMarkdown = (text: string) =>
    text
      .replace(/\\n/g, "\n")
      .replace(/(\r?\n\s*){2,}/g, "\n")
      .trim();

  const handleManualQuestionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (onSubmitQuestion && manualQuestion.trim()) {
      onSubmitQuestion(manualQuestion.trim());
      setManualQuestion(""); // Clear the input after sending
    } else {
      if (!onSubmitQuestion) {
        console.warn("No onSubmitQuestion handler provided");
      }
      if (!manualQuestion.trim()) {
        console.warn("Empty question provided");
      }
    }
  };

  if (ordered.length === 0 && !currentStreamingAnswer) return <></>;

  return (
    <div className="copilot-response">
      {isSessionStarted && (
        <div className="manual-input">
          <form
            onSubmit={handleManualQuestionSubmit}
            className="manual-input-form"
          >
            <input
              type="text"
              value={manualQuestion}
              onChange={(e) => setManualQuestion(e.target.value)}
              placeholder="Type your question..."
              className="manual-input-field"
            />
            <button type="submit" className="manual-input-button">
              Ask
            </button>
          </form>
        </div>
      )}
      <h3 className="copilot-heading">Answers</h3>
      <div className="copilot-container">
        {!isSessionStarted ? (
          <p className="copilot-message">Start Interview</p>
        ) : ordered.length > 0 || currentStreamingAnswer ? (
          <div className="copilot-text answers-list">
            {currentStreamingAnswer && (
              <div className="copilot-content">
                <div className="answer-streaming-header">
                  <span>Generating Answer</span>
                  <span className="pulse-dot" />
                </div>
                <div className="answer-streaming-body">
                  <div className="answer-markdown prose prose-invert max-w-none prose-sm">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {cleanMarkdown(currentStreamingAnswer)}
                    </ReactMarkdown>
                    <span className="streaming-caret" />
                  </div>
                </div>
              </div>
            )}
            {ordered.map((a, idx) => (
              <div key={a.timestamp + idx} className="copilot-content">
                <div className="answer-item-text">
                  <MemoizedAnswerContent answer={cleanMarkdown(a.answer)} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="copilot-message">Answers will appear here…</p>
        )}
      </div>
    </div>
  );
}
