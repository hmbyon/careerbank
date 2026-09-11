"""Admin-only views. Reuses the feedback router's ADMIN_EMAIL check."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.routers.feedback import get_admin_user
from app.schemas import AdminUserOut

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Everyone who signed up, most recently signed-in first.

    Users who have never logged in (null last_login_at) sort to the bottom.
    """
    users = db.query(User).all()
    return sorted(
        users,
        key=lambda u: (u.last_login_at is not None, u.last_login_at or u.created_at),
        reverse=True,
    )
