"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { Brand } from "./dashboard/ui";

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);

  useEffect(() => {
    if (/#.*type=(invite|recovery)/.test(window.location.hash)) setSettingPassword(true);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setSettingPassword(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function requestNewLink() {
    if (!email.trim()) { setError("Введи email сотрудника."); return; }
    setLoading(true);
    setError("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setLoading(false);
    if (resetError) { setError("Не удалось отправить ссылку. Попробуй позже."); return; }
    setMessage("Ссылка для установки пароля отправлена на почту.");
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("Ссылка истекла. Введи email и запроси новую ссылку.");
      setSettingPassword(false);
      setLoading(false);
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) { setError(updateError.message); return; }
    window.location.href = "/dashboard";
  }

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
    <main className="nu-login min-h-screen bg-[#f6f4ef] text-stone-900">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <section className="nu-login-brand hidden w-1/2 flex-col justify-between p-12 lg:flex">
          <div>
            <Brand/>
          </div>

          <div>
            <h1 className="max-w-xl text-6xl font-semibold leading-[1.05] tracking-tight">
              Управление
              <br />
              без хаоса.
            </h1>

            <p className="mt-6 max-w-md text-lg leading-8 text-stone-600">
              Задачи, дедлайны, ответственность и контроль команды
              в одном месте.
            </p>
          </div>

          <div className="text-sm text-stone-500">
            Внутренняя система управления
          </div>
        </section>

        <section className="flex w-full items-center justify-center p-6 lg:w-1/2">
          <div className="w-full max-w-md">
            <div className="mb-10 lg:hidden">
              <Brand/>
            </div>

            <div className="mb-8">
              <h2 className="text-3xl font-semibold tracking-tight">
                Вход
              </h2>
              <p className="mt-2 text-stone-600">
                {settingPassword ? "Придумай пароль для входа." : "Войди в свою рабочую панель."}
              </p>
            </div>

            <form onSubmit={settingPassword ? savePassword : handleLogin} className="space-y-5">
              {!settingPassword && (
              <div>
                <label className="mb-2 block text-sm text-stone-600">
                  Email
                </label>

                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  placeholder="name@company.ru"
                  className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3.5 outline-none transition focus:border-orange-500"
                />
              </div>
              )}

              <div>
                <label className="mb-2 block text-sm text-stone-600">
                  Пароль
                </label>

                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete={settingPassword ? "new-password" : "current-password"}
                  minLength={settingPassword ? 8 : undefined}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3.5 outline-none transition focus:border-orange-500"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              {message && <p className="text-sm text-emerald-700">{message}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#ff641f] px-4 py-3.5 font-medium text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Подожди..." : settingPassword ? "Установить пароль" : "Войти"}
              </button>
            </form>
            {!settingPassword && <button type="button" disabled={loading} onClick={requestNewLink} className="mt-4 text-sm text-stone-600 underline hover:text-orange-700">Получить ссылку для установки пароля</button>}

            <div className="mt-8 border-t border-stone-200 pt-6 text-sm text-stone-500">
              Доступ только для сотрудников «Не Усложняй»
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

