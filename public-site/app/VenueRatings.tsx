import { safeContactUrl } from "./VenueContacts";

type Ratings = {
  rating_2gis?: number | string | null;
  rating_yandex?: number | string | null;
  two_gis_url?: string | null;
  yandex_maps_url?: string | null;
};

export default function VenueRatings({ place }: { place: Ratings }) {
  return <>{([
    ["2ГИС", place.rating_2gis, place.two_gis_url],
    ["Яндекс", place.rating_yandex, place.yandex_maps_url],
  ] as const).map(([label, rating, url]) => {
    const href = safeContactUrl(url);
    const value = rating == null ? null : Number(rating);
    const score = value != null && Number.isFinite(value) && value >= 1 && value <= 5 ? value.toFixed(1) : null;
    const content = <><b>{score || "Отзывы ↗"}</b> {label}</>;
    return href ? <a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label}: ${score ? `оценка ${score}` : "читать отзывы"}`}>{content}</a> : <span key={label}>{content}</span>;
  })}</>;
}
