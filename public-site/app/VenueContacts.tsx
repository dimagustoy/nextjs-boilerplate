export type VenueContactFields = {
  telegram_channel_url?: string | null;
  vk_group_url?: string | null;
  instagram_url?: string | null;
  booking_telegram_url?: string | null;
  booking_vk_url?: string | null;
  booking_website_url?: string | null;
  booking_max_url?: string | null;
  booking_whatsapp_url?: string | null;
};

const contacts = [
  ["booking_telegram_url", "Написать в Telegram"],
  ["booking_max_url", "Написать в MAX"],
  ["booking_whatsapp_url", "Написать в WhatsApp"],
  ["booking_vk_url", "Бронировать во ВКонтакте"],
  ["booking_website_url", "Бронировать на сайте"],
  ["telegram_channel_url", "Telegram-канал"],
  ["vk_group_url", "Группа ВКонтакте"],
  ["instagram_url", "Instagram"],
] as const;

export function safeContactUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function MessengerIcon({ max }: { max: boolean }) {
  return <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="16" fill={max ? "#7058f5" : "#229ED9"} />
    {max ? <path fill="white" d="M16 6a10 10 0 0 0-8.7 15L6 26l5.3-1.4A10 10 0 1 0 16 6Zm0 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z" /> : <path fill="white" d="m7 15 17-7c.8-.3 1.3.2 1 1l-3 15c-.2 1-1 .9-1.6.5l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.8 8.8-8c.4-.4-.1-.5-.6-.2L10 17.6l-3-.9c-.9-.3-.9-.9 0-1.7Z" />}
  </svg>;
}

export default function VenueContacts({ place, className }: { place: VenueContactFields; className?: string }) {
  const hasMax = Boolean(safeContactUrl(place.booking_max_url));
  return <>{contacts.map(([field, label]) => {
    if (field === "booking_whatsapp_url" && hasMax) return null;
    const href = safeContactUrl(place[field]);
    const icon = field === "booking_telegram_url" || field === "booking_max_url" || field === "telegram_channel_url";
    return href ? <a key={field} className={[className, icon ? "venue-contact-icon" : ""].filter(Boolean).join(" ")} href={href} title={icon ? label : undefined} aria-label={icon ? label : undefined} target="_blank" rel="noopener noreferrer">{icon ? <MessengerIcon max={field === "booking_max_url"} /> : `${label} ↗`}</a> : null;
  })}</>;
}
