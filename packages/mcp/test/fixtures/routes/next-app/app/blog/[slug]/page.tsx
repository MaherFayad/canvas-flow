export function generateStaticParams() {
  return [{ slug: 'hello-world' }, { slug: 'second-post' }];
}
export default function Page() {
  return <main />;
}
