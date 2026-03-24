import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

const MAX_IMAGE_SIZE    = 5 * 1024 * 1024;   // 5 MB
const MAX_VIDEO_SIZE    = 50 * 1024 * 1024;  // 50 MB
const MAX_VIDEO_DURATION = 30;               // seconds

function createCloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${sortedParams}${apiSecret}`).digest('hex');
}

// ── Cloudinary URL transformations ───────────────────────────────────────────

function applyImageTransformations(url: string, isSelfie: boolean): string {
  // w_1080          → cap width at 1080 px
  // q_auto,f_auto   → optimised quality + format
  // a_hflip         → flip selfie (front-camera) images back to natural orientation
  // No portrait crop — stories use /api/upload/story for that.
  const flip = isSelfie ? ',a_hflip' : '';
  return url.replace(
    '/image/upload/',
    `/image/upload/w_1080,q_auto,f_auto${flip}/`,
  );
}

function applyVideoTransformations(url: string): string {
  // Trimming is already baked in via so_/eo_ upload params.
  // q_auto,f_auto selects webm for supporting browsers, mp4 otherwise.
  return url.replace('/video/upload/', '/video/upload/q_auto,f_auto/');
}

// ── POST /api/upload ─────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'Cloudinary server credentials are missing' },
        { status: 500 },
      );
    }

    const formData      = await request.formData();
    const file          = formData.get('file');
    const startOffsetRaw = formData.get('startOffset');
    const startOffset   = startOffsetRaw ? parseFloat(startOffsetRaw as string) : 0;
    // Client sends this flag when the photo/video was taken with the front camera
    // so we know to apply a_hflip on delivery to restore natural (non-mirrored) orientation.
    const isSelfie      = formData.get('isSelfie') === 'true';

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    if (!isImage && !isVideo) {
      return NextResponse.json(
        { error: 'Only image or video files are allowed' },
        { status: 400 },
      );
    }

    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `${isVideo ? 'Video' : 'Image'} must be smaller than ${maxSize / 1024 / 1024}MB` },
        { status: 400 },
      );
    }

    const timestamp    = Math.floor(Date.now() / 1000).toString();
    const resourceType = isVideo ? 'video' : 'image';

    const uploadParams: Record<string, string> = {
      folder: 'nous',
      timestamp,
    };

    if (isVideo) {
      const endOffset = startOffset + MAX_VIDEO_DURATION;
      uploadParams.transformation = `so_${startOffset.toFixed(1)},eo_${endOffset.toFixed(1)}`;
    }

    const signature = createCloudinarySignature(uploadParams, apiSecret);

    const cloudinaryFormData = new FormData();
    cloudinaryFormData.append('file',      file);
    cloudinaryFormData.append('api_key',   apiKey);
    cloudinaryFormData.append('timestamp', timestamp);
    cloudinaryFormData.append('folder',    'nous');
    cloudinaryFormData.append('signature', signature);

    if (isVideo) {
      const endOffset = startOffset + MAX_VIDEO_DURATION;
      cloudinaryFormData.append(
        'transformation',
        `so_${startOffset.toFixed(1)},eo_${endOffset.toFixed(1)}`,
      );
    }

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
      { method: 'POST', body: cloudinaryFormData },
    );

    const uploadResult = await uploadResponse.json();

    if (!uploadResponse.ok) {
      const message = uploadResult?.error?.message || 'Cloudinary upload failed';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const optimizedUrl = isImage
      ? applyImageTransformations(uploadResult.secure_url, isSelfie)
      : applyVideoTransformations(uploadResult.secure_url);

    return NextResponse.json({
      secureUrl:    optimizedUrl,
      publicId:     uploadResult.public_id,
      resourceType,
      duration:     uploadResult.duration ?? null,
    });
  } catch (error) {
    console.error('Upload route error:', error);
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}