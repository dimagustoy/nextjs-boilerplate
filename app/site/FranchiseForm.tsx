"use client";

import { FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";
import styles from "./site.module.css";

export default function FranchiseForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus("sending");

    const { error } = await supabase.from("site_franchise_leads").insert({
      full_name: String(form.get("full_name") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
      city: String(form.get("city") || "").trim(),
      budget: String(form.get("budget") || "").trim() || null,
      source: "website",
    });

    if (error) {
      setStatus("error");
      return;
    }

    event.currentTarget.reset();
    setStatus("success");
  }

  return (
    <form className={styles.franchiseForm} onSubmit={submit}>
      <input name="full_name" required minLength={2} maxLength={120} placeholder="Имя" />
      <input name="phone" required minLength={5} maxLength={40} placeholder="Телефон" />
      <input name="city" required minLength={2} maxLength={120} placeholder="Город" />
      <select name="budget" defaultValue="">
        <option value="" disabled>Бюджет</option>
        <option value="до 5 млн ₽">до 5 млн ₽</option>
        <option value="5–10 млн ₽">5–10 млн ₽</option>
        <option value="10–15 млн ₽">10–15 млн ₽</option>
        <option value="15+ млн ₽">15+ млн ₽</option>
      </select>
      <button type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Отправляем…" : "Получить условия"}
      </button>
      {status === "success" && <p className={styles.formSuccess}>Заявка отправлена. Мы получили контакты.</p>}
      {status === "error" && <p className={styles.formError}>Не получилось отправить. Проверь поля и попробуй ещё раз.</p>}
    </form>
  );
}
