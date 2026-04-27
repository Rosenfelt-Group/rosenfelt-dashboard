"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

function RosablyIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 62" fill="none">
      <path d="M28 2C42 2 52 13 52 27C52 44 42 58 28 61C14 58 4 44 4 27C4 13 14 2 28 2Z" fill="#C16A34"/>
      <path d="M10 25C12 13 19 7 28 7C37 7 45 13 46 25" stroke="#F5EFE7" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity="0.72"/>
      <path d="M15 31C16 21 22 16 28 16C35 16 41 21 41 30" stroke="#F5EFE7" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity="0.85"/>
      <path d="M21 34C21 27 24 23 28 23C32 23 36 27 35 33" stroke="#F5EFE7" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.93"/>
      <path d="M25 37C27 34 31 34 33 37" stroke="#F5EFE7" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.9"/>
      <path d="M22 51C20 55 18 59 20 62" stroke="#F5EFE7" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.65"/>
      <path d="M34 51C36 55 38 59 36 62" stroke="#F5EFE7" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.65"/>
    </svg>
  );
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      router.push("/overview");
    } else {
      const data = await res.json();
      setError(data.error ?? "Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-offwhite">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="flex flex-col items-center gap-3">
          <RosablyIcon size={64} />
          <h1 className="text-2xl font-bold text-brand-black tracking-tight">Rosably</h1>
          <p className="text-sm text-brand-muted">AI that actually makes sense</p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="username" className="sr-only">Username</label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-brand-border placeholder-brand-muted text-brand-black rounded-t-md focus:outline-none focus:ring-brand-orange focus:border-brand-orange focus:z-10 sm:text-sm"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-brand-border placeholder-brand-muted text-brand-black rounded-b-md focus:outline-none focus:ring-brand-orange focus:border-brand-orange focus:z-10 sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="text-red-600 text-sm text-center">{error}</div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-brand-orange hover:bg-brand-orange/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-orange disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
