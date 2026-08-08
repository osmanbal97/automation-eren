"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setSubmitting(false);

    if (!res.ok) {
      setError("Incorrect password.");
      return;
    }

    const destination = searchParams.get("from") || "/";
    router.replace(destination);
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <div className="aurora" aria-hidden />
      <div className="grain" aria-hidden />

      <div className="animate-rise w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="bg-accent-gradient mb-5 flex size-12 items-center justify-center rounded-2xl text-lg font-semibold text-white shadow-[0_16px_40px_-14px_rgba(139,92,246,0.95)]">
            ✦
          </span>
          <h1 className="text-gradient text-3xl font-semibold tracking-tight">Content Engine</h1>
          <p className="mt-2 text-sm text-fg-muted">
            Generate, review and ship short-form video on autopilot.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="glass rounded-panel p-7">
          <label className="mb-1.5 block text-xs font-medium tracking-wide text-fg-muted uppercase">
            Access password
          </label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="w-full rounded-lg border border-line bg-ink-900/70 px-4 py-3 text-sm tracking-widest text-fg outline-none transition placeholder:text-fg-subtle focus:border-accent-violet/60 focus:ring-2 focus:ring-accent-violet/25"
          />

          {error ? (
            <p className="mt-3 rounded-lg border border-danger/30 bg-danger-dim px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            disabled={submitting || password.length === 0}
            className={`mt-5 w-full py-3 ${submitting ? "shimmering" : ""}`}
          >
            {submitting ? "Verifying…" : "Enter console"}
          </Button>

          <p className="mt-5 text-center text-xs text-fg-subtle">
            Private console · single-operator access
          </p>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
