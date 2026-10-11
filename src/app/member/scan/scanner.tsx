"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";

import jsQR from "jsqr";

import { parseScannedCheckInUrl } from "@/lib/qr-check-in";

/**
 * In-app gym QR scanner (ADR 022).
 *
 * The camera is requested ONLY from the Start scanning button — never
 * on page load — and every track is stopped as soon as scanning ends,
 * succeeds, or the component unmounts. Decoding runs locally with
 * jsQR (the native barcode-detection API is not available in Safari,
 * so it cannot be the only path).
 *
 * A decoded code is untrusted input. It is accepted only when
 * parseScannedCheckInUrl validates it against this application's own
 * origin and the check-in route; navigation then goes to the
 * application's own check-in URL built from the extracted gym
 * identifier — the scanned text itself is never navigated to. And
 * scanning is not check-in: the member still confirms on the landing
 * page, which resolves their session exactly as for any other arrival.
 *
 * Camera lifecycle: getUserMedia is asynchronous, so a request can
 * resolve after the member cancels or the page unmounts. A generation
 * counter (requestRef) is bumped by every start, cancel, and unmount;
 * start() re-checks its generation after each await and, when stale,
 * stops the just-granted stream immediately without attaching it,
 * starting the decode loop, changing state, or navigating.
 */

type ScannerState =
  | "idle"
  | "requesting"
  | "scanning"
  | "denied"
  | "unsupported"
  | "invalid"
  | "error";

/** Roughly 9 decode attempts per second — plenty for a printed poster. */
const DECODE_INTERVAL_MS = 110;

// Camera capability is an external (browser) fact, read through
// useSyncExternalStore: the server snapshot renders the idle-safe UI,
// and the client snapshot replaces it after hydration on devices where
// scanning cannot work. The capability never changes during the
// page's lifetime, so the subscription is inert.
function subscribeToCameraSupport(): () => void {
  return () => {};
}

function getCameraSupportSnapshot(): boolean {
  return (
    window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function getServerCameraSupportSnapshot(): boolean {
  return true;
}

export function Scanner() {
  const router = useRouter();
  const cameraSupported = useSyncExternalStore(
    subscribeToCameraSupport,
    getCameraSupportSnapshot,
    getServerCameraSupportSnapshot,
  );
  const [state, setState] = useState<ScannerState>("idle");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Generation of the latest camera request. start() captures its
  // generation before awaiting getUserMedia; cancel and unmount bump
  // it, which invalidates any still-pending request.
  const requestRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDecodeRef = useRef(0);
  const loopRef = useRef<() => void>(() => {});

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Unmount cleanup: the camera never outlives the page — invalidate a
  // pending request as well as stopping an active stream.
  useEffect(() => {
    return () => {
      requestRef.current += 1;
      stopCamera();
    };
  }, [stopCamera]);

  const decodeFrame = useCallback((): boolean => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      return false;
    }
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = canvas;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return false;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height);
    if (!code || !code.data) {
      // Nothing decodable in this frame — keep scanning silently.
      return false;
    }

    const parsed = parseScannedCheckInUrl(code.data, window.location.origin);
    stopCamera();
    if (parsed) {
      router.push(`/member/check-in?gym=${encodeURIComponent(parsed.gym)}`);
    } else {
      setState("invalid");
    }
    return true;
  }, [router, stopCamera]);

  // The decode loop lives in a ref (assigned in an effect) so it can
  // reschedule itself without a self-referencing callback declaration.
  useEffect(() => {
    loopRef.current = () => {
      if (!streamRef.current) {
        return;
      }
      const now = performance.now();
      if (now - lastDecodeRef.current >= DECODE_INTERVAL_MS) {
        lastDecodeRef.current = now;
        if (decodeFrame()) {
          return; // Scanning is over (navigated or invalid code).
        }
      }
      rafRef.current = requestAnimationFrame(loopRef.current);
    };
  }, [decodeFrame]);

  const start = useCallback(async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    const requestId = ++requestRef.current;
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
    } catch (error) {
      if (requestId !== requestRef.current) {
        return; // Cancelled or unmounted while the prompt was open.
      }
      const name = (error as { name?: unknown } | null)?.name;
      setState(name === "NotAllowedError" ? "denied" : "error");
      return;
    }
    if (requestId !== requestRef.current) {
      // The request was cancelled (or the page unmounted) while the
      // permission prompt was open: stop the just-granted stream
      // immediately. It is never attached, tracked in streamRef, or
      // given a decode loop.
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return;
    }
    streamRef.current = stream;

    const video = videoRef.current;
    if (!video) {
      stopCamera();
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      stopCamera();
      if (requestId === requestRef.current) {
        setState("error");
      }
      return;
    }
    if (requestId !== requestRef.current) {
      // Cancelled while the preview was starting; cancel() already
      // stopped the camera — don't start the decode loop or set state.
      return;
    }
    lastDecodeRef.current = 0;
    setState("scanning");
    rafRef.current = requestAnimationFrame(loopRef.current);
  }, [stopCamera]);

  const cancel = useCallback(() => {
    // Invalidate a pending camera request as well as stopping an
    // active stream: if getUserMedia resolves after Cancel, start()
    // discards the stream instead of attaching it.
    requestRef.current += 1;
    stopCamera();
    setState("idle");
  }, [stopCamera]);

  const displayState: ScannerState = cameraSupported ? state : "unsupported";
  const cameraActive = displayState === "requesting" || displayState === "scanning";

  return (
    <section aria-label="QR scanner">
      <p>
        You&apos;ll confirm your check-in on the next screen — scanning
        alone doesn&apos;t check you in.
      </p>

      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-label="Camera preview"
        style={{
          display: cameraActive ? "block" : "none",
          width: "100%",
          maxWidth: "30rem",
        }}
      />

      {displayState === "idle" && (
        <p>
          <button type="button" onClick={start}>
            Start scanning
          </button>
        </p>
      )}

      {displayState === "requesting" && (
        <>
          <p>Starting the camera…</p>
          <p>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </p>
        </>
      )}

      {displayState === "scanning" && (
        <>
          <p>Point your camera at the gym&apos;s QR code.</p>
          <p>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </p>
        </>
      )}

      {displayState === "denied" && (
        <>
          <p>
            Camera access was denied. Allow camera access in your
            browser settings and try again, or use the options below.
          </p>
          <p>
            <button type="button" onClick={start}>
              Try again
            </button>
          </p>
        </>
      )}

      {displayState === "unsupported" && (
        <p>
          This device or browser can&apos;t scan QR codes here. Use the
          options below instead.
        </p>
      )}

      {displayState === "invalid" && (
        <>
          <p>That code isn&apos;t a gym check-in code.</p>
          <p>
            <button type="button" onClick={start}>
              Scan again
            </button>
          </p>
        </>
      )}

      {displayState === "error" && (
        <>
          <p>
            Something went wrong with the camera. Try again, or use the
            options below.
          </p>
          <p>
            <button type="button" onClick={start}>
              Try again
            </button>
          </p>
        </>
      )}
    </section>
  );
}
