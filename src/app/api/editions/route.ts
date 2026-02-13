import { NextResponse } from 'next/server';
import { listEditions } from '@/src/lib/ocr-adapter';

// Revalidate editions list every 60 seconds (ISR)
export const revalidate = 60;

export async function GET() {
  try {
    const editions = await listEditions();
    return NextResponse.json({ editions });
  } catch (error) {
    console.error('Failed to list editions:', error);
    return NextResponse.json(
      { error: 'Failed to load editions' },
      { status: 500 },
    );
  }
}
