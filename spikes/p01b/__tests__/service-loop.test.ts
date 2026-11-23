import {
  runServiceLoop,
  type LoopPort,
  type ServiceTask,
} from '../service-loop';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  const state = { generation: 1, running: true };
  const writes: Uint8Array[] = [];
  const port = {
    serviceState: () => ({ ...state }),
    workChunk: jest.fn(async (_generation: number, bytes: Uint8Array) => {
      writes.push(bytes);
      bytes[0] = 7;
      return bytes.length;
    }),
    poke: jest.fn(
      (generation: number, _sequence: number) =>
        generation === state.generation && state.running,
    ),
    waitForRecord: jest.fn(
      async (_generation: number, _milliseconds: number): Promise<boolean> =>
        false,
    ),
    stopGeneration: jest.fn((generation: number) => {
      if (generation !== state.generation) return false;
      state.running = false;
      return true;
    }),
  } satisfies LoopPort;
  const task: ServiceTask = { generation: 1, scheduler: 'native-paced' };
  const jsWait = jest.fn(async (_milliseconds: number) => {});
  return { state, writes, port, task, jsWait };
}

test('cancellation during native I/O discards late progress and wipes the owned chunk', async () => {
  const { state, writes, port, task, jsWait } = setup();
  const io = deferred<number>();
  port.workChunk.mockImplementation(async (_g, bytes) => {
    writes.push(bytes);
    bytes[0] = 9;
    return io.promise;
  });
  const done = runServiceLoop(port, task, jsWait);
  state.running = false;
  io.resolve(1048576);
  await done;
  expect(port.poke).not.toHaveBeenCalled();
  expect(port.waitForRecord).not.toHaveBeenCalled();
  expect(writes[0]!.every((x) => x === 0)).toBe(true);
});

test('native wait cancellation exits without another write or using a JS timer', async () => {
  const { state, writes, port, task, jsWait } = setup();
  const waiting = deferred<boolean>();
  const entered = deferred<void>();
  port.waitForRecord.mockImplementation(async () => {
    entered.resolve();
    return waiting.promise;
  });
  const done = runServiceLoop(port, task, jsWait);
  await entered.promise;
  state.running = false;
  waiting.resolve(false);
  await done;
  expect(port.workChunk).toHaveBeenCalledTimes(1);
  expect(jsWait).not.toHaveBeenCalled();
  expect(writes[0]![0]).toBe(0);
});

test('a late I/O rejection is stopped by old generation, leaving a newer job running', async () => {
  const { state, port, task, jsWait } = setup();
  const io = deferred<number>();
  port.workChunk.mockImplementation(async () => io.promise);
  const done = runServiceLoop(port, task, jsWait);
  state.generation = 2;
  io.reject(new Error('TEST_IO_ERROR'));
  expect((await done).failed).toBe(true);
  expect(port.stopGeneration).toHaveBeenCalledWith(1);
  expect(state.running).toBe(true);
});

test('a late successful wait cannot start writes for a replacement job', async () => {
  const { state, port, task, jsWait } = setup();
  const waiting = deferred<boolean>();
  const entered = deferred<void>();
  port.waitForRecord.mockImplementation(async () => {
    entered.resolve();
    return waiting.promise;
  });
  const done = runServiceLoop(port, task, jsWait);
  await entered.promise;
  state.generation = 2;
  waiting.resolve(true);
  await done;
  expect(port.workChunk).toHaveBeenCalledTimes(1);
  expect(port.stopGeneration).not.toHaveBeenCalled();
  expect(state.running).toBe(true);
});
