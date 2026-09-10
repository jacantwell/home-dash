import Link from "next/link";

export default function NotFound() {
  return (
    <main className="raw mx-auto w-full max-w-4xl flex-1 px-4 pb-8">
      <h1>Not Found</h1>
      <p>The requested URL was not found on this server.</p>
      <p>
        <Link href="/">Back to Index of /</Link>
      </p>
      <hr />
      <address>home-dash/{process.env.NEXT_PUBLIC_APP_VERSION} Server at home Port 3000</address>
    </main>
  );
}
