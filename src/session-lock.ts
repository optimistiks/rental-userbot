import Database from "better-sqlite3";

import { SESSION_LOCK_PATH } from "./config.js";

interface SessionLock {
  release: () => void;
}

/**
 * Guards the Telegram session: the daemon and `login` must never run at once, or
 * Telegram sees one auth key on two clients and revokes the session.
 *
 * The lock is a SQLite write transaction held for the life of the process, so the
 * operating system drops it when the process dies. A crash never leaves a stale
 * lock behind.
 */
function acquireSessionLock(lockPath: string = SESSION_LOCK_PATH): SessionLock {
  const database = new Database(lockPath);

  try {
    // No waiting: a second instance must fail immediately, not queue behind the first.
    database.pragma("busy_timeout = 0");
    database.pragma("locking_mode = EXCLUSIVE");
    database.exec("CREATE TABLE IF NOT EXISTS session_lock (id INTEGER PRIMARY KEY)");
    database.exec("BEGIN IMMEDIATE");
  } catch (error) {
    database.close();
    throw new Error(
      `Another instance is already using the Telegram session ("${lockPath}"). Stop the daemon before running login.`,
      { cause: error },
    );
  }

  return {
    release() {
      try {
        database.exec("ROLLBACK");
      } catch {
        // The transaction is gone already; closing is what matters.
      }
      database.close();
    },
  };
}

export { type SessionLock, acquireSessionLock };
