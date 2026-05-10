import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as cron from "node-cron";
import { db } from "../../db/postgres/postgres.js";
import { activeSessions } from "../../db/postgres/schema.js";
import { createServiceLogger } from "../../lib/logger/logger.js";

class SessionsService {
  private cleanupTask: cron.ScheduledTask | null = null;
  private logger = createServiceLogger("sessions");

  constructor() {}

  private initializeCleanupCron() {
    this.cleanupTask = cron.schedule(
      "* * * * *",
      async () => {
        try {
          const deletedCount = await this.cleanupOldSessions();
          // Uncomment for debugging
          this.logger.debug(`Cleaned up ${deletedCount} expired sessions`);
        } catch (error) {
          this.logger.error(error as Error, "Error during session cleanup");
        }
      },
      { timezone: "UTC" }
    );

    this.logger.info("Session cleanup cron initialized (runs every minute)");
  }
  async getExistingSession(userId: string, siteId: number) {
    const [existingSession] = await db
      .select()
      .from(activeSessions)
      .where(and(eq(activeSessions.userId, userId), eq(activeSessions.siteId, siteId)))
      .orderBy(desc(activeSessions.lastActivity), desc(activeSessions.startTime))
      .limit(1);

    return existingSession || null;
  }

  async updateSession({ userId, siteId }: { userId: string; siteId: number }): Promise<{ sessionId: string }> {
    return db.transaction(async tx => {
      // Serialize updates for a specific (siteId, userId) pair across app instances.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${siteId}, hashtext(${userId}))`);

      const existingSessions = await tx
        .select()
        .from(activeSessions)
        .where(and(eq(activeSessions.userId, userId), eq(activeSessions.siteId, siteId)))
        .orderBy(desc(activeSessions.lastActivity), desc(activeSessions.startTime));

      if (existingSessions.length > 0) {
        const primarySession = existingSessions[0];

        await tx
          .update(activeSessions)
          .set({
            lastActivity: new Date(),
          })
          .where(eq(activeSessions.sessionId, primarySession.sessionId));

        // Heal any pre-existing duplicates so events stop bouncing between session IDs.
        if (existingSessions.length > 1) {
          const duplicateSessionIds = existingSessions.slice(1).map(s => s.sessionId);
          await tx.delete(activeSessions).where(inArray(activeSessions.sessionId, duplicateSessionIds));
          this.logger.warn(
            { siteId, userId, duplicateCount: duplicateSessionIds.length },
            "Removed duplicate active sessions for user"
          );
        }

        return { sessionId: primarySession.sessionId };
      }

      const insertData = {
        sessionId: nanoid(14),
        siteId,
        userId,
        startTime: new Date(),
        lastActivity: new Date(),
      };

      await tx.insert(activeSessions).values(insertData);
      return { sessionId: insertData.sessionId };
    });
  }

  async cleanupOldSessions(): Promise<number> {
    // Delete sessions older than 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const deletedSessions = await db
      .delete(activeSessions)
      .where(lt(activeSessions.lastActivity, thirtyMinutesAgo))
      .returning();

    // this.logger.debug(`Cleaned up ${deletedSessions.length} sessions`);
    return deletedSessions.length;
  }

  // Method to stop the cleanup cron job (useful for graceful shutdown)
  startCleanupCron() {
    this.initializeCleanupCron();
  }

  stopCleanupCron() {
    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.logger.info("Session cleanup cron stopped");
    }
  }
}

export const sessionsService = new SessionsService();
