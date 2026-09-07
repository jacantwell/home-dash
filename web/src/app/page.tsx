import Link from "next/link";

import { PixelIcon } from "@/components/pixel-icon";

// The landing is an Apache-style directory listing: one row per thing the house can do.
const ENTRIES = [
  {
    href: "/board",
    name: "board/",
    icon: "folder",
    size: "-",
    description: "Send a message to the LED board",
  },
  {
    href: "/terms",
    name: "terms.html",
    icon: "document",
    size: "4.2K",
    description: "Terms and conditions",
  },
] as const;

const NAME_WIDTH = 24;

// Apache's `%d-%b-%Y %H:%M`.
function apacheDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${pad(d.getDate())}-${month}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const built = apacheDate(new Date());

export default function Home() {
  return (
    <main className="raw mx-auto w-full max-w-4xl flex-1 px-4 pb-8">
      <h1>Index of /</h1>
      <pre>
        <span className="inline-block w-5" aria-hidden /> {"Name".padEnd(NAME_WIDTH)}
        {"Last modified".padEnd(20)}
        {"Size".padEnd(6)}Description
        <hr />
        {ENTRIES.map((e) => (
          <span key={e.href}>
            <PixelIcon name={e.icon} size={16} label={e.icon === "folder" ? "directory" : "file"} />{" "}
            {""}
            <Link href={e.href}>{e.name}</Link>
            {"".padEnd(NAME_WIDTH - e.name.length)}
            {built.padEnd(20)}
            {e.size.padEnd(6)}
            {e.description}
            {"\n"}
          </span>
        ))}
        <hr />
      </pre>
      <address>home-dash/{process.env.NEXT_PUBLIC_APP_VERSION} Server at home Port 3000</address>
    </main>
  );
}
