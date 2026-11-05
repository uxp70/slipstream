// Difficulty tiers. Every tier scales the same levers — wave size, enemy health,
// speed, damage and fire cadence — so the fight reads differently without any
// enemy needing a second rule set. Scoring is identical on all three, which
// keeps best scores comparable across tiers.
export const DIFFICULTIES = {
  rookie: {
    id: 'rookie',
    name: 'ROOKIE',
    blurb: 'thinner waves, softer hits, more room to learn the arenas.',
    count: 0.65,
    hp: 0.8,
    speed: 0.9,
    damage: 0.65,
    fireDelay: 1.3,
    waveHeal: 25,
  },
  standard: {
    id: 'standard',
    name: 'STANDARD',
    blurb: 'the tuned fight the arenas were balanced around.',
    count: 1,
    hp: 1,
    speed: 1,
    damage: 1,
    fireDelay: 1,
    waveHeal: 15,
  },
  overclock: {
    id: 'overclock',
    name: 'OVERCLOCK',
    blurb: 'denser waves, faster hostiles, heavier fire and leaner repairs.',
    count: 1.45,
    hp: 1.3,
    speed: 1.1,
    damage: 1.45,
    fireDelay: 0.78,
    waveHeal: 8,
  },
};
