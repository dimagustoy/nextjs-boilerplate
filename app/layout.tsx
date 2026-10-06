import type { Metadata } from "next";
import "./globals.css";
import "./network.css";
import "./place-details.css";
import NetworkDirectory from "./NetworkDirectory";
import JournalSourceLinks from "./JournalSourceLinks";

export const metadata: Metadata = {
  title: "Не Усложняй — места, люди, истории",
  description: "Сеть «Не Усложняй»: 15 заведений в 11 городах. Найди своё место, узнай, что происходит в NU, или открой «Не Усложняй» в своём городе.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}<NetworkDirectory /><JournalSourceLinks /></body>
    </html>
  );
}
