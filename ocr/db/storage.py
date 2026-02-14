"""Supabase Storage client for uploading newspaper images."""

import logging
import os

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


def get_storage_client():
    """Return a Supabase client, or None if env vars are missing."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")

    if not url or not key:
        logger.info("SUPABASE_URL/SUPABASE_KEY not set — storage uploads disabled")
        return None

    from supabase import create_client

    return create_client(url, key)


def ensure_bucket(client, bucket_name="newspaper-images"):
    """Create a public bucket if it doesn't already exist."""
    from storage3.utils import StorageException

    try:
        client.storage.create_bucket(
            bucket_name,
            options={
                "public": True,
                "allowed_mime_types": ["image/jpeg", "image/png"],
                "file_size_limit": 10 * 1024 * 1024,  # 10 MB
            },
        )
        logger.info("Created storage bucket '%s'", bucket_name)
    except StorageException as e:
        if "already exists" in str(e).lower():
            logger.debug("Bucket '%s' already exists", bucket_name)
        else:
            raise


def upload_image(client, local_path, storage_path, bucket="newspaper-images"):
    """
    Upload a local image file to Supabase Storage.

    Returns the public URL on success, or None on failure (non-fatal).
    """
    try:
        with open(local_path, "rb") as f:
            client.storage.from_(bucket).upload(
                path=storage_path,
                file=f,
                file_options={"content-type": "image/jpeg", "upsert": "true"},
            )

        public_url = client.storage.from_(bucket).get_public_url(storage_path)
        return public_url

    except Exception as e:
        logger.warning("Failed to upload %s: %s", local_path, e)
        return None
