import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentDefinition, RunDefinition, TaskExecutor } from "../src/domain.js";
import { InMemoryEventStore, JsonlEventStore } from "../src/event-store.js";
import { ExecutionCoordinator } from "../src/execution-coordinator.js";
import { ProcessSharedCapacity } from "../src/process-shared-provider.js";
import { MultiAgentScheduler } from "../src/scheduler.js";

const researcher: AgentDefinition = {
  id: "researcher",
  role: "researcher",
  instructions: "Collect evidence.",
  capabilities: ["research"],
  maxParallelTasks: 3,
};

const integrator: AgentDefinition = {
  id: "integrator",
  role: "integrator",
  instructions: "Integrate verified outputs.",
  capabilities: ["integrate"],
  maxParallelTasks: 1,
};

test("runs three tasks concurrently and waits before integration", async () => {
  const store = new InMemoryEventStore();
  const scheduler = new MultiAgentScheduler({ eventStore: store, globalConcurrency: 3 });
  const started: string[] = [];
  const completed: string[] = [];
  const gate = deferred<void>();

  const executor: TaskExecutor = {
    async execute({ task }) {
      started.push(task.id);
      if (task.id !== "integrate") {
        await gate.promise;
      }
      completed.push(task.id);
      return task.id;
    },
  };

  const runPromise = scheduler.run(
    makeRun({
      agents: [researcher, integrator],
      tasks: [
        task("research-a", "research", { resourceId: "main", access: "read" }),
        task("research-b", "research", { resourceId: "main", access: "read" }),
        task("research-c", "research", { resourceId: "main", access: "read" }),
        {
          ...task("integrate", "integrate", { resourceId: "main", access: "write" }),
          dependsOn: ["research-a", "research-b", "research-c"],
        },
      ],
    }),
    executor,
  );

  await waitUntil(() => started.length === 3);
  assert.deepEqual(new Set(started), new Set(["research-a", "research-b", "research-c"]));
  assert.equal(started.includes("integrate"), false);

  gate.resolve();
  const summary = await runPromise;
  assert.equal(summary.status, "succeeded");
  assert.equal(completed.at(-1), "integrate");
});

test("honors agent capacity independently from global concurrency", async () => {
  const store = new InMemoryEventStore();
  const scheduler = new MultiAgentScheduler({ eventStore: store, globalConcurrency: 3 });
  const singleCapacityAgent = { ...researcher, maxParallelTasks: 1 };
  let active = 0;
  let maxActive = 0;

  const summary = await scheduler.run(
    makeRun({
      agents: [singleCapacityAgent],
      tasks: [task("a", "research"), task("b", "research"), task("c", "research")],
    }),
    {
      async execute() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
      },
    },
  );

  assert.equal(summary.status, "succeeded");
  assert.equal(maxActive, 1);
});

test("allows shared reads but waits to write the shared workspace", async () => {
  const store = new InMemoryEventStore();
  const scheduler = new MultiAgentScheduler({ eventStore: store, globalConcurrency: 3 });
  const readersStarted: string[] = [];
  let writerStarted = false;
  const gate = deferred<void>();

  const runPromise = scheduler.run(
    makeRun({
      agents: [researcher, { ...integrator, capabilities: ["research", "integrate"] }],
      tasks: [
        task("read-a", "research", { resourceId: "main", access: "read" }),
        task("read-b", "research", { resourceId: "main", access: "read" }),
        task("write", "integrate", { resourceId: "main", access: "write" }),
      ],
    }),
    {
      async execute({ task }) {
        if (task.id.startsWith("read")) {
          readersStarted.push(task.id);
          await gate.promise;
        } else {
          writerStarted = true;
        }
      },
    },
  );

  await waitUntil(() => readersStarted.length === 2);
  assert.equal(writerStarted, false);
  gate.resolve();
  const summary = await runPromise;
  assert.equal(summary.status, "succeeded");
  assert.equal(writerStarted, true);
});

test("allows concurrent writes in separate isolated workspaces", async () => {
  const store = new InMemoryEventStore();
  const scheduler = new MultiAgentScheduler({ eventStore: store, globalConcurrency: 2 });
  const started: string[] = [];
  const gate = deferred<void>();

  const runPromise = scheduler.run(
    makeRun({
      agents: [{ ...researcher, capabilities: ["code"], maxParallelTasks: 2 }],
      tasks: [
        task("code-a", "code", {
          resourceId: "main",
          access: "write",
          isolationKey: "worktree-a",
        }),
        task("code-b", "code", {
          resourceId: "main",
          access: "write",
          isolationKey: "worktree-b",
        }),
      ],
    }),
    {
      async execute({ task: currentTask }) {
        started.push(currentTask.id);
        await gate.promise;
      },
    },
  );

  await waitUntil(() => started.length === 2);
  gate.resolve();
  assert.equal((await runPromise).status, "succeeded");
});

test("shares the global concurrency limit across separate runs", async () => {
  const coordinator = new ExecutionCoordinator(2);
  const gate = deferred<void>();
  let active = 0;
  let maxActive = 0;
  const executor: TaskExecutor = {
    async execute() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
    },
  };
  const makeScheduler = () => new MultiAgentScheduler({
    eventStore: new InMemoryEventStore(),
    globalConcurrency: 2,
    executionCoordinator: coordinator,
  });
  const makeConcurrentRun = (id: string): RunDefinition => ({
    id,
    goal: "share global capacity",
    agents: [researcher],
    tasks: [task(`${id}-a`, "research"), task(`${id}-b`, "research")],
  });

  const first = makeScheduler().run(makeConcurrentRun("run-a"), executor);
  const second = makeScheduler().run(makeConcurrentRun("run-b"), executor);
  await waitUntil(() => coordinator.activeCount === 2);

  assert.equal(maxActive, 2);
  gate.resolve();
  assert.deepEqual((await Promise.all([first, second])).map((run) => run.status), [
    "succeeded",
    "succeeded",
  ]);
  assert.equal(coordinator.activeCount, 0);
});

test("shares task capacity across separate scheduler instances through file leases", async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), "localbuddy-process-task-capacity-"));
  context.after(async () => rm(stateRoot, { recursive: true, force: true }));
  const capacityA = new ProcessSharedCapacity({ namespace: "tasks", stateRoot, limit: 1 });
  const capacityB = new ProcessSharedCapacity({ namespace: "tasks", stateRoot, limit: 1 });
  let active = 0;
  let maximum = 0;
  const gate = deferred<void>();
  const executor: TaskExecutor = {
    async execute() {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate.promise;
      active -= 1;
    },
  };
  const runA = new MultiAgentScheduler({
    eventStore: new InMemoryEventStore(),
    processCapacity: capacityA,
  }).run({
    ...makeRun({ agents: [researcher], tasks: [task("a", "research")] }),
    id: "process-run-a",
  }, executor);
  const runB = new MultiAgentScheduler({
    eventStore: new InMemoryEventStore(),
    processCapacity: capacityB,
  }).run({
    ...makeRun({ agents: [researcher], tasks: [task("b", "research")] }),
    id: "process-run-b",
  }, executor);

  await waitUntil(() => active === 1);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  assert.equal(maximum, 1);
  gate.resolve();
  await Promise.all([runA, runB]);
  assert.equal(maximum, 1);
});

test("serializes writes to the same workspace across separate runs", async () => {
  const coordinator = new ExecutionCoordinator(2);
  const firstGate = deferred<void>();
  let firstStarted = false;
  let secondStarted = false;
  const schedulerOptions = {
    globalConcurrency: 1,
    executionCoordinator: coordinator,
  };
  const writeRun = (id: string): RunDefinition => ({
    id,
    goal: "write shared workspace",
    agents: [{ ...researcher, capabilities: ["write"], maxParallelTasks: 1 }],
    tasks: [task("write", "write", { resourceId: "/shared/repo", access: "write" })],
  });

  const first = new MultiAgentScheduler({
    ...schedulerOptions,
    eventStore: new InMemoryEventStore(),
  }).run(writeRun("run-write-a"), {
    async execute() {
      firstStarted = true;
      await firstGate.promise;
    },
  });
  await waitUntil(() => firstStarted);
  const second = new MultiAgentScheduler({
    ...schedulerOptions,
    eventStore: new InMemoryEventStore(),
  }).run(writeRun("run-write-b"), {
    async execute() {
      secondStarted = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondStarted, false);

  firstGate.resolve();
  await first;
  await waitUntil(() => secondStarted);
  assert.equal((await second).status, "succeeded");
});

test("blocks downstream tasks after a dependency failure", async () => {
  const store = new InMemoryEventStore();
  const scheduler = new MultiAgentScheduler({ eventStore: store });
  const summary = await scheduler.run(
    makeRun({
      agents: [researcher, integrator],
      tasks: [
        task("source", "research"),
        { ...task("report", "integrate"), dependsOn: ["source"] },
      ],
    }),
    {
      async execute({ task: currentTask }) {
        if (currentTask.id === "source") {
          throw new Error("source unavailable");
        }
      },
    },
  );

  assert.equal(summary.status, "failed");
  assert.equal(summary.tasks.get("source")?.status, "failed");
  assert.equal(summary.tasks.get("report")?.status, "blocked");
  const events = await store.list(summary.runId);
  assert.ok(events.some((event) => event.type === "task.blocked"));
});

test("restores succeeded task outputs and executes only unfinished tasks", async () => {
  const store = new InMemoryEventStore();
  const scheduler = new MultiAgentScheduler({ eventStore: store });
  const executed: string[] = [];
  const definition = makeRun({
    agents: [researcher, integrator],
    tasks: [
      task("source", "research"),
      { ...task("report", "integrate"), dependsOn: ["source"], agentId: "integrator" },
    ],
  });
  const summary = await scheduler.run(
    definition,
    {
      async execute({ task: currentTask, dependencyOutputs }) {
        executed.push(currentTask.id);
        assert.equal(dependencyOutputs.get("source"), "restored output");
        return "integrated";
      },
    },
    undefined,
    {
      tasks: new Map([
        ["source", { status: "succeeded", agentId: "researcher", output: "restored output" }],
        ["report", { status: "queued", agentId: "integrator" }],
      ]),
    },
  );

  assert.deepEqual(executed, ["report"]);
  assert.equal(summary.status, "succeeded");
  const events = await store.list(definition.id);
  assert.ok(events.some((event) =>
    event.type === "checkpoint.restored"
    && event.taskId === "source"
    && event.data?.status === "succeeded"));
});

test("persists append-only events with monotonic sequences", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-events-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "events.jsonl");
  const store = new JsonlEventStore(filePath, () => new Date("2026-08-07T00:00:00.000Z"));

  await Promise.all([
    store.append({ type: "run.started", runId: "run-a" }),
    store.append({ type: "task.queued", runId: "run-a", taskId: "task-a" }),
    store.append({ type: "task.started", runId: "run-a", taskId: "task-a" }),
  ]);

  const events = await store.list("run-a");
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  assert.equal((await readFile(filePath, "utf8")).trim().split("\n").length, 3);

  const reopenedStore = new JsonlEventStore(filePath);
  const appendedAfterRestart = await reopenedStore.append({
    type: "task.succeeded",
    runId: "run-a",
    taskId: "task-a",
  });
  assert.equal(appendedAfterRestart.sequence, 4);
  assert.equal((await reopenedStore.list("run-a")).length, 4);
});

test("rejects cyclic graphs before execution", async () => {
  const scheduler = new MultiAgentScheduler({ eventStore: new InMemoryEventStore() });
  await assert.rejects(
    scheduler.run(
      makeRun({
        agents: [researcher],
        tasks: [
          { ...task("a", "research"), dependsOn: ["b"] },
          { ...task("b", "research"), dependsOn: ["a"] },
        ],
      }),
      { async execute() {} },
    ),
    /cycle/,
  );
});

test("cancels queued tasks when the run is aborted before scheduling", async () => {
  const controller = new AbortController();
  controller.abort();
  const store = new InMemoryEventStore();
  const scheduler = new MultiAgentScheduler({ eventStore: store });
  let executions = 0;

  const summary = await scheduler.run(
    makeRun({ agents: [researcher], tasks: [task("a", "research"), task("b", "research")] }),
    {
      async execute() {
        executions += 1;
      },
    },
    controller.signal,
  );

  assert.equal(summary.status, "cancelled");
  assert.equal(executions, 0);
  assert.ok([...summary.tasks.values()].every((record) => record.status === "cancelled"));
});

test("rejects a task without a compatible agent", async () => {
  const scheduler = new MultiAgentScheduler({ eventStore: new InMemoryEventStore() });
  await assert.rejects(
    scheduler.run(
      makeRun({ agents: [researcher], tasks: [task("compile", "code")] }),
      { async execute() {} },
    ),
    /no compatible agent/,
  );
});

function makeRun(input: Pick<RunDefinition, "agents" | "tasks">): RunDefinition {
  return { id: "run-1", goal: "Test a multi-agent plan", ...input };
}

function task(
  id: string,
  capability: string,
  workspace?: { resourceId: string; access: "read" | "write"; isolationKey?: string },
) {
  return {
    id,
    title: id,
    input: {},
    requiredCapabilities: [capability],
    workspace,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Condition was not met before timeout");
}
