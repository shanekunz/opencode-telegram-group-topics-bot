import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";

const { globalEventMock, subscribeMock } = vi.hoisted(() => ({
  globalEventMock: vi.fn(),
  subscribeMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      event: globalEventMock,
    },
    event: {
      subscribe: subscribeMock,
    },
  },
}));

import {
  stopEventListening,
  subscribeToEvents,
  unsubscribeFromEvents,
} from "../../src/opencode/events.js";

function createStream(events: Event[]): AsyncGenerator<Event, void, unknown> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

function createOpenStream<T>(events: T[], signal: AbortSignal): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }

    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

function createAbortableStream(signal: AbortSignal): AsyncGenerator<Event, void, unknown> {
  return (async function* () {
    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
}

describe("opencode/events", () => {
  beforeEach(() => {
    globalEventMock.mockReset();
    subscribeMock.mockReset();
    globalEventMock.mockRejectedValue(new Error("global events unavailable"));
  });

  afterEach(() => {
    stopEventListening();
  });

  it("subscribes once per directory and forwards events", async () => {
    const eventA = {
      type: "session.status",
      properties: { sessionID: "s1", status: { type: "busy" } },
    } as unknown as Event;
    const eventB = {
      type: "session.idle",
      properties: { sessionID: "s1" },
    } as unknown as Event;
    subscribeMock.mockResolvedValueOnce({ stream: createStream([eventA, eventB]) });

    const callback = vi.fn();
    await subscribeToEvents("/repo/a", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith(
      { directory: "/repo/a" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("unwraps global event payloads before forwarding them", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockResolvedValueOnce({
      stream: createStream([{ directory: "/repo/a", payload: event } as unknown as Event]),
    });

    const callback = vi.fn();
    await subscribeToEvents("/repo/a", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(event);
    });

    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("ignores global events from other directories", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockImplementation(async (options: { signal: AbortSignal }) => ({
      stream: createOpenStream([{ directory: "/repo/b", payload: event }], options.signal),
    }));

    const callback = vi.fn();
    await subscribeToEvents("/repo/a", callback);

    await vi.waitFor(() => {
      expect(globalEventMock).toHaveBeenCalledTimes(1);
    });

    expect(callback).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("matches global event directories across Windows slash and drive casing differences", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockResolvedValueOnce({
      stream: createStream([{ directory: "d:/repo/", payload: event } as unknown as Event]),
    });

    const callback = vi.fn();
    await subscribeToEvents("D:\\repo", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(event);
    });

    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("falls back to legacy project events when global stream is unavailable", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock.mockRejectedValueOnce(new Error("global stream failed"));
    subscribeMock.mockResolvedValueOnce({ stream: createStream([event]) });

    const callback = vi.fn();
    await subscribeToEvents("/repo/a", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(event);
    });

    expect(globalEventMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith(
      { directory: "/repo/a" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not fall back to legacy events when OpenCode is unavailable", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    globalEventMock
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockImplementationOnce(async (options: { signal: AbortSignal }) => ({
        stream: createOpenStream([{ directory: "/repo/a", payload: event }], options.signal),
      }));

    const callback = vi.fn();
    await subscribeToEvents("/repo/a", callback);

    await vi.waitFor(
      () => {
        expect(callback).toHaveBeenCalledWith(event);
      },
      { timeout: 3000 },
    );

    expect(globalEventMock).toHaveBeenCalledTimes(2);
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("falls back to legacy project events when global stream ends without project events", async () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as Event;
    const serverConnected = { type: "server.connected", properties: {} } as Event;
    globalEventMock.mockResolvedValueOnce({
      stream: createStream([{ payload: serverConnected } as unknown as Event]),
    });
    subscribeMock.mockResolvedValueOnce({ stream: createStream([event]) });

    const callback = vi.fn();
    await subscribeToEvents("/repo/a", callback);

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith(event);
    });

    expect(globalEventMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it("does not start duplicate stream for same directory", async () => {
    subscribeMock.mockImplementation(async (_params, options: { signal: AbortSignal }) => ({
      stream: createAbortableStream(options.signal),
    }));

    const callbackA = vi.fn();
    const callbackB = vi.fn();

    await subscribeToEvents("/repo/a", callbackA);
    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(1);
    });

    await subscribeToEvents("/repo/a", callbackB);
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it("keeps existing stream when subscribing to another directory", async () => {
    let signalA: { aborted: boolean } | null = null;
    let signalB: { aborted: boolean } | null = null;

    subscribeMock
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        signalA = options.signal;
        return { stream: createAbortableStream(options.signal) };
      })
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => {
        signalB = options.signal;
        return { stream: createAbortableStream(options.signal) };
      });

    await subscribeToEvents("/repo/a", vi.fn());
    await subscribeToEvents("/repo/b", vi.fn());

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(2);
    });

    expect((signalA as { aborted: boolean } | null)?.aborted ?? null).toBe(false);
    expect((signalB as { aborted: boolean } | null)?.aborted ?? null).toBe(false);
  });

  it("can unsubscribe a callback without stopping other listeners", async () => {
    subscribeMock.mockImplementation(async (_params, options: { signal: AbortSignal }) => ({
      stream: createAbortableStream(options.signal),
    }));

    const callbackA = vi.fn();
    const callbackB = vi.fn();

    await subscribeToEvents("/repo/a", callbackA);
    await subscribeToEvents("/repo/a", callbackB);
    unsubscribeFromEvents("/repo/a", callbackA);

    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it("stops only requested directory listener", async () => {
    subscribeMock.mockImplementation(async (_params, options: { signal: AbortSignal }) => ({
      stream: createAbortableStream(options.signal),
    }));

    await subscribeToEvents("/repo/a", vi.fn());
    await subscribeToEvents("/repo/b", vi.fn());

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(2);
    });

    stopEventListening("/repo/a");

    await subscribeToEvents("/repo/a", vi.fn());

    await vi.waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledTimes(3);
    });
  });

  it("reconnects after stream end", async () => {
    subscribeMock
      .mockResolvedValueOnce({ stream: createStream([]) })
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => ({
        stream: createAbortableStream(options.signal),
      }));

    await subscribeToEvents("/repo/a", vi.fn());

    await vi.waitFor(
      () => {
        expect(subscribeMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
  });

  it("reconnects after non-fatal stream error", async () => {
    subscribeMock
      .mockRejectedValueOnce(new Error("transient error"))
      .mockImplementationOnce(async (_params, options: { signal: AbortSignal }) => ({
        stream: createAbortableStream(options.signal),
      }));

    await subscribeToEvents("/repo/a", vi.fn());

    await vi.waitFor(
      () => {
        expect(subscribeMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
  });
});
