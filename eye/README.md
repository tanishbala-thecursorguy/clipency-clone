# The Eye of Marketing

The intro film on the homepage. It plays on a first visit and again after 7 days; `/?eye` plays it any time, and the footer links there too.
It is skipped for crawlers and for links to a section (`/#start`). There is no sound.

| File | What it holds |
|---|---|
| `eye-plate.webp` | The eye artwork (1671 × 941). Every era sits somewhere inside it. |
| `eye-data.js` | All words and settings: booking link, the story lines, the 7 chapters, where each chapter looks in the artwork (`focus`, in image pixels), the activities, the Clipency reveal |
| `eye.css` | Layout, film effects (letterbox, smoke, grain, flashes), buttons, mobile |
| `eye.js` | The engine: the eye opening, the turning iris, camera flights, activities, skip |

No libraries and no build step. The homepage loads these files only when the film is going to play.

To swap the artwork for a sharper one, keep the same framing (or update `IRIS`, `GLINT` in `eye.js` and the `focus` points in `eye-data.js`).

## Testing

- `/?eye&eyespeed=8` runs everything 8× faster.
- To see it again as a first-time visitor: `localStorage.removeItem('cx-eye-seen')`.
- Reduced-motion users get short fades instead of big camera moves. Phones and slow devices (`html.lite`) skip the grain and dust.
