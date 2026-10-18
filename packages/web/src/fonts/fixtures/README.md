# Font metric references

`web-font-fixture.ttf` and `.woff2` are an ASCII subset of Liberation Sans
Regular from the installed `pdfjs-dist@5.4.296/standard_fonts` distribution.
The SIL OFL 1.1 is reproduced in `OFL.txt`. The modified family was renamed
to **Web Font Fixture**, avoiding the reserved font names. Outlines are real;
the fixture is 11 KB as sfnt and 7 KB as WOFF2. No tool is needed to run tests.

Reproduction: fontTools 4.27.1, subset U+0020–007E, disable hinting, retain
name IDs 0–6 for language 0x409, and replace name IDs 1, 3, 4, 6 with
`Web Font Fixture`. Save once as TTF, then with `font.flavor = "woff2"`.
The Brotli encoder was 1.0.9. These tools are not project dependencies.

Independently verified with the installed `@capsizecss/unpack@4.0.1`
`fromBuffer` for both containers: unitsPerEm 2048, ascent 1854, descent -434,
lineGap 67, weighted Latin xWidthAvg 913. fontTools confirms OS/2
xAvgCharWidth 1208 and typo ascender/descender/lineGap 1491/-431/307.

`published-metrics.ts` and `../system-metrics.ts` contain selected data from
[@capsizecss/metrics](https://github.com/seek-oss/capsize/blob/1fcf40ae804b918b9b2289cc046f12cedf9f34ae/packages/metrics/src/entireMetricsCollection.json),
revision `1fcf40ae804b918b9b2289cc046f12cedf9f34ae`, verified 2026-10-18.
The MIT license is reproduced in `../CAPSIZE-LICENSE.txt`.
`../latin-weightings.ts` records the Latin frequencies in
`@capsizecss/unpack@4.0.1`, under the same license.

The pinned upstream
[`createFontStack`](https://github.com/seek-oss/capsize/blob/1fcf40ae804b918b9b2289cc046f12cedf9f34ae/packages/core/src/createFontStack.ts)
was run independently to verify these expected outputs (percentage values):

| Pair                     | size-adjust | ascent-override | descent-override | line-gap-override |
| ------------------------ | ----------- | --------------- | ---------------- | ----------------- |
| Abel / Arial             | 85.7612     | 114.2115        | 34.3887          | 0                 |
| Roboto / Times New Roman | 109.4952    | 84.7283         | 22.2969          | 0                 |

The reader follows the
[WOFF2 table directory and transforms](https://www.w3.org/TR/2024/REC-WOFF2-20240808/)
and Microsoft's [OpenType tables](https://learn.microsoft.com/en-us/typography/opentype/spec/otff).
It reads advance widths without reconstructing outlines. Vertical metrics use
OS/2's typo values when `USE_TYPO_METRICS` is set, otherwise hhea. Latin width
weighting uses the same sample and rounding as Capsize. Subsets that omit
sample characters use the missing glyph's advance, as Capsize does.
