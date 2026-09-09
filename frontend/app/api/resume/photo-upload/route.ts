import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

/** jpg / png / webp only, 5MB cap - enforced here as well as in the form. */
const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Auth endpoint for the browser -> Vercel Blob client upload. The file itself
 * never passes through this route: the browser asks here for a short-lived
 * upload token, then PUTs straight to Blob storage.
 *
 * Requires BLOB_READ_WRITE_TOKEN in the environment.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: MAX_SIZE_BYTES,
        addRandomSuffix: true,
      }),
      // Nothing to persist here: the resume row stores the returned URL when the
      // user saves the form, so an abandoned upload leaves no dangling record.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "업로드에 실패했어요." },
      { status: 400 }
    );
  }
}
