import { withPageAuthRequired } from '@auth0/nextjs-auth0';
export const getServerSideProps = withPageAuthRequired();
export default function Page() {
  return <main />;
}
