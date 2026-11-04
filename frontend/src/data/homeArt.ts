// Home lobby artwork slots. The owner will send the final 3D illustrations later —
// drop the PNG into assets/home/ and replace `null` with require("@/assets/home/<file>.png").
// While a slot is null the lobby renders an icon + glow placeholder instead.
export const HOME_ART: {
  mascot: number | null; // footballer kicking a glowing golden ball (hero, top-left)
  timeAttack: number | null; // running players (Time Attack card)
  tournament: number | null; // chained / locked trophy (Tournament card)
  classic: number | null; // glowing gold trophy (Classic card)
} = {
  mascot: null,
  timeAttack: null,
  tournament: null,
  classic: null,
};
