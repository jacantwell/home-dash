"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, Dialog, StatusBar, ToolButton } from "@/components/xp";
import {
  type AlbumSummary,
  ApiError,
  createAlbum,
  displayName,
  listAlbums,
  MAX_ALBUM_TITLE_LENGTH,
} from "@/lib/api";

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return "Something went wrong. Try again.";
}

export function GalleryClient() {
  const { getToken } = useAuth();
  const router = useRouter();
  return <AlbumBrowser getToken={getToken} onOpen={(id) => router.push(`/gallery/${id}`)} />;
}

interface AlbumBrowserProps {
  getToken: () => Promise<string | null>;
  onOpen: (id: string) => void;
}

export function AlbumBrowser({ getToken, onOpen }: AlbumBrowserProps) {
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const list = await listAlbums(token);
        if (live) setAlbums(list);
      } catch (err) {
        if (live) setError(errorMessage(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [getToken]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("You've been signed out. Sign in and try again.");
      const album = await createAlbum(token, title.trim());
      onOpen(album.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="xp-toolbar">
        <ToolButton icon="folder" label="New album" onClick={() => setCreating(true)} />
      </div>
      <div className="gallery-pane">
        {albums === null && !error && <p className="p-3">Loading albums...</p>}
        {albums?.length === 0 && (
          <p className="p-3">No albums yet. Make one and start dumping photos in.</p>
        )}
        {albums && albums.length > 0 && (
          <ul className="album-grid" aria-label="Albums">
            {albums.map((a) => (
              <li key={a.id}>
                <Link href={`/gallery/${a.id}`} className="album-tile">
                  <span className="album-cover">
                    {a.cover_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed CloudFront URL
                      <img src={a.cover_url} alt="" loading="lazy" />
                    ) : (
                      <PixelIcon name="folder" size={56} />
                    )}
                  </span>
                  <span className="album-title">{a.title}</span>
                  <span className="album-meta">
                    {a.photo_count} {a.photo_count === 1 ? "photo" : "photos"} &middot;{" "}
                    {displayName(a.created_by_name)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <StatusBar>
        <span>{albums ? `${albums.length} album${albums.length === 1 ? "" : "s"}` : ""}</span>
      </StatusBar>

      {creating && (
        <Dialog
          title="New Album"
          icon="folder"
          actions={
            <>
              <Button
                type="submit"
                form="new-album"
                className="default"
                disabled={!title.trim() || busy}
              >
                Create
              </Button>
              <Button onClick={() => setCreating(false)}>Cancel</Button>
            </>
          }
        >
          <form id="new-album" onSubmit={submit}>
            <label className="flex flex-col gap-1">
              Album name
              <input
                className="xp-field"
                value={title}
                maxLength={MAX_ALBUM_TITLE_LENGTH}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </label>
          </form>
        </Dialog>
      )}

      {error && (
        <Dialog
          title="My Pictures"
          icon="error"
          role="alert"
          actions={<Button onClick={() => setError(null)}>OK</Button>}
        >
          {error}
        </Dialog>
      )}
    </>
  );
}
