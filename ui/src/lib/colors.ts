// Chart colors. Validated with the dataviz palette checker against the dark
// surfaces used here (#09090b, #18181b): categorical hues in fixed order,
// all pass CVD / normal-vision separation and 3:1 contrast. Text never wears
// these colors - they only mark identity on bars, dots and swatches.

/** The three retrieval rankings. First three palette slots: valid for any pairing. */
export const ARM = {
  bm25: '#d95926',
  dense: '#3987e5',
  fused: '#199e70',
} as const

/** Categorical series in fixed order (adjacent pairs validated). Never cycled. */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9']

/** Fold color for series past the palette ("other"). */
export const OTHER = '#52525b'

/** Neutral mark color for single-series charts. */
export const NEUTRAL = '#a1a1aa'
