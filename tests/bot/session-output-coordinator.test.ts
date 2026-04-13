import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionOutputCoordinator } from "../../src/bot/session-output-coordinator.js";

describe("bot/session-output-coordinator", () => {
  function createCoordinator(overrides?: {
    onFinalizeSession?: ReturnType<typeof vi.fn>;
    onFinalDeliveryCommitted?: ReturnType<typeof vi.fn>;
  }): SessionOutputCoordinator {
    return new SessionOutputCoordinator({
      settleMs: 100,
      onFinalizeSession: overrides?.onFinalizeSession ?? vi.fn().mockResolvedValue(true),
      onFinalDeliveryCommitted:
        overrides?.onFinalDeliveryCommitted ?? vi.fn().mockResolvedValue(undefined),
      handlers: {
        onAssistantUpdate: vi.fn().mockResolvedValue(undefined),
        onAssistantComplete: vi.fn().mockResolvedValue(undefined),
        onTool: vi.fn().mockResolvedValue(undefined),
        onSubagent: vi.fn().mockResolvedValue(undefined),
        onToolFile: vi.fn().mockResolvedValue(undefined),
        onQuestion: vi.fn().mockResolvedValue(undefined),
        onPermission: vi.fn().mockResolvedValue(undefined),
        onThinking: vi.fn().mockResolvedValue(undefined),
        onSessionError: vi.fn().mockResolvedValue(undefined),
        onSessionRetry: vi.fn().mockResolvedValue(undefined),
      },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("runs session tasks sequentially", async () => {
    const calls: string[] = [];
    const coordinator = createCoordinator();

    coordinator.enqueue("s1", async () => {
      calls.push("first:start");
      await Promise.resolve();
      calls.push("first:end");
    });

    coordinator.enqueue("s1", async () => {
      calls.push("second");
    });

    await vi.runAllTimersAsync();

    expect(calls).toEqual(["first:start", "first:end", "second"]);
  });

  it("delays finalization until the session has been quiet for settleMs", async () => {
    const onFinalizeSession = vi.fn().mockResolvedValue(true);
    const coordinator = createCoordinator({ onFinalizeSession });

    coordinator.markActivity("s1");
    coordinator.scheduleFinalDelivery("s1");

    await vi.advanceTimersByTimeAsync(80);
    coordinator.markActivity("s1");
    await vi.advanceTimersByTimeAsync(80);

    expect(onFinalizeSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(onFinalizeSession).toHaveBeenCalledTimes(1);
    expect(onFinalizeSession).toHaveBeenCalledWith("s1", null);
  });

  it("cancels pending finalization", async () => {
    const onFinalizeSession = vi.fn().mockResolvedValue(true);
    const coordinator = createCoordinator({ onFinalizeSession });

    coordinator.scheduleFinalDelivery("s1");
    coordinator.cancelFinalDelivery("s1");

    await vi.runAllTimersAsync();

    expect(onFinalizeSession).not.toHaveBeenCalled();
  });

  it("dispatches typed actions to the matching handlers in session order", async () => {
    const calls: string[] = [];
    const coordinator = new SessionOutputCoordinator({
      settleMs: 100,
      onFinalizeSession: vi.fn().mockResolvedValue(true),
      onFinalDeliveryCommitted: vi.fn().mockResolvedValue(undefined),
      handlers: {
        onAssistantUpdate: vi.fn(async () => {
          calls.push("assistant_update:start");
          await Promise.resolve();
          calls.push("assistant_update:end");
        }),
        onAssistantComplete: vi.fn(async () => {
          calls.push("assistant_complete");
        }),
        onTool: vi.fn(async () => {
          calls.push("tool");
        }),
        onSubagent: vi.fn().mockResolvedValue(undefined),
        onToolFile: vi.fn().mockResolvedValue(undefined),
        onQuestion: vi.fn().mockResolvedValue(undefined),
        onPermission: vi.fn().mockResolvedValue(undefined),
        onThinking: vi.fn().mockResolvedValue(undefined),
        onSessionError: vi.fn().mockResolvedValue(undefined),
        onSessionRetry: vi.fn().mockResolvedValue(undefined),
      },
    });

    coordinator.dispatch({ kind: "assistant_update", sessionId: "s1", messageId: "m1", text: "a" });
    coordinator.dispatch({
      kind: "tool",
      sessionId: "s1",
      toolInfo: {} as never,
      visibleToUser: true,
    });
    coordinator.dispatch({
      kind: "assistant_complete",
      sessionId: "s1",
      messageId: "m1",
      text: "done",
    });

    await vi.runAllTimersAsync();

    expect(calls).toEqual([
      "assistant_update:start",
      "assistant_update:end",
      "tool",
      "assistant_complete",
    ]);
  });

  it("routes session errors through the error handler and cancels pending finalization", async () => {
    const onFinalizeSession = vi.fn().mockResolvedValue(true);
    const onSessionError = vi.fn().mockResolvedValue(undefined);
    const coordinator = new SessionOutputCoordinator({
      settleMs: 100,
      onFinalizeSession,
      onFinalDeliveryCommitted: vi.fn().mockResolvedValue(undefined),
      handlers: {
        onAssistantUpdate: vi.fn().mockResolvedValue(undefined),
        onAssistantComplete: vi.fn().mockResolvedValue(undefined),
        onTool: vi.fn().mockResolvedValue(undefined),
        onSubagent: vi.fn().mockResolvedValue(undefined),
        onToolFile: vi.fn().mockResolvedValue(undefined),
        onQuestion: vi.fn().mockResolvedValue(undefined),
        onPermission: vi.fn().mockResolvedValue(undefined),
        onThinking: vi.fn().mockResolvedValue(undefined),
        onSessionError,
        onSessionRetry: vi.fn().mockResolvedValue(undefined),
      },
    });

    coordinator.dispatch({ kind: "session_idle", sessionId: "s1" });
    coordinator.dispatch({ kind: "session_error", sessionId: "s1", message: "boom" });

    await vi.runAllTimersAsync();

    expect(onSessionError).toHaveBeenCalledWith({
      kind: "session_error",
      sessionId: "s1",
      message: "boom",
    });
    expect(onFinalizeSession).not.toHaveBeenCalled();
  });

  it("reschedules finalization when a visible tool action arrives", async () => {
    const onFinalizeSession = vi.fn().mockResolvedValue(true);
    const coordinator = createCoordinator({ onFinalizeSession });

    coordinator.dispatch({ kind: "session_idle", sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(80);
    coordinator.dispatch({
      kind: "tool",
      sessionId: "s1",
      toolInfo: {} as never,
      visibleToUser: true,
    });
    await vi.advanceTimersByTimeAsync(80);

    expect(onFinalizeSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(onFinalizeSession).toHaveBeenCalledTimes(1);
  });

  it("does not reschedule finalization for hidden tool actions", async () => {
    const onFinalizeSession = vi.fn().mockResolvedValue(true);
    const coordinator = createCoordinator({ onFinalizeSession });

    coordinator.dispatch({ kind: "session_idle", sessionId: "s1" });
    await vi.advanceTimersByTimeAsync(80);
    coordinator.dispatch({
      kind: "tool",
      sessionId: "s1",
      toolInfo: {} as never,
      visibleToUser: false,
    });
    await vi.advanceTimersByTimeAsync(20);

    expect(onFinalizeSession).toHaveBeenCalledTimes(1);
  });

  it("passes the latest assistant completion text into finalization", async () => {
    const onFinalizeSession = vi.fn().mockResolvedValue(true);
    const coordinator = createCoordinator({ onFinalizeSession });

    coordinator.dispatch({
      kind: "assistant_complete",
      sessionId: "s1",
      messageId: "m1",
      text: "First",
    });
    coordinator.dispatch({
      kind: "assistant_complete",
      sessionId: "s1",
      messageId: "m2",
      text: "Second",
    });
    coordinator.dispatch({ kind: "session_idle", sessionId: "s1" });

    await vi.runAllTimersAsync();

    expect(onFinalizeSession).toHaveBeenCalledTimes(1);
    expect(onFinalizeSession).toHaveBeenCalledWith("s1", "Second");
  });

  it("keeps the pending completion when finalization reports failure", async () => {
    const onFinalizeSession = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const coordinator = createCoordinator({ onFinalizeSession });

    coordinator.dispatch({
      kind: "assistant_complete",
      sessionId: "s1",
      messageId: "m1",
      text: "Retry me",
    });
    coordinator.dispatch({ kind: "session_idle", sessionId: "s1" });

    await vi.advanceTimersByTimeAsync(100);
    expect(onFinalizeSession).toHaveBeenNthCalledWith(1, "s1", "Retry me");

    await vi.advanceTimersByTimeAsync(100);
    expect(onFinalizeSession).toHaveBeenNthCalledWith(2, "s1", "Retry me");
  });

  it("flushes pending final delivery immediately for the next prompt", async () => {
    const onFinalizeSession = vi.fn().mockResolvedValue(true);
    const onFinalDeliveryCommitted = vi.fn().mockResolvedValue(undefined);
    const coordinator = createCoordinator({ onFinalizeSession, onFinalDeliveryCommitted });

    coordinator.dispatch({
      kind: "assistant_complete",
      sessionId: "s1",
      messageId: "m1",
      text: "Reply",
    });
    coordinator.dispatch({ kind: "session_idle", sessionId: "s1" });

    const flushed = await coordinator.flushPendingFinalDelivery("s1");

    expect(flushed).toBe(true);
    expect(onFinalizeSession).toHaveBeenCalledTimes(1);
    expect(onFinalizeSession).toHaveBeenCalledWith("s1", "Reply");
    expect(onFinalDeliveryCommitted).toHaveBeenCalledWith("s1");
  });

  it("does not commit an older finalization when a newer completion arrives during delivery", async () => {
    let releaseFirstFinalize: (() => void) | null = null;
    const onFinalizeSession = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            releaseFirstFinalize = () => resolve(true);
          }),
      )
      .mockResolvedValueOnce(true);
    const onFinalDeliveryCommitted = vi.fn().mockResolvedValue(undefined);
    const coordinator = createCoordinator({ onFinalizeSession, onFinalDeliveryCommitted });

    coordinator.dispatch({
      kind: "assistant_complete",
      sessionId: "s1",
      messageId: "m1",
      text: "Old",
    });
    coordinator.dispatch({ kind: "session_idle", sessionId: "s1" });

    await vi.advanceTimersByTimeAsync(100);
    expect(onFinalizeSession).toHaveBeenNthCalledWith(1, "s1", "Old");

    coordinator.dispatch({
      kind: "assistant_complete",
      sessionId: "s1",
      messageId: "m2",
      text: "New",
    });
    releaseFirstFinalize?.();
    await Promise.resolve();

    expect(onFinalDeliveryCommitted).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(onFinalizeSession).toHaveBeenNthCalledWith(2, "s1", "New");
    expect(onFinalDeliveryCommitted).toHaveBeenCalledTimes(1);
    expect(onFinalDeliveryCommitted).toHaveBeenCalledWith("s1");
  });
});
