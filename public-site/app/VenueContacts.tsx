export type VenueContactFields = {
  telegram_channel_url?: string | null;
  vk_group_url?: string | null;
  booking_telegram_url?: string | null;
  booking_max_url?: string | null;
  booking_whatsapp_url?: string | null;
};

const contacts = [
  ["booking_telegram_url", "Написать в Telegram"],
  ["booking_max_url", "Написать в MAX"],
  ["booking_whatsapp_url", "Написать в WhatsApp"],
  ["telegram_channel_url", "Telegram-канал"],
  ["vk_group_url", "Группа ВКонтакте"],
] as const;

export function safeContactUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export default function VenueContacts({ place, className }: { place: VenueContactFields; className?: string }) {
  return <>{contacts.map(([field, label]) => {
    const href = safeContactUrl(place[field]);
    return href ? <a key={field} className={className} href={href} target="_blank" rel="noopener noreferrer">{label} ↗</a> : null;
  })}</>;
}
