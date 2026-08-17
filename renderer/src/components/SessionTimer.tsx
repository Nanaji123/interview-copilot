import { useEffect, useState } from "react";

type Props = {
  /** Session start, in ms since epoch. Comes from the server's `started_at`
   *  so the displayed time matches exactly what gets billed. */
  startedAt: number;
};

function format(totalSeconds: number) {
  const s = Math.max(0, totalSeconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

/**
 * Elapsed session time.
 *
 * Owns its own interval so the per-second tick re-renders this component only,
 * rather than the whole app (which would re-render every streamed answer).
 */
export default function SessionTimer({ startedAt }: Props): JSX.Element {
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - startedAt) / 1000)
  );

  useEffect(() => {
    // Recompute from the timestamp each tick rather than incrementing a
    // counter — that stays correct if the machine sleeps or a tick is missed.
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  // 1 credit = 1 minute, and partial minutes round up at settlement.
  const creditsUsed = Math.ceil(elapsed / 60);

  return (
    <div className="session-timer" title={`${creditsUsed} credit(s) used so far`}>
      <span className="session-timer-dot" />
      <span className="session-timer-value">{format(elapsed)}</span>
    </div>
  );
}
