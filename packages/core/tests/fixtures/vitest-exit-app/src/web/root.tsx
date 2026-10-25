export default function Root({ children }: { children?: unknown }) {
  return <main>{children as never}</main>;
}
