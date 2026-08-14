// Next.js calls register() exactly once when the server process starts
// (dev and prod). This is where the background feed-refresh scheduler is
// wired up, rather than a separate service/process.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DISABLE_SCHEDULER !== "true") {
    const { startScheduler } = await import("@/jobs/scheduler");
    startScheduler();
  }
}
