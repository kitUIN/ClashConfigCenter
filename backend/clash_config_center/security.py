import hashlib
import secrets


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_token(token: str, expected: str) -> bool:
    return secrets.compare_digest(token_digest(token), expected)
