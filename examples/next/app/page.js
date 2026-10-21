// A server component: it can render the client component directly. silk.js touches the DOM only inside the
// component's effect, so server rendering is safe and no next/dynamic is needed.
import Demo from '../components/Demo';

export default function Page() {
  return <Demo />;
}
