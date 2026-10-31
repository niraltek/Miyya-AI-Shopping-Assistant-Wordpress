export type AccentName =
  | 'miyya'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose'
  | 'slate'
  | 'gray'
  | 'zinc'
  | 'neutral'
  | 'stone'
  | 'taupe'
  | 'mauve'
  | 'mist'
  | 'olive'
  | 'custom';

export interface AccentOption {
  readonly name: AccentName;
  readonly swatch: string;
}
