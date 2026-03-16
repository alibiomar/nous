import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

function createCloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return createHash('sha1').update(`${sortedParams}${apiSecret}`).digest('hex');
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'Cloudinary server credentials are missing' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Image file is required' }, { status: 400 });
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Image must be smaller than 5MB' },
        { status: 400 }
      );
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const uploadParams: Record<string, string> = {
      folder: 'nous',
      timestamp,
    };

    const signature = createCloudinarySignature(uploadParams, apiSecret);

    const cloudinaryFormData = new FormData();
    cloudinaryFormData.append('file', file);
    cloudinaryFormData.append('api_key', apiKey);
    cloudinaryFormData.append('timestamp', timestamp);
    cloudinaryFormData.append('folder', 'nous');
    cloudinaryFormData.append('signature', signature);

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      {
        method: 'POST',
        body: cloudinaryFormData,
      }
    );

    const uploadResult = await uploadResponse.json();

    if (!uploadResponse.ok) {
      const message = uploadResult?.error?.message || 'Cloudinary upload failed';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ secureUrl: uploadResult.secure_url });
  } catch (error) {
    console.error('Upload route error:', error);
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
  }
}
