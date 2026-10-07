export type VenueAmenityFields = {
  has_kitchen?: boolean | null;
  has_spirits?: boolean | null;
  has_beer?: boolean | null;
  has_console?: boolean | null;
};

const amenities = [
  ["has_kitchen", "Кухня", "🍴"],
  ["has_spirits", "Крепкий алкоголь", "🍸"],
  ["has_beer", "Пиво", "🍺"],
  ["has_console", "Приставка", "🎮"],
] as const;

export default function VenueAmenities({ place }: { place: VenueAmenityFields }) {
  return <ul className="venue-amenities" aria-label="Что есть в заведении">
    {amenities.map(([field, label, icon]) => {
      const state = place[field];
      return <li key={field} className={`venue-amenity${state === true ? " venue-amenity-active" : ""}`}>
        <span aria-hidden="true">{icon}</span>
        <span>{label}<small>{state === true ? "✓ Есть" : state === false ? "— Нет" : "? Уточняется"}</small></span>
      </li>;
    })}
  </ul>;
}
