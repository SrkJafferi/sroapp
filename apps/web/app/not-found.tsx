import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="standalone-empty">
      <h1>This clinic page was not found</h1>
      <p>Choose your clinic workspace to continue.</p>
      <Link className="btn btn-primary" href="/admin">
        Open clinic dashboard
      </Link>
    </main>
  );
}
