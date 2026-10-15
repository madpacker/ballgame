import { useEffect, useRef, useState } from "react";

export function useCountdown(seconds: number, running: boolean, onDone?: () => void) {
  const [remaining, setRemaining] = useState(seconds);
  const doneRef = useRef(false);
  useEffect(() => {
    doneRef.current = false;
    setRemaining(seconds);
  }, [seconds]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          if (!doneRef.current) {
            doneRef.current = true;
            onDone?.();
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  return remaining;
}
