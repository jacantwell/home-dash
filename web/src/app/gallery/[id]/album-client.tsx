"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PixelIcon } from "@/components/pixel-icon";
import { Button, Dialog, StatusBar, ToolButton, ToolSeparator } from "@/components/xp";
import {
  type Album,
  deleteAlbum,
  deletePhoto,
  getAlbum,
  type Layout,
  type Photo,
  saveLayout,
} from "@/lib/api";
import { resolveLayout } from "@/lib/space";
import { type UploadDeps, uploadAll } from "@/lib/upload";

import { errorMessage } from "../gallery-client";
import { CanvasBoard } from "./canvas-board";
import { Lightbox } from "./lightbox";

type View = "grid" | "canvas";

export function AlbumClient({ albumId }: { albumId: string }) {
  const { getToken } = useAuth();
  const router = useRouter();
  return (
    <AlbumView albumId={albumId} getToken={getToken} onDeleted={() => router.push("/gallery")} />
  );
}

interface AlbumViewProps {
  albumId: string;
  getToken: () => Promise<string | null>;
  onDeleted: () => void;
  uploadDeps?: Partial<UploadDeps>;
}

interface UploadState {
  total: number;
  finished: number;
  failed: string[];
}

export function AlbumView({ albumId, getToken, onDeleted, uploadDeps }: AlbumViewProps) {
  const [album, setAlbum] = useState<Album | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("grid");
  const [open, setOpen] = useState<number | null>(null);
  const [layout, setLayout] = useState<Layout>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const token = useCallback(async () => {
    const t = await getToken();
    if (!t) throw new Error("You've been signed out. Sign in and try again.");
    return t;
  }, [getToken]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const a = await getAlbum(await token(), albumId);
        if (!live) return;
        setAlbum(a);
        setLayout(a.layout);
      } catch (err) {
        if (live) setError(errorMessage(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [albumId, token]);

  const photos = useMemo(() => album?.photos ?? [], [album]);

  // new photos get scattered on top, deleted ones drop out; neither counts as an edit
  const placed = useMemo(() => resolveLayout(photos, layout), [photos, layout]);

  function addPhoto(photo: Photo) {
    setAlbum((a) => a && { ...a, photos: [...a.photos, photo], photo_count: a.photos.length + 1 });
  }

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length || upload) return;
    setUpload({ total: files.length, finished: 0, failed: [] });
    const results = await uploadAll(albumId, files, { getToken, ...uploadDeps }, (r, finished) => {
      if (r.photo) addPhoto(r.photo);
      setUpload((u) => u && { ...u, finished });
    });
    const failed = results.filter((r) => r.error).map((r) => `${r.file.name}: ${r.error}`);
    setUpload(null);
    if (failed.length) setError(`Some photos didn't upload:\n${failed.join("\n")}`);
  }

  async function removePhoto(photo: Photo) {
    try {
      await deletePhoto(await token(), photo.id);
      const left = photos.length - 1;
      setOpen((i) => (i === null || left === 0 ? null : Math.min(i, left - 1)));
      setAlbum((a) => {
        if (!a) return a;
        const next = a.photos.filter((p) => p.id !== photo.id);
        return { ...a, photos: next, photo_count: next.length };
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function removeAlbum() {
    setConfirmDelete(false);
    try {
      await deleteAlbum(await token(), albumId);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function persistLayout() {
    setSaving(true);
    try {
      setLayout(await saveLayout(await token(), albumId, placed));
      setDirty(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function changeLayout(next: Layout) {
    setLayout(next);
    setDirty(true);
  }

  return (
    <>
      <div className="xp-toolbar">
        <Link href="/gallery" className="xp-tool">
          <PixelIcon name="back" size={28} />
          <span>Back</span>
        </Link>
        <ToolSeparator />
        <ToolButton
          icon="picture"
          label={upload ? "Uploading..." : "Upload"}
          disabled={!album || Boolean(upload)}
          onClick={() => fileInput.current?.click()}
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="Choose photos"
          onChange={onFiles}
        />
        <ToolSeparator />
        <div role="radiogroup" aria-label="View" className="flex">
          {(["grid", "canvas"] as const).map((v) => (
            <ToolButton
              key={v}
              role="radio"
              aria-checked={view === v}
              icon={v === "grid" ? "folder" : "pencil"}
              label={v === "grid" ? "Thumbnails" : "Canvas"}
              className={view === v ? "xp-tool on" : "xp-tool"}
              onClick={() => setView(v)}
            />
          ))}
        </div>
        {view === "canvas" && (
          <>
            <ToolSeparator />
            <ToolButton
              icon="check"
              label={saving ? "Saving..." : "Save"}
              disabled={!dirty || saving}
              onClick={persistLayout}
            />
          </>
        )}
        {album?.deletable && (
          <>
            <ToolSeparator />
            <ToolButton icon="error" label="Delete album" onClick={() => setConfirmDelete(true)} />
          </>
        )}
      </div>

      <div className="xp-pane-title">
        <Link href="/gallery">My Pictures</Link>
        <span aria-hidden>&rsaquo;</span>
        <h1 className="font-bold">{album?.title ?? "..."}</h1>
      </div>

      <div className="gallery-pane">
        {!album && !error && <p className="p-3">Loading album...</p>}
        {album && photos.length === 0 && (
          <p className="p-3">Empty album. Hit Upload and pick some photos.</p>
        )}
        {photos.length > 0 && view === "grid" && (
          <ul className="photo-grid" aria-label="Photos">
            {photos.map((p, i) => (
              <li key={p.id}>
                <button type="button" className="photo-tile" onClick={() => setOpen(i)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed CloudFront URL */}
                  <img
                    src={p.thumb_url}
                    alt={`Photo ${i + 1} by ${p.uploader_name || "someone"}`}
                    loading="lazy"
                    width={p.width}
                    height={p.height}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
        {photos.length > 0 && view === "canvas" && (
          <CanvasBoard photos={photos} layout={placed} onChange={changeLayout} onOpen={setOpen} />
        )}
      </div>

      <StatusBar>
        <span>
          {upload
            ? `Uploading ${upload.finished}/${upload.total}...`
            : `${photos.length} photo${photos.length === 1 ? "" : "s"}`}
        </span>
        {view === "canvas" && dirty && <span>Unsaved changes</span>}
      </StatusBar>

      {open !== null && photos[open] && (
        <Lightbox
          key={photos[open].id}
          photos={photos}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onDelete={removePhoto}
        />
      )}

      {confirmDelete && (
        <Dialog
          title="Confirm Album Delete"
          icon="error"
          actions={
            <>
              <Button className="default" onClick={removeAlbum}>
                Yes
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>No</Button>
            </>
          }
        >
          Delete &lsquo;{album?.title}&rsquo; and all {photos.length} photos in it? This can&apos;t
          be undone.
        </Dialog>
      )}

      {error && (
        <Dialog
          title="My Pictures"
          icon="error"
          role="alert"
          actions={<Button onClick={() => setError(null)}>OK</Button>}
        >
          <p className="whitespace-pre-line">{error}</p>
        </Dialog>
      )}
    </>
  );
}
