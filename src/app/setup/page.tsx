import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/current-user";
import { getSidebarData } from "@/articles/queries";
import { SetupWelcome } from "@/components/SetupWelcome";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  const userId = getCurrentUserId();
  const sidebar = getSidebarData(userId);
  if (sidebar.folders.length > 0 || sidebar.unfiledFeeds.length > 0) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex h-dvh max-w-lg flex-col items-center justify-center gap-8 px-4 text-center">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Welcome to Reader</h1>
        <p className="mt-2 text-muted">Import your existing subscriptions or add your first feed.</p>
      </div>
      <SetupWelcome />
    </main>
  );
}
