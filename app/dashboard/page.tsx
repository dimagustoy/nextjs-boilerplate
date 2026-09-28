"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Profile = {
  id: string;
  name: string;
  role: string;
};

export default function Dashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/";
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single();

      if (error || !data) {
        await supabase.auth.signOut();
        window.location.href = "/";
        return;
      }

      setProfile({
        id: user.id,
        name: data.full_name,
        role: data.role,
      });

      setLoading(false);
    }

    checkUser();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    localStorage.removeItem("nu_profile");
    window.location.href = "/";
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-white/50">Загрузка...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <div className="text-xs font-semibold tracking-[0.25em] text-white/40">
              НЕ УСЛОЖНЯЙ
            </div>
            <div className="mt-1 text-lg font-semibold">
              Система управления
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="text-right">
              <div className="text-sm font-medium">
                {profile?.name}
              </div>

              <div className="text-xs text-white/40">
                {profile?.role === "owner"
                  ? "Владелец"
                  : profile?.role === "manager"
                  ? "Управляющий"
                  : profile?.role}
              </div>
            </div>

            <button
              onClick={logout}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 transition hover:bg-white/5 hover:text-white"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-10">
          <p className="text-sm text-white/40">Рабочая панель</p>

          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            {profile?.name}, вот что происходит.
          </h1>
        </div>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Активные задачи" value="0" />
          <StatCard title="Просрочено" value="0" />
          <StatCard title="Под угрозой" value="0" />
          <StatCard title="На проверке" value="0" />
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 lg:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  Задачи
                </h2>
                <p className="mt-1 text-sm text-white/40">
                  Текущая работа команды
                </p>
              </div>

              {profile?.role === "owner" && (
                <button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">
                  + Новая задача
                </button>
              )}
            </div>

            <div className="mt-10 rounded-xl border border-dashed border-white/10 px-6 py-14 text-center">
              <div className="text-white/60">
                Задач пока нет
              </div>

              <div className="mt-2 text-sm text-white/30">
                Скоро здесь появится первая настоящая задача.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold">
              Команда
            </h2>

            <p className="mt-1 text-sm text-white/40">
              Контроль исполнения
            </p>

            <div className="mt-8 space-y-3">
              <TeamRow name="Дмитрий" role="Владелец" />
              <TeamRow name="Управляющий" role="Управляющий" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="text-sm text-white/40">{title}</div>
      <div className="mt-4 text-4xl font-semibold">{value}</div>
    </div>
  );
}

function TeamRow({
  name,
  role,
}: {
  name: string;
  role: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-3">
      <div>
        <div className="text-sm font-medium">{name}</div>
        <div className="mt-1 text-xs text-white/30">{role}</div>
      </div>

      <div className="h-2 w-2 rounded-full bg-emerald-400" />
    </div>
  );
}
