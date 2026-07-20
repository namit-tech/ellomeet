import { useEffect, useRef, useState } from "react";

/**
 * useSpeaking — tells you who is currently talking.
 *
 * Runs each participant's audio through a Web Audio analyser and compares the
 * short-term volume against a threshold, with a hold time so the ring around a
 * tile doesn't flicker between syllables.
 *
 * Muting works for free: a disabled track feeds silence into the graph, so a
 * muted participant can never light up as "speaking".
 *
 * @param {Object<string, MediaStream>} streams  id -> stream (include your own)
 * @returns {Object<string, boolean>} id -> speaking
 */
const THRESHOLD = 0.045; // RMS; below this is room noise
const HOLD_MS = 600; // keep the highlight this long after they stop

export function useSpeaking(streams) {
  const [speaking, setSpeaking] = useState({});
  const ctxRef = useRef(null);
  const nodesRef = useRef({}); // id -> { source, analyser, data, lastLoud }

  // Rebuild analysers only when the set of streams actually changes.
  const key = Object.entries(streams)
    .map(([id, s]) => `${id}:${s?.id || "-"}`)
    .sort()
    .join(",");

  useEffect(() => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return undefined;

    if (!ctxRef.current) ctxRef.current = new Ctx();
    const ctx = ctxRef.current;
    ctx.resume?.().catch(() => {});

    const nodes = nodesRef.current;

    // Drop analysers for participants who left or whose stream was swapped.
    for (const id of Object.keys(nodes)) {
      const stream = streams[id];
      if (!stream || nodes[id].streamId !== stream.id) {
        nodes[id].source.disconnect();
        delete nodes[id];
      }
    }

    // Add analysers for new participants.
    for (const [id, stream] of Object.entries(streams)) {
      if (!stream || nodes[id]) continue;
      if (!stream.getAudioTracks().length) continue;

      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser); // analyser only — never back to the speakers
        nodes[id] = {
          streamId: stream.id,
          source,
          analyser,
          data: new Uint8Array(analyser.fftSize),
          lastLoud: 0,
        };
      } catch (err) {
        console.warn("speaking analyser failed for", id, err);
      }
    }

    const timer = setInterval(() => {
      const now = Date.now();
      const next = {};
      let changed = false;

      for (const [id, node] of Object.entries(nodesRef.current)) {
        node.analyser.getByteTimeDomainData(node.data);

        // RMS of the waveform, centred on 128 (silence).
        let sum = 0;
        for (let i = 0; i < node.data.length; i++) {
          const v = (node.data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / node.data.length);

        if (rms > THRESHOLD) node.lastLoud = now;
        next[id] = now - node.lastLoud < HOLD_MS;
      }

      setSpeaking((prev) => {
        const ids = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const id of ids) {
          if (!!prev[id] !== !!next[id]) changed = true;
        }
        return changed ? next : prev;
      });
    }, 150);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Tear the graph down when the call ends.
  useEffect(
    () => () => {
      Object.values(nodesRef.current).forEach((n) => n.source.disconnect());
      nodesRef.current = {};
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    },
    []
  );

  return speaking;
}
