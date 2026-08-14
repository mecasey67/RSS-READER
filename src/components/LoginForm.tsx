"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/login/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState(loginAction, undefined);

  return (
    <main className="flex h-dvh items-center justify-center px-4">
      <form action={formAction} className="w-full max-w-xs">
        <h1 className="mb-1 text-xl font-bold tracking-tight text-foreground">Reader</h1>
        <p className="mb-4 text-sm text-muted">Enter the admin password to continue.</p>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          required
          className="w-full rounded border border-border bg-surface px-3 py-2 text-sm"
        />
        {state?.error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="mt-3 w-full rounded bg-accent py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
