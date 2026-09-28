"use client";

import { FormEvent, useState } from "react";
import { supabase } from "./lib/supabase";

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const { data, error: loginError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (loginError) {
      setError("Не удалось войти. Проверь email и пароль.");
      setLoading(false);
      return;
    }

    if (!data.user) {
      setError("Пользователь не найден.");
      setLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, role, is_active")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile) {
      setError("Не удалось загрузить профиль сотрудника.");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    if (!profile.is_active) {
      setError("Эта учётная запись отключена.");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    localStorage.setItem(
      "nu_profile",
      JSON.stringify({
        id: data.user.id,
        name: profile.full_name,
        role: profile.role,
      })
    );

    window.location.href = "/dashboard";
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <section className="hidden w-1/2 flex-col justify-between border-r border-white/10 p-12 lg:flex">
          <div>
            <div className="text-sm font-semibold tracking-[0.25em] text-white/50">
              НЕ УСЛОЖНЯЙ
            </div>
          </div>

          <div>
            <h1 className="max-w-xl text-6xl font-semibold leading-[1.05] tracking-tight">
              Управление
              <br />
              без хаоса.
            </h1>

            <p className="mt-6 max-w-md text-lg leading-8 text-white/50">
              Задачи, дедлайны, ответственность и контроль команды
              в одном месте.
            </p>
          </div>

          <div className="text-sm text-white/30">
            Внутренняя система управления
          </div>
        </section>

        <section className="flex w-full items-center justify-center p-6 lg:w-1/2">
          <div className="w-full max-w-md">
            <div className="mb-10 lg:hidden">
              <div className="text-sm font-semibold tracking-[0.25em] text-white/50">
                НЕ УСЛОЖНЯЙ
              </div>
            </div>

            <div className="mb-8">
              <h2 className="text-3xl font-semibold tracking-tight">
                Вход
              </h2>
              <p className="mt-2 text-white/50">
                Войди в свою рабочую панель.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm text-white/60">
                  Email
                </label>

                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  placeholder="name@company.ru"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5 outline-none transition focus:border-white/30"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-white/60">
                  Пароль
                </label>

                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5 outline-none transition focus:border-white/30"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-white px-4 py-3.5 font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Входим..." : "Войти"}
              </button>
            </form>

            <div className="mt-8 border-t border-white/10 pt-6 text-sm text-white/30">
              Доступ только для сотрудников «Не Усложняй»
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
