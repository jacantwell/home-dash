import { completeUpload, type Photo, postToS3, startUpload } from "./api";
import { type PreparedImage, prepareImage } from "./images";

export interface UploadDeps {
  getToken: () => Promise<string | null>;
  prepare?: (file: File) => Promise<PreparedImage>;
  fetchImpl?: typeof fetch;
}

export interface UploadResult {
  file: File;
  photo?: Photo;
  error?: string;
}

const CONCURRENCY = 3;

async function token(getToken: UploadDeps["getToken"]): Promise<string> {
  const t = await getToken();
  if (!t) throw new Error("You've been signed out. Sign in and try again.");
  return t;
}

/** Resize in the browser, reserve the photo, POST all three variants to S3, then confirm. */
export async function uploadPhoto(albumId: string, file: File, deps: UploadDeps): Promise<Photo> {
  const { getToken, prepare = prepareImage, fetchImpl } = deps;
  const image = await prepare(file);
  const ticket = await startUpload(
    await token(getToken),
    albumId,
    {
      content_type: image.contentType,
      bytes: file.size,
      width: image.width,
      height: image.height,
    },
    fetchImpl,
  );
  await Promise.all([
    postToS3(ticket.uploads.original, file, fetchImpl),
    postToS3(ticket.uploads.display, image.display, fetchImpl),
    postToS3(ticket.uploads.thumb, image.thumb, fetchImpl),
  ]);
  return completeUpload(await token(getToken), ticket.photo_id, fetchImpl);
}

/** A few at a time; one bad file doesn't stop the rest. Results keep the input order. */
export async function uploadAll(
  albumId: string,
  files: File[],
  deps: UploadDeps,
  onDone?: (result: UploadResult, finished: number) => void,
): Promise<UploadResult[]> {
  const results: UploadResult[] = new Array(files.length);
  let next = 0;
  let finished = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      const file = files[i];
      try {
        results[i] = { file, photo: await uploadPhoto(albumId, file, deps) };
      } catch (err) {
        results[i] = { file, error: err instanceof Error ? err.message : String(err) };
      }
      onDone?.(results[i], ++finished);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  return results;
}
