// Development-only control loop. Injectable so stop/restart races can be checked offline.
export const schedulers = [
  'js-timer',
  'native-paced',
  'native-steady',
  'native-slow',
] as const;
export type Scheduler = (typeof schedulers)[number];
export type ServiceTask = { generation: number; scheduler: Scheduler };
export type LoopPort = {
  serviceState(): { generation: number; running: boolean };
  workChunk(generation: number, bytes: Uint8Array): Promise<number>;
  poke(generation: number, sequence: number): boolean;
  waitForRecord(generation: number, milliseconds: number): Promise<boolean>;
  stopGeneration(generation: number): boolean;
};
export function isServiceTask(value: unknown): value is ServiceTask {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(data.generation) &&
    (data.generation as number) > 0 &&
    schedulers.some((mode) => mode === data.scheduler)
  );
}
export async function runServiceLoop(
  port: LoopPort,
  task: ServiceTask,
  jsWait: (milliseconds: number) => Promise<void>,
) {
  const chunk = new Uint8Array(1048576);
  const active = () => {
    const state = port.serviceState();
    return state.generation === task.generation && state.running;
  };
  let sequence = 0;
  let failed = false;
  try {
    while (active()) {
      const bytes = await port.workChunk(task.generation, chunk);
      // Cancellation may arrive during native I/O. Never publish late progress.
      if (!bytes || !active()) break;
      if (!port.poke(task.generation, sequence + 1)) break;
      sequence++;
      if (task.scheduler === 'js-timer') await jsWait(200);
      else {
        const delay =
          task.scheduler === 'native-steady'
            ? 0
            : task.scheduler === 'native-slow'
              ? 1000
              : 200;
        if (!(await port.waitForRecord(task.generation, delay))) break;
      }
    }
  } catch {
    failed = true;
    // Native also checks the generation, so a late rejection cannot stop a new job.
    port.stopGeneration(task.generation);
  } finally {
    chunk.fill(0);
  }
  return { sequence, failed };
}
