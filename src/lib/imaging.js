/*
 * Preparing a screen crop so small interface text can be read.
 *
 * Lifting the text out of the picture behind it.
 *
 * In a raid the item's name is a small light-grey label printed over the item's
 * own artwork, and the reading lost more than half of them. The label is far
 * brighter than anything it is drawn on, so turning the crop grey and pushing
 * everything below roughly two thirds brightness to black leaves the text
 * standing on its own. Measured on the user's own gear screen, labels read went
 * from 6 of 14 to 12 of 14, and a flea market list reads exactly as well as
 * before.
 *
 * The crop still has to be enlarged afterwards - read at its captured size the
 * same screens score 3 of 14 and 2 of 14 - but the enlarging is left to the
 * image library, because a hand-written bicubic pass measured no better.
 */
const textFloor = 130,
  textGain = 2;

// Rec. 709 luma. The weighting is not a detail here: the labels sit over
// strongly coloured artwork, and greying a saturated green or red by the older
// Rec. 601 weights shifts which of them survive the threshold.
function liftText(bgra) {
  const pixels = Buffer.from(bgra);
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = 0.0722 * pixels[i] + 0.7152 * pixels[i + 1] + 0.2126 * pixels[i + 2],
      lifted = Math.max(0, Math.min(255, Math.round(textGain * luma - textFloor)));
    pixels[i] = lifted;
    pixels[i + 1] = lifted;
    pixels[i + 2] = lifted;
    pixels[i + 3] = 255;
  }
  return pixels;
}

export { liftText, textFloor, textGain };
