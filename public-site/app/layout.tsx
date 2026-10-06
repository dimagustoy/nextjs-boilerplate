import type { Metadata } from "next";
import "./globals.css";
import "./network.css";
import "./place-details.css";
import "./visual-v2.css";
import "./atmosphere-v3.css";
import "./progressive-directory.css";
import "./network-native.css";
import JournalSourceLinks from "./JournalSourceLinks";

export const metadata: Metadata = {
  title: "Не Усложняй — места, люди, истории",
  description: "Сеть «Не Усложняй»: места, люди, события и истории бренда. Найди свой NU или открой «Не Усложняй» в своём городе.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}<JournalSourceLinks /></body>
    </html>
  );
}
