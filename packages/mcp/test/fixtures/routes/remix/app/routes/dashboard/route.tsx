import { requireUserId } from '~/session.server';
export async function loader({ request }) {
  return requireUserId(request);
}
export default function Route() {
  return <main />;
}
