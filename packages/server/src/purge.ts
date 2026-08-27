import { query } from "./db.js";

/**
 * Sample history has no foreign key to targets/collectors: cascading a delete
 * through a year of compressed hypertable chunks takes minutes and would hang
 * the HTTP request that triggered it. Deletes therefore drop the target row
 * immediately and hand the time-series cleanup to this queue, which walks the
 * data one day at a time so no single statement runs long.
 */

interface PurgeJob {
  targetId?: number;
  collectorId?: number;
}

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

const DAY_MS = 86_400_000;

const queue: PurgeJob[] = [];
let running = false;

/** Queue a background purge. Returns immediately; failures only get logged. */
export function schedulePurge(job: PurgeJob, log: Logger): void {
  queue.push(job);
  if (running) return;
  running = true;
  void drain(log).finally(() => {
    running = false;
  });
}

async function drain(log: Logger): Promise<void> {
  for (let job = queue.shift(); job; job = queue.shift()) {
    try {
      const deleted = await purge(job);
      log.info(`purged ${deleted} samples for ${describe(job)}`);
    } catch (err) {
      // Orphan rows are invisible to the API (every read joins live targets),
      // so a failed purge costs disk, not correctness — retention drops them.
      log.warn(`purge failed for ${describe(job)}: ${(err as Error).message}`);
    }
  }
}

function describe(job: PurgeJob): string {
  return job.targetId != null ? `target ${job.targetId}` : `collector ${job.collectorId}`;
}

async function purge(job: PurgeJob): Promise<number> {
  const column = job.targetId != null ? "target_id" : "collector_id";
  const id = job.targetId ?? job.collectorId;
  if (id == null) return 0;

  const { rows } = await query<{ oldest: Date | null; newest: Date | null }>(
    `SELECT min(time) AS oldest, max(time) AS newest FROM samples WHERE ${column} = $1`,
    [id],
  );
  const oldest = rows[0]?.oldest;
  const newest = rows[0]?.newest;
  if (!oldest || !newest) return 0;

  let deleted = 0;
  for (let from = oldest.getTime(); from <= newest.getTime(); from += DAY_MS) {
    const res = await query(
      `DELETE FROM samples WHERE ${column} = $1 AND time >= $2 AND time < $3`,
      [id, new Date(from).toISOString(), new Date(from + DAY_MS).toISOString()],
    );
    deleted += res.rowCount ?? 0;
  }
  return deleted;
}
