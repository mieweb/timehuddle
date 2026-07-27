/** The TimeHuddle brand mark.
 *
 * Single source of truth for the app icon so the sidebar, landing page, and any
 * future surface stay in sync. The artwork is opaque (its centre well and the
 * "H" are painted white, so it cannot be knocked out to transparency without
 * losing the letter against a dark background) — hence the light tile, which
 * also matches how the icon is presented on iOS and Android home screens.
 */
type LogoProps = {
  /** Rendered edge length in pixels. Defaults to the 32px sidebar mark. */
  size?: number;
  className?: string;
};

export function Logo({ size = 32, className = '' }: LogoProps) {
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-lg bg-white object-contain shadow-sm ${className}`}
    />
  );
}
