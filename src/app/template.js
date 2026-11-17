// Re-mounts on every navigation, so each page fades in instead of snapping.
// Opacity only: a transform here would become the containing block for every
// fixed-position modal and sticky header on the page.
export default function Template({ children }) {
  return <div className="animate-fade-in">{children}</div>;
}
