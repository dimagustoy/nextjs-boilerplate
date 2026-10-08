export type VenueAmenityFields = {
  slug?: string;
  has_kitchen?: boolean | null;
  has_spirits?: boolean | null;
  has_beer?: boolean | null;
  has_console?: boolean | null;
};

const amenities = [
  ["has_kitchen", "Кухня"],
  ["has_spirits", "Крепкий алкоголь"],
  ["has_beer", "Пиво"],
  ["has_console", "Приставка"],
] as const;

function AmenityIcon({ field }: { field: typeof amenities[number][0] }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {field === "has_kitchen" && <><path d="M4 3v5a3 3 0 0 0 6 0V3M7 3v18M16 3v9h4M20 3v18" /></>}
    {field === "has_spirits" && <><path d="M3 4h18l-9 9-9-9ZM12 13v7M7 21h10M6 7h12" /></>}
    {field === "has_beer" && <><path d="M5 7h12v14H5zM17 9h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M9 10v7M13 10v7M5 7V5a2 2 0 0 1 3-1 3 3 0 0 1 5 0 2 2 0 0 1 4 1v2" /></>}
    {field === "has_console" && <><path d="M8 7h8a4 4 0 0 1 4 3l2 7a3 3 0 0 1-5 3l-3-3h-4l-3 3a3 3 0 0 1-5-3l2-7a4 4 0 0 1 4-3ZM6 12h4M8 10v4" /><circle cx="16" cy="11" r=".8" fill="currentColor" stroke="none" /><circle cx="18" cy="13" r=".8" fill="currentColor" stroke="none" /></>}
  </svg>;
}

export default function VenueAmenities({ place }: { place: VenueAmenityFields }) {
  return <ul className="venue-amenities" aria-label="Что есть в заведении">
    {amenities.map(([field, label]) => {
      const state = place[field];
      const comingSoon = state !== true && place.slug === "ekb-beloglazova-2g" && (field === "has_kitchen" || field === "has_spirits");
      if ((field === "has_kitchen" || field === "has_spirits") && state !== true && !comingSoon) return null;
      return <li key={field} className={`venue-amenity${state === true ? " venue-amenity-active" : comingSoon ? " venue-amenity-soon" : ""}`}>
        <AmenityIcon field={field} />
        <span>{comingSoon && field === "has_spirits" ? "Бар" : label}<small>{state === true ? "✓ Есть" : comingSoon ? "СКОРО" : state === false ? "— Нет" : "? Уточняется"}</small></span>
      </li>;
    })}
  </ul>;
}
