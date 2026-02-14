"""Database engine and session factory. Reads DATABASE_URL from .env."""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL", "")

if DATABASE_URL:
    engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine)
else:
    engine = None
    SessionLocal = None


def get_session():
    """Create a new database session. Caller must close it."""
    if SessionLocal is None:
        raise RuntimeError(
            "DATABASE_URL not set. Add it to .env with your Supabase connection string."
        )
    return SessionLocal()
