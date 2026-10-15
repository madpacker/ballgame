import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")


@pytest.fixture(scope="session")
def base_url():
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    assert url, "EXPO_PUBLIC_BACKEND_URL not set"
    return url.rstrip("/")


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
