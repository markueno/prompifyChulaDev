import appleMd from './design-md/apple.md?raw';
import airbnbMd from './design-md/airbnb.md?raw';
import stripeMd from './design-md/stripe.md?raw';
import notionMd from './design-md/notion.md?raw';
import linearMd from './design-md/linear.md?raw';
import figmaMd from './design-md/figma.md?raw';
import spotifyMd from './design-md/spotify.md?raw';
import framerMd from './design-md/framer.md?raw';
import raycastMd from './design-md/raycast.md?raw';
import supabaseMd from './design-md/supabase.md?raw';

export const DESIGN_SYSTEMS: Record<string, string> = {
  apple: appleMd,
  airbnb: airbnbMd,
  stripe: stripeMd,
  notion: notionMd,
  linear: linearMd,
  figma: figmaMd,
  spotify: spotifyMd,
  framer: framerMd,
  raycast: raycastMd,
  supabase: supabaseMd,
};
