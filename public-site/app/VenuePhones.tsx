export type VenuePhoneFields = { phone?: string | null; phone_secondary?: string | null };

export default function VenuePhones({ place, className }: { place: VenuePhoneFields; className?: string }) {
  return <>{([place.phone, place.phone_secondary]).map((phone, index) => {
    if (!phone) return null;
    const number = phone.replace(/[^+\d]/g, "");
    if (!/^\+?\d{5,15}$/.test(number)) return null;
    return <a key={index} className={className} href={`tel:${number}`}>{place.phone_secondary ? `Позвонить ${phone}` : "Позвонить"}</a>;
  })}</>;
}
