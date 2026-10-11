// @vitest-environment jsdom
/**
 * Behavioral lifecycle tests for the member QR scanner.
 *
 * The race under test: getUserMedia() is asynchronous, so it can
 * resolve (or reject) AFTER the member cancels or the page unmounts.
 * A late stream must be stopped immediately and never attached, and a
 * late outcome must not change state or navigate. These tests mount
 * the real component with a deferred getUserMedia stub — they do not
 * assert on source text.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { Scanner } from "./scanner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeStream() {
  const tracks: [{ stop: () => void }, { stop: () => void }] = [
    { stop: vi.fn() },
    { stop: vi.fn() },
  ];
  const stream = {
    getTracks: () => tracks,
  } as unknown as MediaStream;
  return { stream, tracks };
}

let container: HTMLDivElement;
let root: Root;
let mounted = false;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pushMock.mockClear();
  getUserMedia = vi.fn();
  // jsdom does not implement isSecureContext (real browsers all define
  // it, and this page is served from a secure context) — provide it so
  // the component's capability snapshot reflects a scanning-capable
  // browser. navigator.mediaDevices is likewise stubbed with the
  // per-test getUserMedia.
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  vi.spyOn(HTMLVideoElement.prototype, "play").mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = false;
});

afterEach(async () => {
  if (mounted) {
    await act(async () => {
      root.unmount();
    });
    mounted = false;
  }
  container.remove();
  vi.restoreAllMocks();
});

async function renderScanner() {
  await act(async () => {
    root.render(<Scanner />);
  });
  mounted = true;
}

async function unmount() {
  await act(async () => {
    root.unmount();
  });
  mounted = false;
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text,
  );
  if (!found) {
    throw new Error(`Button not found: ${text}`);
  }
  return found;
}

async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
}

function video(): HTMLVideoElement {
  const element = container.querySelector("video");
  if (!element) {
    throw new Error("video element not rendered");
  }
  return element;
}

describe("Scanner camera lifecycle", () => {
  it("stops a stream that resolves after unmount and never attaches it", async () => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValue(pending.promise);
    await renderScanner();
    const videoElement = video();

    await click("Start scanning");
    expect(container.textContent).toContain("Starting the camera");

    await unmount();

    const { stream, tracks } = fakeStream();
    await act(async () => {
      pending.resolve(stream);
    });

    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(videoElement.srcObject ?? null).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("cancel during a pending request invalidates it: a late stream is stopped, state stays idle", async () => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValue(pending.promise);
    await renderScanner();

    await click("Start scanning");
    await click("Cancel");
    expect(container.textContent).toContain("Start scanning");

    const { stream, tracks } = fakeStream();
    await act(async () => {
      pending.resolve(stream);
    });

    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(video().srcObject ?? null).toBeNull();
    // Still idle — the late resolution changed nothing.
    expect(container.textContent).toContain("Start scanning");
    expect(container.textContent).not.toContain("Point your camera");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("a permission rejection arriving after cancel does not flip the state to denied", async () => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValue(pending.promise);
    await renderScanner();

    await click("Start scanning");
    await click("Cancel");

    await act(async () => {
      pending.reject({ name: "NotAllowedError" });
    });

    expect(container.textContent).toContain("Start scanning");
    expect(container.textContent).not.toContain("Camera access was denied");
  });

  it("happy path unchanged: a prompt resolution attaches the stream and starts scanning", async () => {
    const { stream, tracks } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    await renderScanner();

    await click("Start scanning");

    expect(container.textContent).toContain("Point your camera");
    expect(video().srcObject).toBe(stream);
    expect(tracks[0].stop).not.toHaveBeenCalled();
    expect(tracks[1].stop).not.toHaveBeenCalled();
  });

  it("denied permission still lands on the denied state", async () => {
    getUserMedia.mockRejectedValue({ name: "NotAllowedError" });
    await renderScanner();

    await click("Start scanning");

    expect(container.textContent).toContain("Camera access was denied");
  });

  it("cancel during scanning stops the active stream", async () => {
    const { stream, tracks } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    await renderScanner();

    await click("Start scanning");
    expect(container.textContent).toContain("Point your camera");

    await click("Cancel");

    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Start scanning");
  });
});
