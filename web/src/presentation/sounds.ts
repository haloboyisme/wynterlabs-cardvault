// Original short synthesized cues; no media downloads or server processing.
export const SOUND_IDS = ["chime", "arcade", "fanfare", "bell", "bubbles", "radar", "sparkle", "coin", "powerup", "victory", "error", "warning", "sonar", "twinkle", "drumroll"] as const;
export type SoundId = "off" | typeof SOUND_IDS[number];
export const SOUND_OPTIONS = ["off", ...SOUND_IDS];
export const SOUND_PATTERNS: Record<typeof SOUND_IDS[number], {notes:number[]; wave:OscillatorType}> = {
 chime:{notes:[659,880],wave:"sine"}, arcade:{notes:[523,784,1047],wave:"triangle"},
 fanfare:{notes:[523,659,784,1047,784,1047],wave:"triangle"},
 bell:{notes:[1047,784],wave:"sine"}, bubbles:{notes:[330,494,740,988],wave:"sine"},
 radar:{notes:[880,880,1320],wave:"sine"}, sparkle:{notes:[1047,1319,1568,2093],wave:"sine"},
 coin:{notes:[988,1976],wave:"square"}, powerup:{notes:[262,330,392,523,659,784],wave:"triangle"},
 victory:{notes:[392,523,659,784,659,1047],wave:"triangle"}, error:{notes:[196,147,110],wave:"triangle"},
 warning:{notes:[440,660,440,660],wave:"triangle"}, sonar:{notes:[660,440,330],wave:"sine"},
 twinkle:{notes:[784,1175,988,1568,1319],wave:"sine"}, drumroll:{notes:[110,120,130,140,150,180,262],wave:"triangle"},
};
