export async function getStaticPaths() {
  return { paths: [{ params: { id: '42' } }], fallback: false };
}
export default function Page() {
  return <main />;
}
