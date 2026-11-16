"use client";

import { useEffect, useRef, useState } from "react";

import { Button, TitleBar } from "@/components/xp";
import { displayName, type Photo } from "@/lib/api";
import { formatRelative } from "@/lib/time";

interface LightboxProps {
  photos: Photo[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onDelete: (photo: Photo) => void;
}

const SWIPE_PX = 50;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Lightbox({ photos, index, onIndex, onClose, onDelete }: LightboxProps) {
  const photo = photos[index];
  const [confirming, setConfirming] = useState(false);
  const swipeFrom = useRef<number | null>(null);
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onIndex(index - 1);
      else if (e.key === "ArrowRight" && hasNext) onIndex(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, hasPrev, hasNext, onIndex, onClose]);

  return (
    <div className="xp-overlay lightbox-overlay">
      <div className="xp-window lightbox" role="dialog" aria-label="Picture viewer">
        <TitleBar
          title={`Photo ${index + 1} of ${photos.length} - Picture Viewer`}
          icon="picture"
        />
        <div
          className="lightbox-stage"
          onPointerDown={(e) => {
            swipeFrom.current = e.clientX;
          }}
          onPointerUp={(e) => {
            if (swipeFrom.current === null) return;
            const dx = e.clientX - swipeFrom.current;
            swipeFrom.current = null;
            if (dx > SWIPE_PX && hasPrev) onIndex(index - 1);
            if (dx < -SWIPE_PX && hasNext) onIndex(index + 1);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed CloudFront URL */}
          <img
            key={photo.id}
            src={photo.display_url}
            alt={`Photo ${index + 1} by ${displayName(photo.uploader_name)}`}
            draggable={false}
          />
        </div>
        <div className="lightbox-bar">
          <Button
            aria-label="Previous photo"
            disabled={!hasPrev}
            onClick={() => onIndex(index - 1)}
          >
            &larr;
          </Button>
          <Button aria-label="Next photo" disabled={!hasNext} onClick={() => onIndex(index + 1)}>
            &rarr;
          </Button>
          <span className="lightbox-meta">
            {displayName(photo.uploader_name)} &middot; {formatRelative(photo.created_at)} &middot;{" "}
            {photo.width}&times;{photo.height} &middot; {formatBytes(photo.bytes)}
          </span>
          <a className="xp-btn" href={photo.original_url} target="_blank" rel="noreferrer">
            Original
          </a>
          {photo.deletable &&
            (confirming ? (
              <>
                <Button
                  className="default"
                  onClick={() => {
                    setConfirming(false);
                    onDelete(photo);
                  }}
                >
                  Really delete?
                </Button>
                <Button onClick={() => setConfirming(false)}>Keep</Button>
              </>
            ) : (
              <Button onClick={() => setConfirming(true)}>Delete</Button>
            ))}
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
